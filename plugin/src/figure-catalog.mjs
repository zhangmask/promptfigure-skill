// figure-catalog.mjs — 图型目录（catalog）：让宿主 AI 知道"能做什么图、每种图怎么想"
//
// 背景（用户实测反馈 2026-09-20）：宿主 AI 不了解我们能画什么图，也不知道一张方法图
// 应该长什么样 —— craft 只有 4 个隐式 TYPE_TEMPLATES，AI 蒙着选。
// 对标来源（2026-09-21 两轮调研）：
//   · MatPlotAgent / figure-generation skill —— 图型目录化（10 种类型列出，AI 才知道选项）
//   · figures4papers DESIGN_THEORY —— 语义化配色（蓝=提出方法/绿=增益/红=对照/灰=中性）
//   · academic-figure-skill —— "一幅图一个核心信息"、审稿人 3 秒扫读
//   · awesome-gpt-image-2（15.8k★）—— 每类图自带"避坑规则"（Prompt as Code 分类模板）
//   · 🔴 2026-09-21 二轮（用户批评"提示词太笼统"后对标成品提示词）：
//       GPT-Image2-Skill research-paper-figures gallery —— 「布局契约」模式：
//       每个面板/区域单独描述 + 逐字引用标签 + 每元素指定配色
//       paper-banana.org/prompts（End-to-End Segmentation Training Pipeline）——
//       编号阶段（Stage 1 — Input）+ 每阶段 2-4 条内容要点 + 指定阶段内画什么
//       （"Show a 2x2 grid of tile thumbnails inside the stage"）+ 风格句殿后
//       ScholarViz 5-block template —— Objective / Composition / Entities / Style / Labeling
//
// 每个条目：
//   id      —— craft --figure-type 用的标识符
//   name    —— 中文名
//   when    —— 什么内容该选它（选型判断，给宿主 AI 看）
//   think   —— 动笔前该想清楚的构图问题（给宿主 AI 看）
//   guide   —— 进图模型提示词的版式指导段（布局契约语言：区域编号+区域内容+区域画法）
//   avoid   —— 该图型特有避坑（进提示词 Avoid 段之后）
//   example —— 完整示例（intent/entities/structure/stages + craft 用法），可改变量直接用

