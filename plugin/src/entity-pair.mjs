// entity-pair.mjs — 实体双语对照解析（2026-09-22 用户拍板补差距②）。
// 独立叶子模块：quality.mjs 与 craft.mjs 都要用，放任何一边都会成环。
//
// 实测痛点：中文用户把实体译成英文喂 craft（standard 档中文乱码率高），但译完溯源就断——
// checkEntitySource 对"脚本不一致"的实体只能 skipped（fail open）。对照格式
// 「英文标签|原文词」（如 "Weighted Box Fusion|加权框融合"）两头都占：
//   - 溯源对账查原文侧（确定性）
//   - 卡面/提示词用英文侧（不乱码）
export function splitEntityPair(e) {
  const raw = String(e || "").trim();
  // 🔴 渗透实测（2026-09-22 子智能体 B）：一侧为空的残缺对照（"Label|" / "|原文"）不能当
  // 普通实体放行——英文侧会连 "|" 一起印进卡面，原文侧静默丢掉。标记 invalid 让质量门拦。
  if (!raw.includes("|")) return { label: raw, src: null };
  const parts = raw.split("|").map((s) => s.trim());
  if (parts.length === 2 && parts[0] && parts[1]) return { label: parts[0], src: parts[1] };
  return { label: raw, src: null, invalid: true };
}
