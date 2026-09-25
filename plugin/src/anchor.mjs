// anchor.mjs — 锚点台账
// 锚点由 AI 显式声明（--at + --side），插件不猜。
// 🔴 相似度只当"要不要提醒 AI 看一眼"的粗筛（changed 状态），绝不参与定位决策
import crypto from "node:crypto";
import { readAnchors, writeAnchors, readMeta } from "./store.mjs";
import { resolveRef, checkQuote } from "./doc/para.mjs";

export function setAnchor(docId, { at, side = "after", quote, figure }) {
  const meta = readMeta(docId);
  if (!meta) throw new Error(`项目 ${docId} 不存在`);
  const target = resolveRef(meta.blocks, at); // 校验引用合法（抛错则命令失败）
  const anchors = readAnchors(docId);

  // 同一位置同一侧已有锚点 → 复用（AI 改图重出时不会堆锚点）
  const exist = anchors.find((a) => a.placement.at === at && a.placement.side === side);
  if (exist) {
    if (figure) exist.figure = figure;
    // 🔴 红队实测（2026-09-23 fuzzA）：复用路径不更新快照——先 quote 编造句（changed）再
    // quote 正确原文，回显 ✅ 但快照仍是旧错句，changed 永远无法自愈。
    const q = quote ?? exist.placement.quote;
    exist.state = checkQuote(meta.blocks, q);
    if (quote && exist.state === "ok" && q !== exist.placement.quote) {
      exist.placement.quote = q; // 新 quote 对上原文才换快照；对不上的旧快照保留作证据
    }
    exist.updatedAt = new Date().toISOString();
    writeAnchors(docId, anchors);
    return { anchor: exist, reused: true, quoteOk: exist.state === "ok" };
  }

  // 🔴 2026-09-21 弱模型实测：新建锚点路径写死 state:"ok"，编造的 quote 被静默收下
  // （weak-agent-sim 第 14 轮：AI 编了句"YOLO-based end-to-end pipeline"当引文，直接 ✅）。
  // quote 给了就必须当场对账原文；对不上 → state:"changed" + quoteOk:false，CLI 打警告。
  const q = quote ?? target.text.slice(0, 160);
  const state = checkQuote(meta.blocks, q);
  const anchor = {
    id: "a" + crypto.randomBytes(2).toString("hex"),
    docId,
    placement: {
      at,
      side, // before | after
      quote: q, // 建锚时该段原文快照（变化检测用）
    },
    figure: figure || null,
    state, // ok | changed（quote 对不上原文）| lost
    createdAt: new Date().toISOString(),
  };
  anchors.push(anchor);
  writeAnchors(docId, anchors);
  return { anchor, reused: false, quoteOk: state === "ok" };
}

export function listAnchors(docId, { changedOnly = false } = {}) {
  const meta = readMeta(docId);
  if (!meta) throw new Error(`项目 ${docId} 不存在`);
  let anchors = readAnchors(docId);
  // 状态每次现算：quote 是否还能在当前文档里找到
  for (const a of anchors) {
    a.state = meta.kind === "pdf" ? a.state : checkQuote(meta.blocks, a.placement.quote);
  }
  writeAnchors(docId, anchors);
  if (changedOnly) anchors = anchors.filter((a) => a.state !== "ok");
  return anchors;
}
