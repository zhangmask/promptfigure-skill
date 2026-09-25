// craft-rules.mjs — 第二阶段「本地提示词规则层」纯数据模块
//
// 来源：服务端多年踩坑沉淀的确定性规则，从 EasyDraw-main 蒸馏而来。
// 所有正则/数据均带「源:」注释，便于日后跟服务端同步。
//   · 自省句逻辑：functions/_shared/promptcraft.js  stripSelfNarration   L317-364
//   · 输出硬约束  ：functions/_shared/promptcraft.js  OUTPUT_GUARD        L157-163
//   · 审查协议    ：skills/promptcraft/REVIEW.md（A1-A5 / B1-B5）
//   · 各 guard    ：functions/_shared/promptcraft.js  applyDeterministicFixes L381-432
//   · 通用工艺层  ：functions/_shared/promptcraft.js  UNIVERSAL_CRAFT     L71-83
//   · 负向清单    ：functions/_shared/promptcraft.js  COMMON_RULES Avoid  L46
//
// 本模块零依赖、纯 ESM，Node 22 直接可 import。

// ---------- 自省句（模型对自己说的诚实性元评论）----------
// 源: promptcraft.js stripSelfNarration SELF_NARRATION_RE L332
// 蒸馏为多条「子句级」正则（sanitizePrompt 按子句切分后逐条匹配删除）。
// ⚠️ 边界：只删「元评论式」诚实性声明，绝不删视觉负向项（no watermark /
// no drop shadows / no decorative icons）——后者对图模型是有效约束。
export const SELF_NARRATION_PATTERNS = [
  // 源: SELF_NARRATION_RE 分支 1 —— "no invented/fabricated/made-up numbers/data/..."
  /(?:no|without|zero)\s+(?:invented|fabricated|made[- ]?up|fake|unsupported|hallucinated)\s+(?:\w+\s+){0,2}(?:numbers?|data|values?|statistics|figures?|metrics?|results?|counts?)/i,
  // 源: SELF_NARRATION_RE 分支 2 —— "never/do not invent/fabricate/make up ..."
  /(?:never|do\s+not|don't|avoid)\s+(?:inventing|invent|fabricating|fabricate|making\s+up|make\s+up)/i,
  // 源: SELF_NARRATION_RE 分支 3 —— "no/specific numeric values/labels/annotations"
  /(?:no|without)\s+(?:specific\s+)?numeric\s+(?:values?|labels?|annotations?)/i,
  // 源: SELF_NARRATION_RE 分支 4 —— "values are/were omitted/withheld/not shown/..."
  /values?\s+(?:are\s+|were\s+)?(?:omitted|withheld|not\s+(?:shown|specified|provided|invented|fabricated))/i,
  // 源: SELF_NARRATION_RE 分支 5 —— "magnitude not specified/quantified"
  /magnitude\s+not\s+(?:specified|quantified)/i,
  // 源: SELF_NARRATION_RE 分支 6 —— "fabricated data/numbers/values/statistics"
  /fabricated\s+(?:data|numbers?|values?|statistics)/i,
  // 源: REVIEW.md A2 / OUTPUT_GUARD L158「复述约束本身」—— "no numeric values are printed" 类元评论
  /no\s+numeric\s+(?:values?|labels?)\s+(?:are\s+|were\s+)?(?:printed|shown|included|present|used)/i,
  // 源: OUTPUT_GUARD L158「不要宣布没有数字」—— "values omitted / not specified" 复述句
  /(?:no|without)\s+(?:invented|fabricated)\s+(?:numeric\s+)?(?:values?|data)/i,
  // 源: SELF_NARRATION_RE 分支 2 放宽 —— 覆盖 "I will not invent / will not invent / not invent" 变体
  // （服务端正则要求 "do not/never/avoid" 紧贴 invent；裸 "will not invent" 同样属自省句，必须删）
  /(?:I\s+will\s+not|will\s+not|do\s+not|don't|never|avoid)\s+(?:invent|fabricate|make\s+up|hallucinate|forge)/i,
];

// ---------- 违禁 / 平台样板模式（可确定性修复的部分）----------
// 每条描述一个确定性动作，由 craft.mjs 的 sanitizePrompt 解释执行。
// 源: promptcraft.js applyDeterministicFixes L381-432 各 guard。
export const BANNED_PATTERNS = [
  {
    id: "hex",
    // 源: promptcraft.js humanizeHexPalette L439-465 + hexGuard L410-415
    // 图模型对负向指令服从率低，唯一可靠手段是让 hex 码「不存在」。
    action: "hexHumanize",
    source: "promptcraft.js humanizeHexPalette L439-465 / hexGuard L410-415",
  },
  {
    id: "cjk",
    // 源: promptcraft.js stripStrayCJK L286-315（引号外 CJK 残留剔除）
    // 仅删引号外的裸 CJK（翻译残留），引号内文本是图上标签原文，保留。
    action: "stripStrayCJK",
    source: "promptcraft.js stripStrayCJK L286-315",
  },
];

// hex → 科学图常用色名标准池（用于确定性 humanize，最近邻映射）。
// 源: promptcraft.js HEX_NAMED_COLORS L439-449（RGB 值原样保留）。
export const HEX_NAMED_COLORS = [
  ["deep blue", 15, 77, 146], ["navy", 24, 38, 84], ["blue", 46, 116, 182],
  ["sky blue", 112, 179, 222], ["teal", 66, 148, 158], ["cyan", 88, 188, 218],
  ["green", 76, 155, 106], ["dark green", 44, 104, 72], ["pale green", 155, 205, 155],
  ["olive", 128, 132, 48], ["yellow", 230, 200, 60], ["amber", 222, 156, 32],
  ["orange", 212, 118, 58], ["coral", 233, 166, 161], ["red", 192, 57, 43],
  ["vermilion", 182, 67, 66], ["crimson", 153, 27, 45], ["magenta", 170, 62, 143],
  ["purple", 106, 76, 156], ["lavender", 180, 192, 228], ["brown", 121, 85, 61],
  ["pink", 230, 143, 172], ["grey", 118, 118, 118], ["dark grey", 72, 72, 78],
  ["light grey", 200, 200, 200], ["black", 26, 26, 26],
];

// ---------- 科研风格基线 ----------
// 源: promptcraft.js UNIVERSAL_CRAFT L71-83（Rendering discipline）+ COMMON_RULES L40-46
// + OUTPUT_GUARD L163「flat editorial style」。白底、无阴影无渐变、扁平色块、
// 克制色板 2-4 色、清晰字号层级。
export const STYLE_BASELINE = [
  "White background, clean publication-grade canvas.",
  "Flat editorial rendering: NO drop shadows, NO glow, NO gradient decoration unless explicitly requested; separate elements with crisp borders or whitespace.",
  "Restrained semantic palette: 2-4 hues plus neutral greys/black/white; one accent colour on at most 1-2 focal elements; colourblind-safe pairing (never red-vs-green as the only distinction).",
  "Exactly THREE visible text tiers — figure title/panel headers (largest), element/series labels (medium), annotations/axis numbers (smallest); keep total text items low (ideally under 15 short labels).",
  "All lines and text crisp anti-aliased edges, print-quality, no sketch texture.",
  "Keep at least a quarter of the canvas calm (whitespace is part of the design).",
].join(" ");

// ---------- 视觉负向项（图模型有效约束，非自省句）----------
// 源: promptcraft.js COMMON_RULES Avoid L46 + UNIVERSAL_CRAFT Rendering L83
// + TECH_RULES L174（no lens flare / no photorealistic branding）
export const NEGATIVE_LIST = [
  "no watermark or logos",
  "no drop shadows",
  "no glow",
  "no gradient decoration",
  "no 3D chart junk",
  "no photographic textures unless asked",
  // 🔴 2026-09-21 premium v7 实测：图模型自加了清单外的 bullet 注释/箭头连接词/图例项，
  // 且把"抽象白块"母题画成雪山照片。文字白名单与抽象母题约束（对图模型可执行的负向措辞）：
  "no text on the figure beyond the quoted stage titles and entity labels (no self-added bullets, arrow captions, legend entries or numbering; no full sentences printed inside cards — card text is short labels only)",
  "abstract placeholder shapes stay abstract plain shapes (a 'white rounded rectangle' is NOT a photograph of a real scene)",
  "no dense text blocks",
  "no decorative clutter",
  // ⚠️ "no invented data" 已删（weak-model-eval 2026-09-20）：它是写手元评论而非视觉负向项，
  // 会被自家 SELF_NARRATION_PATTERNS 误删（规则源冲突），对图模型也无画面意义。防编造归 writerGuard。
  "no decorative pictograms or object icons (vegetable sketches, molecule doodads, product silhouettes) unless explicitly asked",
  "no lens flare",
  "no photorealistic branding",
];

// ---------- 版式预设（对标竞品"产物直接投稿可用"）----------
// 依据：论文图有物理版式约束（双栏图横贯两栏、单栏图窄幅），竞品（AutoFigure /
// PaperBanana）把版式写进生成约束；图模型不守版式，用户就要手工裁剪重排。
export const PRESET_LAYOUTS = {
  "double-column": "Composition sized for a TWO-COLUMN paper figure spanning full text width: wide landscape layout, left-to-right reading flow, main content in a horizontal band, no wasted side margins.",
  "single-column": "Composition sized for a SINGLE-COLUMN paper figure: compact portrait or square layout, top-to-bottom reading flow, large enough fonts to stay legible at ~8 cm print width.",
  "slide": "Composition sized for a presentation slide: 16:9 landscape, bolder line weights and larger labels than print figures, readable from the back of a room.",
};

// ---------- 渲染后视觉核验清单（对标 ARS v3.3 VLM 图件核验 / AutoFigure Review-Refine）----------
// 🔴 与 craftPrompt 的 CHECKLIST（出图前、文本层）不同：这张清单是图渲染出来之后
// 宿主 AI 亲眼读图逐条核验用的。竞品用 VLM 评委 + 重画闭环；本地版把"评委"交给宿主
// AI 的视觉能力（零成本），清单必须可判定（看一眼有答案），不打分。
export const QA_CHECKLIST = [
  "Q1 文字卫生 — 图内没有乱码/伪文字（gibberish glyphs）、没有拼错的英文单词；带文字的图必须 premium 出稿（standard 渲文字必乱码）。",
  "Q2 实体逐字 — 🔴 先把图上全部可见文字逐条列出（一张都不许漏），再逐条对照白名单（阶段标题+实体清单）：多一条、改一字、多一句都算失败；卡面出现完整说明句（任何语言：明显长于标签、带句读或含助词/动词句尾，且不是实体/标题）= 直接 FAIL（V11 事故：说明句被印进卡面，抽样式核验漏检）。",
  "Q3 结构保真 — 箭头方向/流程顺序/包含关系与声明的结构一致；机制图的因果方向错 = 直接重画（ confidently wrong 比 omit 更糟）。",
  "Q4 无编造 — 图上没有清单之外的新模块、新曲线、新数值、新图例项；数出来的元素个数与实体数一致。",
  "Q5 版式与底色 — 布局只有一种阅读朝向；版式预设（双栏/单栏）符合；留白占画布 1/10~1/3：少于 1/10 拥挤，🔴 多于 1/3 = 内容带没撑满画布 = FAIL（V11 事故：上下空白带 >40%，排进双栏后文字会被压得极小）；🔴 背景必须纯白 —— 重点检查四角与空白区域的淡淡斑块/纸张纹理/有机斑点底纹，不是刺眼的白 = 不过（standard 档高发，实测出现过且极易漏检）。",
  "Q6 配色与装饰 — 色板 ≤ 4 色相 + 中性色；无红绿唯一区分；hex 码没有作为文字印在图上；无阴影/渐变/3D 装饰；🔴 无装饰性图形符号（鸟兽/人物/器物小剪影点缀）——除非实体清单明确要求（standard 档高发，实测出现过）。",
  "Q7 风格一致 — 若本文档设了风格卡：这张图与同批其他图放在一起色板/线条/字体观感一致（全批对照，不只看单张）。",
  "Q8 原文溯源 + 原图对照（重绘任务必过）— 双重验收：①原文溯源：图中每个阶段/实体/数据流步骤都能在论文正文（图 ref 所在 section 及其方法章节）找到出处（§¶）；正文没提的模块或母题不许画，正文明确写的步骤不许漏、顺序不许错。②原图对照：原图的每个卡片/面板在新图中有对应物，标签逐字一致。没读过相关正文与原图 PNG 就渲染 = 流程违规，先回退补读。",
  "Q9 画法落实 — 逐阶段对照任务包第 3c 步清单：每个阶段盒子存在、标题逐字一致；[画法] 条目描述的视觉元素（缩略图阵列/合并箭头/门形分组/热图小块…）真的以**图形**画出，而不是被文字化或直接省略；[标签] 条目以 ≤5 词文字印在盒内。漏画 = 布局漂移 FAIL，缺陷写具体到阶段（如「阶段2缺 IoU 合并视觉」），精修状态机按阶段定位重拼。",
];

// ---------- 输出硬约束（紧贴 user 末尾的硬约束行）----------
// 源: promptcraft.js OUTPUT_GUARD L157-163 六条蒸馏。
// ⚠️ 不给偷懒出口（OUTPUT_GUARD 注释 L149-156 踩坑）：
//   禁止 "or use neutral placeholders" 这类措辞（3.0 会改成占位符敷衍量级）；
//   禁止模糊量词（"roughly half"）当范例；
//   禁止复述约束本身（"no numeric values" 写成产出一部分 = 元评论）。
export const OUTPUT_GUARD_LINES = [
  // 源: OUTPUT_GUARD 第 1 条 L158
  "Numbers: use ONLY numbers the user supplied. Never invent counts, sizes, resolutions, percentages, performance figures, symbols or formulas. When the user asks for a magnitude they never quantified, encode it VISUALLY — draw the block noticeably larger or smaller, the bar taller or shorter, the panel wider — or distinguish with neutral tags (Variant A, Variant B). Never announce the absence of numbers and never leave an empty placeholder (Value, Comparable).",
  // 源: OUTPUT_GUARD 第 2 条 L159
  "Structure: never invent components, activation states, ablation settings, mechanisms, symbols or names the user did not give. Where a needed detail is unspecified, use a neutral placeholder (Variant A, Path 1, Module 1) — never a realistic-sounding name or a made-up technical detail.",
  // 源: OUTPUT_GUARD 第 3 条 L160
  "Coverage: silently check off EVERY explicit request in the user's text — each entity, number, unit, label wording, arrow or data-flow requirement, comparison, annotation request and emphasis — and make sure every one appears in the output. Dropping a requested item is worse than an imperfect layout.",
  // 源: OUTPUT_GUARD 第 4 条 L161
  "Verbatim: keep every user-supplied entity, number, unit, dose, condition and label wording exactly as given.",
  // 源: OUTPUT_GUARD 第 5 条 L162
  "Format: emit the field headers in order — Style anchor, Overall layout, Content blocks, Palette, Emphasis, Scale & text space, Avoid — nothing before the first header and nothing after the last.",
  // 源: OUTPUT_GUARD 第 6 条 L163
  "Output only the prompt itself: no commentary, no notes about these constraints, no questions.",
  // 源: promptcraft.js hexGuard L410-415 + labelPurityGuard L427-430（确定性追加守卫，本地一并钉死）
  "Apply colours directly to the shapes they belong to — never print hex codes or colour values as visible text on the figure, and do not draw a colour legend that names the colours.",
  "Render every quoted label exactly once, exactly as quoted — do not add English translations or synonyms alongside them, never duplicate a label, and do not prefix labels with list markers the label text does not include.",
];
