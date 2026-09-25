// render.mjs — 调我们服务器出图（唯一外呼：promptfigure.top）
//
// 链路：POST /api/v1/generate（额度通道）→ 402 quota_exhausted → 自动改走
// /api/v1/generate/balance（余额通道，官网已写明此规则）→ b64_json 存本地。
// 🔴 polish:false —— 本地 AI 写的提示词直接出图，服务端不润色
// 🔴 premium 代码级门禁 —— 未 approved 的图禁止出 premium（不靠提示词自觉）
// 🔴 计费通道切换必须留痕（事件流 billing.fallback）
import { loadConfig, maskKey } from "./config.mjs";
import { readMeta, writeMeta, saveFigureFile, resolveDoc, readAnchors, readReview } from "./store.mjs";
import { appendEvent } from "./events.mjs";
import { resolveRef } from "./doc/para.mjs";
import { isApproved } from "./review.mjs";
import { setAnchor } from "./anchor.mjs";
import { pngDims, ratioMismatch } from "./ratio.mjs";
import { trimWhitespace, pngStats } from "./png-trim.mjs";

const BASE = "https://promptfigure.top";
const GEN_URL = `${BASE}/api/v1/generate`;
const GEN_BALANCE_URL = `${BASE}/api/v1/generate/balance`;

async function callGenerate(url, key, body) {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      // 🔴 不带 UA 会被边缘 WAF 当脚本质询（返回 HTML 200，JSON 解析就炸了）
      "User-Agent": "promptfigure-local-plugin/0.1",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  let data = null;
  let rawText = "";
  try {
    rawText = await resp.text();
    data = JSON.parse(rawText);
  } catch {
    // 非 JSON（WAF 质询页 / 网关错误页）→ 给出可诊断的短摘要
    return { status: resp.status, data: { error: "non_json_response", detail: rawText.slice(0, 160).replace(/<[^>]+>/g, " ").trim() } };
  }
  return { status: resp.status, ok: resp.ok, data };
}

