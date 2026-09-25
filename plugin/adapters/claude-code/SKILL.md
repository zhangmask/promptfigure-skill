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
6. **图内带文字的图，定稿必须 premium**：standard 档渲图内英文必出乱码（实测），别用 standard 交付带文字的图。
7. **报告完成前自己看图**：有视觉能力就用 Read/看图工具打开图文件（`pf qa-list <figureId>` 直接给路径），
   亲眼确认质量，别只看命令成功。
8. **全文优化 = 全做或全不做**：论文是同一套视觉语言 —— 只重绘一两张、其余保留原图，放在一起画风割裂
   （用户实测反馈，重罪）。要优化就先 `pf doc figures` 列出全部原图，`pf style set` 定统一风格卡，
   然后逐张 craft+render 全部覆盖；风格卡一次设置，之后每张 craft 自动带上，**禁止每张图自配风格**。
9. **数值精确的结果图不许 AI 重画**：柱/线/热图等要保留精确数值的（AI 重画数字必错），
   引导用户改绘图脚本样式（配色/字体/线宽）—— 改脚本同样要全文统一，只改一个脚本的色板照样割裂。
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
   🔴 **卡面文字纪律（V11 事故）**：要点必须写成 ≤5 词短标签或 show 开头的画法句——
   **完整句子当要点 = 被原样印进卡面**（"connected components merge by…"就这样上了图）。
   说明性内容永远放 show 句里描述画法，不进卡面；craft 现在会对句子型要点打 ⚠️。
12. **画布比单一来源，禁止手写比例**（2026-09-21 V10 事故：提示词写死 16:5、实际渲染 16:9 →
   内容被横向压缩）：比例永远由 `craft --ratio 宽:高` 拼进提示词（缺省按预设 double-column/slide=16:9、
   single-column=3:4），`--out` 会写 `<同名>.craft.json` 伴随文件，`render --prompt-file` 自动继承
   同一比例 —— 你**不需要也不应该**在 render 手动传 --ratio（传了还要与 craft 一致，否则告警）。
   提示词里出现任何手写的 "16:5 / roughly aspect" 字样 = 上一个版本的产物，丢弃重 craft。
13. **多轮精修循环，出图 ≠ 完工**（2026-09-21 定规，本地 AI 的核心优势）：
   出图后亲眼严审（全文字清单逐条对照 + 留白/杂点/色相逐项），**任何 FAIL 或存疑 = 不送审不通过**，
   `pf qa <figureId> --fail --note "缺陷1; 缺陷2"` 会把缺陷**自动**写进精修状态机并重拼下一轮 craft
   命令（与 `pf refine` 同一状态），循环到零存疑才 `pf qa <figureId> --pass`。
   🔴 **fixes 沉淀规则**：被下一版验证遵守的 fix 要"沉淀"——把约束直接写进 --stages 措辞、
   从 --fixes 里删掉。fixes 只留当前活跃缺陷：提示词总长上限约 8000 字节，超限 craft/render
   都会直接拒绝（V18 实测：7611 能过、8205 爆）。修正轮出 premium 用 `render --force "修正轮: 理由"` 豁免门禁
   （--force 建议带一句话理由；忘了带也放行，审计记"(未给理由)"，pf audit 可查）。
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
   抽象母题要写死 "plain abstract … (NOT photographs)"；图上文字只许清单内标签
   （NEGATIVE_LIST 已全局约束，图模型自加 bullet/箭头词 = Q2/Q4 违规）。

## 环境自检（遇到问题先跑 pf doctor）

