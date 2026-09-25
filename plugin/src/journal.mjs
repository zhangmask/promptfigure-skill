// journal.mjs — 期刊/会议画幅规范映射（2026-09-22 竞品差距①：academic-figure-skill 1.6k★
// 把 Nature/Cell/Science 的尺寸·字号·导出规范做成先验，我们从 craft --journal 一句话注入）。
//
// 为什么进提示词而不是进质量门：图模型吃的是"布局契约语言"，期刊规范的本质是
// "这张图最终会被缩到多宽印刷"——字号/线宽/信息密度都必须按这个物理宽度反推。
// 纯函数：CLI 与测试共用。
export const JOURNAL_SPECS = {
  nature: {
    col1: "89 mm", col2: "183 mm", minPt: 5,
    text: "Nature-family figure: final print width is 89 mm (single column) or 183 mm (double column). Minimum 5 pt lettering at final size, sans-serif (Helvetica/Arial-like), avoid hairline strokes thinner than 0.5 pt, colour-safe for common colour-vision deficiency (no red-green-only contrasts), generous white space over decoration.",
  },
  science: {
    col1: "55 mm", col2: "120 mm", minPt: 6,
    text: "Science-family figure: single column ≈55 mm, two columns ≈120 mm. Keep all lettering ≥6 pt at final size, line weights legible after ~50% reduction, restrained palette, every panel self-explanatory.",
  },
  ieee: {
    col1: "88 mm", col2: "181 mm", minPt: 8,
    text: "IEEE figure: column width ≈88 mm (single) or ≈181 mm (full page). Fonts ≥8 pt at final size (Times/New-Century-like is common but any clean serif/sans works), avoid coloured backgrounds, high contrast for grayscale printing.",
  },
  elsevier: {
    col1: "90 mm", col2: "190 mm", minPt: 7,
    text: "Elsevier journal figure: single column ≈90 mm, full width ≈190 mm. Minimum 7 pt at final size, sans-serif preferred, consistent line weights, colours must survive grayscale conversion.",
  },
  thesis: {
    col1: "150 mm", col2: "150 mm", minPt: 9,
    text: "Thesis/report figure: text width ≈150 mm, figure is read on paper or screen at 100% — medium density, lettering ≥9 pt, no shrink-dependent details.",
  },
};

// 主读语言无关——注入句永远英文（进图模型提示词），CLI 提示用中文。
export function journalSentence(journal = "") {
  const key = String(journal || "").trim().toLowerCase();
  const spec = JOURNAL_SPECS[key];
  if (!spec) return null;
  return `Print-size contract (${key}): ${spec.text}`;
}

// 版式预设联动：期刊 + preset 缺省画布比有冲突时给提示（宽幅内容 vs 单栏窄幅）
export function journalPresetHint(journal = "", preset = "") {
  const key = String(journal || "").trim().toLowerCase();
  if (!JOURNAL_SPECS[key]) return null;
  if (preset === "double-column" || preset === "slide") {
    return `--journal ${key} 双栏宽 ≈${JOURNAL_SPECS[key].col2}：字号按这个物理宽度反推，双栏图缩印后字会小，标签别太密`;
  }
  if (preset === "single-column") {
    return `--journal ${key} 单栏宽 ≈${JOURNAL_SPECS[key].col1}：内容必须极简，字号按 ${JOURNAL_SPECS[key].col1} 印刷宽度可读来设计`;
  }
  return `--journal ${key}：单栏 ≈${JOURNAL_SPECS[key].col1} / 双栏 ≈${JOURNAL_SPECS[key].col2}，配合 --preset double-column 或 single-column 使用（字号按最终印刷宽度反推）`;
}

// ---- 字号物理核验（2026-09-22 用户拍板补差距③）----
// 痛点：--journal 只能把规格写进提示词，渲染完没人验证字号是否真被遵守。
// 确定性换算：PNG 像素宽 × 印刷宽(mm) → mm/px；最小字号(pt)×0.3528(mm/pt) → 最小文字高度(px)。
// qa 任务包把这个数打出来，AI 量图上最小文字的像素高即可判定——不需要开图片编辑器量 mm。
// 纯函数；参数缺失或期刊未知时返回 null（不核验）。
const PT_MM = 0.3528; // 1 pt = 0.3528 mm
export function fontCheck({ journal = "", preset = "", pngW = 0 } = {}) {
  const key = String(journal || "").trim().toLowerCase();
  const spec = JOURNAL_SPECS[key];
  const w = Number(pngW) || 0;
  if (!spec || !spec.minPt || !w) return null;
  const colMm = parseFloat(preset === "double-column" ? spec.col2 : spec.col1);
  if (!colMm) return null;
  const mmPerPx = colMm / w;
  const minTextPx = Math.ceil((spec.minPt * PT_MM) / mmPerPx);
  return { journal: key, preset: preset || "(default single)", colMm, mmPerPx: +mmPerPx.toFixed(4), minPt: spec.minPt, minTextPx };
}
