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
  // 🔴 属性唯一化（2026-10-13 组词重构）：本句只管 DATA 编码用色的总原则；
  // 阶段/模块的身份配色已在场景叙述段逐卡指定，这里只留指针不重复填充公式（原豁免句删除）。
  "Restrained semantic palette: 2-4 hues for DATA encodings (chart series, heat levels); per-stage or per-module identity colours follow the Scene description exactly; colourblind-safe pairing (never red-vs-green as the only distinction).",
  "Exactly THREE visible text tiers — figure title/panel headers (largest), element/series labels (medium), annotations/axis numbers (smallest); keep total text items low (ideally under 15 short labels).",
  "All lines and text crisp anti-aliased edges, print-quality, no sketch texture.",
  "Keep at least a quarter of the canvas calm (whitespace is part of the design).",
].join(" ");

// ---------- 视觉语法块（2026-10-13 调研 PaperBanana 6.8k★ 后新增） ----------
// 来源：dwzhu-pku/PaperBanana style_guides/neurips2025_diagram_style_guide.md（104 行）蒸馏。
// PaperBanana 把完整指南喂给 Stylist agent；pf 无 Stylist，直接蒸馏成紧凑语义系统
// 拼进图模型提示词——形状/线条/字体/图标各管一层语义，图模型照语义画而不是瞎猜。
// 🔴 保持紧凑（~700B）：提示词越长上游越慢（CF 100s 天花板，524 风险）；上限现为 32000 字节但别当免费额度用。
export const VISUAL_GRAMMAR = [
  "Visual grammar — semantics to follow: rounded rectangles = processes/stages; sharp rectangles and flat grids = data, matrices, attention maps; cuboid stacks = tensors; cylinders = storage; dashed-outline containers = logical scopes or optional paths. Solid arrows = main data flow; dashed lines = auxiliary flow (gradients, skips, optional paths). Module labels sans-serif (bold titles); math variables serif italic. Flame/lightning icon = trainable, snowflake = frozen (small flat glyphs only).",
].join(" ");