```bash
pf doctor                # 体检：TeX 引擎 / API key / 本地服务 / 当前文档健康（块数·图数·PNG 丢失）
pf audit                 # 审计一键可查：绕门记录（craft.forced/gate_bypass/review.forced）+ 计费兜底
                         #   每条带理由；接手别人项目/怀疑历史版本可信度时先跑它
pf export svg <figId>    # 最新版 PNG → 可缩放 SVG（vtracer 描摹，draft/high 两档）
                         #   ⚠️ 描摹 ≠ 可编辑矢量：文字全变路径，不可编辑不可搜索
                         #   要「每个元素都能改」的可编辑矢量版（PPT 形状/独立 SVG 元素），
                         #   让宿主 AI 用本地工具照终稿重绘（如 python-pptx/结构化 SVG，
                         #   参考 github.com/icebird1998/scientific-illustifier）——禁止拿本命令的输出顶替
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
                                      #   实体/结构只准从它的输出来；跳过它直接编内容 = 编造图
                                      #   任何语言都支持（Unicode script 统计抽取：中文/日/韩/泰走 n-gram，
                                      #   拉丁/西里尔/希腊/阿拉伯走大写术语+高频词，2026-09-22）——候选是统计性的，
                                      #   每个都要回原文核对出处再用
                                      #   输出末尾带【用户确认卡】——craft/render 花钱前先转给用户确认（用用户的语言）

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
`pf status`（看当前文档）→ 没开过就 `pf open <论文>` → `pf doc outline`（定位内容用 `pf doc search <关键词>`，找数值用 `pf doc data`）→ `pf distill --at "§x.x ¶y"`（从原文抽实体/阶段素材，末尾确认卡转给用户）→ `pf craft --at "§x.x ¶y"`（被拒就照改法示范 ❌/✅ 改命令）→ `pf render` → **`pf qa <figureId>` + 亲眼读图核验 → `--pass` 写回 / `--fail` 写回（缺陷自动进精修循环）** → 核验通过后 premium 定稿 → `pf review status`。
- **小白用户/用户说不清需求**：先 `pf plan --goal "<用户原话>"` —— 问题卡（真实章节选项）发给用户等答复，再按步骤执行；用户答复有变就重跑 plan
- 所有命令**不带 `--doc` 时自动作用于最近打开的文档**；要跨文档操作才加 `--doc <docId>`
- `craft --out` 建议用**绝对路径**（相对路径会落在你的当前工作目录，容易找不到）
- `pf doctor` 的 "API key: 已配置" 只说明 key 存在，**不代表有效**；render 报 `invalid_api_key` 就执行 `pf login <pf_key>`（key 在 promptfigure.top 控制台建）
- 出图失败先看报错原文再决定动作，不要盲目重试同一命令

## 图型选型（画之前先想清楚"画什么图"）

平台能画 12 种图型，每种有明确的适用场景。**不要默认都画流程图** —— 图型选错，画得再好也传达不了内容：

```bash
pf types                    # 13 种图型目录 + 选型决策速查（拿到内容先过一遍；含 multi-panel 期刊组合图）
pf types show pipeline      # 某图型的：什么时候用 / 构图思考 / 完整示例
pf examples                 # 全部图型的现成示例命令（照抄结构、换成你论文的实体）
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
- **GUI 桌面**（Windows/macOS/有显示的 Linux）：`pf open` 会自动拉起服务+开窗，
  用户可在 GUI 审批队列点通过/驳回；你的 `review resolve` 裁决在队列里对得上号。
- **端口冲突**：CLI 起不来/连不上时，`PF_PORT=17421 pf status` 整体换端口。
- **强制无头**：GUI 卡住时 `PF_HEADLESS=1 pf open` 明确跳过开窗。
- **TeX 引擎没有**：`pf open` 对 .tex 编译失败不阻塞（文本模式预览），
  需要 PDF 预览时再 `pf setup-tex`，Codex Cloud 容器里通常没必要装。
- **路径写法**：Git Bash 的 `/c/...`、Windows 的 `C:\...`、POSIX 的 `/home/...` 都能用；
  但 craft --out 建议用相对路径（当前目录下），最不容易踩环境差异。

## 事件回放

`~/.promptfigure/projects/<docId>/events.jsonl` 只追加不改写 —— 审批历史、
换通道记录全在里面。用户问「之前那张为什么被驳回」，读它。
