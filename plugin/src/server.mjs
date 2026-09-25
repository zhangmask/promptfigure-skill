// server.mjs — 本地服务：唯一状态源
// 🔴 只绑 127.0.0.1，绝不 0.0.0.0
// 🔴 写操作双令牌：GUI 走会话令牌（开窗口时注入 URL），CLI 走 daemon.json 里的 cliToken
// 🔴 唯一外呼是出图（render.mjs 里）；本服务自己不向任何外部地址发数据
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import url from "node:url";
import { fileURLToPath } from "node:url";

import { readDaemon, writeDaemon, clearDaemon, ensureDirs } from "./config.mjs";
import { projectByDocId, readMeta, resolveDoc, readReview } from "./store.mjs";
import { sseHandler, appendEvent, readEvents } from "./events.mjs";
import { setAnchor, listAnchors } from "./anchor.mjs";
import { renderFigure, listFigures } from "./render.mjs";
import { reviewStatus, setStatus } from "./review.mjs";
import { resolveRef } from "./doc/para.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");
const WEB_DIR = path.join(PKG_ROOT, "web");
const VENDOR = {
  "/vendor/jszip.min.js": "jszip/dist/jszip.min.js",
  "/vendor/docx-preview.min.js": "docx-preview/dist/docx-preview.min.js",
  "/vendor/pdf.min.js": "pdfjs-dist/legacy/build/pdf.min.js",
  "/vendor/pdf.worker.min.js": "pdfjs-dist/legacy/build/pdf.worker.min.js",
};

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".json": "application/json", ".map": "application/json",
  ".pdf": "application/pdf",
};

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function sendFile(res, file) {
  try {
    const buf = fs.readFileSync(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}

export function startServer({ port, registerDaemon = true }) {
  ensureDirs();
  const guiToken = crypto.randomBytes(16).toString("hex");
  const cliToken = crypto.randomBytes(16).toString("hex");

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    const p = u.pathname;

    try {
      // ---- 静态 ----
      if (p === "/" || p === "/index.html") return sendFile(res, path.join(WEB_DIR, "index.html"));
      if (p === "/app.js") return sendFile(res, path.join(WEB_DIR, "app.js"));
      if (p === "/style.css") return sendFile(res, path.join(WEB_DIR, "style.css"));
      if (p === "/probe.html" && fs.existsSync(path.join(WEB_DIR, "probe.html"))) {
        return sendFile(res, path.join(WEB_DIR, "probe.html"));
      }
      if (VENDOR[p]) {
        const file = path.join(PKG_ROOT, "node_modules", VENDOR[p]);
        return sendFile(res, file);
      }

      // ---- 图文件（figures/<figureId>/<v>.png）----
      const figM = /^\/fig\/([\w-]+)\/([\w.-]+)$/.exec(p);
      if (figM) {
        const doc = u.searchParams.get("doc");
        const dir = projectByDocId(doc);
        return sendFile(res, path.join(dir, "figures", figM[1], figM[2]));
      }

      // ---- 原始文档（给浏览器渲染 docx/pdf 用；只读）----
      // tex 文档：若编译成功，返回编译产物 PDF（GUI 渲染排版结果而非源码文本）
      if (p === "/api/file") {
        const doc = u.searchParams.get("doc");
        const meta = readMeta(doc);
        if (!meta) return json(res, 404, { error: "doc not found" });
        if (meta.kind === "tex") {
          const pdf = path.join(projectByDocId(doc), path.basename(meta.source).replace(/\.tex$/i, "") + ".pdf");
          if (fs.existsSync(pdf)) return sendFile(res, pdf, "application/pdf");
          return json(res, 404, { error: "pdf not compiled（pf doc compile 可重编译）" });
        }
        return sendFile(res, meta.source);
      }

      // ---- SSE ----
      if (p === "/api/events") {
        const doc = u.searchParams.get("doc");
        return sseHandler(doc, req, res);
      }

      // ---- 全量状态 ----
      if (p === "/api/state") {
        const doc = u.searchParams.get("doc");
        const meta = readMeta(doc);
        if (!meta) return json(res, 404, { error: "doc not found" });
        return json(res, 200, {
          meta: {
            docId: doc, fileName: meta.fileName, kind: meta.kind,
            outline: meta.outline || [], blocks: meta.blocks || [],
            pdfReady: !!meta.pdfReady, pdfEngine: meta.pdfEngine, pdfFailReason: meta.pdfFailReason,
          },
          anchors: listAnchors(doc),
          figures: meta.figures || {},
          review: readReview(doc),
          events: readEvents(doc, 100),
        });
      }

      // ---- GUI 审批（唯一写操作，需会话令牌）----
      if (p === "/api/review" && req.method === "POST") {
        const body = await readBody(req);
        if (body.token !== guiToken) return json(res, 403, { error: "bad session token" });
        const doc = u.searchParams.get("doc");
        const r = setStatus(doc, body.figureId, body.status, body.note, "user");
        return json(res, 200, { ok: true, review: r });
      }

      // ---- CLI 通道 ----
      if (p === "/api/cli" && req.method === "POST") {
        if (req.headers["x-pf-cli-token"] !== cliToken) return json(res, 403, { error: "bad cli token" });
        const body = await readBody(req);
        const doc = body.doc || u.searchParams.get("doc");
        const out = await cliAction(doc, body.action, body.params || {});
        return json(res, 200, { ok: true, result: out });
      }

      res.writeHead(404); res.end("not found");
    } catch (err) {
      json(res, 400, { error: String(err.message || err) });
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", (e) => {
      if (e.code === "EADDRINUSE") reject(new Error(`端口 ${port} 已被占用`));
      else reject(e);
    });
    server.listen(port, "127.0.0.1", () => {
      // registerDaemon:false 供测试用 —— 测试 daemon 不写 daemon.json，
      // 否则会把真实托盘守护的服务记录顶掉（2026-09-21 实测反复污染）
      if (registerDaemon) {
        writeDaemon({ port, guiToken, cliToken, pid: process.pid, startedAt: new Date().toISOString() });
      }
      resolve({ server, port, guiToken, cliToken });
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(new Error("bad json body")); }
    });
  });
}

