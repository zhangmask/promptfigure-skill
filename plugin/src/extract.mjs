// extract.mjs — 🔴 多语言蒸馏抽取器（2026-09-22 第二轮：去写死、脚本无关）：
// 第一版的候选实体正则只认英文大写词、分句只认 `.!?` —— 中文论文蒸馏出来是空的（数模小白
// 用不好的根因）。第二版把"写死的语言规则"降到最少：
//   - splitSentences：终结标点覆盖中日韩/阿拉伯/天城文/亚美尼亚/高棉等主要文字，超长无标点段兜底
//   - candidateEntities：按 Unicode script 切 run —— 带空格文字（拉丁/西里尔/希腊/阿拉伯/
//     天城文/韩语…）走词元路径（大写术语+缩写+高频词），无空格文字（汉字/假名/谚文/泰/高棉…）
//     走同 run 内 n-gram 频次路径。中文"X模型/X算法"后缀表只是众多启发式之一（对其他语言
//     自动失效、不碍事，不再为每种语言写后缀表）。
// 抽取是统计性的，会有误抽/漏抽 —— 蒸馏输出必须带"逐个核对原文出处"的核验任务（判断层归
// AI，插件只做确定性对账：checkEntitySource 拿实体回原文对账，编造出不了门）。
// 纯函数：CLI（distill/plan）与测试共用。

// ---- 分句（多语言通用）----
// 终结标点集：中日韩（。！？；…‥）拉丁（!?）阿拉伯（؟）乌尔都（۔）天城文（।॥）
// 亚美尼亚（։）格鲁吉亚/高棉（៖）埃塞俄比亚（።）高棉（។）
const TERM_PUNCT = "。！？；…‥!?؟۔।॥։៖።។";
export function splitSentences(text = "") {
  const src = String(text || "");
  if (!src.trim()) return [];
  // 常见缩写句点保护（拉丁侧）+ 小数点保护
  const ABBR = [/\bvs\./g, /\be\.g\./g, /\bi\.e\./g, /\bet al\./g, /\bFig\./g, /\bEq\./g, /\bapprox\./g, /\bNo\./g];
  const masked = ABBR.reduce((t, re) => t.replace(re, (m) => m.replace(/\./g, "\u0001")), src)
    .replace(/(\d)\.(\d)/g, "$1\u0001$2");
  let parts = masked
    .replace(/\s+/g, " ")
    .split(new RegExp(`(?<=[${TERM_PUNCT}])\\s*|(?<=[.;])\\s+`))
    .map((s) => s.replace(/\u0001/g, ".").trim())
    .filter(Boolean);
  // 兜底：泰语/老挝语等无句读符号的文字 —— 超长无标点段按空格粗切（~12 词一段）
  const out = [];
  for (const p of parts) {
    if (p.length > 300 && p.includes(" ")) {
      const toks = p.split(" ");
      for (let i = 0; i < toks.length; i += 12) out.push(toks.slice(i, i + 12).join(" "));
    } else out.push(p);
  }
  return out;
}

// ---- 候选实体 ----
// 中文后缀术语（"X模型 / X算法 / X方法…"）—— 数模论文命名实体的常见形态。
// 只对含汉字的 run 生效；其他语言自动不命中、不碍事（不为每种语言写后缀表）。
const ZH_SUFFIX = "(?:模型|算法|方法|网络|函数|矩阵|方程|指标|策略|机制|模块|系统|流程|准则|分布|检验|拟合|规划|仿真)";
// 无空格文字：连续序列整体当一个 run（"灰色予測モデル"不再按汉/假名切碎）
const RUN_UNSPACED = "[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\p{Script=Thai}\\p{Script=Khmer}\\p{Script=Lao}\\p{Script=Myanmar}]+";

// 高频功能词黑名单（只兜中文——其他语言靠"≥2 次"频次门槛 + AI 逐个核对兜底）
const ZH_STOP = new Set([
  "我们", "其中", "因此", "通过", "可以", "以及", "进行", "结果", "问题", "对于", "并且",
  "然后", "如果", "得到", "使用", "基于", "不同", "如图", "所示", "本文", "首先", "其次",
  "最后", "所以", "由于", "但是", "同时", "此外", "另外", "如下", "根据", "计算", "分析",
  "建立", "考虑", "假设", "使得", "从而", "进而", "一个", "两个", "这种", "这些",
  "为了", "需要", "可能", "应该", "表示", "对应", "分别", "之间", "之后", "上述", "该",
  "情况下", "过程中", "基础上", "结果表明",
]);
const EN_STOP = new Set(["The","We","Figure","Table","Section","Equation","In","For","And","With","From","This","That","These","Those","Our","Where","When","If","As","By","On","To","An","A","It","Each","Both","All","Not","Can","May","One","Two","First","Second","Then","Thus","However","Note","Given","Since","While","After","Before","During","Over","Under","Between","Within","Without","Across","According","Based","Proposed","Method","Results","Experiment","Experiments","Training","Model","Models","Input","Output"]);

