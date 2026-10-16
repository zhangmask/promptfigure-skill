---
name: promptfigure-local
description: >-
  为用户的论文/文档配科研图。当用户要求为论文、报告、章节生成插图、逻辑图、
  机理示意图、优化已有 MATLAB/Python 结果图的科研美感，或为文章段落配图时使用。
  插件提供：只读预览用户文档、锚点定位（图放在哪一段）、调 promptFigure 出图
  （standard 草稿 / premium 定稿）、读取用户审批结果。适用于 Codex、Claude Code
  及任何支持 Agent Skills 的宿主。用户已装好本插件（pf 命令可用）。
---

# promptFigure 本地插件

你（AI）通过 `pf` 命令行为用户的论文配图：读文档 → 选位置（锚点）→ 出图 → 等审批 → 定稿。
用户在独立 GUI 窗口里看到论文、黄色高亮和图，并在 GUI 里审批。**用户文档你只能读，永远不能写。**

## 铁律（违反任何一条都算任务失败）

1. **零侵入**：不写用户的论文/代码/数据文件。插入片段用 `pf doc snippet` 输出给用户，由用户自己插。
2. **premium 门禁**：图未获用户审批通过前，禁止出 premium 定稿。插件代码会硬拒绝，不要绕。
3. **位置显式声明**：每次出图/建锚必须 `--at "§3.2 ¶2"`（章节路径 + 段序）。禁止让插件猜位置。
4. **每轮开工先看审批**：`pf review status` —— 被驳回的图带意见，先处理再出新图。
5. **原文不进提示词**：先 `pf doc context` 蒸馏出「实体 / 结构 / 图种」，提示词写视觉描述，不搬运段落原文。
6. **图内带文字的图，直接 premium，别用 standard 精修**（2026-09-27 复测改写理由）：standard 档文字质量**不可靠且不是单一乱码形态**——同一提示词 4 个样本（CLI×3 + 网页×1）实测：字符级乱码会出现（"anchared top-elelf" 级），但更常见的是**内容污染**：白名单外的自加标签（"feature map M=4"、"Swin Transformer"、"connections"）和轴标签错乱（1,4,4,5,7,1 级），4/4 中招。带显式可印文字白名单也拦不住（复测证伪）。带文字的图直接 `render --model premium --force "文字图不走 standard"`；standard 草稿只配验证布局/配色。在 standard 上反复精修文字 = 白烧钱（render 和 QA 包现在都会提前警告）。
7. **报告完成前自己看图**：有视觉能力就用 Read/看图工具打开图文件（`pf qa-list <figureId>` 直接给路径），
   亲眼确认质量，别只看命令成功。
8. **全文优化 = 全做或全不做**：论文是同一套视觉语言 —— 只重绘一两张、其余保留原图，放在一起画风割裂
   （用户实测反馈，重罪）。要优化就先 `pf doc figures` 列出全部原图，`pf style set` 定统一风格卡，
   然后逐张 craft+render 全部覆盖；风格卡一次设置，之后每张 craft 自动带上，**禁止每张图自配风格**。
9. **精确定量结构的图不许 AI 裸画**（2026-09-26 扩写，原"数值精确的结果图"）：两类——① 柱/线/热图等保留精确数值的（AI 重画数字必错）→ 引导用户改绘图脚本样式；② **承载精确几何的机制图**（坐标网格/窗口划分/带确切参数的示意：移位窗口、attention 矩阵、算法伪码——AI 画不准格子：实测轴标签出两个"3"、分界线落错行、偏移量不足）→ 画之前先想清楚：几何是不是内容？是则**走脚本/矢量路径**（AI 只填数据不画图），或让用户在 QA 时逐项核验几何。craft 时用 `--geometry "分界线在第 4 行; 轴标签 1-8 无重复; 偏移 2 格"` 声明几何契约——QA 包会列出逐项核验清单（Q3 阻断级）， craft 也会警告 AI 保证不了。改脚本同样要全文统一，只改一个脚本的色板照样割裂。
10. **渲染后视觉核验是必做环节，不是可选项，且必须走 `pf qa` 写回**：每张图出来后 `pf qa <figureId>`
   拿核验任务包（自动体检数字 + 实体清单 + 阶段画法清单 + Q1-Q9 清单）→ 你亲眼读图逐条核验 →
   `pf qa <figureId> --pass --note "量化依据"` 写回通过（自动写审批状态），或
   `pf qa <figureId> --fail --note "缺陷1; 缺陷2"` 写回驳回（缺陷**自动**进精修状态机）。
   🔴 **approve 门禁只认最新版 QA 记录**：`pf review resolve --approve` 没有核验记录会被 CLI 硬拒
   （放水出不了门）；出新版本后旧 QA 作废，定稿（premium）也要重新核验。
   🔴 核验要挑刺视角：背景是不是纯白（重点看四角的淡斑/纹理）、有没有多余的小图标剪影——
   这两项是 standard 档高发违规，实测视觉模型在措辞不严时会放行。
11. **提示词必须是布局契约，不许是风格句**（2026-09-21 用户明确批评"太笼统"）：多区域图必须
   `--stages` 给出编号阶段 + 每阶段 2-4 条内容要点 + 阶段内画法（show 开头）——
   只给名词链/只有实体清单 = 空盒子图，craft 会打 ⚠️，出现警告就不许 render。
   🔴 **卡面文字纪律（V11 事故 + 2026-10-13 卡内空洞实拍二次收紧）**：能印上卡面的**纯标签只有 ≤2 词**的短标签
   （每卡最多 2 条，如 "hflip"、"A1"）；**>2 词的要点不再印卡面**（craft 自动降级为卡内图形的推导素材——
   卡面印成文字列表 = 实拍"这就是文字和框框，里面啥都没有"的根因之一）；
   **完整句子当要点 = 被原样印进卡面**（"connected components merge by…"就这样上了图）。
   说明性内容永远放 show 句里描述画法，不进卡面；craft 对 **>5 词**的要点、**>2 词被降级**的要点都会打 ⚠️。
   🔴 **要印什么就直接写标签，别写指令**：`label W-MSA` / `name the panel X` 会把 `label`/`name` 这个词一起印上图
   （实测 v1 图上出现 "label W-MSA"）——craft 现在会自动剥掉指令前缀并留痕告警，但写法本身就要改。
12. **画布比单一来源，禁止手写比例**（2026-09-21 V10 事故：提示词写死 16:5、实际渲染 16:9 →
   内容被横向压缩）：比例永远由 `craft --ratio 宽:高` 拼进提示词（缺省按预设 double-column/slide=16:9、
   single-column=3:4），`--out` 会写 `<同名>.craft.json` 伴随文件，`render --prompt-file` 自动继承
   同一比例 —— 你**不需要也不应该**在 render 手动传 --ratio（传了还要与 craft 一致，否则告警）。
   提示词里出现任何手写的 "16:5 / roughly aspect" 字样 = 上一个版本的产物，丢弃重 craft。
13. **多轮精修循环，出图 ≠ 完工**（2026-09-21 定规，本地 AI 的核心优势）：
   出图后亲眼严审（全文字清单逐条对照 + 留白/杂点/色相逐项），**任何 FAIL 或存疑 = 不送审不通过**，
   `pf qa <figureId> --fail --note "缺陷1; 缺陷2"` 会把缺陷**自动**写进精修状态机并重拼下一轮 craft
   命令（与 `pf refine` 同一状态），循环到零存疑才 `pf qa <figureId> --pass`。
   🔴 **fixes 沉淀规则（2026-09-27 起为默认路径）**：缺陷的归宿是**写进 --stages 措辞**，不是传 --fixes —
   实测（两次独立复现）缺陷文本会被图模型原样印上图。`pf qa --fail`/`pf refine` 重拼的 craft 命令
   **已不再带 --fixes**，改为随命令打印「沉淀指引」（逐条告诉你写进哪类措辞）；自己 craft 时也照此办，
   万不得已要传 --fixes 会收到 ⚠️（只允许"约束句"，严禁"缺陷描述句"）。已遵守的修正用
   `pf refine <figureId> --settle "<修正原文>"` 移出状态机：提示词总长上限 32000 字节（2026-10-13 从 8000 放开，对齐 premium 上游原生上限），超限 craft/render
   都会直接拒绝。修正轮出 premium 用 `render --force "修正轮: 理由"` 豁免门禁
   （--force 必须带理由；门禁被拒时会直接给可复制的完整命令，照抄即可）。
   重拼完成后真实渲染一次：新版本会自动清核验记录+审批重置回待审+清空活跃修正
   （QA 重新裁决）；等用户授权渲染时 `pf next` 会对账 sidecar 里的 --fixes 自动指到 render，不会死锁 refine。