async function cliAction(doc, action, params) {
  switch (action) {
    case "anchor.set": {
      const r = setAnchor(doc, params);
      appendEvent(doc, "anchor.set", { at: params.at, side: params.side, reused: r.reused, quoteOk: r.quoteOk });
      // 🔴 2026-09-21 红队实测：只返回 r.anchor 会丢 reused/quoteOk——CLI 的复用标记与
      // 编造引文警告全部哑火（锚点 state 落了 changed 但用户/AI 看不到任何警告）。
      return { ...r.anchor, reused: r.reused, quoteOk: r.quoteOk };
    }
    case "anchor.list":
      return listAnchors(doc, { changedOnly: !!params.changed });
    case "render":
      return renderFigure({ docId: doc, ...params });
    case "render.list":
      return listFigures({ docId: doc, at: params.at });
    case "review.status":
      return reviewStatus(doc);
    case "review.resolve": {
      const status = params.approve ? "approved" : "rejected";
      return setStatus(doc, params.figureId, status, params.note, "ai");
    }
    case "doc.read": {
      const meta = readMeta(doc);
      const target = resolveRef(meta.blocks, params.at);
      return target;
    }
    case "doc.context": {
      // 上下文蒸馏原料：整节段落文本（实体/结构/图种三清单由 AI 自己产出 —— skill 教）
      const meta = readMeta(doc);
      const { parseRef } = await import("./doc/para.mjs");
      const { secPath } = parseRef(params.at);
      const paras = meta.blocks.filter((b) => b.type === "para" && b.secPath === secPath).map((b) => b.text);
      // 🔴 红队实测（2026-09-23 fuzz）：§99 等不存在章节静默返回 0 字 = AI 拿空上下文去编素材
      if (!paras.length) throw new Error(`章节 §${secPath} 不存在或没有正文段落（--at: ${params.at}）——用 pf doc outline 看有效章节，或 pf doc search 定位关键词`);
      return { section: secPath, paragraphs: paras, chars: paras.join("").length };
    }
    default:
      throw new Error(`未知 action: ${action}`);
  }
}

// 独立进程入口：pf serve-daemon
if (process.argv[1] && process.argv[1].endsWith("server.mjs")) {
  const { loadConfig } = await import("./config.mjs");
  const cfg = loadConfig();
  const port = Number(process.argv[2]) || cfg.port || (await import("./config.mjs")).DEFAULT_PORT;
  startServer({ port })
    .then(({ port }) => console.log(`[pf] daemon on 127.0.0.1:${port}`))
    .catch((e) => { console.error("[pf] daemon 启动失败:", e.message); process.exit(1); });
}