export async function renderFigure({ docId, prompt, model = "standard", at, side = "after", ratio, force = false, forceReason = null, sidecar = null }) {
  const cfg = loadConfig();
  if (!cfg.key) {
    throw new Error("还没有配置 pf_ API key。先运行 pf login（控制台创建 key 后：pf login pf_xxxxx）");
  }
  if (!prompt || !prompt.trim()) throw new Error("提示词不能为空（--prompt 或 --prompt-file）");
  if (!at) throw new Error("必须显式声明锚点位置 --at \"§3.2 ¶2\" —— 插件不猜位置");
  if (!["standard", "premium"].includes(model)) throw new Error(`未知档位 ${model}（standard | premium）`);

  const dir = resolveDoc(docId);
  docId = dir.split(/[\\/]/).pop();
  const meta = readMeta(docId);
  resolveRef(meta.blocks, at); // 校验位置存在

  const anchors = readAnchors(docId);
  let anchor = anchors.find((a) => a.placement.at === at && a.placement.side === side);
  if (!anchor) {
    // 🔴 自愈建锚（2026-09-21 实测）：render 只找不建时，新位置出图 = 无锚孤儿图，
    // GUI 永远不显示、无高亮、无内联卡片 —— AI 照 help 走 craft→render 必踩。
    const { anchor: created } = setAnchor(docId, { at, side });
    anchor = created;
    anchors.push(anchor);
  }

  // ---- 红线 1：standard 草稿数量上限 ----
  const limits = cfg.limits || {};
  const perDoc = limits.perDocStandard ?? 60;
  const figCount = Object.keys(meta.figures || {}).length;
  if (model === "standard" && figCount >= perDoc) {
    throw new Error(`已达本文 standard 出图上限（${perDoc} 张，可用 pf config limits.perDocStandard 调整）。先整理图库再继续`);
  }

  // ---- 红线 2：premium 门禁（代码级，不靠提示词） ----
  // --force 豁免（2026-09-21 定规）：多轮精修循环会死锁——修正轮要真实渲染视觉缺陷，
  // 但缺陷只有 premium 渲得出（standard 渲文字必乱码），而门禁要求先审批通过、审批要求零缺陷。
  // force = 显式声明"这轮是已授权的修正迭代"，事件留痕 figure.gate_bypass 可审计，默认仍锁死。
  const figures = meta.figures || {};
  const prevFig = anchor?.figure ? figures[anchor.figure] : null;
  if (model === "premium" && !force) {
    if (!prevFig) throw new Error(`premium 门禁拒绝：位置 ${at} 还没有 standard 草稿。下一步: pf craft … --out p.txt 然后 pf render --at "${at}" --model standard --prompt-file p.txt（修正迭代轮可用 --force "理由" 豁免，事件留痕）`);
    if (!isApproved(docId, prevFig.figureId)) {
      throw new Error(`premium 门禁拒绝：图 ${prevFig.figureId} 尚未审批通过。下一步: pf review ai ${prevFig.figureId}（AI 核验）→ pf review resolve ${prevFig.figureId} --approve；或在 GUI 审批队列点「通过」（修正迭代轮可用 --force "理由" 豁免，事件留痕）`);
    }
  }
  if (model === "premium" && force && prevFig) {
    appendEvent(docId, "figure.gate_bypass", {
      figure: prevFig.figureId, version: (prevFig.versions?.length || 0) + 1,
      reason: forceReason || "(无理由)",
      reviewStatus: (readReview(docId)[prevFig.figureId] || {}).status || "unknown", at: new Date().toISOString(),
    });
  } else if (force && !(model === "premium" && prevFig)) {
    // 非 premium 门的 force（如字节预算绕门）同样留痕——凡是绕门都要能在 pf audit 里查到
    appendEvent(docId, "render.forced", { at, model, reason: forceReason || "(无理由)", ts: new Date().toISOString() });
  }

  // ---- 出图（402 自动换余额通道） ----
  const body = { prompt: prompt.trim(), model, polish: false };
  if (ratio) body.ratio = ratio;
  let channel = "quota";
  let resp = await callGenerate(GEN_URL, cfg.key, body);
  if (resp.status === 402 && resp.data?.error === "quota_exhausted") {
    channel = "balance";
    appendEvent(docId, "billing.fallback", { from: "quota", to: "balance", model });
    resp = await callGenerate(GEN_BALANCE_URL, cfg.key, body);
  }
  if (resp.status === 429) throw new Error(`触发 RPM 限流（${resp.data?.limit ?? "?"}/分钟），稍等一分钟再试`);
  if (!resp.ok || !resp.data?.b64_json) {
    let detail = resp.data?.detail || resp.data?.error || `HTTP ${resp.status}`;
    const refunded = resp.data?.refunded ? "（已自动退款/还原额度）" : "";
    // 弱模型实测（weak-agent-sim 2026-09-20）：invalid_api_key 时弱 AI 卡死在这，不知道下一步
    if (/invalid[_ ]api[_ ]key/i.test(String(detail))) {
      detail += " —— pf_ key 无效或已被覆盖。让用户执行 pf login <pf_key> 重新配置（控制台 promptfigure.top 可建 key）";
    }
    throw new Error(`出图失败：${detail}${refunded}`);
  }

  // ---- 落盘：同锚点追加版本，否则新图 ----
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  let figureId;
  if (prevFig) {
    figureId = prevFig.figureId;
  } else {
    figureId = `fig_${stamp}_${Math.random().toString(36).slice(2, 6)}`;
  }
  const verNo = prevFig ? prevFig.versions.length + 1 : 1;
  const file = `v${verNo}.png`;
  let imgBuf = Buffer.from(resp.data.b64_json, "base64");
  // ---- 画布比核验（2026-09-21 V10 事故补的闭环）：对**裁剪前**像素算 —— 白边裁剪是预期行为，
  // 裁后比例对不上请求比不是事故（V14 后：2560x685 vs 16:9 是正常产出）----
  const preTrimDims = pngDims(imgBuf);
  const ratioIssue = body.ratio ? ratioMismatch(body.ratio, preTrimDims) : null;
  // ---- 自动体检（2026-09-21 定规：核验数字由插件算，AI 只做语义判断）----
  // 对**裁前**图统计：留白占比（模型原始行为，对账用）/ 边缘白度 / 彩色像素占比
  const autoChecks = pngStats(imgBuf);
  // ---- 白边自动裁剪（2026-09-21 V14 复盘：画布句"撑满高度"模型不听——上下空白 >50%）----
  // 措辞路线到头了，留白改由确定性后处理保证：留白面积 >30% 就裁到内容包围盒+窄边距。
  // 任何异常 png-trim 内部吞掉返回 null（保留原图，宁可多留白不可损坏图）。
  const trimmed = trimWhitespace(imgBuf);
  let trimInfo = null;
  if (trimmed) {
    imgBuf = trimmed.buf;
    trimInfo = trimmed;
  }
  const rel = saveFigureFile(docId, figureId, file, imgBuf);
  const dims = pngDims(imgBuf);

  if (trimInfo) {
    appendEvent(docId, "figure.trimmed", {
      figure: figureId, version: verNo,
      from: `${trimInfo.from.w}x${trimInfo.from.h}`,
      to: `${trimInfo.to.w}x${trimInfo.to.h}`,
      savedPct: trimInfo.savedPct, at: now.toISOString(),
    });
  }

  const version = {
    file: rel,
    model,
    status: model === "premium" ? "final" : "draft",
    channel,
    promptSha: Buffer.from(prompt).toString("base64").slice(0, 24),
    prompt,
    // 🔴 画布比留痕（V10 事故：之前 ratio 参数完全不落盘，出了压缩图无从对账）
    ratio: body.ratio || null,
    pixels: dims ? `${dims.w}x${dims.h}` : null,
    // 白边裁剪留痕（V14 事故）：裁剪前的原始像素，便于对账
    trimmedFrom: trimInfo ? `${trimInfo.from.w}x${trimInfo.from.h}` : null,
    // 🔴 自动体检结果（2026-09-21）：裁前量化数字，AI 核验以此为底数，不许凭感觉
    autoChecks,
    // craft 伴随 JSON 路径（pf refine 重拼下一轮命令的依据）
    sidecar: sidecar || null,
    at: now.toISOString(),
  };
  meta.figures = meta.figures || {};
  if (prevFig) {
    prevFig.versions.push(version);
    // 🔴 新版本 = 送审对象变了（2026-09-21 "别放水"定规）：
    // ① 旧 QA 核验记录作废（审批门禁按最新版对账，不清会把旧版 PASS 错套在新版上）；
    // ② 审批状态重置回 pending —— premium 定稿也要重新核验，不许"标准版过了定稿自动过"；
    // ③ activeFixes 清空（2026-09-21 子智能体实测：全插件没人清它 → pf next 永久死锁在
    //    refine，连真实渲染后也出不去）。新版本就是修复尝试的产物，缺陷是否真修好由
    //    QA 重新核验裁决：pass 收工 / fail 会把缺陷重新写回状态机，闭环不丢。
    delete prevFig.qa;
    prevFig.activeFixes = [];
  } else {
    meta.figures[figureId] = { figureId, at, side, anchorId: anchor?.id || null, versions: [version] };
    if (anchor) anchor.figure = figureId;
  }
  writeMeta(docId, meta);
  // 新版本审批状态重置（pending）：写回要在 writeMeta 之后，setStatus 自己读写 review.json 不冲突
  if (prevFig) {
    const { setStatus } = await import("./review.mjs");
    try {
      const prevStatus = readReview(docId)[figureId]?.status;
      if (prevStatus && prevStatus !== "pending") {
        setStatus(docId, figureId, "pending", `v${verNo} 新版本落盘，旧核验作废，重新送审`, "system");
      }
    } catch { /* 审批状态重置失败不阻塞出图 */ }
  }
  if (anchor) {
    const idx = anchors.findIndex((a) => a.id === anchor.id);
    anchors[idx] = anchor;
    // 写回 anchors.json
    const { writeAnchors } = await import("./store.mjs");
    writeAnchors(docId, anchors);
  }

  appendEvent(docId, "figure.created", {
    figure: figureId, version: verNo, model, at, side, channel,
    ratio: body.ratio || null, pixels: version.pixels,
    quota: resp.data.quota, balance: resp.data.balance,
  });
  if (ratioIssue) {
    appendEvent(docId, "figure.ratio_mismatch", {
      figure: figureId, version: verNo, requested: body.ratio, ...ratioIssue,
    });
  }

  const notes = [];
  if (model === "standard") notes.push("草稿已入库，等用户在 GUI 审批；通过后才可出 premium 定稿");
  else notes.push("定稿已生成，高亮会转为绿色");
  if (ratioIssue) {
    notes.push(`⚠️ 画布比不符：请求 ${body.ratio}，实测 ${version.pixels}（偏差 ${ratioIssue.dev}%）—— 宽幅内容可能被压缩/裁切，读图核验后决定是否重出`);
  }

  return {
    figureId, version: verNo, file: rel, model, channel,
    ratio: body.ratio || null, pixels: version.pixels, ratioIssue,
    quota: resp.data.quota, balance: resp.data.balance,
    keyMasked: maskKey(cfg.key),
    note: notes.join("；"),
  };
}

export function listFigures({ docId, at }) {
  const dir = resolveDoc(docId);
  docId = dir.split(/[\\/]/).pop();
  const meta = readMeta(docId);
  let figs = Object.values(meta.figures || {});
  if (at) figs = figs.filter((f) => f.at === at);
  return figs;
}
