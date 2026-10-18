# 图表升级与整文批处理工作流

> 场景：用户扔来一篇论文 + 一堆已有图（多半是 MATLAB/Python/Origin 出的），要求「把图都变高级，再加几张流程图/机制图」。本文件覆盖：**① 需求分型 ② 澄清协议 ③ 两种执行模式 ④ 代码图数据溯源 ⑤ 追溯台账**。插图位定位与上下文提取见 `document-workflow.md`；PDF/WPS 格式、主动插图建议、参考论文风格库见 `proactive-upgrade.md`；**单张图的意图确认与提示词审核协议（出图前免费环节）见 `prompt-review-workflow.md`**。

---

## 0. 需求分型：先看图里的数字是不是真的

两类需求走两条完全不同的路，分错的代价是**数字造假**：

| 需求 | 判据 | 路线 |
|---|---|---|
| **A1. 结果图美化**（曲线/柱状/热图/箱线…） | 图上带**精确数值**（刻度、柱高、数据点） | 照最终结果重绘（§3）：以我们最终给出的成图为基准重绘——期刊图大多也不是 MATLAB 原生生成的；**验收 = 数值与基准一致（差不多即可）+ 比例/对应关系正确**。能拿到原始数据就优先溯源（更稳），拿不到就以最终版成图逐点核对 |
| **A2. 示意图升级**（用户已画的结构/流程/机制图，嫌丑） | 图上只有方块、箭头、标签，无数值 | AI 升级：结构照搬 + 视觉升级指令（§4.2），可选参考图 |
| **A3. 结构组合**（多张小图合并成一张大图） | 多张 A1 或 A2 要拼版 | A1 部分本地 matplotlib subplot 拼版；A2 部分合并成一个多 panel prompt（§4.1） |
| **B. 代码画不出的图**（流程图/机制图/神经网络图/算法示意） | 用户只能嘴上说 | promptFigure API（§4），本技能的主场 |

**一句话分流：数字支撑 → 本地画；结构故事 → API 画；一张图里混着两者 → 拆开，各走各的，最后拼版。**

> 🔴 **动手升级前先过成图质量标准**（`figure-quality-standard.md`，A1/A2/A3 全适用）：① 一句话写出这张图在原文里论证什么——写不出来禁止动图；② 先判体裁（结果对比图 vs 方法图），展示惯例是底线；③ 写 acceptance 四项（story / segmentation / alignment / enhancement）。优化只许走 L0/L1/L2 档位，L2 呈现增强是**声明制白名单**——❌ 超分/去噪/改内容像素一律禁止。交付前按三定义逐条自检并写进台账。

> 🔴 **每轮结束必须交付台账**：新建 `promptfigure-out/vN/round-vN.md`——本轮清单（图种/档位/版本/本机路径/插入位置）、每张图的插入位置（上段末句 + …… + 下段首句）、所用上下文（只放首尾句）、数据文件只给引用链接；「优化前 → 优化后」对比也落在这里。全文协议见 `deliverables-ledger.md`。

> 🔴 **「把终稿变成可编辑矢量/PPT 版」不属于以上任何一类**——走 `SKILL.md` **阶段 5**：终稿交付后先问用户要不要，比赛/数模默认不做（速度优先），时间充裕才做。**首选**宿主 AI 比照最终版用本地工具重绘（每元素独立对象、用图层分离工具编辑）；**退路**可描摹，但须先核对数值/比例并告知「描摹件文字不可编辑」。§3 的本地重绘 = 数据图的美化路径，不碰矢量转换。

---

## 1. 澄清协议：整文任务开工前的一轮集中反问

SKILL.md 的「零反问」铁律**约束的是对 API 的出图过程**——出图时不许停下来问参数。但整文级批量任务（用户甩来一篇文章）在**开工前允许且应该有且只有一轮集中澄清**。这一轮的作用就是替 API 把意图收敛好：用户的 Agent 澄清得越准，发给 API 的请求就越正常。

**必问 4 项**（一轮问完，之后不再问）：