export const FIGURE_CATALOG = [
  {
    id: "pipeline",
    name: "方法流水线 / 处理流程",
    when: "论文方法节的核心图：多步处理过程（数据预处理→模型→后处理）、训练/推理管线。论文里最常见的一种。",
    think: "① 步骤顺序是什么？箭头方向必须与数据流向一致；② 每一步内部发生什么——拆成 2-4 条内容要点（PaperBanana：每阶段 2-4 条 bullet，多视觉截断）；③ 每个阶段「框里画什么」——缩略图/小条形/形状母题要指定（如 Show a 2x2 grid of tile thumbnails inside the stage）；④ 哪一步是本文贡献——它要视觉突出（主色+放大）；⑤ 双栏图横排，单栏图竖排。",
    guide:
      "Method pipeline figure: a horizontal chain of NUMBERED stages (small numerals or \"Stage 1\"-style title prefixes), each stage a rounded rectangle carrying its title on top and its 2-4 content bullets inside, connected left-to-right by short labelled black arrows showing data flow direction. Where a stage specifies a visual (a thumbnail grid, a mini stacked bar, a shape motif), draw that visual INSIDE the stage box instead of describing it in words. The paper's contribution stage gets the primary hue and a slightly larger box. One reading orientation; stage outputs implied by small glyph shapes between boxes only when no explicit visual was specified.",
    avoid: "no arrowheads pointing backwards unless a genuine feedback loop exists; do not invent stage names or bullet content beyond what was supplied; no empty title-only boxes (every stage carries its listed content); no isometric/3D boxes.",
    example: {
      intent: "Two-stage defect detection pipeline: a coarse filter discards most background patches, then a fine grader classifies the rest",
      entities: "Input Image, Patch Sampler, Coarse Filter, Fine Grader, Defect Map",
      stages: "Input Image | Show a strip of 3 rail-surface thumbnails || Patch Sampler + Coarse Filter | discard most background patches; keep candidate patches || Fine Grader | vision transformer classifier; output per-patch score || Defect Map | show a small heat-map thumbnail",
      cmd: 'pf craft --figure-type pipeline --intent "Two-stage defect detection: coarse filter discards background, fine grader scores the rest" --entities "Input Image,Patch Sampler,Coarse Filter,Fine Grader,Defect Map" --stages "Input Image | Show a strip of 3 rail-surface thumbnails || Patch Sampler + Coarse Filter | discard background patches; keep candidates || Fine Grader | vision transformer scoring; per-patch score || Defect Map | show a small heat-map thumbnail" --preset double-column',
    },
  },
  {
    id: "architecture",
    name: "模型 / 系统架构图",
    when: "网络结构（encoder-decoder、attention 块、多分支）、系统组件图（客户端/服务/数据库）。与 pipeline 的区别：强调模块内部构造与连接，不是时间顺序。",
    think: "① 模块嵌套关系（哪个块包含哪个块）用容器表达；② 每个关键模块内部画什么——子块/内部连接要逐个列出（对标 GPT-Image2-Skill No.79：左右两列 encoder-decoder，每块标签逐字写出）；③ 并联分支要对称排布；④ 张量/接口标签只用用户给的，形状数字没有给就不写。",
    guide:
      "Model architecture diagram: nested containers for sub-modules (an outer container visually encloses its inner blocks with clear padding), parallel branches laid out symmetrically, every module block carries its quoted name label and, where supplied, 1-3 one-line content notes inside the block; connection lines labelled only with user-supplied names; encoder blocks tinted with one hue family, decoder with a second; skip-connections as thin curved lines over the main path.",
    avoid: "do not print tensor shapes or parameter counts that were not supplied; do not invent layer names or internal sub-blocks beyond what was supplied; no empty blocks (each module shows its listed inner structure); avoid crossing lines where a rearrangement could avoid them.",
    example: {
      intent: "U-shaped encoder-decoder where skip connections carry multi-scale features into the bottleneck fusion gate",
      entities: "Input Image, Encoder E1, Encoder E2, Bottleneck, Decoder D2, Decoder D1, Output Mask, Fusion Gate",
      structure: "U-shape, skip connections from E1/E2 to D1/D2, Fusion Gate at the bottleneck",
      cmd: 'pf craft --figure-type architecture --intent "U-shaped encoder-decoder: skip connections carry multi-scale features into the bottleneck fusion gate" --entities "Input Image,Encoder E1,Encoder E2,Bottleneck,Decoder D2,Decoder D1,Output Mask,Fusion Gate" --stages "Encoder E1 + E2 | show downsampling blocks over the Input Image; channel counts grow || Bottleneck + Fusion Gate | show multi-scale feature fusion; gates weighted skips || Decoder D2 + D1 | show upsampling blocks; skip connections from matching encoders; produces Output Mask" --structure "U-shape with skip connections"',
    },
  },
  {
    id: "flowchart",
    name: "决策流程图",
    when: "有判断分支的流程（是/否走不同路径）、算法步骤、实验流程（筛样→分组→测量→统计）。",
    think: "① 判断点有几个？菱形表达；② 每个分支的出口标签是互斥的吗（是/否逐字写出）；③ 每个处理节点发生了什么——1-2 条要点写进节点；④ 一屏内能读完吗——超过 10 个节点就考虑拆分或合并。",
    guide:
      "Decision flowchart: process steps as rounded rectangles, decision points as diamonds with short yes/no style exit labels (verbatim from user), one reading orientation, generous spacing so lines never touch text; each process node may list 1-2 content bullets beneath its title when supplied, so nodes never appear as empty titled boxes.",
    avoid: "no orphan nodes (every node reachable); do not merge two different branches into one ambiguous arrow; labels under 4 words each; do not invent branch outcomes beyond the user's statements.",
    example: {
      intent: "Sample screening workflow: exclude low-quality recordings, split by diagnosis, two analysis arms",
      entities: "Raw Records, Quality Check, Excluded, Diagnosis Split, Group A Analysis, Group B Analysis, Meta Report",
      structure: "top-down flowchart, one diamond decision at Quality Check, two parallel branches below",
      cmd: 'pf craft --figure-type flowchart --intent "Sample screening workflow: exclude low-quality recordings, split by diagnosis, two analysis arms" --entities "Raw Records,Quality Check,Excluded,Diagnosis Split,Group A Analysis,Group B Analysis,Meta Report" --stages "Raw Records | show a small stack-of-documents motif || Quality Check | decision diamond; exclude low-quality recordings || Diagnosis Split | two parallel branches; labelled yes/no exits || Group A / Group B Analysis | one rounded box per arm; same layout in both || Meta Report | show the final summary node; collects both arms" --structure "top-down, one decision diamond, two branches"',
    },
  },
  {
    id: "mechanism",
    name: "机理 / 因果通路图",
    when: "生物学通路、因果链、物理过程（A 激活 B、B 抑制 C）。核心是因果方向，不是流程步骤。",
    think: "① 因果方向必须与文献/用户陈述一致——画错方向比不画更糟；② 每条连线上的动作标签逐字写（activates / inhibits / releases）；③ 激活/抑制用什么视觉区分（实心箭头 vs 短横线端点）？④ 主通路和旁路要分清主次；⑤ 分子/实体的状态变化（磷酸化/释放）要不要画在节点内。",
    guide:
      "Mechanism / pathway diagram: entities as labelled nodes, activation as solid pointed arrows and inhibition as blunt-ended lines (only where the user stated the relation), each arrow carrying its action label verbatim where supplied; nodes may show a one-line state note beneath the label when supplied; one dominant pathway visually stronger (thicker line, primary hue), side branches visually quieter; stage numerals when sequential.",
    avoid: "no arrow between two entities unless the user stated a genuine causal link; do not invent intermediate molecules/steps; no membrane-like decoration unless asked; no empty nodes (state notes included where supplied).",
    example: {
      intent: "Inflammatory signalling cascade: receptor activation triggers kinase cascade leading to cytokine release, with one negative-feedback loop",
      entities: "Receptor, Kinase A, Kinase B, Transcription Factor, Cytokine, Feedback Inhibitor",
      structure: "left-to-right cascade with a curved feedback line from Cytokine back to Kinase A",
      cmd: 'pf craft --figure-type mechanism --intent "Inflammatory signalling cascade: receptor activation triggers kinase cascade leading to cytokine release, with one negative-feedback loop" --entities "Receptor,Kinase A,Kinase B,Transcription Factor,Cytokine,Feedback Inhibitor" --stages "Receptor | show ligand binding at the membrane receptor || Kinase A → Kinase B | show phosphorylation relay with solid activation arrows; label each arrow phosphorylate || Transcription Factor | show translocation into the nucleus; drives Cytokine release || Feedback Inhibitor | show curved blunt-ended inhibition back to Kinase A" --structure "left-to-right cascade, curved feedback loop"',
    },
  },
  {
    id: "teaser",
    name: "图形摘要 / 概念主图（teaser）",
    when: "第一页 graphical abstract、开头 overview 图：一图讲清全文最核心的一件事。读者 3 秒扫读即懂——信息极简。",
    think: "① 全文唯一想让读者记住的一句话是什么——它就是构图中心；② 能砍掉的元素全砍掉（academic-figure-skill：一幅图一个核心信息）；③ 只留 3-6 个视觉元素，留白 ≥ 1/3；④ 输入→输出的「变换」用哪个视觉隐喻表达。",
    guide:
      "Graphical abstract / teaser figure: ONE communication idea as the focal centre, at most 3-6 visual elements, strong empty space, the input-to-output transformation shown as a single clean visual metaphor with its label; reads correctly even at thumbnail size.",
    avoid: "no multi-panel structure; no small annotation text; no secondary ideas competing with the focal one; minimal labels only.",
    example: {
      intent: "One-line value proposition: degraded photos restored to gallery quality by a single model pass",
      entities: "Degraded Photo, Single-Pass Restoration Model, Gallery-Quality Result",
      structure: "three-element horizontal composition, model box at centre slightly larger, generous whitespace",
      cmd: 'pf craft --figure-type teaser --intent "Degraded photos restored to gallery quality in a single pass" --entities "Degraded Photo,Single-Pass Restoration Model,Gallery-Quality Result" --stages "Degraded Photo | show a faded scratched photo thumbnail || Single-Pass Restoration Model | show a single rounded box in the primary hue; centre focal || Gallery-Quality Result | show a vivid sharp photo thumbnail" --structure "horizontal, centre focal"',
    },
  },
  {
    id: "comparison",
    name: "对比图（ours vs baseline / before-after）",
    when: "方法对比、改前改后、消融示意。视觉核心是\"差异\"，不是双方完整细节。",
    think: "① 对比的维度是什么（质量/速度/结构）？② 对齐排版——同维度水平对齐读者才扫得出差异；③ 两侧用同一组「编号槽位」组织，读者逐槽对比；④ 我们的方法视觉突出（主色），对照安静（灰）；⑤ 中间加分隔或 VS 留白，不要共用边框。",
    guide:
      "Comparison figure: two aligned panels (left = baseline in neutral grey tones, right = ours in the primary hue), built from the SAME numbered slots inside both panels (Slot 1, Slot 2, ...) so the reader compares slot-by-slot, same internal layout in both so differences pop, a slim divider or whitespace gap between panels; differences emphasised, similarities quiet.",
    avoid: "do not use red-green as the only contrast pair; do not give the baseline deliberately ugly styling; keep panel titles short and parallel; do not put different content in matched slots.",
    example: {
      intent: "Before/after comparison of a deblurring method on a face photo, ours keeps eye detail sharp",
      entities: "Blurred Input, Baseline Result, Ours Result",
      structure: "three aligned panels left-to-right, ours panel slightly larger and blue-tinted",
      cmd: 'pf craft --figure-type comparison --intent "Deblurring before/after: baseline leaves residual blur, ours keeps eye detail sharp" --entities "Blurred Input,Baseline Result,Ours Result" --stages "Blurred Input | show the shared left thumbnail; identical crop in both panels || Baseline Result | grey panel; residual blur around eyes || Ours Result | primary-hue panel; sharp eye detail" --structure "three aligned panels"',
    },
  },
  {
    id: "dataflow",
    name: "数据流 / 形态变换图",
    when: "数据在系统里形态怎么变（文本→token→向量→聚类）、数据集组织与流动。强调\"形态\"，常配小字形示意。",
    think: "① 每个阶段的形态用什么小图形示意（波浪线=文本、点阵=token、方块阵列=张量）——逐阶段指定；② 每阶段发生了什么——1-3 条要点；③ 流动主线唯一；④ 数据量变化（变多/变少）可用粗细或宽度暗示。",
    guide:
      "Data-flow figure: one continuous flow spine; each stage a numbered node carrying its quoted label and 1-3 content bullets, with its data-shape glyph drawn beneath the node (wavy lines for text, dot grids for tokens, tile arrays for tensors — specify per stage); flow width hints at volume only where the user stated it.",
    avoid: "do not invent dimensionalities (no \"768-d\" unless supplied); glyphs stay schematic, never photorealistic; one spine only; no shapeless empty nodes.",
    example: {
      intent: "Document processing flow: raw text becomes tokens, then embeddings, then clustered topics",
      entities: "Raw Text, Tokenizer, Tokens, Encoder, Embeddings, Clustering, Topic Groups",
      structure: "single left-to-right spine with shape glyphs under each stage",
      cmd: 'pf craft --figure-type dataflow --intent "Document processing flow: raw text becomes tokens, then embeddings, then clustered topics" --entities "Raw Text,Tokenizer,Tokens,Encoder,Embeddings,Clustering,Topic Groups" --stages "Raw Text | show a wavy-line glyph; raw text paragraphs || Tokenizer | show a dot-grid glyph; splits text into tokens || Encoder | show a tile-array glyph; embeddings per token || Clustering | show grouped dot clusters; Topic Groups emerge" --structure "single left-to-right spine"',
    },
  },
  {
    id: "hierarchy",
    name: "层级 / 分类树图",
    when: "类别体系、目录结构、组织关系、数据集标注层级。核心是包含关系，不是流动。",
    think: "① 几层？每层几个节点？超宽就换横向树；② 每个节点除了名字还有没有一句话说明——有就写进节点；③ 同层节点视觉等权；④ 根/主干加粗或主色，叶节点安静。",
    guide:
      "Hierarchy tree diagram: root at top (or left for wide trees), levels clearly separated, same-level nodes visually equal width, each node carrying its quoted label and an optional one-line content note; containment or membership implied by tree lines only, root branch emphasised with the primary hue.",
    avoid: "no curved decorative branches; do not vary node size by importance unless asked; max ~4 levels visible; no empty nodes.",
    example: {
      intent: "Taxonomy of evaluation metrics organised into three families with sub-metrics",
      entities: "Metrics, Fidelity, Perceptual, Task-Based, PSNR Family, LPIPS Family, Accuracy Family",
      structure: "three-level tree, root at top, three mid nodes, leaves below",
      cmd: 'pf craft --figure-type hierarchy --intent "Taxonomy of evaluation metrics organised into three families with sub-metrics" --entities "Metrics,Fidelity,Perceptual,Task-Based,PSNR Family,LPIPS Family,Accuracy Family" --stages "Metrics (root) | show the root node in the primary hue; spans all families || Fidelity | PSNR Family leaf; pixel-wise fidelity || Perceptual | LPIPS Family leaf; learned perceptual distance || Task-Based | Accuracy Family leaf; downstream task scores" --structure "three-level tree"',
    },
  },
  {
    id: "timeline",
    name: "时间线 / 发展历程图",
    when: "领域发展脉络、版本演进、项目里程碑。核心是时间顺序 + 关键转折点。",
    think: "① 里程碑几个？超过 7 个就合并；② 转折点（范式变化）视觉强调；③ 时间轴只有一条，从左到右或从上到下。",
    guide: null, // timeline 属于低频图型，不进 craft 模板路由，仅作选型参考与示例
    example: {
      intent: "Evolution of diffusion models from pixel-space to latent-space to rectified flow",
      entities: "Pixel Diffusion, Latent Diffusion, Rectified Flow",
      structure: "left-to-right timeline with three milestone nodes and a connecting axis",
      cmd: 'pf craft --figure-type flowchart --intent "Evolution from pixel diffusion to rectified flow" --entities "Pixel Diffusion,Latent Diffusion,Rectified Flow" --structure "left-to-right timeline with a horizontal axis line"',
    },
  },
  {
    id: "zoomin",
    name: "总览 + 局部放大图",
    when: "整体架构太大看不清细节时：一张总览 + 从总览引出的放大框。常见于 CV 方法图。",
    think: "① 放大哪一处（必须是最关键的模块）；② 放大框内部画什么——模块的子块与连接要逐个列出（这是放大框存在的意义，空放大框=白画）；③ 总览与放大框用虚线引导线连接；④ 总览对应区域用虚线框标注。",
    guide:
      "Overview plus zoom-in figure: full pipeline at smaller scale on top (numbered stages), a dashed callout box magnifying the key module — INSIDE the callout, draw the module's internal sub-blocks and their connections explicitly as listed; thin dashed leader lines connect the callout to its dashed-highlighted source region; the magnified panel is the visual centre.",
    avoid: "only ONE magnified region unless user asked for more; leader lines must not cross each other; zoom panel must not cover the overview; no empty callout (its listed internals are always drawn).",
    example: {
      intent: "Full detector pipeline with the attention module magnified to show its internal heads",
      entities: "Input Image, Backbone, Attention Module, Detection Head, Multi-Head Split",
      structure: "overview pipeline top, magnified attention panel below-right connected by dashed leaders",
      cmd: 'pf craft --figure-type zoomin --intent "Detector overview with the attention module magnified to show its internal heads" --entities "Input Image,Backbone,Attention Module,Detection Head,Multi-Head Split" --stages "Overview pipeline | show Input Image → Backbone → Attention Module → Detection Head at small scale || Attention callout | show the Multi-Head Split explicitly: parallel head boxes feeding a concat block; dashed leaders to the Attention Module in the overview" --structure "overview top, zoom panel bottom-right, dashed leaders"',
    },
  },
  {
    id: "scene",
    name: "场景插图 / 应用示意",
    when: "应用背景图（部署在手术机器人上的系统）、人文示意、封面配图。允许更丰富的视觉，但仍要克制。",
    think: "① 场景里的\"产品/方法\"在哪——用主色或焦点光引到它；② 场景元素服务主题，与主题无关的装饰全删（NEGATIVE_LIST 的 object icons 条款就是为这类图准备的例外出口）；③ 人物可剪影化，避免写实人脸。",
    guide:
      "Application scene illustration: the deployed system or method highlighted as the focal element (primary hue or focus lighting), supporting scene elements in muted tones, clean flat vector style maintained; human figures as simple silhouettes unless the user asked otherwise.",
    avoid: "keep palette restraint (scene is not an excuse for rainbow); no photorealistic faces; no brand logos; the focal method stays legible at thumbnail size.",
    example: {
      intent: "Rail-inspection robot deployed in a metro tunnel, scanner beam highlighting a crack",
      entities: "Metro Tunnel, Inspection Robot, Scanner Beam, Surface Crack",
      structure: "wide tunnel scene, robot at right third with a teal scanner beam to the crack",
      cmd: 'pf craft --figure-type scene --intent "Rail-inspection robot scanning a crack in a metro tunnel" --entities "Metro Tunnel,Inspection Robot,Scanner Beam,Surface Crack" --stages "Metro Tunnel | show a wide low-light tunnel backdrop; muted tones || Inspection Robot | show the robot at the right third in the primary hue; scanner beam emitter || Scanner Beam → Surface Crack | show a teal beam landing on a visible crack on the rail" --structure "wide scene, robot right third"',
    },
  },
  {
    id: "result-style",
    name: "数据图风格示意（⚠️ 非精确数据图）",
    when: "示意性质的统计图（概念对比柱、趋势示意）。⚠️ 要保留精确数值的结果图禁止 AI 重画——AI 画数字必错，引导用户改绘图脚本（figures4papers / academic-figure-skill 路线）。",
    think: "① 这张图是\"示意\"还是\"承载精确数值\"？后者停手，走改脚本路线；② 示意图里坐标轴只是视觉暗示，刻度文字不写数字；③ 相对大小即信息（A 明显高于 B）；④ 每根柱/每条线对应哪个系列——逐个指定颜色。",
    guide:
      "Schematic data figure: implied axes as thin lines with NO numeric tick labels, bars/curves encoding RELATIVE magnitude only, each series named and colour-assigned individually (focal series in the primary hue, all other series muted grey); clear value difference between series is the message.",
    avoid: "no numeric axis labels, no invented values printed on bars; no 3D bars; if precise numbers matter, do not use AI rendering — modify the plotting script instead.",
    example: {
      intent: "Schematic bar comparison: our method clearly higher than three baselines",
      entities: "Ours, Baseline A, Baseline B, Baseline C",
      structure: "four vertical bars, Ours tallest and blue, baselines muted grey",
      cmd: 'pf craft --figure-type result-style --intent "Schematic bar comparison: our method clearly higher than three baselines" --entities "Ours,Baseline A,Baseline B,Baseline C" --stages "Ours | show the tallest bar in primary blue || Baseline A / B / C | show muted grey bars; clearly lower than ours" --structure "four vertical bars, no tick numbers"',
    },
  },
  {
    id: "multi-panel",
    name: "多面板组合图 (a)(b)(c)",
    when: "多个子图并列成一张期刊组合图：方法总览+局部细节、多个子实验并列、消融分组展示。期刊论文最常见的主图形态（academic-figure-skill / nature-figure 路线）。",
    think: "① 每个 panel 只讲一个子信息——panel 顺序与正文引用顺序一致；② panel 间字号/线宽/配色必须完全一致（割裂感是组合图头号死因）；③ (a)(b)(c) 编号统一放各 panel 左上角，粗体小写；④ 图例共享还是各自带？逐个指定；⑤ panel 尺寸一致或按内容权重明确分配（如 左 1/3 + 右 2/3）。",
    guide:
      "Multi-panel composite figure: labelled panels arranged on a clean grid, each panel carrying a bold lowercase letter label ((a), (b), (c)) at its top-left corner; every panel internally uses the same font size, stroke weight and colour assignments; a single shared legend when series repeat across panels; panel widths stated by the user are honoured exactly; thin separators or whitespace between panels, never decorative frames.",
    avoid: "no numeric axis tick labels or invented measured values in any panel; do not vary font size or palette between panels; no empty panels (each panel shows its supplied content); panel labels must not float far from their panels; do not repeat the same legend twice.",
    example: {
      intent: "Composite figure: overview of the two-stage method plus a zoom of the fine grader",
      entities: "Full Pipeline, Coarse Filter, Fine Grader, Score Map",
      stages: "Panel (a) Full Pipeline | show the two-stage chain end to end with Coarse Filter and Fine Grader || Panel (b) Fine Grader | zoom into grader internals; attention blocks || Panel (c) Score Map | show a small heat-map thumbnail",
      cmd: 'pf craft --figure-type multi-panel --preset double-column --intent "Composite figure: two-stage method overview plus a zoom of the fine grader" --entities "Full Pipeline,Coarse Filter,Fine Grader,Score Map" --stages "Panel (a) Full Pipeline | show the two-stage chain end to end with Coarse Filter and Fine Grader || Panel (b) Fine Grader | zoom into internals; attention blocks || Panel (c) Score Map | show a small heat-map thumbnail" --structure "three panels: a wide left panel, two stacked right panels"',
    },
  },
];

