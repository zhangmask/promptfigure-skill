// events.mjs — events.jsonl 只 append + SSE 广播
// 🔴 永不改写/删除已有行 —— AI 回放审批历史全靠这个文件
// 🔴 不用 fs.watch —— 进程间通知走本地 HTTP/SSE（跨平台踩过的坑）
import fs from "node:fs";
import path from "node:path";
import { projectByDocId } from "./store.mjs";

const clients = new Set(); // { docId, res }

function eventsFile(docId) {
  const dir = projectByDocId(docId);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "events.jsonl");
}

export function appendEvent(docId, type, data = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), type, ...data });
  fs.appendFileSync(eventsFile(docId), line + "\n");
  broadcast(docId, { type, ...data });
  return line;
}

export function readEvents(docId, limit = 200) {
  try {
    const raw = fs.readFileSync(eventsFile(docId), "utf8").trim();
    if (!raw) return [];
    const lines = raw.split("\n");
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return { type: "corrupt", raw: l }; } });
  } catch {
    return [];
  }
}

export function broadcast(docId, payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) {
    if (c.docId !== docId) continue;
    try { c.res.write(msg); } catch { clients.delete(c); }
  }
}

export function sseHandler(docId, req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ type: "hello", docId })}\n\n`);
  const entry = { docId, res };
  clients.add(entry);
  req.on("close", () => clients.delete(entry));
}