| # | 问题 | 为什么必须问 | 用户没答时的推定默认 |
|---|---|---|---|
| 1 | **使用场景**：期刊投稿 / 组会 PPT / 基金标书 / 海报？ | 决定信息密度、字号、比例、档位——期刊图求克制精确，PPT 图求大字号强对比 | 期刊投稿（最保守） |
| 2 | **目标模式**：单图精修还是整文批处理？ | 决定执行流程（§2） | 整文批处理 |
| 3 | **原始材料**：已有图的生成代码 / 数据文件（.xlsx/.csv/.mat）在不在？ | A1 类图没有原始数据就只能放弃或降级处理（§3） | 不存在 → 该图按 A2 处理或明确告知做不了 |
| 4 | **定稿档位**：草稿满意后用 premium 2K 定稿？ | premium $0.15/张，批量任务先确认预算 | 草稿 standard，定稿 premium |

**单图任务不需要这轮澄清**——上下文足够就推断，信息不足用占位符（这是 SKILL.md 零反问的适用域）。

### Agent 自检：还缺什么（发给 API 前的最后闸门）

每张图提交前，Agent 对自己过一遍这个清单——**缺的要么向用户澄清（仅限第 1 轮），要么推断补全，绝不含糊提交**：

- [ ] 图种定了吗？（管线/机制/对比/框架/图形摘要，对照 `document-workflow.md` §1.5）
- [ ] 实体清单齐全吗？**专有名词原样搬运**了吗？（拼写不改）
- [ ] 关系结构（谁指向谁、分几组、哪条是 skip/反馈）写进 prompt 了吗？
- [ ] 这张图是不是 A1 真数据图？（是 → 停，走 §3，不调 API）
- [ ] ratio 和档位按场景定了吗？

---

## 2. 两种执行模式

### 2.1 单图精修模式（图少、要求高）

```
意图收敛（§1 自检清单）→ standard 出 2~3 版草稿（prompt 各有侧重：
一版忠实原结构、一版重构布局、一版换视觉方案）
→ 看图自审 + 用户挑 → 定稿方向微调 prompt → premium 2K 定稿
```

- 草稿的价值在**探索构图**，不在画质——全用 standard，别烧 premium 试错
- 定稿不是重新写 prompt：拿选中草稿的服务端润色结果（`result.prompt` 或页面对应的最终提示词）**微调**后升档，保证草稿→定稿一致

### 2.2 整文批处理模式（用户甩来一整篇）

```
① 全文扫描：已有图逐张分型（§0），插图位定位（document-workflow.md §1）
② 出 figure plan 清单给用户看：
   | 位置 | 现有图 | 分型 | 处置动作（本地重绘/AI升级/新增/不动） |
③ 集中澄清一轮（§1 必问 4 项）——合并进清单汇报里问
④ 全部走 standard 草稿（新增图 + AI 升级图），A1 图并行做数据溯源
⑤ 汇总：每张草稿 + 一句改动说明 → 用户确认/打回
⑥ 满意后逐张 premium 2K 定稿，插回文档，写台账（§5）
```

- **默认先出全部草稿**再定稿——批处理改的多，先全稿确认能避免「第 3 张改了方向、前 2 张白定稿」的返工
- 每张草稿都过视觉自查（乱码/拼写/结构与原文对不上 → 改 prompt 重出，别把垃圾递给用户）
- 批量调用遵守 RPM 限制（免费 5/min，会员更高），串行 + 退避，别并发轰炸

---

## 3. 数据图美化（照最终结果重绘）

> 本节 = **A1 数据图专用**（曲线/柱状/热图等带真数值的图）。2026-09-25 松口（原规则太死）：
> **数据图照我们最终给出的成图重绘即可**——期刊图大多也不是 MATLAB 原生生成的，只要
> **① 数值与最终版一致（差不多即可）② 比例与对应关系正确**，就达标。能拿到原始数据
> （脚本/数据文件）时优先按真数据画（更稳、更精确）；拿不到就以最终版成图为基准逐点
> 核对，核对记录写进 round-vN.md。matplotlib 只是美化手段，不是矢量转换手段——
> 「照终稿做可编辑矢量版」见 `SKILL.md` 阶段 5。

**为什么必须溯源**：结果图上的文字往往很小，视觉模型抄轴刻度、抄数据点**必然出错**；靠 OCR 抄数出来的图是假的。唯一可靠路径是找到原始数据，用真数据重绘。

### 步骤

1. **读图取线索**：轴标签、图例文字、caption 里的变量名/指标名（这些是下一 步的 grep 关键词）
2. **找生成代码**：在用户工程里搜图例字符串/函数名：
   ```bash
   grep -rn "图例文字\|legend_label\|xlabel('Loss')" --include="*.m" --include="*.py" --include="*.ipynb" .
   ```
   MATLAB 从 `.m` 脚本看 `plot()/bar()/scatter()` 的数据来源变量；Python 看 `plt.plot(x, y)` 的 x/y 从哪个文件读的