// —— 配色体系：数据 + 拼接（🔴 2026-09-21 用户定规：提示词不许写死配色）——
// 缺省 Okabe-Ito（colorblind-safe，Nature Methods / Wong 2011）；用户 --colors 或
// 风格卡里出现 ≥2 个 hex 就整体换用用户的 —— 阶段配色行与调色板句全部由模板拼接生成。
export const OKABE_ITO_ROLES =
  "deep blue #0072B2 = the proposed method / primary emphasis; sky blue #56B4E9 = supporting modules and secondary inputs; " +
  "bluish green #009E73 = outputs, gains and success path; orange #E69F00 = intermediate steps and pending items; " +
  "vermillion #D55E00 = discarded elements, baselines and contrast; neutral grey #B0B0B0 = context and shared structure";

export const SEMANTIC_COLOR_DEFAULT =
  "Palette — Okabe-Ito colorblind-safe scientific palette (Nature Methods / Wong 2011), use EXACTLY these hues and no others: " +
  OKABE_ITO_ROLES + ". " +
  "Every block gets an explicit assignment: fills are a very light tint of that hue (roughly 10-12% opacity on white), " +
  "borders are the full-strength hue at consistent 1.5pt weight, text is near-black #1A1A1A. " +
  "Never print hex codes as visible text on the figure; never pair red-vs-green as the only distinction.";

