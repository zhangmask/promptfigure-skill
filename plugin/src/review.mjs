// review.mjs — 审批状态机：pending → approved | rejected
// 两个入口写同一份状态：GUI（会话令牌）/ CLI（pf review resolve）
// AI 每轮开工先 pf review status —— 写进 skill 的硬规矩
import { readReview, writeReview, readMeta } from "./store.mjs";
import { appendEvent, readEvents } from "./events.mjs";

export function latestVersion(fig) {
  return fig.versions[fig.versions.length - 1];
}

export function setStatus(docId, figureId, status, note, by) {
  const meta = readMeta(docId);
  if (!meta || !meta.figures?.[figureId]) throw new Error(`图 ${figureId} 不存在`);
  if (!["approved", "rejected", "pending"].includes(status)) throw new Error(`非法状态 ${status}`);
  const review = readReview(docId);
  const prev = review[figureId];
  review[figureId] = { status, note: note || "", by, at: new Date().toISOString(), prevStatus: prev?.status || null };
  writeReview(docId, review);
  appendEvent(docId, "review." + (status === "approved" ? "approved" : status === "rejected" ? "rejected" : "reset"), {
    figure: figureId, status, note, by,
  });
  return review[figureId];
}

export function reviewStatus(docId) {
  const meta = readMeta(docId);
  if (!meta) throw new Error(`项目 ${docId} 不存在`);
  const review = readReview(docId);
  const figures = meta.figures || {};
  const items = Object.entries(figures).map(([figureId, fig]) => ({
    figureId,
    at: fig.at,
    side: fig.side,
    versions: fig.versions,
    review: review[figureId] || { status: "pending", note: "", by: null },
  }));
  return {
    pending: items.filter((x) => x.review.status === "pending"),
    approved: items.filter((x) => x.review.status === "approved"),
    rejected: items.filter((x) => x.review.status === "rejected"),
    history: readEvents(docId, 500).filter((e) => e.type.startsWith("review.")),
  };
}

// premium 门禁：该图最近一版必须已 approved
export function isApproved(docId, figureId) {
  return readReview(docId)?.[figureId]?.status === "approved";
}
