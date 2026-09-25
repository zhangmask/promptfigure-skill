// ledger.mjs — 执行留证账本（2026-09-23 用户拍板"让用户的 AI 明确执行才放行"）
// 原则：放行条件不是提示词约定，是事件流水对账——宿主 AI 必须真的执行过前置步骤
// （读文档 / 排练渲染 / 领核验任务包），events.jsonl 里查得到记录才放行。
// 🔴 只读 events.jsonl，不写；写入一律走 appendEvent（append-only 契约不变）。
import crypto from "node:crypto";
import { appendEvent, readEvents } from "./events.mjs";

export const EVIDENCE_WINDOW_MS = 24 * 3600 * 1000; // 会话级窗口：24h 内的执行记录有效

/** 记录一条执行留证（同步落盘 —— die/退出前必须已经写进去，异步会丢；无项目上下文时静默跳过） */
export function logEvidence(docId, type, data = {}) {
  try {
    appendEvent(docId, type, { ...data, ts: new Date().toISOString() });
  } catch { /* 无项目上下文时跳过 */ }
}

/**
 * 24h 内是否有过指定类型的执行记录。
 * @param {string} docId 项目 docId
 * @param {string[]} types 事件类型（任一命中即 true）
 * @param {{filter?: (e: object) => boolean, windowMs?: number}} opts
 */
export function hasEvidence(docId, types, { filter = null, windowMs = EVIDENCE_WINDOW_MS } = {}) {
  const since = Date.now() - windowMs;
  const evs = readEvents(docId, 500);
  return evs.some((e) => {
    if (!types.includes(e.type)) return false;
    const t = new Date(e.ts || e.t || 0).getTime();
    if (t < since) return false;
    return filter ? filter(e) : true;
  });
}

/** 最近一条指定类型的执行记录（没有则 null）——用于对比排练内容与当前是否一致 */
export function lastEvidence(docId, type, { filter = null } = {}) {
  const evs = readEvents(docId, 500).filter((e) => e.type === type && (!filter || filter(e)));
  return evs.length ? evs[evs.length - 1] : null;
}

/** 提示词指纹（sha256 前 16 位）——排练事件与真实渲染对账用 */
export function shaOf(s) {
  return crypto.createHash("sha256").update(String(s ?? "").trim(), "utf8").digest("hex").slice(0, 16);
}
