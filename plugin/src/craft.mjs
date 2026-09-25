// craft.mjs — 第二阶段「本地提示词规则层」逻辑模块
//
// 依赖 craft-rules.mjs（纯数据，同源注释见该文件）。零依赖、纯 ESM。
// 职责：
//   1) sanitizePrompt(text)      —— 确定性净化（删自省句 + 修复违禁模式），幂等
//   2) craftPrompt(input)        —— 组装科研绘图提示词 + warnings + checklist
//   3) reviewCandidate(text)     —— 审查对象 = 模型原文 − 自省句（源: promptcraft.js reviewCandidate L374-376）
//
// 所有规则来源均可在 craft-rules.mjs 的「源:」注释回溯到服务端源码。

import {
  SELF_NARRATION_PATTERNS,
  BANNED_PATTERNS,
  HEX_NAMED_COLORS,
  STYLE_BASELINE,
  NEGATIVE_LIST,
  OUTPUT_GUARD_LINES,
  PRESET_LAYOUTS,
  QA_CHECKLIST,
} from "./craft-rules.mjs";
import {
  FIGURE_CATALOG,
  buildPalette,
  paletteSentence,
} from "./figure-catalog.mjs";
import {
  parseRatio,
  defaultRatioForPreset,
  canvasSentence,
} from "./ratio.mjs";
import { journalSentence, journalPresetHint } from "./journal.mjs";
import { splitEntityPair } from "./entity-pair.mjs";

// ---------- 图型目录路由（源: src/figure-catalog.mjs，2026-09-21 调研对标后取代内联 TYPE_TEMPLATES）----------
// 旧 id 兼容：concept → teaser（原 4 模板全部保留语义，扩展为 12 图型目录）
const CATALOG_BY_ID = Object.fromEntries(FIGURE_CATALOG.map((t) => [t.id, t]));
const TYPE_ALIASES = { concept: "teaser" };
function resolveType(figureType) {
  const id = TYPE_ALIASES[figureType] || figureType;
  const entry = CATALOG_BY_ID[id];
  if (!entry) return { entry: null, id };
  // guide 为 null 的图型（如 timeline）不进提示词路由 —— 属选型参考，示例里写明借道哪条
  return { entry: entry.guide ? entry : null, id, meta: entry };
}

// ---------- 审查清单（源: skills/promptcraft/REVIEW.md A1-A5 / B1-B5 蒸馏，8-12 条可执行项）----------
const CHECKLIST = [
  "A1 Skeleton — prompt carries the field headers in order: Style anchor, Overall layout, Content blocks, Palette, Emphasis, Scale & text space, Avoid (OR a deliberately minimal factual spec with no headers).",
  "A2 Integrity — no fabricated numbers/statistics/AUC/p-values/n=/percentages/citations/doses the user never gave; unnamed labels use neutral placeholders (Gene 1, Compound A, Step 1).",
  "A2 Verbatim — every user-supplied entity, number, unit, dose, condition and label wording appears exactly as given.",
  "B3 Coverage — every explicit request (arrow, label, comparison, annotation, emphasis, panel) is present; none silently dropped.",
  "A2 Quantified annotation — a requested magnitude the user never quantified is encoded by RELATIVE visual scale (larger block / taller bar / wider panel) or neutral tags, never by inventing a figure or announcing its absence.",
  "A4 Orientation — exactly ONE layout orientation; never mix left-to-right with top-down with a 2x2 grid in one figure.",
  "A4 Palette — palette semantic and consistent; data figures ≤4 hues plus neutrals; colourblind-safe (never red-vs-green as the only distinction).",
  "A5 Typography — no pt/px values; spacing as visual proportions; ideally <15 short labels; ≥1/4 of canvas calm; flat rendering (no shadow/glow unless asked).",
  "A4/CJK — no questions, no meta-commentary, no stray CJK outside quoted labels; output is the prompt only.",
  "B1 Type — the built figure matches the figure type the user asked for (bar stays bar, mechanism keeps direction, device keeps structure).",
  "A4 Panels/hex — panel letters only if multipanel was requested; hex codes applied to shapes, never printed as visible text, no colour-legend naming colours.",
  "B5 Domain facts — any supplied domain knowledge (flow direction, cause/effect, physical behaviour) is scientifically correct; a confidently wrong direction is worse than omitting it.",
];

// ---------- 工具：子句切分（源: promptcraft.js stripSelfNarration L343 切分逻辑）----------
function splitClauses(body) {
  // 源: promptcraft.js stripSelfNarration L343 切分逻辑（逗号/分号 + 前置 and/also）。
  // 放宽：补充句号边界（". " 后接大写 = 新句），否则 "I will not invent... . No watermark."
  // 这类句号拼接句不会被切分，自省句会漏删。
  return body.split(/(?<=[;,])\s+|(?<=\.)\s+(?=[A-Z])|\s+(?=(?:and|also)\s)/i);
}

