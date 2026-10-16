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
  VISUAL_GRAMMAR,
  NEGATIVE_LIST,
  OUTPUT_GUARD_LINES,
  PRESET_LAYOUTS,
  QA_CHECKLIST,
  MOTIF_HINTS,
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
import { parseSlots } from "./assets.mjs";

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

// ---------- buildStageSceneNarrative：场景叙述段（2026-10-13 组词重构核心） ----------
// 原则（对标 PaperBanana Planner + 图模型 attention 实证）：
//   ① 每个属性只说一次——几何/逐卡配色/内容收进一段连贯画面叙述，
//      替代原「阶段几何句 + 逐阶段配色句×N + 调色板句 + 风格豁免句」四处分散
//   ② 场景叙述 > 元指令——模型只执行"名词 + 空间关系 + 属性"
//   ③ 叙述段放提示词最前（首因位置留给画面主体）
// 🔴 2026-10-13 卡内空洞实拍复盘（用户批评 craft-rework-v1.png"这就是文字和框框，
// 里面啥都没有"）新增卡内内容分级：
//   - ≤2 词纯标签 = chips（每卡最多 2 条，可印卡面，进可印白名单）
//   - >2 词 plain 要点 = 降级为母题推导素材，不再印卡面（原逻辑全印 → 卡面变文字列表）
//   - show 句具体（含视觉词汇/数字）= 照用；show 句笼统或缺失 = 用 MOTIF_HINTS
//     原语映射按标题+要点推 1-2 个母题（2026-10-14 重构：数据类型→学术原语，见 craft-rules.mjs）
// 纯函数，返回 { text, strippedInstr, chips, vagueShows, demoted, uncovered }；
// stages < 2 或非线性拓扑门控回落时返回 null / 旧路径。
const VISUAL_VOCAB_RE = /(thumbnail|grid|stack|bar|box(es)?|icon|arrow|dashed|solid|rounded|cuboid|cylinder|heat ?map|graph|node|curve|circle|badge|chip|colour|color|pastel|hue|shaded|motif|glyph|chart|photo|mini|strip|funnel|mirrored|copy|blocks|sheet|table|gauge|funnel|fan|frames|tag|axes|badge|tiles?|converging)/i;
export function buildStageSceneNarrative({ stages, palette, lang = "en", figureType = "pipeline" }) {
  if (!Array.isArray(stages) || stages.length < 2 || !palette?.cycle?.length) return null;
  // 🔴 拓扑门控（2026-10-13）：线性卡片叙述只适配"链式/流程"族；
  // hierarchy（树）/timeline（时间轴）等非线性拓扑硬套横排卡片=误导，先回落调色板句，
  // 等各自专属叙述分支就绪再放开（见 ref-provenance/prompt-research 分册）。
  const LINEAR_TYPES = new Set(["pipeline", "dataflow", "flowchart", "architecture", "zoomin", "mechanism", undefined, ""]);
  const isComparison = (figureType === "comparison" || figureType === "multi-panel") && stages.length >= 2;
  if (!isComparison && !LINEAR_TYPES.has(figureType)) return null;
  const stripped = [];
  const VISUAL_RE = /^(show|draw|画|示意)\b/i;
  const INSTR_PREFIX = /^(?:label|name|call|mark|tag|entitle|印|标注|叫做|称为)\s+/i;
  const stripInstr = (b) => {
    const m = b.match(INSTR_PREFIX);
    if (m && b.length > m[0].length) {
      stripped.push(`"${b}" → 只印 "${b.slice(m[0].length)}"`);
      return b.slice(m[0].length);
    }
    return b;
  };
  const hueOf = (name) => String(name || "").replace(/#[0-9a-fA-F]{3,8}\b/g, "").trim() || "this hue";
  // —— 卡内内容分级 + 图标推导（2026-10-13 卡内空洞实拍复盘）——
  const wordCount = (b) => b.trim().split(/\s+/).length;
  const isConcreteVisual = (desc) => VISUAL_VOCAB_RE.test(desc) || /\d/.test(desc);
  const deriveMotifs = (st) => {
    const pool = [st.title, ...st.bullets].join(" ");
    const hits = [];
    for (const { re, icon } of MOTIF_HINTS) {
      if (re.test(pool) && !hits.includes(icon)) hits.push(icon);
      if (hits.length >= 2) break;
    }
    return hits;
  };
  const chipsAll = [];
  const vagueShows = [];
  const demotedAll = [];
  let uncovered = 0;
  // 返回该卡"卡内"叙述片段（可能为空串）+ 分级产物
  const interiorOf = (st) => {
    const plain = st.bullets.filter((b) => !VISUAL_RE.test(b)).map(stripInstr);
    const visualRaw = st.bullets
      .filter((b) => VISUAL_RE.test(b))
      .map((b) => b.replace(VISUAL_RE, "").replace(/^画|示意\s*/g, "").trim())
      .filter(Boolean);
    const chips = plain.filter((b) => wordCount(b) <= 2).slice(0, 2);
    const demoted = plain.filter((b) => wordCount(b) > 2);
    const concreteVisual = visualRaw.filter(isConcreteVisual);
    const vague = visualRaw.filter((v) => !isConcreteVisual(v));
    // 🔴 craft-motif-v1 实拍复盘（standard 一轮）：show 短句带引号（`inside it "lr and hr
    // thumbnails"`）被图模型整句印成斜体文字（卡1/卡6 全空）。两条修复：
    //   ① 具体 show 也改成不带引号的绘图指令措辞（引号 = 可印文字的视觉信号）；
    //   ② show 无数字锚点时仍从词典补 1 条母题（"detection boxes on a thumbnail" 这类
    //      短句信息量不够，模型还是会画通用框；补上 "bounding boxes drawn over a photo"
    //      级描述才画得动）。有数字锚点（"strip of 3 thumbnails"）视为足够具体，不加。
    const showHasDigit = /\d/.test(visualRaw.join(" "));
    const motifs = showHasDigit ? [] : deriveMotifs(st);
    chipsAll.push(...chips);
    vagueShows.push(...vague);
    demotedAll.push(...demoted);
    if (!concreteVisual.length && !motifs.length) uncovered += 1;
    const bits = [];
    if (concreteVisual.length) {
      bits.push(lang === "zh" ? `内嵌小图：${concreteVisual.join("与")}（画成图形，不要印成文字）` : `inside it a small graphic of ${concreteVisual.join(" and ")} — drawn, never printed as text`);
    }
    if (motifs.length) {
      bits.push(lang === "zh" ? `卡内画一幅内容小图（${motifs.join(" + ")}）——按描述画出具体物体，不要只画空方框` : `a small content pictogram inside: ${motifs.join(", plus ")}`);
    }
    if (chips.length) {
      bits.push(lang === "zh" ? `小文字标签 ${chips.map((c) => `"${c}"`).join("、")}` : `tiny text labels ${chips.map((c) => `"${c}"`).join(", ")}`);
    }
    return bits.join(lang === "zh" ? "，" : ", ");
  };
  // —— comparison 专属叙述：双面板受控对照（对应元素同槽位），非线性线性卡片 ——
  if (isComparison) {
    const panelDesc = (st, i) => {
      const interior = interiorOf(st);
      const c = palette.cycle[i % palette.cycle.length];
      return lang === "zh"
        ? `面板 ${i + 1}「${st.title}」用${c.tint}（明显着色，非纯白），边框与标题用全饱和度的 ${hueOf(c.name)}${interior ? `，${interior}` : ""}`
        : `Panel ${i + 1} "${st.title}" with a ${c.tint} (clearly tinted, never pure white), ${hueOf(c.name)} border and title${interior ? `, ${interior}` : ""}`;
    };
    return {
      text: lang === "zh"
        ? `画面：白底上并排 ${stages.length} 张等宽圆角面板。${stages.map(panelDesc).join("。")}。各面板内部结构与排版完全一致，对应元素占相同槽位，构成受控对照。`
        : `Scene: ${stages.length} rounded-rectangle panels side by side on a white background, equal width. ${stages.map(panelDesc).join("; ")}. All panels share identical internal structure and typography — matching elements sit at the same slot positions so they read as a controlled comparison.`,
      strippedInstr: stripped,
      chips: [...new Set(chipsAll)],
      vagueShows,
      demoted: demotedAll,
      uncovered,
    };
  }
  if (lang === "zh") {
    const cards = stages.map((st, i) => {
      const c = palette.cycle[i % palette.cycle.length];
      const interior = interiorOf(st);
      // tint 已含 "fill" 词、hue 抠掉 hex（humanizeHex 会把 hex 变色词造成重复），模板不再补词
      return `卡 ${i + 1}「${st.title}」用${c.tint}（明显着色，非纯白），边框与标题用全饱和度的 ${hueOf(c.name)}${interior ? `，${interior}` : ""}`;
    });
    return {
      text: `画面：白底上一排 ${stages.length} 张留白充裕的圆角卡片，从左到右等宽铺开。${cards.join("。")}。短实线箭头按序连接相邻卡片，阅读方向唯一；最后一张卡承载最强饱和度（输出/贡献位）。`,
      strippedInstr: stripped,
      chips: [...new Set(chipsAll)],
      vagueShows,
      demoted: demotedAll,
      uncovered,
    };
  }
  const cards = stages.map((st, i) => {
    const c = palette.cycle[i % palette.cycle.length];
    const interior = interiorOf(st);
    return `Card ${i + 1} "${st.title}" with a ${c.tint} (clearly tinted, never pure white), ${hueOf(c.name)} border and title${interior ? `, ${interior}` : ""}`;
  });
  return {
    text: `Scene: one horizontal flow on a white background — ${stages.length} generously padded rounded-rectangle cards left to right, evenly spanning the width. ${cards.join("; ")}. Short solid dark-grey arrows connect consecutive cards in order; one reading direction only. The last card carries the strongest saturation as the output.`,
    strippedInstr: stripped,
    chips: [...new Set(chipsAll)],
    vagueShows,
    demoted: demotedAll,
    uncovered,
  };
}

// ---------- promptSelfCheck：craft 输出侧确定性体检（2026-09-23 收紧轮③） ----------
// 🔴 定位：输入质量门（quality.mjs）拦劣质输入，本函数查**门内产物**——
// craftPrompt 组装 + sanitizePrompt 净化后的提示词本身。这些都是"标签不会出现在图上"级别的
// 产物损坏，渲染必废，所以全部按 issue（拦）出，不给警告档：
//   1) 内部护盾标记残留（PF_PAL_SHIELD / U+E000 私有区）= 净化还原步骤失败
//   2) 实体标签逐个回声：净化层（stripStrayCJK/humanizeHex）吃掉引号标签 = 图上丢实体
//      （实测能发生：实体自带双引号会击穿 quote-shield 正则）
//   3) 阶段标题逐个回声：标题没拼进去 = 阶段块静默丢失
//   4) 配色契约缺失（场景叙述内嵌配色与调色板句都不在）= 图模型自由发挥配色
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
  // 4) 配色契约（2026-10-13 组词重构）：阶段图=场景叙述段内嵌配色（pastel/填充词在）；
  //    非阶段图=尾部调色板句。两者都不在 = 配色契约整段丢
  if (!/Additional style notes:/.test(p) && !/pastel|fill/i.test(p)) {
    issues.push("配色契约缺失（既无场景叙述内嵌配色也无调色板句）——图模型会自由发挥配色（2026-09-21 实拍批评的灰蓝糊根因）。");
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
    // 🔴 承载意思的几何约束（2026-09-26 Swin 移位窗口实测补）：宿主声明"分界线必须在
    // 第 4 行 / 轴标签 1-8 / 偏移 2 格"这类几何契约。AI 渲染保证不了（实测轴标签出
    // 两个 3、分界线落在 3 和 5/6 行），声明 = ①craft 告警 ②进 sidecar ③QA 包出几何
    // 核验清单——把"几何精确"从审批人自觉变成流程义务。精确结构类图（坐标网格/窗口
    // 划分/算法示意）必填；不给则 QA 只能靠 Q3 泛查。
    geometry = "",
  } = input;

  // 🔴 双语对照实体（2026-09-22 用户拍板）：「英文标签|原文词」——卡面/提示词只印英文侧，
  // 原文侧留给 checkEntitySource 对账（quality.mjs）。craft 收到的数组先在这里归一。
  // 🔴 2026-09-23 收紧轮③：ASCII 双引号剥掉——标签被拼进 "…" 引号契约里，自带引号会击穿
  // 净化护盾正则（shield 只认成对引号）并产出嵌套引号，图模型无法判断标签边界（输出体检实锤）。
  const stripQuote = (s) => String(s).replace(/"/g, "").trim();
  const quoteStripped = [];
  // 指令前缀剥离留痕（"label X" → 只印 X），循环尾统一告警
  const strippedInstr = [];
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
  const typeTplIdx = promptParts.length; // 场景叙述生成后可能替换为 guideScene（几何唯一化）
  promptParts.push(typeTpl);

  // —— 1b) 图型母题污染告警（2026-09-26 实测补）——
  // 图型 guide 自带框架词（comparison 的 baseline/ours/Slot、multi-panel 的 (a)(b)(c)/legend），
  // 图模型会当内容渲染。用 comparison 画"两种构型"、用 multi-panel 画单幕流程图时，
  // 这些词改变的是**图在说什么**（意思错，阻断级），不是美观问题。
  // 告警 = 让宿主显式覆盖；不覆盖 =  QA Q2/Q4 见一个词拦一个词。
  if (entry?.motifWords?.length) {
    warnings.push(
      `图型「${entry.name}」的母题自带框架词：${entry.motifWords.map((w) => `"${w}"`).join("、")}——图模型会把它们当内容画上图。若本文不是这个框架（如用 comparison 画两种窗口构型而非方法对比），必须在 --stages 里显式覆盖（例："two panels titled Regular and Shifted; no baseline/ours wording; no slot numbers"），否则 Q2/Q4 按编造拦截。`
    );
  }

  // —— 2) 实体 / 结构视觉化描述 ——
  const entList = (Array.isArray(entities) ? entities : [])
    .map((e) => String(e).trim())
    .filter(Boolean);
  if (entList.length) {
    // 🔴 属性唯一化（2026-10-13 组词重构）：实体句延后到阶段场景叙述之后，
    // 只补「未被阶段标题覆盖」的实体——阶段图里实体=卡片，整行省去（原重复源之一）
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

  // 🔴 sceneBuilt：阶段图配色的唯一化标记——场景叙述段生成成功后，
  // 尾部不再注入调色板句（原四处颜色重复源之一），只给非阶段图兜底。
  let sceneBuilt = false;
  let sceneResult = null; // 供白名单（chips）与卡内覆盖度检查用；拓扑门控回落时为 null
  if (derivedStages.length >= 2) {
    // 🔴 思考外置（2026-10-14 定版路线，用户定调"从拼接提示词变成调用用户 AI 思考"）：
    // scene = 宿主 AI 看 pf refs 真图思考后写的自然语言画面段，craft 只做直通 + 阅卷
    // （护栏照跑），不再正则推导图标/槽位——词典路线退役为无 scene 时的兜底。
    const sceneText = String(input.scene || "").trim();
    if (sceneText) {
      // 🔴 资产槽位（2026-10-14）：scene 里 {{asset:名|路径}} / {{icon:名|描述}} 先解析——
      // 槽位位置在给图模型的文本里改写成纯品红占位块，渲后 pf compose 贴真图/图标。
      // 宿主 AI 在 brief 例图清单里挑中的原文例图走 asset；要单独画的图标走 icon。
      const { slots, modelScene } = parseSlots(sceneText);
      // 🔴 真链路实测（2026-10-14 claude 宿主）：宿主 AI 会嘴上说 "only as a layout
      // reference, never pasted" 却把方法图写进 {{asset}} 槽位——自相矛盾。阅卷抓这个矛盾：
      // 槽位标记邻近文本出现"仅参考"措辞 = 告警，让宿主改掉（参考图不进槽位，槽位=贴原图）。
      const refOnlySlots = slots.filter((s) => {
        const idx = sceneText.indexOf(`{{${s.kind}:${s.name}`);
        // 矛盾措辞可能在槽位标记之前或之后——两侧都扫。
        // 🔴 只抓「定性为参考图/不进卡面」类矛盾（reference only / never pasted）；
        // "must not be redrawn" 是贴原图的正当理由，不算矛盾，别误伤
        const ctx = sceneText.slice(Math.max(0, idx - 200), idx + s.value.length + 300);
        return /\b(only as a? )?(layout |drawing )?reference only\b|\b(only as a? )?(layout |drawing )?reference\b(?!\s*for)|never pasted|never be pasted|do not paste|not be pasted|仅参考/i.test(ctx);
      });
      // 🔴 审查机制（2026-10-14）：仅参考标记随槽位落 sidecar——assemble 读到 refOnly 直接不贴，
      // 不让「参考图冒充卡面内容」漏到成品（grid6 实测教训：方法卡被塞结果图无人拦）。
      for (const s of refOnlySlots) s.refOnly = true;
      promptParts.push(modelScene);
      sceneBuilt = true;
      // scene 内的引号字符串 = 宿主要印的标签，并入可印白名单（溯源责任在 SKILL.md 实体规则）
      const sceneLabels = [...modelScene.matchAll(/"([^"]{1,60})"/g)].map((m) => m[1]);
      sceneResult = { text: modelScene, strippedInstr: [], chips: sceneLabels, vagueShows: [], demoted: [], uncovered: 0, slots };
      // 几何唯一化：宿主 scene 已自己描述布局，guide 里重复的几何句换成类型专属短句
      if (entry?.guideScene) promptParts[typeTplIdx] = entry.guideScene;
      if (slots.length) {
        // 🔴 来源标记（2026-10-14 用户定规）：original=原文原图直贴 / reproduced=源码复现图 /
        // drawn=AI 画——来源随槽位落伴随 JSON、compose 后回写 compose 段，不是原图的可查可审计
        const srcZh = { original: "原图", reproduced: "复现图", drawn: "AI画" };
        const roleZh = { operation: "操作步", result: "结果位" };
        warnings.push(`解析出 ${slots.length} 个资产槽位（${slots.map((s) => `${s.kind}:${s.name}←${s.value}[${srcZh[s.source] || s.source}${s.role ? `/${roleZh[s.role] || s.role}` : ""}]${s.crop ? `(模块裁剪 ${s.crop.left},${s.crop.top},${s.crop.width},${s.crop.height})` : ""}`).join("；")}）——渲染图里对应位置是纯品红色块。分部分出图：${slots.some((s) => s.kind === "icon") ? "先 pf render-icon --prompt-file <本提示词> --all 单独渲小图 → " : ""}渲完跑 pf compose --prompt-file <本提示词> --png <渲染图> 贴入。`);
        if (refOnlySlots.length) {
          warnings.push(`这些槽位与"仅作画法参考"的措辞自相矛盾（${refOnlySlots.map((s) => s.name).join("、")}）——写"never pasted/reference only"的图不该进 {{asset}} 槽位：槽位=贴原图占位，模型会给它渲品红块。要贴就删掉参考措辞，不贴就把槽位标记从 scene 里删掉。`);
        }
        // 🔴 操作位贴结果图拦截（2026-10-15 用户定规「操作卡该画示意图而不是结果」——grid6
        // Denoise 卡被塞结果图的根因就是没有这个审查）。词面判为操作步的卡走 {{asset}}：
        // 整图直贴（无 crop）= 大概率把结果图贴进方法步，最严重，必须宿主显式定夺；
        // 带 crop = 已声明只取方法结构部分，轻提醒一句。
        const opPlain = slots.filter((s) => s.kind === "asset" && s.role === "operation" && !s.crop && !s.refOnly);
        const opCropped = slots.filter((s) => s.kind === "asset" && s.role === "operation" && s.crop && !s.refOnly);
        if (opPlain.length) {
          warnings.push(`这些卡讲的是**操作/方法步骤**（${opPlain.map((s) => `${s.name}：「${(s.about || "").slice(0, 50)}」`).join("；")}）——操作步应该**画示意图**（改 {{icon:名|示意图描述}} 走 render-icon 单独画流程图），不是贴论文例图：结果图贴进方法步=图不对题。两个例外任选其一并在 scene 写明：① 原图本身是方法/管线结构图→保留 asset 但加 crop= 只裁方法部分；② 该例图就是这一步的真实中间产物→把这句话写进 scene 归属句（"this example IS the output of this step"）。`);
        }
        if (opCropped.length) {
          warnings.push(`操作步卡位走 crop 裁原图（${opCropped.map((s) => s.name).join("、")}）——请确认裁出的部分确实是方法结构示意，不是结果展示。`);
        }
      }
      warnings.push(`scene 段为宿主 AI 直通产出（思考外置路线）——护栏已跑（白名单/hex/预算），引号标签${sceneLabels.length ? ` ${sceneLabels.map((l) => `"${l}"`).join("、")} 并入可印白名单` : "零"}。画面质量责任在 scene 文本本身：不满意改 scene 重 craft，别烧渲染额度试错。`);
    } else {
    // —— 场景叙述段（2026-10-13 组词重构核心）：几何 + 逐卡配色 + 内容一次说清 ——
    // 替代原「阶段几何句 + 逐阶段配色句×N」，卡片描述内嵌 show 句与指令前缀剥离
    // 🔴 2026-10-14 降级为兜底：内置词典是写死路线（上限低、措辞歪会画出非学术元素），
    // 正式出图走 --brief 出题 → 宿主 AI 写 scene → --scene 阅卷的质量路线。
    const scene = buildStageSceneNarrative({ stages: derivedStages, palette, lang, figureType });
    sceneResult = scene;
    if (scene?.text) {
      promptParts.push(scene.text);
      if (scene.strippedInstr?.length) strippedInstr.push(...scene.strippedInstr);
      sceneBuilt = true;
      // 几何唯一化：场景段已指定卡片形状/箭头/内容位置，guide 里重复的几何句换成类型专属短句
      if (entry?.guideScene) promptParts[typeTplIdx] = entry.guideScene;
      warnings.push(`本提示词卡内画面来自内置词典兜底（写死路线，上限低）——正式出图前用 pf craft --brief 出题、宿主 AI 看图思考后 --scene 直通（质量路线）。`);
      // 🔴 卡内空洞三告警（2026-10-13 craft-rework-v1.png 实拍复盘：
      // "这就是文字和框框，里面啥都没有"——show 笼统 + 要点全印文字两大根因）
      if (scene.vagueShows?.length) {
        warnings.push(`这些 show 句太笼统、缺具体画面要素（${scene.vagueShows.map((v) => `"${v}"`).join("；")}）——已按内置图标词典为相关阶段补推了具体小图标，但最好重写成具体画法：画什么物体 + 什么形状 + 什么空间关系。不懂画什么图标就按文字含义推一个可行的小图标（例：hflip → 两张镜像小图 + 双向箭头；IoU 合并 → 三个小框箭头汇入一个粗框），写法参考 pf types show 里各图型示例。`);
      }
      if (scene.demoted?.length) {
        warnings.push(`这些框内要点超过 2 词，不再印上卡面（${scene.demoted.map((b) => `"${b}"`).join("；")}）——已转为卡内图形的推导素材（卡面印成文字列表 = 实拍"文字和框框"的根因之一）。要保留成文字标签就缩到 ≤2 词；说明性内容挪进 show 句描述画法，不要印。`);
      }
    }
    } // else：词典兜底路径结束（无 --scene 时）
    // 🔴 补实体行（属性唯一化）：只列未被阶段标题覆盖的实体（阶段图里实体=卡片）
    // 🔴 scene 直通模式（2026-10-14）：scene 已自行描述全部卡面，实体行再推独立卡片
    // 会和 scene 的卡数描述打架（实测：scene 写 exactly six cards，实体行多推一张
    // "Weighted Box Fusion" → 模型画出 8 卡重复）。scene 引用过的实体不再补行。
    {
      const stageTitleSet = new Set(derivedStages.map((s) => s.title));
      const extraEnts = entList.filter((e) => !stageTitleSet.has(stripQuote(e)) && !(sceneText && sceneText.includes(e)));
      if (extraEnts.length) {
        promptParts.push(
          lang === "zh"
            ? `图中实体（保持用户原文）：将以下各项作为命名节点/模块呈现 —— ${extraEnts.map((e) => `"${e}"`).join("、")}。`
            : `Named entities (keep verbatim): present each of the following as a labelled node/block — ${extraEnts.map((e) => `"${e}"`).join(", ")}.`
        );
      }
    }
    // 🔴 美学密度实测（2026-10-13 CVPR 优化复盘）：多阶段多卡片的图在 standard 档
    // 容易糊成单色泥浆（18 版精修现场 v1：钢蓝糊+小字乱码）。草稿可以 standard，
    // 但定稿必须 premium 才扛得住这个信息密度。
    if (derivedStages.length >= 5) {
      warnings.push(`阶段有 ${derivedStages.length} 张（≥5）：这个信息密度在 standard 档实测会糊成单色泥浆+小字乱码——standard 只适合出布局草稿，定稿必须走 premium（standard 草稿 → pf qa 核验 → 审批通过 → render --model premium）。`);
    }
    if (!stageList.length) {
      warnings.push(
        "结构链只有名词（自动拆成了仅标题的编号阶段）：图模型只能画空标题盒子——这正是\"提示词笼统\"的根因。回原文给每个阶段补 2-4 条内容要点与内部画法（--stages \"标题 | 要点1; 要点2 || …\"，视觉内容写 show 开头）。"
      );
    } else if (stageList.some((s) => !s.bullets.length)) {
      const empty = stageList.filter((s) => !s.bullets.length).map((s) => s.title).join("、");
      warnings.push(`这些阶段没有内容要点（${empty}）：空标题盒子必出——补 2-4 条要点或内部画法（show 开头的条目会被画成阶段内的视觉元素）。`);
    }
    // 🔴 卡面文字契约已并入尾部可印文字白名单块（2026-10-13 组词重构：两段原本说同一件事，
    // 合并后白名单仍是提示词最后一段——recency 效应实测有效的位置保持不动）。
    // 🔴 句子型要点前置拦截（V11 事故源头在写手侧）：plain 要点写成完整句子必被印出。
    // 🔴 2026-09-26 阈值修正（Swin 实测）：旧阈值 >8 词有盲区——6 词碎片
    // （"2x2 bold windows anchored top-left"）漏网后被原样印上图。文档契约是
    // ≤5 词短标签，门槛就按 5 词划：>5 词的 plain 要点一律告警。
    const sentencey = stageList
      .flatMap((s) => s.bullets.filter((b) => !/^(show|draw|画|示意)\b/i.test(b) && b.trim().split(/\s+/).length > 5))
      .map((b) => `"${b}"`);
    if (sentencey.length) {
      warnings.push(`这些框内要点超过 5 词（${sentencey.join("；")}）——图模型会把它们原样印进卡面（V11 事故；2026-09-26 实测 6 词碎片也会上图为 "anchared top-elelf" 级乱码）。要点改成 ≤5 词短标签；说明性内容挪进 show 句描述画法，不要印。`);
    }
    if (strippedInstr.length) {
      warnings.push(`已剥离指令前缀、只印标签本体（${strippedInstr.join("；")}）——"label X" 写法会把 label 这个词一起印上图，要印什么就直接写标签。`);
    }
    // 🔴 画面感检查（2026-10-13 调研 PaperBanana 6.8k★："vague specifications will only
    // make the generated figure worse"）：要点全是抽象名词/短标签、零视觉词汇时，图模型
    // 只能自由发挥——18 版精修现场 v4-v6 的"黑色乱线团"正是这种输入的产物。
    // 🔴 2026-10-13 联动图标词典：场景叙述段已为每张卡推到具体母题（uncovered===0）时
    // 不再告警——词典兜底已把"抽象术语"翻译成可画内容，告警只留给词典也没接住的卡。
    const allBullets = stageList.flatMap((s) => s.bullets);
    const sceneCovered = sceneResult && sceneResult.uncovered === 0;
    if (allBullets.length && !sceneCovered && !allBullets.some((b) => VISUAL_VOCAB_RE.test(b))) {
      warnings.push(`所有要点都是抽象名词/短标签、零视觉词汇，且原语映射没接住 ${sceneResult ? sceneResult.uncovered : 0} 张卡（形状/线型/颜色/母题都没有）——图模型只能自由发挥（vague specifications make the figure worse，实测出黑色乱线团）。优先跑 pf refs 检索顶会同模块参考图（宿主看图提炼画法写 show 句）；零命中时从 provenance/materials 取该模块真实数据类型（图像/特征图/向量/图结构/标量…），按数据类型→学术原语映射写 show 句（SKILL.md 原语表），不要发明具象图标。`);
    }
    // 🔴 承载意思的几何（2026-09-26 Swin 实测）：宿主声明了几何契约 → ①告警 AI 保证不了
    // ②进 sidecar ③QA 包逐项核验。没声明则不告警（纯示意图没有精确几何诉求）。
    if (String(geometry || "").trim()) {
      warnings.push(
        `已声明几何约束（"${String(geometry).trim()}"）——AI 渲染不保证几何精确（实测：轴标签重复、分界线落错行、偏移量不足）。QA 包会列出逐项几何核验清单，必须亲眼核对；有偏差换脚本/矢量路径重画，别反复烧 premium。`
      );
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

  // —— 4) 风格基线 + 视觉语法（2026-10-13：形状/线条/字体语义系统，蒸馏自 PaperBanana NeurIPS 指南）——
  promptParts.push(`Style: ${STYLE_BASELINE}`);
  promptParts.push(VISUAL_GRAMMAR);

  // —— 5) 负向清单（通用 + 该图型特有的避坑，对标 awesome-gpt-image-2「每类图自带避坑规则」）——
  const avoidParts = [...NEGATIVE_LIST];
  if (entry?.avoid) avoidParts.push(entry.avoid);
  promptParts.push(`Avoid: ${avoidParts.join("; ")}.`);

  // —— 5.5) 多轮精修块：上一版核验出的缺陷逐条拼接为硬性修正（2026-09-21 定规）——
  // 不重掷骰子：上一版画对的部分原样保留，本块只钉死上一版的失败点。
  // 🔴 2026-09-25 双智能体实测：修正文本此前无护栏，被图模型当卡面文字印上图
  //    （实测 "Q2/Baseline" 字样上图；宿主被迫整体弃用 --fixes）。护栏=显式声明非图面文字。
  const fixList = String(fixes || "")
    .split(/[;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (fixList.length) {
    warnings.push(
      `传了 --fixes（${fixList.length} 条）：修正文本有被图模型原样印上图的实测风险（2026-09-26/27 两次独立复现，"Q2/Baseline" 上图）。优先做法：把每条修正改写进 --stages 的画法/标签措辞后省略 --fixes；确要传，务必逐条是"约束句"而非"缺陷描述句"。`
    );
    promptParts.push(
      lang === "zh"
        ? `上一版修正（以下全部是生成约束，**不是图面文字，严禁印到图上**；逐条必须满足）：${fixList.map((f, i) => `(${i + 1}) "${f}"`).join("；")}。`
        : `Corrections from the previous attempt — these are GENERATION CONSTRAINTS ONLY, **never print them onto the figure**; each is a HARD requirement, satisfy all of them: ${fixList.map((f, i) => `(${i + 1}) "${f}"`).join("; ")}.`
    );
  }

  // ⚠️ 实测教训（scripts/weak-model-eval.mjs 2026-09-20，4/4 用例命中）：
  // OUTPUT_GUARD_LINES 是**写给宿主 AI（写手）**的约束，绝不能拼进发给图模型的提示词——
  // 否则 "Output only the prompt / emit the field headers" 等写手指令成为图模型提示词的噪音，
  // 且其要求的七字段头格式 craft 产物本身不满足，自相矛盾。它们经 writerGuard 返回给宿主 AI。

  // —— 6) 额外风格提示（用户给的 styleHints / 文档风格卡）——
  // 🔴 属性唯一化（2026-10-13 组词重构）：阶段图的配色已由场景叙述段逐卡指定，
  // 不再注入调色板句（原四处颜色重复源之一）；仅非阶段图（无场景叙述）保留兜底。
  // 用户 --colors / 风格卡 hex 生效时 palette.cycle 整体换用，叙述段自动跟随。
  if (!sceneBuilt) {
    promptParts.push(`Additional style notes: ${paletteSentence(palette)}`);
  }
  if (String(styleHints || "").trim()) {
    promptParts.push(`Document style notes (supplementary): ${styleHints}`);
  }

  // 引号剥离警告（实体标签/阶段标题归一时收集，见上方 stripQuote）
  if (quoteStripped.length) {
    warnings.push(`这些实体/阶段标题含双引号，已剥掉（${quoteStripped.join("、")}）——引号会击穿提示词的引号契约，卡面标签不要带引号字符。`);
  }

  // 🔴 显式可印文字白名单（2026-09-25 双智能体实测修复）：上面的卡面文字契约是长句描述，
  //    实测管不住图模型——show/draw 引号句照样被印上图（GUI 侧为此多跑 3 轮精修，
  //    CLI 侧被迫整体弃用 --fixes）。实测有效的形态 = 具体枚举 + 放在提示词最后
  //    （recency 效应）：模型照着清单印字，清单外的一律当画法指令。
  // 🔴 2026-10-13 卡内分级：chips（≤2 词卡面小标签）也进白名单——它们在场景叙述段里
  // 被声明为 tiny text labels，白名单不同步会自相矛盾（印了但"清单外"）。
  const allowedText = [...new Set([...derivedStages.map((s) => s.title), ...(sceneResult?.chips || []), ...entList].filter(Boolean))];
  if (allowedText.length) {
    promptParts.push(
      lang === "zh"
        ? `可印文字白名单（图上唯一允许出现的文字，逐字）：${allowedText.map((s) => `"${s}"`).join("、")}。本提示词中其余一分内容——尤其是引号内的句子、draw/show 后面的描述——都只是【怎么画】的指令，印到图上即是错误。`
        : `PRINTABLE TEXT WHITELIST (the ONLY strings allowed to appear as text on the figure, verbatim): ${allowedText.map((s) => `"${s}"`).join(", ")}. Every other part of this prompt — especially quoted sentences and anything after "draw"/"show" — is a DRAWING INSTRUCTION ONLY; rendering any of it as on-figure text is an error.`
    );
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
    // 🔴 承载意思的几何约束（2026-09-26）：原样透传，CLI 写进伴随 JSON，QA 包据此出几何核验清单
    geometry: String(geometry || "").trim(),
    // 🔴 资产槽位（2026-10-14）：scene 解析出的 {{asset}}/{{icon}} 清单——CLI 写进伴随 JSON，
    // pf compose 据此把真图/图标贴进渲染图里的品红占位块
    slots: sceneResult?.slots || [],
    // 实际进入提示词的阶段标题（含结构链自动拆出的）——promptSelfCheck 回声检查用
    stageTitles: derivedStages.map((s) => s.title),
    // 写手守卫：给宿主 AI 在**写/改提示词时**遵守（源: OUTPUT_GUARD），不进图模型提示词
    writerGuard: OUTPUT_GUARD_LINES,
    // 渲染后视觉核验清单（图出来之后宿主 AI 亲眼读图逐条过；对标 ARS VLM 核验）
    qaChecklist: QA_CHECKLIST,
  };
}
