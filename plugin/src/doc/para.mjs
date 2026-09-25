// para.mjs — 段落引用 "§3.2 ¶2" 的解析、校验与定位
// 🔴 用章节路径+段序，不用全局段序（全局段序会因增删段落整体漂移）

export function parseRef(ref) {
  if (!ref || typeof ref !== "string") throw new Error("锚点引用必须是字符串，如 \"§3.2 ¶2\"");
  const m = /^\s*§?\s*([\d.]+)\s*(?:¶\s*(\d+))?\s*$/.exec(ref);
  if (!m) {
    throw new Error(`无法解析锚点引用 "${ref}"。格式：§<章节路径> ¶<段序>，例如 "§3.2 ¶2"（¶ 缺省时指该章节标题本身）`);
  }
  return { secPath: m[1].replace(/\.$/, ""), para: m[2] ? parseInt(m[2], 10) : 0 };
}

export function resolveRef(blocks, ref) {
  const { secPath, para } = parseRef(ref);
  const head = blocks.find((b) => b.type === "heading" && b.secPath === secPath);
  if (!head) {
    // 🔴 2026-09-21 死路修复：摘要/前言等无标题章节（tex 抽出的 §0）不在 outline 里，
    // 但 pf doc search / pf doc data 会给出这类引用——不能因为没 heading 就拒绝自家工具给的引用。
    // 只要该章节下有真实段落/图注块就放行；¶ 缺省时落到该章节第一个段落。
    const same0 = blocks.filter(
      (b) => (b.type === "para" || b.type === "caption") && b.secPath === secPath
    );
    if (!same0.length) {
      const avail = blocks.filter((b) => b.type === "heading").map((b) => b.secPath).slice(0, 40);
      throw new Error(`章节 §${secPath} 不存在。可用章节（前 40）：${avail.join(", ") || "（无）"}。先 pf doc outline 查看。`);
    }
    if (para === 0) return same0[0];
    const t0 = same0.find((b) => b.para === para);
    if (!t0) {
      throw new Error(`§${secPath} 下只有 ${same0.length} 个段落/图注，¶${para} 不存在（若该章只有子章节没有直属段落，引用要到段落所在的子章节，如 §4.1 ¶2）`);
    }
    return t0;
  }
  if (para === 0) return head;
  // 🔴 caption 块也算段落（tex.mjs 把 \caption 抽成 caption 块并占段号——doc figures 报的
  // 图位置正是它）。只搜 type==="para" 会让 doc figures 给出的每个图位置都过不了校验。
  const same = blocks.filter(
    (b) => (b.type === "para" || b.type === "caption") && b.secPath === secPath
  );
  const target = same.find((b) => b.para === para);
  if (!target) {
    throw new Error(`§${secPath} 下只有 ${same.length} 个段落/图注，¶${para} 不存在（若该章只有子章节没有直属段落，引用要到段落所在的子章节，如 §4.1 ¶2）`);
  }
  return target;
}

// 变化检测：quote 是否还在原文里（确定性比对，不猜）
export function checkQuote(blocks, quote) {
  if (!quote) return "ok";
  const norm = (s) => s.replace(/\s+/g, "");
  const q = norm(quote);
  if (!q) return "ok";
  return blocks.some((b) => norm(b.text).includes(q)) ? "ok" : "changed";
}