// ---------- 工具：hex → 色名最近邻（源: promptcraft.js humanizeHexPalette L451-465）----------
function humanizeHex(text) {
  const HEX_CODE_RE = /#[0-9a-fA-F]{6}\b/g;
  let hits = 0;
  const out = String(text).replace(HEX_CODE_RE, (hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    let best = HEX_NAMED_COLORS[0];
    let bestD = Infinity;
    for (const c of HEX_NAMED_COLORS) {
      const d = (r - c[1]) ** 2 + (g - c[2]) ** 2 + (b - c[3]) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    hits += 1;
    return best[0];
  });
  return { text: out, hits };
}

// ---------- 工具：引号外 CJK 剔除（源: promptcraft.js stripStrayCJK L286-315）----------
function stripStrayCJK(text) {
  const src = String(text);
  const quotes = [];
  // 占位符用 U+E000 私有区字符包裹（不用 NUL，绕开 no-control-regex），避免被 CJK 正则误伤
  const shielded = src.replace(/("[^"]*"|“[^”]*”)/g, (q) => {
    quotes.push(q);
    return `\ue000${quotes.length - 1}\ue001`;
  });
  let hits = 0;
  const stripped = shielded.replace(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}，。；：、！？（）【】《》]+/gu,
    () => { hits += 1; return ""; }
  );
  if (hits === 0) return { text: src, hits: 0 };
  const restored = stripped
    .replace(new RegExp("\ue000(\\d+)\ue001", "g"), (_m, i) => quotes[Number(i)] ?? "")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .trim();
  return { text: restored, hits };
}

// ---------- 工具：删除自省子句（源: promptcraft.js stripSelfNarration L333-364）----------
function stripSelfNarrationLines(text) {
  const lines = String(text).split("\n");
  let hits = 0;
  const outLines = lines.map((line) => {
    const m = line.match(/^(\s*(?:[-*]\s*)?)([^:]{2,40}:\s*)?(.*)$/);
    if (!m) return line;
    const head = `${m[1] || ""}${m[2] || ""}`;
    const body = m[3] || "";
    if (!body) return line;
    const clauses = splitClauses(body);
    const endPunct = /\.\s*$/.test(body) ? "." : "";
    const kept = [];
    let localHits = 0;
    for (const c of clauses) {
      const bare = c.replace(/^[\s,;.-]+|[\s,;.-]+$/g, "");
      if (!bare) continue;
      const isSelfNarration = SELF_NARRATION_PATTERNS.some((re) => re.test(bare));
      if (isSelfNarration) { localHits += 1; continue; }
      kept.push(bare);
    }
    if (!localHits) return line;
    hits += localHits;
    const joined = kept.join(", ").replace(/\s{2,}/g, " ").replace(/^[\s,;]+|[\s,;]+$/g, "");
    return joined ? `${head}${joined}${endPunct}` : head.replace(/:\s*$/, ":");
  });
  if (!hits) return { text, hits: 0 };
  return { text: outLines.join("\n").replace(/[ \t]+\n/g, "\n"), hits };
}

// ---------- sanitizePrompt：确定性净化，幂等 ----------
// 顺序（源: promptcraft.js applyDeterministicFixes L381-432 管线）：
// 先删自省句，再修复违禁模式（hex 色名化 / CJK 剔除），最后清空格。
export function sanitizePrompt(text) {
  let out = String(text || "");

  // 1) 自省句剔除（最前，避免元评论进入后续视野被判 meta-commentary）
  const sn = stripSelfNarrationLines(out);
  out = sn.text;

  // 1.5) 🔴 配色句护盾（2026-09-21）：craft 生成的调色板句与逐阶段 colour/配色 句里的 hex
  // 是确定性配色契约（用户 --colors / 风格卡 / 缺省 Okabe-Ito），不是模型编造的色号；
  // 不护住会被 humanizeHex 洗成最近邻色名（"teal #148F77"→"teal green"），配色精度全丢。
  // "hex 不该出现在图上"由句内 Never-print 约束 + 视觉 QA 把关。其余散落 hex 照旧 humanize。
  const paletteShields = [];
  out = out.replace(
    /(Palette — [^\n]+|colour: [^.]+\.[^.]*\.?|color: [^.]+\.[^.]*\.?|配色：[^\n]+)/g,
    (m) => {
      paletteShields.push(m);
      return ` PF_PAL_SHIELD_${paletteShields.length - 1} `;
    }
  );

  // 2) 违禁模式修复（BANNED_PATTERNS 描述动作）
  for (const banned of BANNED_PATTERNS) {
    if (banned.action === "hexHumanize") {
      const r = humanizeHex(out);
      out = r.text;
    } else if (banned.action === "stripStrayCJK") {
      const r = stripStrayCJK(out);
      out = r.text;
    }
  }

  // 护盾还原（幂等：重复 sanitize 时 hex 仍在 Palette 句内、再次被护住）
  out = out.replace(/ ?PF_PAL_SHIELD_(\d+) ?/g, (_, i) => paletteShields[Number(i)]);

  // 3) 收尾：折叠多余空格 / 悬挂标点
  out = out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();

  return out;
}