3. **顺藤摸到数据文件**：`.xlsx` / `.csv` / `.mat` / `.txt`，确认列名与图例一一对应
4. **本地重绘美化**（pandas/matplotlib）：
   - 语义化多色配色：每条曲线/每组柱子按含义定色（对照组冷色、实验组暖色、强调指标用高饱和强调色），不要默认 MATLAB 蓝
   - 色相 ≤4 + 强调色 1~2，白底，去掉无用图表垃圾（多余边框、3D 效果、双 y 轴滥用）
   - 字号按场景：期刊正文图 ≥8pt 成图尺寸，PPT 图 ≥18pt
   - 导出：期刊 300dpi+ PNG/TIFF 或 PDF/SVG 矢量；PPT 用高分辨率 PNG
5. **逐位核对**：重绘图的每个数据点与原图/原始数据核对，数值不许有任何出入
6. **找不到代码或数据** → 回到 §1 必问第 3 项，向用户要。**要不到就明确告知这张图做不了 A1 升级**，可以降级为「构图示意版」（明说数字是示意），绝不 silently 假装是原数据

---

## 4. B 类图与 A2 升级：给 API 的 prompt 构造

上下文提取总纲见 `document-workflow.md` §2（必给 3 项：图种/实体/关系结构）。本节只讲升级场景的增量。

### 4.1 结构组合（多组合一）

把 N 张小图的信息合并成一个多 panel prompt：

- **panel 清单**：每个 panel 一句「画什么 + 实体 + 内部结构」
- **布局声明**：几行几列、panel 编号（A/B/C）、公共图例放哪、箭头怎么跨 panel 连接
- **panel 布局同样受三定义约束**（`figure-quality-standard.md` §1）：同类 panel 写成同尺度（prompt 里显式写 "all panels equal size"）、共享图例/字体/配色语言；panel 之间的箭头流向必须与真实数据流一致，禁止断裂拼接
- 实体名仍**原样搬运**；ratio 选 `16:9`（横向组合）或按 panel 数定
- 实例：`"组合图，2 行 3 列六个 panel。Panel A：…；Panel B：…；panel 之间用带箭头的灰色连接线表示数据流，整体共享一个图例。"`

### 4.2 视觉升级（A2：已有示意图嫌丑）

prompt = **结构照搬** + **升级方向**，两部分都要：

- 结构照搬：原图有哪些模块、怎么连、分几组——拓扑一个都不许变（变结构=篡改用户的学术内容）
- 升级方向写具体：「扁平矢量风、白底深灰描边、模块按语义配色（输入=浅蓝、核心模块=橙红强调、输出=浅绿）、模块内配简洁图标、等宽圆角」——不要只写「变好看」
- **参考图**：有原图截图可传 `refDataUrl`（base64 ≤8MB）或 `refUrl`（公网直链）。⚠️ 参考图通道（上游 /images/edits）2026-09-07 起有 503 故障记录——批量任务开始前先用 1 张 standard 试水，失败就纯文字描述结构（prompt 写清楚就够，本管线本就擅长从文字重建结构）
- 🔴 **文字密集图（架构图/管线图，模块里带公式与小字注释）standard 档基本不可用**：2026-09-09 CVPR 论文实测，standard 出的架构图标题拼写错（"Uncertanity"）+ 多处小字乱码，直接不可交付。这类图草稿也别用 standard 省钱——乱码草稿没有参考价值，直接 premium；或把模块内小字删到只剩模块名再出 standard 草稿

### 4.3 结合论文（A2/B 共用）

从插图位前后 2-3 段提取实体与关系，不要让用户复述——详见 `document-workflow.md` §2.0/§2.1。批处理时这一步在 ② 阶段一次性做完，存进 figure plan。

---

## 4.5 工作流状态标记（硬性清单——做到哪一步，标记说了算）

升级/拼版流程不是"一口气做完汇报"，是**每完成一步就落一条标记**。状态库在本地，不在服务端（服务端只做出图 API）。宿主装有插件（有 `pf` 命令）用命令标记；纯 REST 宿主没有 pf，就维护同名的 `workflow-state.json`（字段见下），语义完全一致——缺的不是工具，是"每步必标记"这个动作。

