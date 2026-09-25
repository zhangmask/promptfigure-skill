// docsearch.mjs — 🔴 原文检索 + 结果数据抽取（2026-09-21 用户反馈"别人用不了：不读文章、找不到结果数据"）：
// 弱 AI 只有 pf doc outline（章节树），定位内容全靠猜——结果/实验章节里的数字句
// （准确率、提升幅度、对比基线）更是无处可查。这里给两个确定性工具，全部本地计算、不依赖 daemon：
//   - searchBlocks：关键词全文检索（para/caption 块），返回 §引用 + 命中片段 → "去哪读"
//   - dataSentences：抽定量句（%/小数/×/± 模式）→ "结果数据在哪"
// 纯函数：CLI 与测试共用。分句走 extract.splitSentences（2026-09-22 中英通用，中文论文不再糊成一坨）。
import { splitSentences } from "./extract.mjs";

// 关键词全文检索。kws 全部小写化匹配；命中块按命中次数排序（多关键词同时命中的排前）。
// 返回 [{ ref, secPath, para, type, snippet, hits }]，snippet 是首个命中点前后 ~90 字符窗口。
export function searchBlocks(blocks = [], kws = [], { limit = 12 } = {}) {
  const terms = (Array.isArray(kws) ? kws : String(kws).split(/[\s,，]+/))
    .map((k) => String(k).trim().toLowerCase()).filter(Boolean);
  if (!terms.length) return [];
  const out = [];
  for (const b of blocks) {
    if (b.type !== "para" && b.type !== "caption") continue;
    const text = String(b.text || "");
    if (!text) continue;
    const low = text.toLowerCase();
    let hits = 0;
    const hitTerms = [];
    for (const t of terms) {
      const n = low.split(t).length - 1;
      if (n > 0) { hits += n; hitTerms.push(t); }
    }
    if (!hits) continue;
    // 片段窗口：第一个出现的关键词位置
    let pos = -1;
    for (const t of terms) { const p = low.indexOf(t); if (p >= 0 && (pos < 0 || p < pos)) pos = p; }
    const start = Math.max(0, pos - 60);
    const snippet = (start > 0 ? "…" : "") + text.slice(start, pos + 90).replace(/\s+/g, " ") + (start + 90 < text.length ? "…" : "");
    out.push({
      ref: `§${b.secPath}${b.para ? " ¶" + b.para : ""}`,
      secPath: b.secPath, para: b.para || null, type: b.type,
      snippet, hits, hitTerms,
    });
  }
  out.sort((a, b) => b.hits - a.hits);
  return out.slice(0, limit);
}

// 定量句抽取（"结果数据"定位）：命中任一模式的句子算定量句。
// 模式全部确定性：百分比 / 带小数的数值 / ×倍数 / ±波动 / dB/mAP 等常见指标后缀。
// 返回 [{ ref, sentence }]，按原文顺序。
const METRIC_TAIL = /\b(?:dB|PSNR|SSIM|LPIPS|mAP|FID|Acc|accuracy|F1)\b/i;
const QUANT_RE = new RegExp(
  [
    "\\d+(?:\\.\\d+)?\\s*%",          // 34.2%
    "\\d+\\.\\d+",                     // 小数（0.913、3.14）
    "\\d+\\s*[×x]\\s*\\d+",           // 2× 提升 / 1024×1024
    "\\d+(?:\\.\\d+)?\\s*[±]\\s*\\d+",// 1.2±0.1
    "[×x]\\s*\\d+(?:\\.\\d+)?",       // ×1.5
    METRIC_TAIL.source,                // 指标名
  ].join("|"),
  "g"
);

export function dataSentences(blocks = [], { limit = 20 } = {}) {
  const out = [];
  for (const b of blocks) {
    if (b.type !== "para") continue;
    const text = String(b.text || "");
    if (!text) continue;
    const sents = splitSentences(text);
    for (const s of sents) {
      // 🔴 最短句过滤 CJK 感知（2026-09-22）：原 s.length<15 按英文字符定标，
      // "方案二准确率达到91.3%。"（14 字符）被误杀——中文信息密度高，汉字按 2 计
      const eff = (s.match(/[A-Za-z0-9]+/g) || []).join("").length
        + (s.match(/[\u4e00-\u9fff]/g) || []).length * 2
        + (s.match(/[^\u4e00-\u9fffA-Za-z0-9\s]/g) || []).length;
      if (eff < 15) continue;
      QUANT_RE.lastIndex = 0;
      if (!QUANT_RE.test(s)) continue;
      out.push({
        ref: `§${b.secPath}${b.para ? " ¶" + b.para : ""}`,
        sentence: s.slice(0, 200) + (s.length > 200 ? "…" : ""),
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// 数据句按章节聚合视图（pf doc data 输出用）：[{ secPath, items: [{ref, sentence}] }]
export function dataBySection(blocks = [], { limit = 40 } = {}) {
  const flat = dataSentences(blocks, { limit });
  const bySec = new Map();
  for (const it of flat) {
    // 归一化章节键：去掉引用里的 § 前缀与段落号（CLI 输出时统一加 §）
    const key = it.ref.replace(/^§/, "").replace(/ ¶\d+$/, "");
    if (!bySec.has(key)) bySec.set(key, []);
    bySec.get(key).push(it);
  }
  return [...bySec.entries()].map(([secPath, items]) => ({ secPath, items }));
}