// ---------- promptSelfCheck：craft 输出侧确定性体检（2026-09-23 收紧轮③） ----------
// 🔴 定位：输入质量门（quality.mjs）拦劣质输入，本函数查**门内产物**——
// craftPrompt 组装 + sanitizePrompt 净化后的提示词本身。这些都是"标签不会出现在图上"级别的
// 产物损坏，渲染必废，所以全部按 issue（拦）出，不给警告档：
//   1) 内部护盾标记残留（PF_PAL_SHIELD / U+E000 私有区）= 净化还原步骤失败
//   2) 实体标签逐个回声：净化层（stripStrayCJK/humanizeHex）吃掉引号标签 = 图上丢实体
//      （实测能发生：实体自带双引号会击穿 quote-shield 正则）
//   3) 阶段标题逐个回声：标题没拼进去 = 阶段块静默丢失
//   4) 配色句缺失（Additional style notes:）= 配色契约整段丢
//   5) 画布比回声：suggestedRatio 没出现在提示词 = 画布句与 render 继承的比例脱钩（V10 事故根源）
//   6) 长度下限 <400 字节 = 组装大面积失败（正常产物 ≥2KB）
// 纯函数：CLI 与测试共用。
export function promptSelfCheck({ prompt = "", entities = [], stageTitles = [], suggestedRatio = null } = {}) {
  const p = String(prompt || "");
  const issues = [];
  if (Buffer.byteLength(p, "utf8") === 0) {
    return { issues: ["提示词为空——craftPrompt 组装整体失败。"] };
  }
  // 1) 内部标记残留
  if (/PF_PAL_SHIELD/.test(p) || /[\ue000\ue001]/.test(p)) {
    issues.push("净化护盾标记（PF_PAL_SHIELD / U+E000）残留在提示词里——sanitize 还原步骤失败，会把内部标记当文字处理。");
  }
  // 2) 实体回声（去重后逐个查引号标签；对照格式查英文侧——卡面印的就是英文侧。
  //    标签先剥双引号再对账——craftPrompt 组装时同样剥，保持两侧一致）
  const seen = new Set();
  for (const raw of Array.isArray(entities) ? entities : []) {
    const label = splitEntityPair(raw).label.replace(/"/g, "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    if (!p.includes(`"${label}"`)) {
      issues.push(`实体「${label}」没有以引号标签出现在提示词里——净化层吃掉了它或组装漏拼，图上会静默丢这个实体（检查标签是否含引号/特殊字符）。`);
    }
  }
  // 3) 阶段标题回声
  const seenT = new Set();
  for (const t of Array.isArray(stageTitles) ? stageTitles : []) {
    const title = String(t || "").trim();
    if (!title || seenT.has(title)) continue;
    seenT.add(title);
    if (!p.includes(`"${title}"`)) {
      issues.push(`阶段标题「${title}」没有出现在提示词里——阶段块静默丢失，图上少一个区域。`);
    }
  }
  // 4) 配色句
  if (!/Additional style notes:/.test(p)) {
    issues.push("配色句（Additional style notes:）缺失——配色契约整段丢失，图模型会自由发挥配色（2026-09-21 实拍批评的灰蓝糊根因）。");
  }
  // 5) 画布比回声
  if (suggestedRatio && !p.includes(String(suggestedRatio))) {
    issues.push(`画布比 ${suggestedRatio} 没有出现在提示词里——画布句与 render 继承的比例脱钩（V10 压缩事故的根源形态）。`);
  }
  // 6) 长度下限
  if (Buffer.byteLength(p, "utf8") < 400) {
    issues.push(`提示词仅 ${Buffer.byteLength(p, "utf8")} 字节（<400）——组装大面积失败，正常产物至少 2KB。`);
  }
  return { issues };
}

// ---------- reviewCandidate：审查对象 = 模型原文 − 自省句 ----------
// 源: promptcraft.js reviewCandidate L374-376 + prompt-review.js L154-161 注释。
// 中间态：删元评论、尚未追加平台守卫 → 审查看到的是「真正会上线的内容形态」。
export function reviewCandidate(text) {
  return stripSelfNarrationLines(String(text || "")).text;
}

// ---------- 工具：检测疑似编造统计量（源: REVIEW.md A2 / OUTPUT_GUARD L158）----------
const METRIC_RE = /\b(?:AUC|p\s*[=<]|n\s*=|R\s*²|R2|R\^2|F\s*[- ]?score|accuracy|precision|recall|ROC)\b/i;
const PERCENT_RE = /\b\d+(?:\.\d+)?\s*%/;

// ---------- 工具：解析布局契约的阶段清单（--stages）----------
// 格式："Title | bullet; bullet || Title | show a 2x2 grid of thumbnails"
// 阶段间 "||"；标题与要点间 "|"（无 | = 只有标题）；要点间 ";"。
// 也接受 JSON 数组（[{title, bullets: []}]），供程序化调用。
export function parseStages(stages) {
  if (Array.isArray(stages)) {
    return stages
      .map((s) => (typeof s === "string" ? { title: s.trim(), bullets: [] } : { title: String(s.title || "").trim(), bullets: (s.bullets || []).map((b) => String(b).trim()).filter(Boolean) }))
      .filter((s) => s.title);
  }
  const text = String(stages || "").trim();
  if (!text) return [];
  return text
    .split("||")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const bar = chunk.indexOf("|");
      if (bar === -1) return { title: chunk, bullets: [] };
      const title = chunk.slice(0, bar).trim();
      const bullets = chunk
        .slice(bar + 1)
        .split(";")
        .map((b) => b.trim())
        .filter(Boolean);
      return { title, bullets };
    })
    .filter((s) => s.title);
}