```bash
# 开工：建立清单（upgrade = 优化已有图/整文升级）
pf workflow init --kind upgrade --goal "<目标一句话>"
pf workflow status                 # 随时看：哪几步完成、哪几步没做、哪些审查漏了 + 唯一下一步

# 每步完成（乱序会被拒；context/selfcheck 必须带 --evidence 证据）
pf workflow done context   --note "图注论点一句话" --evidence "首句：…｜尾句：…"
pf workflow done genre     --note "comparison：结果对比体裁，理由…"
pf workflow skip panels    --reason "单图无 panel 拼版"          # 仅 panels 可跳，必须给理由
pf workflow done materials --note "裁片路径…"
pf workflow done produce   --note "产物 figures/xxx.png"
pf workflow done selfcheck --note "亲眼核验结论" --evidence "尺寸/文字/对齐逐条看到的证据"

# 审查逐维记录（F=视觉对齐 G=合理分段 H=按原文思维优化；证据必填，"看起来没问题"=无效）
pf workflow review --dim F --verdict PASS --evidence "行内图块零间距、行标竖排"
pf workflow review --dim G --verdict FAIL --evidence "第二列与第三列间距不齐"   # FAIL 会打回，修完重审

# acceptance 四项留痕（enhancement 写白名单内动作+参数；没做的写"有意不做：…"
pf workflow acceptance --story "…" --segmentation "…" --alignment "…" --enhancement "对比度拉伸 1-99.5 百分位；有意不做：不超分不重绘"

# 交付硬门：缺步骤/缺审查/有 FAIL/缺 acceptance → exit 1，不许交付
pf workflow check
```

`workflow-state.json`（无 pf 宿主的等价物）字段与 `pf workflow status` 输出对齐：

```json
{
  "kind": "upgrade", "goal": "…",
  "steps": [ { "id": "context", "status": "done|skipped|pending", "note": "…", "evidence": "…", "at": "ISO时间" } ],
  "reviews": [ { "dim": "F", "verdict": "PASS", "evidence": "…" } ],
  "acceptance": { "story": "…", "segmentation": "…", "alignment": "…", "enhancement": "…" }
}
```

规则（两条通道通用）：

- **步骤固定 9 步、按序推进**：context → genre → panels(可跳) → materials → produce → selfcheck → review(F/G/H) → acceptance → deliver
- **证据先于标记**：context/selfcheck/review 没有 evidence 就不许标 done——"读过""看过"要拿出能复查的证据
- **FAIL 打回**：任何审查维判 FAIL，修完重审到 PASS 才算过；带 FAIL 交付 = check 不过
- **交付前 check 必须全绿**（exit 0）；无 pf 宿主就把状态文件里 `pending` 项逐条列在汇报里——清单未清 = 不许交付
- **报错不许绕，更不许删档重来**（状态库的三类报错各有恢复路径，照做，别自己发明）：
  - 「工作流状态文件损坏」→ 原档已自动备份成 `workflow.json.bak-*`。**先读备份确认做到哪一步**，再决定 `pf workflow init --kind upgrade --reset` 重建（清单归零、备份留档）还是手工补记；不许删项目目录
  - 「与当前模板不匹配」→ 旧版插件留下或模板升级过，同上，用 `--reset` 重建；不要手工编辑 `workflow.json`
  - 「写锁被占用超时」→ 等 1 秒原命令重试即可（持有者退出后锁自动失效，空锁/死进程锁会自愈）；反复出现才手动删 `.pf-write.lock`，且只在确认没有 pf 进程在跑时删
  - 🔴 **最要命的一条**：任何报错都**不许**理解成"这步没做过"然后重跑一遍流程——那是二次出图、白烧额度。报错 = 先 `pf workflow status` 看真实进度，再决定补哪一步

---

## 5. 追溯台账：figure-ledger.json

用户问「哪一次生图做了什么、想退回哪一版」——在**工程根目录**维护一个 JSON 台账，只追加、不覆盖、随工程进 git。本地文件即可，不需要服务端建表：轻量、随项目走、git 天然版本化。

