// ratio.mjs — 画布比（aspect ratio）单一来源模块
//
// 🔴 2026-09-21 V10 事故根因：craft 对 double-column 写死 "roughly 16:5" 画布句，
// 而 render 实际用了 16:9 → 模型把宽幅内容硬塞进 16:9 画布，视觉上被横向压缩。
// 教训：**画布比只能有一个来源，且必须拼接、不许写死**。
//
// 机制（工作流级，不靠宿主 AI 记性）：
//   craft --ratio "16:9" → 提示词里的画布句由本模块从 ratio 数字拼接生成（横/竖/方自动判向）
//                        → --out 同时写 <同名>.craft.json 伴随文件（携带 suggestedRatio）
//   render --prompt-file → 自动读伴随 JSON 继承 suggestedRatio（显式 --ratio 仍可覆盖，不一致给警告）
//   render 落盘后      → 解析 PNG IHDR 实测像素比，与请求比偏差 >5% 记 ratio_mismatch 事件

import { readFileSync as fsRead } from "node:fs";

// ---------- 解析 "16:9" / "3:4" / "1.5:1" ----------
export function parseRatio(r) {
  const m = String(r || "").trim().match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  if (!w || !h) return null; // 0 或 NaN 都拒绝
  return { w, h, text: `${m[1]}:${m[2]}` };
}

// ---------- 版式预设 → 缺省画布比（可被显式 --ratio 覆盖）----------
export function defaultRatioForPreset(preset) {
  return { "double-column": "16:9", slide: "16:9", "single-column": "3:4" }[String(preset || "").trim()] || null;
}

// ---------- 画布句：从 ratio + 阶段数拼接（横/竖/方自动判向）----------
// 这就是 craft 里唯一该出现的画布约束句 —— 比例数字永远来自参数，不写死。
//
// 🔴 2026-09-21 V12 复盘（第二起画布事故，方向相反）：渲染端只有固定档（premium 16:9 /
// standard 方图），16:9 装 7 阶段横排 = 上下空白带 >50%，比 V10 的压缩更隐蔽。
// 渲染端给不了更扁的比例（21:9 实测回落方图，ratio_mismatch 当场抓住）——
// 所以宽画布必须同时命令「内容带撑满画布高度」，把留白压进 1/10~1/3 区间。
export function canvasSentence({ ratio, stageCount = 0 } = {}) {
  const r = parseRatio(ratio);
  if (!r) return null;
  const orient = r.w > r.h * 1.15
    ? "wide horizontal banner"
    : r.h > r.w * 1.15
      ? "portrait canvas"
      : "square-ish canvas";
  const fit = stageCount >= 3
    ? ` The ${stageCount} stages share the full canvas width evenly with visible margins — nothing may be cropped or cut off at any edge.`
    : " ALL content must fit inside the canvas with visible margins — nothing may be cropped or cut off at any edge.";
  const fill = r.w > r.h * 1.15
    ? " The content band must FILL the canvas height: blocks span nearly top to bottom, leaving only narrow calm margins (about 10% of the canvas height each) above and below — large empty bands are a defect."
    : "";
  return `Canvas shape: ${orient} with a strict ${r.text} width-to-height aspect ratio.${fit}${fill}`;
}

// ---------- 伴随文件路径：<同名>.craft.json（p.txt → p.craft.json）----------
export function craftSidecarPath(promptFile) {
  return String(promptFile || "").replace(/\.[^\\/]+$/, "") + ".craft.json";
}

// ---------- 读伴随文件（不存在/损坏 → null，不炸）----------
export function readCraftSidecar(promptFile) {
  try {
    return JSON.parse(fsRead(craftSidecarPath(promptFile)));
  } catch {
    return null;
  }
}

// ---------- PNG 尺寸解析（IHDR 定长头，零依赖）----------
export function pngDims(buf) {
  try {
    if (!buf || buf.length < 24) return null;
    if (buf.readUInt32BE(0) !== 0x89504e47) return null; // \x89PNG
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}

// ---------- 实测像素比 vs 请求比 核验（偏差 >5% 视为不符）----------
export function ratioMismatch(ratio, dims) {
  const r = parseRatio(ratio);
  if (!r || !dims?.w || !dims?.h) return null;
  const target = r.w / r.h;
  const actual = dims.w / dims.h;
  const dev = Math.abs(actual - target) / target;
  return dev > 0.05 ? { target, actual: Number(actual.toFixed(3)), dev: Number((dev * 100).toFixed(1)) } : null;
}