// 缺省阶段/区块配色序列（craft 按序循环取色并写死到每个阶段上）
export const STAGE_COLOR_CYCLE = [
  { name: "deep blue #0072B2", tint: "very light blue tint" },
  { name: "sky blue #56B4E9", tint: "very light sky-blue tint" },
  { name: "bluish green #009E73", tint: "very light green tint" },
  { name: "orange #E69F00", tint: "very light orange tint" },
  { name: "reddish purple #CC79A7", tint: "very light purple tint" },
];

// "deep red #C0392B" → "very light red tint"（抠掉 hex 剩下的词当色相名）；纯 hex → 兜底措辞
function tintOf(name) {
  const hueWords = name.replace(/#[0-9a-fA-F]{3,8}\b/g, "").trim().toLowerCase();
  return hueWords ? `very light ${hueWords} tint` : "very light tint of this hue";
}

// 用户给的色板令牌（数组或逗号/分号分隔串）→ [{name, tint}]；坏令牌丢弃
export function normalizeColorTokens(colors) {
  const raw = Array.isArray(colors)
    ? colors
    : String(colors || "").split(/[,;\n]/);
  const out = [];
  for (const item of raw) {
    const s = String(item).trim().replace(/\s+/g, " ");
    if (!s) continue;
    if (!/#[0-9a-fA-F]{3,8}\b/.test(s) && !/[a-zA-Z]/.test(s)) continue; // 必须有名或 hex
    out.push({ name: s, tint: tintOf(s) });
  }
  return out;
}

// 从风格卡/风格提示里抠"标签 + hex"对（≥2 个才算完整色板，避免误抓单个强调色）
export function extractPaletteFromStyle(text) {
  const s = String(text || "");
  if (!s) return [];
  const re = /([A-Za-z][A-Za-z0-9 ()-]{0,28}?)\s*#([0-9a-fA-F]{6})\b/g;
  const seen = new Set();
  const out = [];
  let m;
  while ((m = re.exec(s))) {
    const hex = "#" + m[2].toUpperCase();
    if (seen.has(hex)) continue;
    seen.add(hex);
    const label = m[1].replace(/\b(use|exactly|hues?|palette|colour|color|border|fill|text|and|the|a|of|in|on|is|=)\b/gi, " ").replace(/\s+/g, " ").trim();
    out.push({ name: (label ? label + " " : "") + hex, tint: tintOf(label || "") });
  }
  return out;
}

// 色板解析优先级：--colors 显式 > 风格卡里的 hex 组 > 缺省 Okabe-Ito
export function buildPalette({ colors, styleHints } = {}) {
  const explicit = normalizeColorTokens(colors);
  if (explicit.length >= 2) {
    return { cycle: explicit, custom: true, source: "user-specified palette" };
  }
  const fromStyle = extractPaletteFromStyle(styleHints);
  if (fromStyle.length >= 2) {
    return { cycle: fromStyle, custom: true, source: "document style-card palette" };
  }
  return { cycle: STAGE_COLOR_CYCLE, custom: false, source: "Okabe-Ito (default)" };
}

// 调色板句：用户色板 = 按显著度拼色名；缺省 = 带角色语义映射的 Okabe-Ito 全句
export function paletteSentence(palette) {
  const fillRule =
    "Every block gets an explicit assignment: fills are a very light tint of that hue (roughly 10-12% opacity on white), " +
    "borders are the full-strength hue at consistent 1.5pt weight, text is near-black #1A1A1A. " +
    "Never print hex codes as visible text on the figure; never pair red-vs-green as the only distinction.";
  if (palette.custom) {
    return (
      "Palette — use EXACTLY these hues and no others, in this order of prominence: " +
      palette.cycle.map((c) => c.name).join("; ") + ". " + fillRule
    );
  }
  return SEMANTIC_COLOR_DEFAULT;
}

// 选型决策速查（给宿主 AI：拿到一段内容先问这几个问题，答案直接映射到图型 id）
export const TYPE_DECISION = [
  "内容是按时间/顺序推进的多步过程？→ pipeline（有判断分支就 flowchart）",
  "内容强调模块内部构造与连接（谁包含谁、谁连谁）？→ architecture（关键模块看不清 → zoomin）",
  "内容是因果链（A 激活/抑制 B）？→ mechanism（方向必须与陈述一致，画错比不画更糟）",
  "内容是\"改前 vs 改后\"或\"我们 vs 对照\"？→ comparison（差异是主角）",
  "内容是形态在变（文本→向量→聚类）？→ dataflow（数据量变化用视觉宽度暗示）",
  "内容是包含/分类体系？→ hierarchy（是发展脉络才用 timeline）",
  "要一图讲清全文唯一核心信息（第一页/摘要）？→ teaser（元素 ≤ 6，砍到不能再砍）",
  "要画应用场景/人文背景？→ scene（方法仍是焦点，装饰全删）",
  "要画统计对比但只是示意？→ result-style（⚠️ 精确数值图不许 AI 画，改绘图脚本）",
  "拿不准 → pf types show <id> 看该图型的构图思考与完整示例，照着改变量",
];