export function candidateEntities(text = "", { limit = 12 } = {}) {
  const src = String(text || "");
  if (!src.trim()) return [];
  const counts = new Map();
  const boosted = new Set(); // 后缀术语/缩写/大写术语：排序加权、出现即算
  const add = (w, boost = false) => {
    const k = String(w).trim();
    if (!k || k.length < 2) return;
    counts.set(k, (counts.get(k) || 0) + 1);
    if (boost) boosted.add(k);
  };

  // ---- 全文层（跨语言通用）：缩写词 + 首字母大写多词术语（有大小写的文字）----
  for (const m of src.matchAll(/\p{Lu}[\p{Lu}\p{Nd}-]{1,11}/gu)) add(m[0].replace(/[-]+$/, ""), true);
  for (const m of src.matchAll(/\p{Lu}\p{Ll}{2,}(?:\s+(?:\p{Ll}{1,3}\s+)?\p{Lu}\p{Ll}{2,}){1,3}/gu)) add(m[0], true);

  // ---- 按 script run 遍历 ----
  // 无空格 run（汉字/假名/谚文/泰…连续段，"VAEモデル" 会拆成 VAE + モデル 两类）：
  //   中文后缀术语 + 同 run 内 n-gram 频次（n=2..6，≥2 次）
  // 带空格 run（拉丁/西里尔/希腊/阿拉伯…）：长词频次（≥5 字母且 ≥2 次，德/俄复合词）
  for (const m of src.matchAll(new RegExp(RUN_UNSPACED + "|\\p{L}{5,}", "gu"))) {
    const run = m[0];
    if (new RegExp("^(?:" + RUN_UNSPACED + ")$", "u").test(run)) {
      // 中文后缀术语（run 含汉字才试）
      if (/\p{Script=Han}/u.test(run)) {
        const LEAD_TRIM = new Set([..."了的是和与及对在是将把从用为以并而或于使给向都也又再比跟同这那有等先"]);
        for (const mm of run.matchAll(new RegExp("[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}]{1,6}?" + ZH_SUFFIX, "gu"))) {
          const full = mm[0];
          const suf = full.match(new RegExp(ZH_SUFFIX + "$"))[0];
          let pre = full.slice(0, full.length - suf.length).slice(-4);
          while (pre.length > 1 && LEAD_TRIM.has(pre[0])) pre = pre.slice(1);
          add(pre + suf, true);
        }
      }
      for (let n = 2; n <= 6; n++) {
        for (let i = 0; i + n <= run.length; i++) {
          const g = run.slice(i, i + n);
          if (n <= 2 && ZH_STOP.has(g)) continue;
          counts.set(g, (counts.get(g) || 0) + 1);
        }
      }
    } else {
      counts.set(run, (counts.get(run) || 0) + 1); // 带空格文字长词
    }
  }

  // ---- 排序与过滤 ----
  const ranked = [...counts.entries()].filter(([w, c]) => {
    if (EN_STOP.has(w)) return false;
    if (boosted.has(w)) return true;                    // 后缀术语/缩写/大写术语：出现即算
    if (ZH_STOP.has(w)) return false;
    return c >= 2;                                      // 统计 n-gram / 长词：≥2 次
  }).sort((a, b) => {
    const pa = boosted.has(a[0]) ? a[1] + 1000 : a[1];
    const pb = boosted.has(b[0]) ? b[1] + 1000 : b[1];
    return pb - pa || b[0].length - a[0].length;
  });

  // 去重包含：短词若是已入选长词的子串则丢掉（"预测模型" ⊂ "灰色预测模型"）
  const picked = [];
  for (const [w] of ranked) {
    if (picked.some((p) => p.includes(w) || w.includes(p))) continue;
    picked.push(w);
    if (picked.length >= limit) break;
  }
  return picked;
}