14. **实体必须有原文出处，禁止编造；craft 必带 `--at`**（2026-09-21 第 2/3 层质量门）：
   craft **不带 `--at` 会被直接拒绝**（无法溯源 = 后门）；带 `--at` 时插件把实体拿回原文对账——
   全部实体都不在原文出现 = 疑似编造，同样拒绝（exit 1）。
   实体/阶段素材只准来自 `pf distill` 的输出；译成英文标签后要自己确认每个都对应原文实体。
   定位原文别靠猜：`pf doc search <关键词>` 全文检索给 §引用；画结果图用 `pf doc data` 找定量数据句。
15. **重绘 = 正文优先的三源蒸馏，不是自由创作**（2026-09-21 用户实拍批评"提示词根本没提原文的内容"）：
   信息源优先级：**① 论文正文（唯一内容源）**——把图 ref 所在 section 及其方法章节的相关 ¶ 完整
   读一遍（`pf doc read` 逐段），实体/阶段/数据流/顺序全部以正文为准（例：正文写四阶段
   TTA → dual-localizer → WBF → CAC-T，顺序就不许自己排）；**② 原图 PNG**——只用来校对视觉
   呈现（面板划分、母题画法），不用来发明内容；**③ caption**——对齐图注口径。
   蒸馏时每条要点自问"正文哪一段说了这个"，答不出 §¶ 出处的条目删掉。
   之后才是 craft（母题用 show 条目逐字搬进 `--stages`）→ 渲染 → 按 Q8 双重验收
   （正文溯源 + 原图卡片对照）。
   ⚠️ 两个已知翻车点：没读正文 = 画一张 caption 同主题的无关图；没读原图 = 母题全靠脑补。
   🔴 show 句具体度红线（2026-10-13 调研 PaperBanana 6.8k★："vague specifications make the
   figure worse"；同日 craft-rework-v1.png 实拍"卡内只有文字和框框"再实锤）：show 条目必须具体到
   **画什么物体 + 什么形状 + 什么空间关系**（例："show a strip of 3 rail-surface thumbnails, the
   middle one carrying a visible crack"），抽象术语堆（"hflip"、"A2 SSIM"、"vision transformer
   classifier"）= 图模型只能画通用小方框涂鸦。
   🔴 **思考外置（2026-10-14 定版路线）：画面语义由你（宿主 AI）思考产出，插件只出题+阅卷**——
   craft 流程两级：① `pf craft --brief`（其余参数照常）= 出题：打印原文摘录+实体清单+refs 真图路径+
   写法规范；**打开参考图亲眼看**，提炼同模块画法（只学画法不搬内容），写 scene 画面段
   （英文 250-450 词，每卡一句：标题+可数部件+数量+相对位置+双引号小标签；布局：等宽等高
   同一水平轴、箭头高中线、文字只在卡内）。② `pf craft --scene "<scene 段>"` = 阅卷：scene 直通
   进提示词主体，护栏照跑（白名单/hex/预算），内置词典推导**跳过**。带 --scene 时不要在
   --stages 里塞 show 长句（画面细节全在 scene 里，骨架只定结构）。
   🔴 **scene 写法实测守则（2026-10-14 四轮渲染实测，每条都有前后对比图实锤）**：
   ① **画面内容必须从原文长出来**——写 scene 前先把原文方法段读一遍，模块名/输入输出/变换组/
   热图分支都要用论文里真实的东西（实锤：没读原文编了 "lr/hr rail 缩略图"，而论文真实内容是
   source-enhanced 人脸对+残差/SSIM 双热图——画出来的图内容全错）；拿不准就 `pf distill --at` 重抽。
   ② **只用通用学术母题**（照片缩略图/热图/检测框/节点连线/堆叠薄片）——图模型天生见过几百万
   张论文图，这些不用教；发明怪图标（圆圈减号徽章、表盘弧）必翻车。
   ③ **明写彩色填充**：pastel 填色卡+自然色照片+暖色热图，并写 "never black-and-white line art,
   never outline-only drawings"——不写这句 standard 档会画成纯白线稿。
   ④ **别用 "Card N" 字面 token**（会被印到图上），用 "Module 1" 或 bullet 结构。
   ⑤ **1:1 画布单行装 6 卡必翻车**（重复卡/大留白）——≥5 卡直接写 two rows of three + 阅读顺序
   + 箭头走向（含换行箭头从哪到哪，方向写死）；≤4 卡才用单行。
   ⑥ **防复数句必备**：exactly N cards / never an extra card / each title and label printed
   exactly once / no numbered circles / no invented words——四轮实测少一句就出对应毛病。
   ⑦ **对齐语言要写具体的几何关系**（学 AutoFigure-Edit「逻辑布局与美学渲染解耦」的思路：
   能确定的别留给模型自由发挥）——不写抽象的 "well-aligned"，写 "all cards the same size with
   equal gaps between them" / "top edges aligned on the same horizontal axis" / "arrows at the
   vertical midline"。**槽位块的精对齐不用求模型**：compose 渲后会把同行带品红块的
   top/height/width 向行内中位数收敛（±30% 内，防拉平有意的大小差异）——scene 里只要把
   槽位写在「卡内、标题下方、宽度撑满卡内边距」就行，歪了插件兜底。
   ⑧ **渲后必亲眼看图改 scene 重渲**（QA 轮之前）：布局错改⑤、内容错改①、风格歪改③——
   别烧渲染额度盲试，每次重渲只改 scene 措辞、其余参数不动。
   🔴 **资产槽位（2026-10-14 实测闭环）：该贴真图的位置不许模型画**——论文里已有的例图
   （视觉识别例子、数据集样例、结果可视化）贴进去，模型画的"假人脸"是造假。流程：
   ① `pf craft --brief` 会打印【原文已有图——逐张判定用途】清单（\includegraphics 捕获的
   绝对路径+图注）——**逐张判定**：例图/数据样例/结果图 = 数据本身，必须贴原图；文件不存在
   的（⚠️ 标记）由宿主 AI 自己去找：原文 PDF 对应 Figure 抽图，或论文开源代码跑出原图；
   方法图/流程图只当画法参考不贴。需要 crop 就用 sharp 按真实像素几何裁（先 Read 原图看内容
   再定坐标，别盲裁）。
   ② scene 里写槽位标记（带来源标记，2026-10-14 用户定规「不是原图的要数据库标记」）：
   `{{asset:名|绝对路径}}`（原文原图，=original）/ `{{asset:名|路径|repro}}`（源码复现图）/
   `{{icon:名|描述}}`（要单独画的小图标，=drawn）。**asset 槽位绝不允许 drawn**——compose 拒贴
   标 |drawn 的 asset（AI 重画例图 = 造假）。来源分类落伴随 JSON slots，compose 后回写 compose 段
   （original/reproduced/drawn 分布），宿主 AI 读伴随 JSON 即知成图里哪些元素是真图。
   🔴 **槽位选型先判卡的角色（2026-10-15 用户定规「操作卡该画示意图而不是结果」）**：
   槽位贴什么之前先问「这张卡在讲操作还是在展示结果」——
   · **操作/方法/步骤卡**（Denoise、Segment、Augment、训练流程…）→ **画示意图**：改用
     `{{icon:名|示意图描述}}` 走 render-icon 单独画（画这一步做什么：输入形状→变换→输出形状），
     不许把论文里的结果例图贴进方法步（图不对题，craft/assemble 会点名拦）。
   · **结果/示例/数据卡**（qualitative 对比、数据集样例、生成效果…）→ 才贴原图 `{{asset}}`。
   · 例外两条（scene 归属句里写明）：① 原图本身是方法/管线结构图 → 保留 asset 但 `crop=` 只裁
     方法部分；② 该例图就是这一步的真实中间产物 → 写 "this example IS the output of this step"。
   craft 解析后：给图模型的文本改写成纯品红 (#FF00FF) 占位块（卡内、标题下方），槽位清单
   写进伴随 JSON，回显清单。
   ③ **分部分出图（2026-10-14 用户定规：一张图不是单次出图能做好的，要多图层多部分区分开）**：
   骨架整图渲 1 次（品红占位）→ 复杂 icon 单独渲小图：`pf render-icon --prompt-file <p.txt> --all`
   （每个 icon 槽位一张 1:1 白底无字小图，走标准计费通道，登记进伴随 JSON icons 段；
   `--name x` 单独重渲某一个；`--dry-run` 先看清单）→ `pf compose` 统一贴入（asset 查 scene 路径，
   icon 查 icons 段）。几何元素（箭头/方框）不用单独渲——整图直接画；只有复杂图标（小网络
   inset、精细示意）才走 {{icon}} 分部分渲。渲图次数 = 1 + icon 数，出图前心里有数。
   asset 贴图用 contain（不裁内容=不造假），icon 用 cover。检出 0 块 = 模型没画品红
   （看渲染图确认），重渲。
   ④ 通用几何图标（圆柱/箭头/方框）不用槽位——模型直接画就行；只有复杂图标（小网络 inset、
   精细示意）才走 {{icon}} 单独渲再合成。
   🔴 **词典兜底路线已退役**：不带 --scene 时卡内画面来自内置词典（写死路线，上限低、
   措辞歪会画出非学术元素），craft 会打告警——正式出图一律走 --brief → --scene。
   🔴 **零命中链（没找到 ≠ 拍脑袋）**：refs 零命中 → ① 用户原图（按下面 A/B/C 分档）；
   ② 还没有 → 从 provenance/materials 取模块**真实数据类型**，按数据类型→学术原语映射写
   show 句（真人画法：内容来自自己文档的数据形状）——图像→小图块、特征图→薄片堆叠、
   向量/embedding→色块行、图结构→节点连线、概率/分数→曲线或表盘、存储→圆柱、
   文本→文档页、操作→圆角框；craft 内置原语映射会自动补推常见词。
   ③ craft 报"零参考"告警时明确告知用户零命中，建议补参考图或走 --ref 复刻，不要盲生成。
   🔴 **用户原图 A/B/C 分档**（用户提供参考图/草图时先分级再决定用法，四项 rubric：
   标签可读 / 结构可辨 / 内容对应 / 学术画法）：**A** 四项全过 → 直接 `--ref` 临摹（最强参考）；
   **B** 结构可用、画法欠佳 → 原图只定拓扑与内容，画法从 refs 检索学；
   **C** 涂鸦/无法对应文档 → 只当意图证据，画法全走 refs/原语映射。
   用户坚持按自己的图画时 `render --ref <图> --ref-quality c` 一票覆盖你的分级（事件留痕可审计）。
   分级结论一句话记入 sidecar 溯源（pf provenance 可回放"当时为什么这么路由"）。
   craft 内置原语映射会自动为常见术语（翻转/缩放/检测框/融合/热图/堆叠块…）补推母题，
   推不到的卡会打 ⚠️——出现警告就先跑 pf refs，别让图模型自由发挥。
   craft 时终端会打出该图型的成品示例命令——show 句的具体度照它对齐。
   精修轮（refine/qa --fail 之后）render 一律带 `--ref prev`：上一版做 img2img 条件，
   修缺陷不重掷骰子（画对的部分不漂移）。
16. **图型母题污染 = 意思错，必须显式覆盖**（2026-09-26 实测新增）：图型的版式指导自带框架词——
   comparison 的 `baseline`/`ours`/`Slot N`/`VS`、multi-panel 的 `(a)(b)(c)`/`legend`、result-style 的
   `Ours`/`baseline`。用 comparison 画"两种构型/两个阶段"（而非方法对比）时，这些词会被图模型
   当内容画上图，**改变的是图在说什么**（阻断级，不是美观问题）。craft 见到这些图型会告警并列出
   框架词；告警出现时：要么本文确实是这个框架（放行），要么在 `--stages` 里显式覆盖
   （如 "two panels titled Regular and Shifted; no baseline/ours wording; no slot numbers"），
   否则 QA 的 Q2/Q4 按编造拦截。
   抽象母题要写死 "plain abstract … (NOT photographs)"；图上文字只许清单内标签
   （NEGATIVE_LIST 已全局约束，图模型自加 bullet/箭头词 = Q2/Q4 违规）。

## 成图质量标准（三定义 + 优化白名单 + 验收；2026-10-16 用户定规「要形成一个标准」）

任何成图/重排/对照交付前，以下三条定义就是验收标准，逐条可判 PASS/FAIL：

1. **视觉对齐** = 同类内容同尺度 + 共享网格。
   - 同类内容（如人脸）跨卡必须同一显示尺寸、同一处理方式；禁止同一类东西一张占满卡、另一张缩成邮票。
   - 所有面板共用一套边距/间隙/行高网格；色调统一（照片卡和图表卡混排时，用同一底色/描边语言框住）。
   - FAIL 例子：卡 1 一张糊脸占满、卡 2 同类脸只有 200px——这就是没对齐。
2. **合理的分段** = 阶段边界跟**论文论证结构**走，不跟「我手上有什么图」走。
   - 动机/论据卡与流程卡必须视觉可区分（副题写 "Why it matters" 类措辞，或图层区分）；
     论据排在流程链末尾还不标注，读者会把它当成流程的第三步——语义就错了。
   - 相邻卡之间箭头宣称的「流向」必须为真：卡 1 的内容必须真的出现在卡 2（同一.setImage 样本），
     禁止「A 样本的输入 → 箭头 → B/C/D 样本的输出」这种断裂拼接。
3. **按作者原文思维优化** = 先回答「这张图在原文里论证什么」，再决定动什么。
   - 动手前必须能一句话说出原文图注的论点（如 DFDC 图 = "Ours 比 LiSiam/LRL 更细粒度，
     且 DFDC 无 GT 纯定性"）；说不出 = 还没读懂，禁止动图。
   - 原文的展示惯例（定性图必带输入图对照、行标语义、配对结构）是底线，重排不得剥掉让图不可解读。

**优化白名单（L2 声明制）**——只许做清单内的事，做了必须写进 sidecar `acceptance.enhancement`：
   ✅ 显示性增强：对比度/伽马拉伸（声明拉伸区间）、放大 inset、行内小标、排版对齐
   ✅ 结构编辑：裁剪、重排、选样（写明选样理由进 reconciliation）
   ❌ 人脸/图像清晰度提升（视频帧无源可提，别硬提）、❌ 改子图内容像素、❌ 重绘论文成品图表
   ❌ 没读懂论证就动图（先通读原文四个 tex 再动手——七轮样式返工的根因）

**验收清单（交付前逐条过，写入 sidecar `acceptance`，assemble 会回显）**：
   `acceptance: { story: "这张图必须让读者记住的一句话",
                  segmentation: "阶段划分 = 论文论证结构的哪几段；论据卡如何区分",
                  alignment: "同类内容对齐规则（谁和谁同尺度、共享什么网格）",
                  enhancement: ["做了哪些白名单内增强，参数是什么"] }`
   缺 acceptance 块 = 装配端告警；enhancement 里有白名单外动作 = 阻断。

## 环境自检（遇到问题先跑 pf doctor）

```bash
pf doctor                # 体检：TeX 引擎 / API key / 本地服务 / 当前文档健康（块数·图数·PNG 丢失）
pf audit                 # 审计一键可查：绕门记录（craft.forced/gate_bypass/review.forced）+ 计费兜底
                         #   每条带理由；接手别人项目/怀疑历史版本可信度时先跑它
pf export svg <figId>    # 最新版 PNG → 可缩放 SVG（vtracer 描摹，draft/high 两档）
                         #   ⚠️ 描摹件：文字全变路径、不可直接编辑——仅作退路。交付前必须核对
                         #   数值与比例（数值差不多即可、对应关系必须对），并告知用户是描摹件
                         #   首选：让宿主 AI 比照终稿用本地工具重绘（python-pptx 形状 / 结构化 SVG），
                         #   每元素独立成对象，用图层分离的工具编辑（参考 github.com/icebird1998/scientific-illustifier）
                         #   首次用报缺依赖时：npm i @visioncortex/vtracer（纯 WASM 可商用）
```

- **LaTeX 论文**：`pf open` 会自动找本机 TeX 引擎（tectonic/latexmk/pdflatex）编译成 PDF 再预览。
  - 编译失败报「no-engine / 本机没有 TeX 编译环境」→ 执行 `pf setup-tex`
    （自动下载便携版 tectonic 约 20MB 到 `~/.promptfigure/bin/`，免安装免管理员；国内镜像自动回退），
    然后重新 `pf open` 或 `pf doc compile`。首次编译要在线拉宏包，几分钟属正常，重跑就快了。
  - 编译失败但引擎存在 → 看输出里的日志尾部：宏包缺失让 tectonic 联网自拉（需能上网）；
    文档本身有错就如实告诉用户。
  - **改了 .tex 源文件后**：执行 `pf doc compile` 重新编译，GUI 刷新即见新版。
- **Word / WPS**：`.docx`（Word 和 WPS 另存都算）直接预览，无需编译。
  老格式 `.doc` / `.wps`（二进制）不支持预览 —— 让用户在 Word/WPS 里「另存为 .docx」再 open。
- **PDF**：直接预览（整页排版 + 可高亮的文本层）。
- **服务与托盘**：`pf open` 自动拉起本地服务和托盘 —— 用户关掉 GUI 窗口后托盘图标仍在
  （打开工作台 / 重启 / 退出）。用户说"关闭/退出插件"→ 让他走托盘菜单退出（真退出），
  或你执行 `pf stop`（停服务，托盘不会自动复活；下次 `pf open` 全部自动恢复）。
  用户报"关了窗口托盘没了"→ 让用户跑 `pf doctor` 看"托盘"一行，多半是缺 python+pystray。
- **服务/托盘死了怎么排（2026-09-21 实测链路）**：
  1. `pf doctor` —— "本地服务: 未运行" 且 daemon.json 还在 = 僵尸记录，`pf open` 会自动清；
     "托盘: 进程在但心跳停更（冻结）" = 托盘被挂起（宿主会话回收/睡眠恢复），自愈已停摆，
     直接 `pf tray` 会用新实例顶替（单实例守卫按心跳新鲜度放行，旧冻结实例会被新实例补刀）。
  2. `~/.promptfigure/logs/daemon.log` —— daemon 秒死时的临终输出在这里（此前死因零证据，现在有）。
  3. 🔴 **agent 沙箱内起的 daemon 活不过本次会话回收**（detached 也逃不掉）——不要反复手动重起；
     只要托盘常驻（登录自启已配：Startup 文件夹 pf-tray.vbs），它 10s 内自愈拉起。
  4. 托盘彻底没了 → `pf tray` 补启；sandbox 里连它也活不过会话时，让用户双击
     Startup 里的 pf-tray.vbs（或重新登录），别在沙箱里死循环重试。

## 命令速查

```bash
# 开工
pf next                               # ⓪ 不知道下一步就跑它：插件读状态给唯一可执行命令；
                                      #   「执行 → pf next」循环可走完全程，冷启动首选
pf plan [--goal "用户原话"]           # ⓪ 小白模式：用户说不清要什么图时先跑它——输出
                                      #   ①发给用户的大白话问题卡（章节选项来自真实文档，用户回数字即可）
                                      #   ②你拿到答复后的执行步骤。用户含糊/是新手 → 先 plan 再干活
pf review status                      # ① 永远先执行这个
pf doc outline                        # 章节树，选图放哪
pf doc search <关键词...>             # 全文检索：关键词 → §引用+片段（定位内容别靠猜，中英文都行）
pf doc data                           # 定量数据句按章节列出 —— 画结果图/对比图的数字只准从这里来
pf doc figures                        # 论文原图清单（位置+图注+图源路径）—— 全文优化前必看
pf board                              # 🔴 多图资产总览：每张图的阶段/QA/审批/文件存在性+各自下一步
                                      #   批量配图先 style set 再逐张 craft；接手别人项目先跑它摸底（丢文件/缺风格卡都会标红）
pf doc context --at "§3.2 ¶2"        # 该节段落 → 你蒸馏出实体/结构/图种
pf distill --at "§3.2 ¶2"            # 🔴 蒸馏素材机：原文+候选实体+候选阶段句序+候选数据句+craft 命令骨架（填空即可）
pf refs "<模块>" --queries "同义词;类别族;动词"   # 🔴 顶会参考图检索（NeurIPS 2025 方法图 590 张，BM25 本地离线）
pf craft --brief …                             # 🔴 思考外置·出题：打印原文摘录+refs 真图+写法规范，宿主 AI 看图思考写 scene
pf craft --scene "<scene 段>" …                # 🔴 思考外置·阅卷：scene 直通+护栏，跳过词典推导（正式出图必走 brief→scene）
pf compose --prompt-file p.txt --png 图.png    # 🔴 槽位合成：把 scene 里 {{asset:名|路径}} 的真图贴进渲染图的品红占位块（来源分类回写伴随 JSON compose 段）
pf assemble --prompt-file p.txt [--png 图.png] [--map "槽名=卡号"]   # 🔴 模板装配（学 AutoFigure-Edit「逻辑布局与美学渲染解耦」）：
                                     #   卡网格/标题/箭头/对齐由插件确定性 SVG 坐标画出（文字不可能拼错、卡数不可能错、
                                     #   等大等高天然成立），卡内视觉 = 真图 asset（contain 不裁）/ render-icon 渲的小图注入；
                                     #   产出可编辑 SVG（元素带 id）+ 可选 PNG 光栅化。**对文字/对齐/卡数要求高时优先走这条**；
                                     #   排版=学术规范：卡高按行内最大内容宽高比实测推出（卡内不留白）、白卡+中性灰细边
                                     #   （色相只做标题下 3.5px 短下划线，克制用色）、小号标题、箭头细线横穿全缝隙；
                                     #   ≤4 卡单行、5-6 卡 2×3、7-8 卡 2×4，>8 拒装；画布宽由网格形状定、高随内容
                                     #   🔴 行内宽高比失衡处置（assemble 告警会点名）：优先 pf montage 把宽条图
                                     #   重排成网格——`pf montage --in 条图 --out 网格.png [--crop 左,上,宽,高]`
                                     #   自动按列亮度找白色间隔切子图（别目测均分，实测必出黑边）、自动选列数
                                     #   使网格宽高比贴近邻卡（--target 0.7 缺省）；重排只动布局不动子图内容。
                                     #   注意：assemble 用 craft 伴随 JSON 的 stages 当卡标题——stages 写好标题就是图上的字
                                     #   🔴 图-卡语义审查（2026-10-14 实装，grid6 教训：结果图塞进方法卡没人拦）：
                                     #   ① scene 里把 {{asset}} 写进对应卡的句子（"Card N, titled ...: ... {{asset:名|路径}}"）
                                     #   ——装配归属按「标记前最近的 Card N」解析，宿主写在哪卡就装哪卡；
                                     #   ② 没写归属句的槽位走顺序兜底、--map 显式指定绕过 scene——两者都打
                                     #   ⚠️「图-卡语义未过词面校验」，装配后必须 Read PNG 逐卡核对：方法卡放方法
                                     #   过程图（Denoise 卡放去噪过程示意，不是失真结果图），结果卡才放结果图；
                                     #   不符改 scene 归属句或 --map 重装配；
                                     #   ③ scene 标「仅参考/never pasted」的方法图（refOnly）装配直接不贴卡面。
                                     #   🔴 尊重原文三条款（2026-10-15，用户问「有没有真正尊重原文」）：
                                     #   a. 整图贴 = 全量保真——不许裁掉模块；示意性重画不许替代原图模块；
                                     #   b. 只用原图某模块用 crop 标签：{{asset:名|路径|crop=左,上,宽,高}}——坐标必须
                                     #      Read 原图按真实像素定（目测越界会被 clamp 并告警），越界=没看过图；
                                     #   c. craft 的【模块对账·未交代】告警列出图注提到、scene/stages/intent 没出现的
                                     #      术语——逐模块决定去留。🔴 省略的唯一合法出口是
                                     #      `--omissions "模块=去掉的理由; 模块2=理由2"`（写 scene 里机制读不到=没写）：
                                     #      理由落伴随 JSON reconciliation 段、assemble 随成图回显给用户。
                                     #      **基本尊重原作者意图**：给不出理由或拿不准该不该省——停下来问用户，
                                     #      不许默默省略（mod.png 实锤：DFDC 图 4 行模块默默只贴了 Ours 一行）。
                                     #   🔴 视觉对齐（2026-10-15 mod.png 复盘）：卡内图片顶部锚定（banner 式贴标题下，
                                     #      空位统一沉底不上下劈开）、stage motif 自动渲染为卡底小注（同行基线对齐，
                                     #      空位被模块描述填掉）——卡内中段巨大空位=排版 bug，别当「正常留白」接受。
                                     #   distill 后 craft 前跑；命中后逐张看图提炼画法进 show 句；零命中走原语映射
pf render --ref "<图路径>" --ref-quality a|b|c   # 临摹参考图；--ref-quality = 用户对 A/B/C 分级的一票覆盖（可审计）
                                      #   实体/结构只准从它的输出来；跳过它直接编内容 = 编造图
                                      #   任何语言都支持（Unicode script 统计抽取：中文/日/韩/泰走 n-gram，
                                      #   拉丁/西里尔/希腊/阿拉伯走大写术语+高频词，2026-09-22）——候选是统计性的，
                                      #   每个都要回原文核对出处再用
                                      #   输出末尾带【用户确认卡】——craft/render 花钱前先转给用户确认（用用户的语言）
pf compare —— 对照图按「美化档位」选体裁（2026-10-16 六轮迭代收拢；一张图只回答一个问题）：
                                      #   🔴 美化分三层，子图像素是红线（学术对比场景数据永不动）：
                                      #   · L0 原样引用——裁剪/重排不改一个像素（默认；审计对照证明的就是这层）
                                      #   · L1 排版美化——取材、重排、留白、对齐、统一尺寸、嵌入成图卡片体系
                                      #   · L2 呈现增强——放大 inset、标注、声明式的亮度对比度；动过必须落库
                                      #   🔴 体裁跟着「给谁看」走：
                                      #   · 美化展示（默认交付这张）→ 整图对照：--before 原文整图 --after 成图，
                                      #     两面板 a/b。美化发生在成图层（卡片/排版/组合），只有整图对照看得见；
                                      #     拿逐格像素对照当美化展示交付 = 用户看到「这不就是原图吗」
                                      #   · 未动数据证明（落库/审计用）→ 逐格对照：--style comparison
                                      #     --row "Paper:图1,..." --row "promptFigure:图1,..."（几何 1:1 抄
                                      #     CXTrack Fig.5：胶片条行、竖排行标、列对齐；配对靠像素匹配+双射校验）
                                      #   · 讲步骤顺序 → --style pipeline --before A --mid B --after C（直线箭头，
                                      #     折行后不画跨行箭头，顺序由 a/b/c 承担；--box 红框）
  pf compare --before 原文整图 --after 成图 --out 对比.png [--mid 中间产物（可多次）] [--labels "a;b;c"] [--steps "…"] [--box "面板:x,y,w,h[:红框标签]"] [--flow]
                                      #   🔴 图面零溯源零过程（2026-10-15 四/五轮定规）：「原文/取材/重排自/贴入第N卡」
                                      #   + crop/clamp/target/卡序号一律禁止上图；解释由宿主 AI 交付时说，记录全量
                                      #   走 --doc <id> --slot <名>（derived/index.json + asset.derived 可审计）
                                      #   🔴 交付前看尺寸（三轮定规「这么长一条有用吗」）：--layout auto 单行超 4800px
                                      #   自动折行，别交细长条；强制单行 --layout strip
                                      #   🔴 优化产物按版本落库：montage/assemble/compare 的 --doc 产物自动复制进
                                      #   figures/derived/<slot>_v<N>.png，双记录可回溯每一版
                                      #   🔴 一句话整图直渲路线（2026-10-15 用户定规，保留）：不带槽位/不 assemble、
                                      #   一条 scene 直出整图 = **仅限 --model premium**（高级模型一次就能出好图，
                                      #   适合拿来和标准链路成图对比、或简单图快速出稿）。分工：
                                      #   standard 档 = 草稿/分图层路线（骨架渲 → render-icon → compose/assemble，
                                      #   相当于打草稿）；premium 一般一次直出即可（质量在提示词本身），
                                      #   **不建议 premium 走多图层多次**——多图层是为 standard 弥补单次能力设计的，
                                      #   premium 用它费钱费时收益小；确要多图层也先 standard 打样再 premium 出关键图层。

# 风格卡（全文多图画风统一的机制，多图任务开工就设）
pf style set --text "muted blue-grey palette, thin sans-serif labels, flat vector, generous whitespace"
pf style                              # 查看当前风格卡
# 之后每条 pf craft 自动注入风格卡，禁止再手动给单图配另一套风格

# 锚点（图挂在哪由你声明）
pf anchor set --at "§3.2 ¶2" --side after --quote "<该段原文前几句>"
                                      # 🔴 quote 必须从 pf doc read / pf distill 输出逐字复制——
                                      #   编造/自行转写的 quote 会被当场对账标记 changed（CLI 有警告）
pf anchor list --changed              # 用户改过文字的锚点（橙/灰），需要你重新确认位置

# 出图（提示词写成 txt 文件再传，避免 shell 转义问题）
pf types                              # 图型目录 —— 不知道能画什么图/选型犹豫时先看
pf craft --at "§3.2 ¶2" --figure-type pipeline --intent "Two-stage defect detection pipeline that first discards background patches then grades remaining rail-surface candidates" --entities "Input Image,Coarse Filter,Fine Grader" --stages "Input Image | show 3 rail-surface thumbnails || Coarse Filter | discard background patches; keep candidates || Fine Grader | transformer scoring; per-patch score" --out prompt.txt
                                      # 🔴 craft 有输入质量门（2026-09-23 松绑后分两档）：
                                      #   【永远拦】intent 空/纯图型名（"方法框架图"）/ 实体空 / 空阶段 / 主链图 0 阶段 /
                                      #     对照格式残缺 / 全部实体对不上原文 / 产物体检失败（标签带引号等）
                                      #   【宽松档只警告，不拦】intent<6 词 / 实体 1-2 个 / 万能占位词（混在真词里）/
                                      #     阶段 1-2 个 / 孤标签阶段 / 零 show 画法句 / 要点整句 / 实体覆盖率 50-80%
                                      #     → 图能出（exit 0），stderr 有 💡 警告+改法；想出更好的图就照着改一轮
                                      #   质量优先加 --strict（或 PF_STRICT=1）恢复全量硬拦；被拒按示范逐条改
                                      # 🔴 craft 还有产物体检（输入门之后的第二道）：实体标签/阶段标题逐个回声、
                                      #   配色句与画布比契约、长度下限——失败=图上会丢实体/丢阶段/丢配色，渲染必废。
                                      #   常见根因：标签或标题里含双引号（craft 会自动剥掉并警告，最好自己别带）
                                      # 🔴 执行留证门①（事件流水对账，不是提示词约定）：过去 24h 内必须真的执行过
                                      #   pf open / pf doc outline|read|search|data / pf distill 任一条，否则 craft 拒——
                                      #   没读过原文就画图=实体靠编。正常按上面流程走（先 outline/distill 再 craft）天然满足
pf render --at "§3.2 ¶2" --model standard --prompt-file prompt.txt
                                      # 🔴 执行留证门②：真实渲染前必须先 --dry-run 排练（24h 内有记录；零成本暴露
                                      #   引用错/预算爆/画布不符）。排练的提示词与本次不一致会有响亮警告
                                      # 🔴 复刻参考图（2026-10-13）：--ref prev | <草图.png> —— 参考图以 img2img
                                      #   条件进出图模型，布局/母题被锁住，提示词只写"要改什么"。
                                      #   复刻 ≠ 重拼文字再盲掷：草图/原图的信息要靠 --ref 带进出图模型。
                                      #   --ref prev = 上一版（premium 定稿复刻已批准草稿布局的标准做法）；
                                      #   --ref <png> = 论文原图（pf doc figures 给路径）/手绘草图/任意参考。
                                      #   配合 --replica 走服务端一键临摹（视觉轮读图出规格重写提示词，prompt 可只写要点）。
                                      #   ⚠️ 输出含 refIgnored=true = 参考图被服务端忽略，本次是无参考盲画且已计费——
                                      #   停下排查（换档位/稍后重试），不要把它当复刻结果送审。
pf render list --at "§3.2 ¶2"
pf qa-list                            # 渲染后视觉核验清单（纯清单）
pf qa <figureId>                      # 🔴 核验闭环：任务包（体检数字+实体清单+阶段画法清单+Q1-Q9）→ 亲眼读图 → 写回
                                      # 🔴 执行留证门③：写回 --pass/--fail 前必须真的领过该图的任务包（先跑 pf qa <id>，
                                      #   24h 内有效）——没领包就写回=没读图就裁决，拒
pf qa <figureId> --pass --note "文字 N 条全对、色相 X、留白 Y%"     # 全 PASS：记录+自动写回审批通过
                                      # note 最好带量化数字；忘了带也不拦——插件会自动把体检数据（留白%/彩色%/尺寸）
                                      # 拼进 note 兜底，但标签/画法的语义核验责任仍在核验 AI（放水会在 GUI/审计留痕）
                                      # 🔴 硬门：图文件不存在时 --pass 一律拒（没有图就没有核验对象，编数字也没用）
pf qa <figureId> --fail --note "缺陷1; 缺陷2" # 有 FAIL：自动驳回+缺陷自动进精修状态机+重拼 craft 命令
                                      # 🔴 approve 门禁只认最新版 QA 记录（且依据须量化）；新版落盘旧 QA 作废

# intent 怎么写（对标 PaperBanana Planner）：先写"读者看完这张图必须记住的一句话"，
# 再补结构 —— 如 intent="读者应记住：检测分两级、粗筛在前精判在后"。
# 关键图（teaser/框架图）：standard 一次出 2-3 张候选（换 --style 细节）让用户挑，再走审批。
# 期刊版式：--preset double-column（横贯双栏宽幅，自动 16:9）/ single-column（单栏窄幅，自动 3:4）/ slide（16:9）
# 期刊规范：--journal nature|science|ieee|elsevier|thesis —— 投稿图必带：字号/线宽/信息密度按最终印刷宽度反推（nature 单栏 89mm/双栏 183mm）
# 多面板组合图：--figure-type multi-panel —— (a)(b)(c) 期刊主图形态；每个 panel 一个子信息，stages 逐 panel 给
# 🔴 distill 候选实体带证据分级（×次数·首现章节）：标 ⚠️ 低证据（仅 1 次）的实体人工确认后再用
# 🔴 双语对照实体：--entities "Data Augmentation|数据增强策略,…"（英文标签|原文词）——
#    英文进卡面（standard 中文乱码率高）、原文侧自动溯源对账；qa 字号核验：craft 带 --journal 时
#    qa 任务包会给"图上最小文字应 ≥N px"的量化判据，量到更小 = FAIL
# 🔴 画布比单一来源：craft --ratio 宽:高 拼进提示词并写进 <同名>.craft.json；
#    render --prompt-file 自动继承，禁止在 render 手写 --ratio（V10 压缩事故的根因就是两处比例不一致）
# 🔴 承载意思的几何（铁律9②）：craft --geometry "分界线在第 4 行; 轴标签 1-8 无重复; 偏移 2 格"——
#    分号分隔逐项声明；AI 渲染保证不了（实测轴标签重复/分界线落错行），声明后 qa 任务包出第 3d 步
#    几何核验清单（Q3 阻断级）。精确结构类图（坐标网格/窗口划分/算法示意）必填

# 用户在 GUI 审批后
pf review status                      # 看到 approved → 才能出定稿
pf render --at "§3.2 ¶2" --model premium --prompt-file prompt_final.txt
                                      # 🔴 2026-09-23 收紧：render 有溯源门——提示词必须带 craft 伴随 JSON
                                      #   （craft --out 自动写；定稿导出用 pf prompt <figureId> --out，会自动带出）。
                                      #   手工/外部拼的提示词直接 render 会被拒（--force "理由" 豁免+留痕）

# 审批入口之二：用户也可以直接在对话里说"第 3 张不行，XXX 改一下"，你替他写进系统：
pf review resolve fig_20260920_3 --reject --note "模块名拼错了"
pf review resolve fig_20260920_3 --approve   # 🔴 approve 必须有最新版 QA 记录（且依据量化），否则被 CLI 拒（--force "理由" 显式豁免，理由落审计）

# 审批入口之三：AI 辅助审批（用户说"你帮我审一下这批图/这张图过不过关"时用）
pf review ai              # 全部待审批图各输出一份审批任务包（图路径+实体清单+核验清单+裁决流程）
pf review ai <figureId>   # 只审指定一张
# 流程：读任务包里的图（用你的视觉能力）→ 对照实体清单/阶段画法清单逐条过 Q1-Q9（每条 PASS/FAIL+证据）
# → 全 PASS 用 `pf qa <fid> --pass --note "AI审: 依据"` 写回；有 FAIL 用 `pf qa <fid> --fail --note "AI审: 缺陷1; 缺陷2"`
#   （fail 会自动驳回并把缺陷写进精修状态机，下一轮 pf refine / pf qa --fail 输出里直接给重拼好的 craft 命令）。
# ⚠️ 改判权在用户：你的判定以 note 形式留在系统里，用户在 GUI 审批队列看得到、可以改；
#    用户没明确说"直接替我批"时，先汇报结论等确认，别自作主张写回。

# 环境
pf doctor               # 出问题时先体检
pf setup-tex            # 没有本地 TeX 时自动装便携 tectonic
pf doc compile          # .tex 改动后重新编译 → PDF 预览
```

**推荐命令顺序**（弱模型实测教训，2026-09-20）：
`pf status`（看当前文档）→ 没开过就 `pf open <论文>` → `pf doc outline`（定位内容用 `pf doc search <关键词>`，找数值用 `pf doc data`）→ `pf distill --at "§x.x ¶y"`（从原文抽实体/阶段素材，末尾确认卡转给用户）→ **`pf refs`（模块画法没把握时检索顶会参考图，看图提炼画法写 show 句；用户原图先 A/B/C 分档）** → `pf craft --at "§x.x ¶y"`（被拒就照改法示范 ❌/✅ 改命令）→ `pf render` → **`pf qa <figureId>` + 亲眼读图核验 → `--pass` 写回 / `--fail` 写回（缺陷自动进精修循环）** → 核验通过后 premium 定稿 → `pf review status`。
- **小白用户/用户说不清需求**：先 `pf plan --goal "<用户原话>"` —— 问题卡（真实章节选项）发给用户等答复，再按步骤执行；用户答复有变就重跑 plan
- 所有命令**不带 `--doc` 时自动作用于最近打开的文档**；要跨文档操作才加 `--doc <docId>`
- `craft --out` 建议用**相对路径**（当前目录下）——绝对路径换机器/换用户就跑，相对路径最不容易踩环境差异（两处口径以此条为准）
- `pf doctor` 的 "API key: 已配置" 只说明 key 存在，**不代表有效**；render 报 `invalid_api_key` 就执行 `pf login <pf_key>`（key 在 promptfigure.top 控制台建）
- 出图失败先看报错原文再决定动作，不要盲目重试同一命令

## 图型选型（画之前先想清楚"画什么图"）

平台能画 12 种图型，每种有明确的适用场景。**不要默认都画流程图** —— 图型选错，画得再好也传达不了内容：

```bash
pf types                    # 13 种图型目录 + 选型决策速查（拿到内容先过一遍；含 multi-panel 期刊组合图）
pf types show pipeline      # 某图型的：什么时候用 / 构图思考 / 完整示例 + 成品叙述范文（你写的
                            # stages 会被 craft 拼成什么样，照这个"画面感"水准写 show 句）
pf examples                 # 全部图型的现成示例命令（照抄结构、换成你论文的实体）
```

🔴 组词契约（2026-10-13 重构）：craft 把你的 stages 拼成一段连贯场景叙述放提示词最前
   （每张卡：形状/粉彩填充/边框与标题同色/内嵌小图，一次说清、属性唯一）。你的职责 =
   给出**具体的** stages（show 句写清画什么形状什么颜色内嵌什么小图），描述组装交给 craft；
   不要自己写整段提示词，也不要在 stages 里写"简洁一点"这类元指令。

```bash
pf provenance <figureId>             # 🔴 图级溯源回放：锚点+原文摘录(±1段)+原图/数据文件
pf provenance --at "§3.2 ¶2"         #   （tex 来源含绝对路径+sha1 防替换+label 被引用段落）+
                                     #   版本史+QA+活跃修正 —— 换会话/接手项目/回答"这张图数据
                                     #   哪来的"一条命令全恢复，别靠猜
```

**选型决策（拿到一段内容先问自己）：**
- 按时间/顺序推进的多步过程 → `pipeline`；有判断分支 → `flowchart`
- 强调模块内部构造与连接（谁包含谁）→ `architecture`；关键模块看不清 → `zoomin`
- 因果链（A 激活/抑制 B）→ `mechanism`（方向画错比不画更糟）
- 改前 vs 改后 / 我们 vs 对照 → `comparison`；形态在变（文本→向量）→ `dataflow`
- 包含/分类体系 → `hierarchy`；发展脉络 → `timeline`
- 一图讲清全文唯一核心（第一页/摘要）→ `teaser`（元素 ≤ 6）
- 应用场景/人文背景 → `scene`；示意性统计对比 → `result-style`（⚠️ 精确数值图禁止 AI 画）

`craft --figure-type <id>` 会自动注入该图型的版式指导 + 专属避坑规则（对标
awesome-gpt-image-2「每类图自带避坑」），stderr 还会打印该图型的构图思考——先想再画。

## 第二阶段：提示词工作台（pf craft）

### 🔴 提示词 = 布局契约（2026-09-21 对标竞品后的硬标准）

用户原话："提示词太笼统，没有具体的图片怎么画的、有哪些内容、什么关系"。对标
paper-banana.org 成品提示词与 GPT-Image2-Skill research-paper-figures gallery 后，硬标准如下——

**一条合格的图提示词必须让图模型"无事可编"**：
1. **编号区域**：每个阶段/面板有编号和逐字标题（`Stage 1 — "Input"`）；
2. **区域内容**：每个阶段 2-4 条内容要点（PaperBanana 实测：多于 4 条图内会被截断）；
3. **区域画法**：说清"框里画什么"——缩略图/小条形/形状母题逐个指定
   （如 `show a strip of 3 rail-surface thumbnails`、`Show the U-shape inside this stage`）；
4. **精确标签**：要出现在图上的文字全部逐字给出（craft 的实体段已做，阶段标题/要点也会被逐字引用）；
5. **风格殿后**：色板/线条/留白约束放提示词尾部（craft 已固定如此）。

**craft 用法**：`--stages "标题 | 要点1; 要点2 || 标题 | show 缩略图描述"`。
- `show`/`draw` 开头的要点会被渲染成"框内画什么"的视觉指令；
- 只给 `--structure "A → B → C"` 名词链会被自动拆成"仅标题的空阶段"并打 ⚠️——
  **出现这个警告就说明你还没做完蒸馏**，回原文补要点再出；
- 多区域图型（pipeline/architecture/mechanism/flowchart/dataflow/zoomin）不给阶段会被警告。

### 🔴 配色 = 拼接生成，不许写死（2026-09-21 用户定规）

craft 的配色永远是**模板拼接**出来的，不写死在提示词里。色板解析优先级：
`--colors "brick red #B03A2E, teal #148F77, …"`（用户显式）> 风格卡里出现 ≥2 个 hex
（自动提取当色板）> 缺省 Okabe-Ito（colorblind-safe，Nature Methods 惯例）。
用户给了自己的配色，整张图（每阶段的边框/填充/标题色 + 调色板句）就整体换成用户的——
实测 v5：--colors 换砖红/蓝绿/琥珀/梅紫后四阶段全部跟换、Okabe-Ito 零残留。
- 每个阶段的配色行由 craft 循环取色板自动拼接（`colour: border X, fill white with a light X tint…`）；
- 净化层的 hexGuard 有护盾：调色板句与 colour 句里的 hex 是配色契约、不会被洗成最近邻色名——
  别试图把 hex 改写成 RGB/文字绕过，也**不要手写 hex 进 stages 之外的正文**（会被 humanize）；
- 期刊/导师指定配色时用 `--colors`；没有就信缺省 Okabe-Ito，不要发明自己的"好看"色。

`pf craft` 用本地确定性规则（随插件分发、零成本）把你的意图+实体+结构组装成合规提示词。它只吃你蒸馏后的产物，**不接收原文段落** —— 铁律 5「原文不进提示词」仍成立：`--intent` 填要画的图（如"两级检测框架流程图"），不要粘贴段落原文。

```bash
pf craft --at "§3.2 ¶2" --figure-type pipeline \
         --intent "两级检测框架：粗筛在前精判在后" \
         --entities "Input Image,Coarse Filter,Fine Grader" \
         [--preset double-column] [--out prompt.txt]
```

- 做什么：按本地规则组装提示词，自动净化自省句/违禁模式，输出 `warnings`（输入问题）和 `checklist`（出图前自审清单）。
- **craft 前 entities 自检**（漏提取是最常见的失败源，实测评测 2026-09-21）：对照 `pf doc context` 原文逐个数名词模块，每个出现的模块都要在实体清单里；分组结构（多个数据集/类别/基线/处理阶段）**整组丢失**是最常见的漏法——逐组核对数量。craft 警告"实体只有 N 个(<3)"就是这个信号。
- 分工：**规则层归插件**（确定性、必过基线）；**判断层归你** —— 看 `checklist` 逐条自审，不妥就改 craft 的输出再渲染。
- `writerGuard`（stderr 显示的 G1-G8）：是**你写/改提示词时**要遵守的约束（防编造、实体逐字、只输出提示词等），规则层已内建，**绝不要把它们写进图模型提示词** —— 那是发给图模型的画面描述，写手指令混进去就是噪音（实测 4/4 用例踩坑）。
- `warnings` 里出现"实体含中文"：图内会渲染中文标签，standard 档乱码率高 —— 先把实体译成英文再渲染（保留原意），或把该图列入 premium 定稿清单。
- 输出默认写到 `--out`；未给则打印 stdout。配合现有 `pf render --prompt-file` 使用。

## 出图档位规则

| 档位 | 价格 | 用途 | 限制 |
|---|---|---|---|
| `standard` | ~$0.02/张 | 草稿：布局、配色、构图探索 | 可自主反复出（有上限）；**图内文字会乱码** |
| `premium` | ~$0.15/张 | 定稿：用户审批通过后出 | 代码级门禁：未 approved 直接被拒 |

计费自动走「先额度、额度尽转余额」，402 换通道自动完成并留痕，你不用管。

## 工作流（三场景）

### 场景 1：优化已有结果图（MATLAB/Python 出的图不好看）

1. `pf doc figures` 先看全文原图清单 —— 如果用户要优化的是"整套图的观感"，
   必须全部统一处理，禁止只优化一两张（铁律 8）
2. 读用户的代码与结果文件（只读！），`pf doc context` 找到描述该结果的章节
3. **先判图种**：要保留精确数值的图（柱/线/热图）→ 不许用 AI 重画数字（必错），
   引导用户改绘图脚本的样式（配色/字体/线宽）或你帮他改代码；
   纯示意/概念类才走 AI 重绘（AI 重绘前先 `pf craft` 出合规提示词；改绘图脚本样式路线不走 craft）
4. AI 重绘路线：standard 出草稿 → 自审（对照期刊风格：无阴影、无渐变、留白、
   字号层级、色板克制）→ 满意后请用户在 GUI 审批 → 通过后 premium 定稿
5. **复刻优先（2026-10-13）**：重绘论文已有图时 render 带 `--ref <原图路径>`
   （pf doc figures 给的路径）——原图以 img2img 条件锁住布局与母题，提示词只描述
   视觉升级点。不带 --ref 的重绘 = 从零盲掷，实测 18 轮精修也回不到原图的构图完成度

### 场景 2：章节/全文逻辑图

1. `pf doc outline` 把握结构 → `pf doc context` 蒸馏方法步骤
2. 提示词描述流程结构（模块、箭头关系、层级），standard 先出草稿
3. **多图先 `pf style set` 定风格卡**（一次设置，每张 craft 自动注入）——
   不要每张图各写各的风格描述，那是画风割裂的根源

### 场景 3：机理插图 / 多因素关系图

1. 蒸馏实体与关系（谁作用于谁、并发/因果/包含）
2. 带小图标的插图直接在提示词里描述图标（试管、细胞、齿轮等），让图模型画；出图前先 `pf craft` 出合规提示词
3. premium 定稿（这类图必带文字标签 → 必须走 premium）

## 锚点协议

- `--at` 用**章节路径 + 段序**：`§3.2 ¶2` = 3.2 节第 2 段。先 `pf doc outline` 确认章节存在
- `--side after`（图放该段之后）或 `before`；同一个位置重复 set 会复用锚点，不会堆
- `--quote` 传该段开头原句快照 → 用户日后改了这段文字，锚点自动变 `changed`，
  `pf anchor list --changed` 能列出，**你要重新核对位置并重新 set**
- **GUI 高亮语义（用户会盯着看）**：荧光笔颜色（黄/绿/蓝/紫/橙循环）= 哪张图的上下文；
  同一段被多张图的上下文覆盖 → 背景加深纹理 + 底部每图一条色带（重叠一眼可见）；
  顶部细条 = 审批状态（黄待审/绿通过/红驳回/橙原文改动/灰丢失）；
  用户点击高亮或上下文段落 → 直接打开那张图的审批面板就地审批。
  所以 `--quote` 要传**真正作为图上下文的原句**，别偷懒传整段开头。
- 高亮颜色含义：黄=待审批草稿 / 绿=已审定稿 / 红=被驳回 / 橙=原文已改动待复核 / 灰=位置丢失

## 提示词要求（草图阶段就按这个标准写）

> 这些基线 craft 已内置；你手写或改 craft 的输出时仍要遵守，并按下方自审逐条过一遍。

- 视觉描述具体：模块/元素的相对大小用「大/小、高/矮」表达量级，不写编造的数字
- 科研风：白底、无阴影无渐变、扁平色块、克制色板（2-4 色）、清晰层级
- 布局意图明确：横/竖构图、阅读顺序、留白
- 全文多图用同一套风格描述（复制同一段风格前缀），保证一致性

### 出图前自审（蒸馏自平台审查规范 REVIEW）
- **不编造数字**：曲线/分组用图例名（Model A / Group 1）区分，不写用户没给的统计量、p 值、%、R²、n=、剂量；刻度/比例尺属框架允许
- **量级用视觉大小表达**：要表达"更大/更高"就画得更大更高，不靠数值标注
- **图内文字少而准**：标签稀疏、短；色盲安全配色（仅红绿区分 = 违规）
- **禁止把审查/平台协议写进提示词**：不写"省略数值""无标注"等元评论，也不把审查条款当提示词内容

## 环境自适应（用户机器千奇百怪，别拿自己的环境当默认）

你的宿主环境可能和插件作者的开发环境完全不同——**先探测，再行动**：

- **无头环境**（Codex Cloud / SSH 容器 / CI，无 GUI）：插件自动跳过托盘和开窗。
  审批全走命令行（`pf qa` → `--pass/--fail` → `pf review resolve`），预览用 `pf doc read`/`pf doc snippet`，
  出图交付**用文件路径**（`figures/<figureId>/vN.png`），别让用户"点 GUI"。
  `pf open` 仍会打印一行 GUI 地址（http://127.0.0.1:<port>/?doc=…&token=…）——无头下**忽略即可**，服务本身已在跑，AI 命令照常用。
- **耗时预期**（无头端到端，2026-09-27 实测口径，别干等也别误判失败）：
  `pf open` 首次编译 ~1-2 分钟（tectonic 要在线拉宏包；编译失败会降级文本模式，不阻塞）；
  `pf distill`/`pf craft`/`pf qa` 都是本地规则，秒级；`pf render --dry-run` 秒级；
  `pf render --model standard` ~40s/张（$0.02）；`--model premium` ~2 分钟/张（$0.15）。
  `/api/gen-result` 轮询到出图通常 1-2 分钟，前端 10 分钟 deadline——**超过 5 分钟先看 `pf inspect` 的自动体检数字和报错原文，别盲目重渲**。
- **GUI 桌面**（Windows/macOS/有显示的 Linux）：`pf open` 会自动拉起服务+开窗，
  用户可在 GUI 审批队列点通过/驳回；你的 `review resolve` 裁决在队列里对得上号。
- **端口冲突**：CLI 起不来/连不上时，`PF_PORT=17421 pf status` 整体换端口。
- **强制无头**：GUI 卡住时 `PF_HEADLESS=1 pf open` 明确跳过开窗。
- **TeX 引擎没有**：`pf open` 对 .tex 编译失败不阻塞（文本模式预览），
  需要 PDF 预览时再 `pf setup-tex`，Codex Cloud 容器里通常没必要装。
- **路径写法**：Git Bash 的 `/c/...`、Windows 的 `C:\...`、POSIX 的 `/home/...` 都能用；
  但 craft --out 建议用相对路径（当前目录下），最不容易踩环境差异。

## 每轮交付与台账（每轮结束必交，CLI 优先）

**CLI 优先**：出图、核验、审批、定稿全走 `pf` 命令（`pf next` 永远告诉你下一步）；
GUI 只留给人两件事——亲眼看图、点审批。插件的门禁与留痕都挂在 CLI 上，
走 CLI 的每一步在 `events.jsonl` 里可审计；无头环境（SSH/容器/CI）本来就全 CLI。

每轮交付在**用户工作目录**建 `promptfigure-out/`，每轮一个新版本文件夹 `vN/`（v1 → v2…）：

```
promptfigure-out/
├── vN/
│   ├── round-vN.md                ← 本轮反馈（下面的必含项）
│   └── figures/                   ← 本轮图（副本或引用，文件名带 -vN）
├── paper-with-figures.md          ← 论文+已插图的演进版（无关段落省略，每次更新同一个）
└── final/paper-final.md + 格式副本  ← 最终论文版本（定稿时才建）
```

**round-vN.md 必含**（与 promptfigure-api skill 的 deliverables-ledger.md 同一协议）：
1. **本轮清单**：每张图——figureId / 图种 / 档位 / 版本 / 本机真实路径（本插件即
   `~/.promptfigure/projects/<docId>/figures/<figureId>/vN.png`）/ 插入位置（§¶）
2. **插入位置（两段边界）**：上一段最后一句 + 「……」 + 下一段第一句，用户一眼定位
3. **所用上下文**：用了哪几段明确到 §¶；上下文只放**首句 + 「……」 + 尾句**；
   数据/表格/代码文件一律给引用链接，不内联内容
4. **图片版本**：每张图的每个版本独立文件（vN），旧版永不覆盖
5. **优化前→优化后**（优化任务）：原图路径 vs 新图路径 + 改了什么 + 所用上下文（首尾句）

**最终成稿流程**（用户说「定稿」）：提醒核对数据是否更新 → 用户确认后才 premium 定稿 →
定稿后必问矢量图（本地 AI 重绘、token 贵、速度慢；比赛/数模默认不做；确认做则按元素
分层重绘成可编辑矢量，PPT/WPS 按用户偏好）——完整协议见 promptfigure-api skill 的
`references/deliverables-ledger.md`。

## 事件回放

`~/.promptfigure/projects/<docId>/events.jsonl` 只追加不改写 —— 审批历史、
换通道记录全在里面。用户问「之前那张为什么被驳回」，读它。