// ---------- craftPrompt：组装提示词 ----------
// 🔴 2026-09-21 二轮迭代（用户批评"提示词太笼统，没有具体画什么"）：
// 对标 paper-banana.org 成品提示词（End-to-End Segmentation Training Pipeline）与
// GPT-Image2-Skill research-paper-figures gallery 的「布局契约」模式——
// 编号阶段 + 每阶段 2-4 条内容要点 + 指定阶段内画什么（"Show a 2x2 grid of tile
// thumbnails inside the stage"）。新增 stages 输入；结构链可自动拆阶段；空盒子必警告。
export function craftPrompt(input = {}) {
  const {
    intent = "",
    entities: entitiesRaw = [],
    structure = "",
    stages = "",
    figureType = "flowchart",
    lang = "en",
    styleHints = "",
    preset = "",
    // 🔴 期刊画幅规范（2026-09-22 竞品差距①：academic-figure-skill 把期刊尺寸/字号做成先验）：
    // "nature|science|ieee|elsevier|thesis" —— 把"最终会被缩到多宽印刷"写进提示词，
    // 字号/线宽/信息密度按物理宽度反推；缺省不注入（行为不变）。
    journal = "",
    // 🔴 用户色板（2026-09-21 定规：配色必须可替换，不许写死）：
    // "deep red #C0392B, teal #16A085, …" —— 给了就整体换用；没给再看风格卡里的 hex 组；
    // 都没有才落到缺省 Okabe-Ito。阶段配色行 / 调色板句全部由 paletteSentence/模板拼接生成。
    colors = "",
    // 🔴 多轮精修（2026-09-21 定规：出图≠完工，本地 AI 的核心优势就是能多轮迭代）：
    // 上一版视觉核验发现的每个缺陷，作为硬性修正条拼接进本版提示词——
    // "卡7 source panel 淡绿底纹; 图例两项靠太近"。分号分隔，逐条编号成 hard requirement 块。
    fixes = "",
    // 🔴 画布比（2026-09-21 V10 事故：写死 "roughly 16:5" 而实际渲染 16:9 → 内容被压缩）：
    // 画布句永远从本参数拼接生成（canvasSentence），不许在模板里写死比例数字。
    // 未显式给时按版式预设取缺省（double-column/slide → 16:9，single-column → 3:4）。
    ratio = "",
  } = input;

  // 🔴 双语对照实体（2026-09-22 用户拍板）：「英文标签|原文词」——卡面/提示词只印英文侧，
  // 原文侧留给 checkEntitySource 对账（quality.mjs）。craft 收到的数组先在这里归一。
  // 🔴 2026-09-23 收紧轮③：ASCII 双引号剥掉——标签被拼进 "…" 引号契约里，自带引号会击穿
  // 净化护盾正则（shield 只认成对引号）并产出嵌套引号，图模型无法判断标签边界（输出体检实锤）。
  const stripQuote = (s) => String(s).replace(/"/g, "").trim();
  const quoteStripped = [];
  const entities = (Array.isArray(entitiesRaw) ? entitiesRaw : [])
    .map((e) => {
      const label = stripQuote(splitEntityPair(e).label);
      if (splitEntityPair(e).label !== label) quoteStripped.push(label);
      return label;
    })
    .filter(Boolean);

  // 色板只解析一次：--colors 显式 > 风格卡 hex 组 > 缺省 Okabe-Ito
  const palette = buildPalette({ colors, styleHints });

  const warnings = [];
  const promptParts = [];

  // —— 确定性输入检查（warnings）——
  if (!String(intent || "").trim()) {
    warnings.push("intent 为空：缺少图的核心意图，AI 易编造内容 —— 必须给出一句话主题。");
  }
  if (!Array.isArray(entities) || entities.length === 0) {
    warnings.push("entities 为空：图上无命名实体，将大量依赖占位符（Gene 1 / Step 1）。");
  } else if (entities.length < 3) {
    // 实测（weak-model-eval 2026-09-21）：提取器漏提取（如丢了全部数据集名）→ 图不完整且审查 Q4 必挂。
    // craft 看不到原文，只能用「数量异常少」这个弱信号提醒宿主 AI 回原文核对。
    warnings.push(`实体只有 ${entities.length} 个（<3）：回原文逐个核对名词模块，确认不是漏提取——分组结构（多个数据集/类别/基线）整组丢失是最常见的漏法，图会不完整。`);
  }
  const rawBlob = [intent, ...(Array.isArray(entities) ? entities : []), structure, styleHints].join(" ");
  if (METRIC_RE.test(rawBlob) || PERCENT_RE.test(rawBlob)) {
    warnings.push("输入含疑似统计量（AUC/p=/n=/%/R² 等）：若用户未提供具体数值，审查将判 A2 blocker —— 用视觉大小表达量级。");
  }
  // 🔴 铁律 9：数值精确的结果图不许 AI 重画。图型是 result-style 且带指标词 = 高概率在
  // 尝试重画承载精确数值的结果图 —— 必须显式拦一道，只靠 types 目录里的说明宿主 AI 会漏读。
  if (figureType === "result-style" && (METRIC_RE.test(rawBlob) || /waterfall|ablation|baseline comparison|累计|增益|F1@/i.test(rawBlob))) {
    warnings.push(
      "疑似要重画承载精确数值的结果图（result-style + 指标/消融词）：AI 画数字必错。确认这是纯示意图——" +
      "要保留精确数值就停手，引导用户改绘图脚本样式（配色/字体/线宽，全文统一），或让用户提供数值后再走。"
    );
  }
  // 实测（scripts/weak-model-eval.mjs 2026-09-20）新增：中文实体 → 图内中文标签，standard 档乱码率高
  const cjkEnts = (Array.isArray(entities) ? entities : [])
    .map((e) => String(e))
    .filter((e) => /[\p{Script=Han}]/u.test(e));
  if (cjkEnts.length) {
    warnings.push(`实体含中文（${cjkEnts.length} 个）：图内将渲染中文标签，standard 档乱码率高（实测 "image profersising" 级别）。出路：把每个实体译成英文标签重填 --entities（如 融合模块 → Weighted Box Fusion，但要保证每个译名都对应原文实体，不许借机编造）；确实要中文标签就走 premium 定稿（standard 草稿 → pf qa 核验 → 审批通过 → render --model premium）。`);
  }

  // —— 1) 图型目录路由（12 图型；未知 id 给 warning 并回退 pipeline）——
  const { entry, meta } = resolveType(figureType);
  if (!entry) {
    const valid = FIGURE_CATALOG.filter((t) => t.guide).map((t) => t.id);
    warnings.push(
      `未知图型 "${figureType}"（可选：${valid.join(" / ")}）—— 已回退 pipeline。选型拿不准先看 pf types（每种带选型时机+构图思考+完整示例）。`
    );
  }
  const typeTpl = entry
    ? entry.guide
    : "Method pipeline figure: sequential stages left-to-right (or top-down for single-column), each stage a rounded box with a short English label, arrows showing data flow direction.";
  promptParts.push(typeTpl);

  // —— 2) 实体 / 结构视觉化描述 ——
  const entList = (Array.isArray(entities) ? entities : [])
    .map((e) => String(e).trim())
    .filter(Boolean);
  if (entList.length) {
    const ents = lang === "zh"
      ? `图中实体（保持用户原文）：将以下各项作为命名节点/模块呈现 —— ${entList.map((e) => `"${e}"`).join("、")}。`
      : `Named entities (keep verbatim): present each of the following as a labelled node/block — ${entList.map((e) => `"${e}"`).join(", ")}.`;
    promptParts.push(ents);
  }

  // —— 2b) 布局契约：编号阶段块（布局契约核心段，对标 PaperBanana 成品提示词）——
  // 解析 --stages："Title | bullet; bullet || Title | bullet"（阶段间 ||，标题与要点间 |，要点间 ;）
  // 没给 stages 时：结构链（A → B → C）自动拆成仅有标题的阶段，并警告"空盒子"风险。
  const stageList = parseStages(stages).map((s) => {
    const title = stripQuote(s.title);
    if (title !== s.title) quoteStripped.push(title);
    return { ...s, title };
  });
  const structureText = String(structure || "").trim();
  const chainStages = !stageList.length && structureText
    ? structureText.split(/\s*(?:→|->|⇒)\s*/).map((s) => s.trim()).filter(Boolean)
    : [];
  const derivedStages = stageList.length ? stageList : chainStages.map((t) => ({ title: t, bullets: [] }));

  if (derivedStages.length >= 2) {
    promptParts.push(
      lang === "zh"
        ? "阶段用编号块表达，按顺序用带标签的短箭头相连；每个阶段框内上方是标题，下方列出它的内容要点。"
        : "Numbered stage blocks connected in order by short labelled arrows; each stage carries its quoted title on top and its content items inside the box."
    );
    derivedStages.forEach((st, i) => {
      const title = `阶段 ${i + 1} — "${st.title}"`;
      const titleEn = `Stage ${i + 1} — "${st.title}"`;
      // 🔴 逐块指定颜色（2026-09-21 用户要求"明确告知画什么颜色，每一块都是"）——
      // 从 palette.cycle 按序拼接，不写死：用户/风格卡给了色板就整体换用
      const c = palette.cycle[i % palette.cycle.length];
      const colorEn = `colour: border ${c.name}, fill white with a ${c.tint}, title text in the border hue`;
      const colorZh = `配色：边框 ${c.name}，白色底加该色的极淡色调填充，标题文字用边框同色`;
      if (!st.bullets.length) {
        promptParts.push(lang === "zh" ? `${title}（无内容要点）${colorZh}` : `${titleEn} (no content items supplied). ${colorEn}.`);
        return;
      }
      const visual = st.bullets.filter((b) => /^(show|draw|画|示意)\b/i.test(b));
      const plain = st.bullets.filter((b) => !/^(show|draw|画|示意)\b/i.test(b));
      const bits = [];
      if (plain.length) {
        bits.push(
          lang === "zh"
            ? `框内内容要点：${plain.map((b) => `"${b}"`).join("；")}`
            : `inside the box: ${plain.map((b) => `"${b}"`).join("; ")}`
        );
      }
      if (visual.length) {
        bits.push(
          lang === "zh"
            ? `框内画：${visual.map((b) => `"${b.replace(/^(画|示意)\s*/, "show ")}"`).join("；")}`
            : `draw ${visual.map((b) => `"${b.replace(/^show\s*/i, "")}"`).join(" and ")} inside the stage`
        );
      }
      bits.push(lang === "zh" ? colorZh : colorEn);
      promptParts.push(`${lang === "zh" ? title : titleEn}: ${bits.join(lang === "zh" ? "；" : "; ")}.`);
    });
    if (!stageList.length) {
      warnings.push(
        "结构链只有名词（自动拆成了仅标题的编号阶段）：图模型只能画空标题盒子——这正是\"提示词笼统\"的根因。回原文给每个阶段补 2-4 条内容要点与内部画法（--stages \"标题 | 要点1; 要点2 || …\"，视觉内容写 show 开头）。"
      );
    } else if (stageList.some((s) => !s.bullets.length)) {
      const empty = stageList.filter((s) => !s.bullets.length).map((s) => s.title).join("、");
      warnings.push(`这些阶段没有内容要点（${empty}）：空标题盒子必出——补 2-4 条要点或内部画法（show 开头的条目会被画成阶段内的视觉元素）。`);
    }
    // 🔴 卡面文字契约（2026-09-21 V11 复盘：plain 要点句被图模型原样印进卡面——
    // 因为 craft 把它们拼成引号句 "inside the box: …"，与 NEGATIVE_LIST 的文字白名单自相矛盾，
    // 模型听拼句不听负向清单）。正解：明说"引号句是画什么，不是印什么"。
    promptParts.push(
      lang === "zh"
        ? "卡面文字契约：图上可印的文字只有各阶段标题与实体标签（每条 ≤5 词）。阶段块里引号中的句子（包括 draw/show 后面的描述）只说明【画什么】，绝不作为文字印进图里；也不要把它们缩短后当卡面小标题印上。"
        : "Canvas text contract: the ONLY printable text is each stage title and the entity labels listed above (each at most 5 words). Quoted sentences in the stage blocks (including after draw/show) specify WHAT TO DRAW, never text to print — do not print them verbatim and do not shorten them into printed captions either."
    );
    // 🔴 句子型要点前置拦截（V11 事故源头在写手侧）：plain 要点写成完整句子必被印出
    const sentencey = stageList
      .flatMap((s) => s.bullets.filter((b) => !/^(show|draw|画|示意)\b/i.test(b) && b.trim().split(/\s+/).length > 8))
      .map((b) => `"${b}"`);
    if (sentencey.length) {
      warnings.push(`这些框内要点是完整句子（${sentencey.join("；")}）——图模型会把它们原样印进卡面（V11 事故）。要点改成 ≤5 词短标签；说明性内容挪进 show 句描述画法，不要印。`);
    }
  }

  if (structureText && !(chainStages.length >= 2)) {
    promptParts.push(
      lang === "zh"
        ? `整体结构："${structureText}"。只采用一种阅读朝向，不要混用两种布局逻辑。`
        : `Overall structure: "${structureText}". Commit to ONE reading orientation; never mix two layout logics.`
    );
  }
  // 多区域图型却拿不到任何阶段清单（结构也没法拆链）：区域内容完全缺失，必警
  if (derivedStages.length < 2 && ["pipeline", "architecture", "dataflow", "zoomin", "mechanism", "flowchart"].includes(figureType)) {
    warnings.push(
      "该图型是多区域版式，但没给编号阶段（--stages）、结构也没法拆成链：图模型只能按图型惯例摆区域，每个区域里画什么全靠它编。给每个区域补 标题 + 2-4 条内容要点 + 内部画法（--stages \"标题 | 要点1; 要点2 || …\"）。"
    );
  }
  if (String(intent || "").trim()) {
    // 对标 PaperBanana Planner 的 communicative intent（竞品对比差距⑤）：
    // intent 不只是主题，是"读者看完必须记住的那一句话"——引导图模型围绕单一信息核心构图
    // 🔴 premium 实测（2026-09-21）：不说"别画出来"，图模型会把这句话渲染成图底部的大横幅
    promptParts.push(
      lang === "zh"
        ? `核心意图（仅供构图决策，🔴 禁止把这句话画进图里或作为任何可见文字）："${intent}"。所有元素为传达这一点服务，与它无关的装饰一律不要。`
        : `Core intent (design guidance only — do NOT draw, print or caption this sentence anywhere in the figure): "${intent}". Every element serves this message; drop anything decorative that does not.`
    );
  }

  // —— 3) 版式预设（竞品对比差距④：产物要符合期刊物理版式）——
  // 🔴 画布比单一来源（2026-09-21 V10 事故）：画布句永远由 canvasSentence 从 ratio 拼接，
  // 显式 --ratio > 版式预设缺省；提示词里说几比几，render 就渲染几比几（伴随 JSON 继承）。
  const presetKey = String(preset || "").trim();
  const explicitRatio = parseRatio(ratio) ? String(ratio).trim() : null;
  if (ratio && !explicitRatio) {
    warnings.push(`--ratio "${ratio}" 格式不认识（要 "宽:高" 如 16:9 / 3:4 / 1:1）—— 已忽略，画布比回退预设缺省。`);
  }
  const effectiveRatio = explicitRatio || defaultRatioForPreset(presetKey);
  // 🔴 红队审计（2026-09-23 B）：无 preset 也无 ratio 时 suggestedRatio=null，画布句静默缺席——
  // "画布比永远由 craft 拼进提示词"的声称落空，render 也无从继承。给全局缺省 16:9。
  const finalRatio = effectiveRatio || "16:9";
  if (presetKey && PRESET_LAYOUTS[presetKey]) {
    promptParts.push(`Layout constraint: ${PRESET_LAYOUTS[presetKey]}`);
  } else if (presetKey) {
    warnings.push(`未知版式预设 "${presetKey}"（可选：${Object.keys(PRESET_LAYOUTS).join(" / ")}）—— 已忽略。`);
  }
  // —— 3b) 期刊画幅规范（academic-figure-skill 差距补齐）：注入印刷宽度契约 ——
  const journalKey = String(journal || "").trim();
  if (journalKey) {
    const js = journalSentence(journalKey);
    if (js) {
      promptParts.push(js);
      const hint = journalPresetHint(journalKey, presetKey);
      if (hint) warnings.push(hint);
    } else {
      warnings.push(`未知期刊规范 "${journalKey}"（可选：nature / science / ieee / elsevier / thesis）—— 已忽略。`);
    }
  }
  if (finalRatio) {
    const cs = canvasSentence({ ratio: finalRatio, stageCount: derivedStages.length });
    if (cs) promptParts.push(cs);
    if (effectiveRatio && !explicitRatio) {
      warnings.push(`画布比未显式给，按版式预设 "${presetKey}" 取缺省 ${effectiveRatio}（已拼进提示词，render 会自动继承）。要换比例就 craft --ratio 宽:高。`);
    } else if (!explicitRatio && !effectiveRatio) {
      warnings.push("未给 --preset / --ratio：画布比按全局缺省 16:9（已拼进提示词，render 会自动继承）。要换比例就 craft --ratio 宽:高。");
    }
  }

  // —— 4) 风格基线 ——
  promptParts.push(`Style: ${STYLE_BASELINE}`);

  // —— 5) 负向清单（通用 + 该图型特有的避坑，对标 awesome-gpt-image-2「每类图自带避坑规则」）——
  const avoidParts = [...NEGATIVE_LIST];
  if (entry?.avoid) avoidParts.push(entry.avoid);
  promptParts.push(`Avoid: ${avoidParts.join("; ")}.`);

  // —— 5.5) 多轮精修块：上一版核验出的缺陷逐条拼接为硬性修正（2026-09-21 定规）——
  // 不重掷骰子：上一版画对的部分原样保留，本块只钉死上一版的失败点。
  const fixList = String(fixes || "")
    .split(/[;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (fixList.length) {
    promptParts.push(
      lang === "zh"
        ? `上一版修正（逐条都是硬性要求，必须全部满足）：${fixList.map((f, i) => `(${i + 1}) ${f}`).join("；")}。`
        : `Corrections from the previous attempt — each is a HARD requirement, satisfy all of them: ${fixList.map((f, i) => `(${i + 1}) ${f}`).join("; ")}.`
    );
  }

  // ⚠️ 实测教训（scripts/weak-model-eval.mjs 2026-09-20，4/4 用例命中）：
  // OUTPUT_GUARD_LINES 是**写给宿主 AI（写手）**的约束，绝不能拼进发给图模型的提示词——
  // 否则 "Output only the prompt / emit the field headers" 等写手指令成为图模型提示词的噪音，
  // 且其要求的七字段头格式 craft 产物本身不满足，自相矛盾。它们经 writerGuard 返回给宿主 AI。

  // —— 6) 额外风格提示（用户给的 styleHints / 文档风格卡）——
  // 🔴 调色板句永远注入、且永远由 paletteSentence 拼接生成（不写死 hex）：
  // 用户 --colors 或风格卡 hex 组生效时拼"用户色板句"，否则拼 Okabe-Ito 缺省句。
  // 旧逻辑 styleHints 存在就整体顶掉配色映射，"muted blue-grey palette" 这种无 hex 风格卡
  // 会让图模型自由发挥成灰蓝糊（2026-09-21 用户实拍批评"明显不是科研配色"）。
  promptParts.push(`Additional style notes: ${paletteSentence(palette)}`);
  if (String(styleHints || "").trim()) {
    promptParts.push(`Document style notes (supplementary): ${styleHints}`);
  }

  // 引号剥离警告（实体标签/阶段标题归一时收集，见上方 stripQuote）
  if (quoteStripped.length) {
    warnings.push(`这些实体/阶段标题含双引号，已剥掉（${quoteStripped.join("、")}）——引号会击穿提示词的引号契约，卡面标签不要带引号字符。`);
  }

  // 组装后整体再过一遍确定性净化（幂等，删掉任何残留自省句 / 违禁模式）
  const prompt = sanitizePrompt(promptParts.join("\n\n"));

  return {
    prompt,
    warnings,
    checklist: CHECKLIST,
    // 图型条目（CLI 据此打印选型时机/构图思考；无匹配时为 null）
    typeMeta: meta || null,
    // 🔴 建议画布比（CLI 写进伴随 JSON，render 自动继承 —— 画布句与实际渲染比强一致）
    suggestedRatio: finalRatio,
    // 实际进入提示词的阶段标题（含结构链自动拆出的）——promptSelfCheck 回声检查用
    stageTitles: derivedStages.map((s) => s.title),
    // 写手守卫：给宿主 AI 在**写/改提示词时**遵守（源: OUTPUT_GUARD），不进图模型提示词
    writerGuard: OUTPUT_GUARD_LINES,
    // 渲染后视觉核验清单（图出来之后宿主 AI 亲眼读图逐条过；对标 ARS VLM 核验）
    qaChecklist: QA_CHECKLIST,
  };
}