```json
{
  "project": "osti-rsr-paper",
  "created": "2026-09-09",
  "entries": [
    {
      "id": "fig3",
      "ts": "2026-09-09T21:40:00+08:00",
      "scene": "journal",
      "source": {
        "file": "sections/methods.tex",
        "locator": "L142-156 (\\ref{fig:pipeline})",
        "quote": "编码器提取特征后经跨尺度融合模块送入解码器"
      },
      "action": "new",                    // new | upgrade | combine | restyle
      "prompt": "提交给 API 的原始意图",
      "prompt_final": "服务端润色后的最终提示词（result.prompt）",
      "tier": "standard",                  // 草稿 standard / 定稿 premium
      "asset": "figures/drafts/fig3-v1.png",
      "status": "draft",                   // draft | final | superseded
      "note": "构图偏挤，v2 把 skip 连接移到 panel 下沿"
    },
    {
      "id": "fig3",
      "ts": "2026-09-09T22:10:00+08:00",
      "prompt_final": "…（v2 微调后）",
      "tier": "premium",
      "asset": "figures/fig3.png",
      "status": "final",
      "note": "v1 定稿打回后重出"
    }
  ]
}
```

**升级 / 拼版 / restyle 类 entry 追加 `acceptance` 字段**（成图质量标准的前置产物，缺 = 交付不完整）：

```json
{
  "id": "fig5-composite",
  "action": "combine",
  "acceptance": {
    "story": "读者该记住的一句话",
    "segmentation": "区块怎么分的、论据块如何与流程块区分",
    "alignment": "谁和谁同尺度、共享什么网格",
    "enhancement": ["白名单内增强 + 参数，如 1-99.5 百分位拉伸；没做写空数组"]
  }
}
```

规则：

- 同一图 id 的每次生成（草稿、打回、定稿）都是**新 entry**，旧 entry 状态改 `superseded`——历史永远可回溯
- **升级 / 拼版 / restyle 类 entry 必须带 `acceptance`**（story/segmentation/alignment/enhancement 四项，见上方模板）；enhancement 里有白名单外动作（超分/去噪/改内容像素）= 不许交付
- `source.locator` 写到能一键跳回的粒度（文件 + 行号/段落号）
- `prompt_final` 必须存：它是「草稿→定稿」一致性的锚点，也是用户日后手动微调的起点
- 每轮批处理结束，把台账路径 + entry 摘要报给用户

**两类 entry 模板要区分**（`action` 字段决定）：

- **AI 生成**（`action`: new/upgrade/combine）：有 `prompt` / `prompt_final` / `tier`。⚠️ `/api/v1/generate` 的响应**不含润色后的 prompt**（`prompt_final` 只有网页异步流程 `/api/gen-result` 才返回）——纯 API 用户在 entry 里存 `prompt`（自己提交的意图）+ `crafted: true/false` 即可，`prompt_final` 字段留空并注明 `via: "api"`；走 §2.1 网页异步流程的才填 `prompt_final`
- **数据图重绘**（`action`: restyle）：不写 prompt 字段，改写 `data_source`（生成脚本路径或数据文件路径）+ `verification`（核对项数与结果，如 "27 checks, 0 mismatch"）+ `style`（配色/字号要点）。真数据图没有 prompt，别硬套 AI 模板

### 402 余额场景处置（批处理必读）

迭代重试会连续扣费——**开工前先查余额**（控制台 `#account-balance`，API 的 `balance` 字段滞后不可信），预估「张数 × 单价 + 至少 2 次重试余量」。跑到一半 402 时：不扣费、任务中断，如实告知用户余额耗尽、请用户充值后继续——**已完成的图不回滚**，台账里记清中断位置，续跑从断点开始。

---

## 6. 完整流程清单（整文批处理）

1. 扫描全文 → 已有图分型（§0）+ 插图位定位（`document-workflow.md` §1）
2. figure plan 清单 + 集中澄清一轮（§1 必问 4 项）→ 用户确认处置方案
3. **建工作流清单**（§4.5：`pf workflow init --kind upgrade` 或 `workflow-state.json`）——之后每步完成即标记
4. A1 图：数据溯源 + 本地重绘（§3）；A2/B 图：构造 prompt（§4）
5. 全部 standard 草稿 → 视觉自查 → 汇总给用户
6. 用户确认 → 逐张 premium 2K 定稿 → 插回文档（`document-workflow.md` §3）
7. 写台账（§5）→ **工作流 check 全绿**（§4.5：`pf workflow check` exit 0）→ 汇报：位置 → 图文件 → 版本 → 台账路径，提示图号/交叉引用需最终复核