// ---------- 视觉负向项（图模型有效约束，非自省句）----------
// 源: promptcraft.js COMMON_RULES Avoid L46 + UNIVERSAL_CRAFT Rendering L83
// + TECH_RULES L174（no lens flare / no photorealistic branding）
// 🔴 2026-10-13 组词重构瘦身：只留纯负面且不与他段重复（阴影/光晕/渐变已由
// STYLE_BASELINE 的 flat editorial 句负责，此处删除重复项）；≤8 条放提示词尾部。
export const NEGATIVE_LIST = [
  "no watermark or logos",
  "no 3D chart junk",
  "no photographic textures unless asked",
  // 🔴 2026-09-21 premium v7 实测：图模型自加了清单外的 bullet 注释/箭头连接词/图例项，
  // 且把"抽象白块"母题画成雪山照片。文字白名单与抽象母题约束（对图模型可执行的负向措辞）：
  "no text on the figure beyond the quoted stage titles and entity labels (no self-added bullets, arrow captions, legend entries or numbering; no full sentences printed inside cards — card text is short labels only)",
  "abstract placeholder shapes stay abstract plain shapes (a 'white rounded rectangle' is NOT a photograph of a real scene)",
  "no dense text blocks",
  "no decorative clutter, pictograms or object icons (vegetable sketches, molecule doodads, product silhouettes) unless explicitly asked",
  "no lens flare or photorealistic branding",
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
  "Q1 文字卫生（通道级，2026-09-26 重新定级）— standard 档出文字 = 通道选错（该档渲染文字必乱码，实测）：换 premium/矢量通道重出，属通道问题不算设计缺陷、不占精修账；premium/矢量仍出乱码/伪文字/拼错词 = 阻断级 FAIL。图上有清单之外的文字（含被印上图的 show 句/要点/缺陷文本）= Q2 处理，不归本条款。",
  "Q2 实体逐字 — 🔴 先把图上全部可见文字逐条列出（一张都不许漏），再逐条对照白名单（阶段标题+实体清单）：多一条、改一字、多一句都算失败；🔴 编号/轴标签序列也要查（1-8 出现重复或缺失 = 错标签，阻断级）；卡面出现完整说明句（任何语言：明显长于标签、带句读或含助词/动词句尾，且不是实体/标题）= 直接 FAIL（V11 事故：说明句被印进卡面，抽样式核验漏检）。",
  "Q3 结构保真 — 箭头方向/流程顺序/包含关系与声明的结构一致；机制图的因果方向错 = 直接重画（ confidently wrong 比 omit 更糟）；🔴 承载意思的几何必须精确（2026-09-26 Swin 实测：网格分界线位置/偏移量/坐标轴刻度与声明不一致 = 意思错，阻断级——示意类图的近似几何才按观察级放行）。",
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

// ---------- 卡内母题映射：数据类型→学术原语（2026-10-14 重构，对标真人画法）----------
// 🔴 2026-10-13 版教训（standard 档渲染出人脸照片、购物风勾选徽章）：旧词典试图
// "发明具象图标"，错在层次——真人零参考画方法图从不发明图标，而是【按流过模块的
// 数据类型选学术原语】（图像→小图块、特征图→薄片堆叠、图结构→节点连线、
// 存储→圆柱…），再按操作类型选原语变体（增广→同块镜像阵列、融合→多箭头汇入）。
// 本表 = 原语映射（前半，数据类型键）+ 操作变体（后半，操作词键），措辞全部学术化：
//   - "photo thumbnail" → "image tile"（photo 一词会引出人脸照片，禁用）
//   - "check badge" 等发明性具象物全部删除
// 顺序敏感：原语在前、变体在后？不——变体更具体，同池匹配时【变体在前、原语兜底】，
// 首个命中生效；未命中时 craft 告警宿主 AI 从 provenance 取真实数据类型自行映射。
export const MOTIF_HINTS = [
  // —— 操作变体（同数据原语的具体画法，最具体、优先）——
  { re: /\b(?:h ?flip|horizontal fl|mirror)\b/i, icon: "two small image tiles side by side, the right one a mirrored copy of the left, joined by a short double-headed arrow" },
  { re: /\b(?:v ?flip|vertical fl|rotate|tilt)\b/i, icon: "two small image tiles, the second slightly rotated, joined by a curved arrow" },
  { re: /\b(?:scale|rescale|resize|zoom|down ?sample|up ?sample)\b/i, icon: "a small image tile beside a smaller copy of itself, joined by a short diagonal arrow" },
  { re: /\b(?:crop|patch|tile)\b/i, icon: "a small image tile with a dashed square marking a cropped region, the dashed region shown beside it" },
  { re: /\b(?:tta|multi[- ]?view|augment)\b/i, icon: "three small image tiles arranged in a slight fan, each a copy of the same tile" },
  { re: /\b(?:residual|difference|subtract|delta)\b/i, icon: "two small image tiles with a circled minus sign between them" },
  { re: /\b(?:ssim|similarity|metric|psnr)\b/i, icon: "two small image tiles aligned side by side with a small gauge arc between them" },
  { re: /\b(?:localiz|detect|bounding)\b/i, icon: "a small image tile with two bold rectangular boxes drawn over it" },
  { re: /\b(?:candidate|proposal|region)\b/i, icon: "a loose cluster of small overlapping rectangles in varying sizes" },
  { re: /\b(?:fuse|fusion|merge|consensus|weighted|aggregate|ensemble)\b/i, icon: "three small tiles with short arrows converging into one bolder tile" },
  { re: /\b(?:filter|keep|drop|prune|select|threshold|suppress)\b/i, icon: "a row of small tiles, most drawn solid and two drawn dashed" },
  { re: /\b(?:refine|iterat|loop|optimiz|optimis)\b/i, icon: "two small tiles joined by a circular loop arrow" },
  { re: /\b(?:reconstruct|restore|generat|enhance|super[- ]?res|\bsr\b|hr\b|deblur)\b/i, icon: "a blurred image tile transforming into a sharp copy along a short arrow" },
  { re: /\b(?:classif|grader|head|predict)\b/i, icon: "several thin lines converging into a single short bold bar" },
  { re: /\b(?:loss|train|gradient)\b/i, icon: "a small descending curve on miniature axes" },
  { re: /\b(?:input|lr|low[- ]?res|blur)\b/i, icon: "a row of two small image tiles, the left one blurred and the right one sharp, joined by a small arrow" },
  // —— 数据类型→学术原语（零参考主兜底：流过什么数据就画什么原语）——
  { re: /\b(?:feature map|conv|kernel|cnn)\b/i, icon: "a stack of three overlapping square feature maps drawn in slight perspective" },
  { re: /\b(?:embedding|latent|vector|token sequence|feature vector)\b/i, icon: "a short row of small shaded squares representing a feature vector" },
  { re: /\b(?:heat ?map|saliency|attention|score map)\b/i, icon: "a small square heat-map, bright at the centre fading toward the edges" },
  { re: /\b(?:graph|node|edge|topolog)\b/i, icon: "a tiny node-edge diagram of four circles joined by thin lines" },
  { re: /\b(?:curve|plot|chart|trend)\b/i, icon: "a miniature line chart with two short axes and a smooth rising curve" },
  { re: /\b(?:table|matrix)\b/i, icon: "a small grid table with a highlighted header row" },
  { re: /\b(?:database|storage|cache|memory|dataset)\b/i, icon: "a small cylinder glyph" },
  { re: /\b(?:text|document|token|prompt)\b/i, icon: "a small document sheet with faint horizontal text lines" },
  { re: /\b(?:iou|matching|correspond)\b/i, icon: "two small rows of squares with thin lines matching squares in the top row to the bottom row" },
  { re: /\b(?:transformer|encoder|decoder|block|layer|module)\b/i, icon: "a small stack of rounded blocks with a thin vertical arrow passing through" },
  { re: /\b(?:output|result|final)\b/i, icon: "a small image tile drawn slightly larger than the others with a thicker border" },
  { re: /\b(?:box|rectangl|frame|region)\b/i, icon: "a few small rectangles of different sizes, mostly solid with one dashed" },
  { re: /\b(?:image|thumbnail|frame|photo|video|view)\b/i, icon: "a small square image tile with rounded corners and a thin border" },
];
