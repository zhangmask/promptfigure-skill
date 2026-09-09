# 文档插图工作流：在论文/报告里找到出图位置并生成配图

> 场景：用户给你一篇 `.tex` / `.docx` / `.md` 文稿，要求「把该配图的地方配上图」。本文件教你 **① 定位哪里该出图 ② 从上下文写出正确 prompt ③ 把图插回文档**。
>
> 批量升级已有图（结果图溯源重绘/示意图 AI 升级/整文批处理/追溯台账）见 `figure-upgrade-workflow.md`。

---

## 0. 调研背景（2026-09-09，为什么不造轮子）

调研了 GitHub 上的现成方案，**没有一个开源项目完整做到「读文档 → 定插图位 → 调外部生图 API → 插回文档」**。最接近的：

| 项目                                                                                 | 做了什么                                                                                             | 对本技能的启示                                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| [paperfigg](https://github.com/oluwafemidiakhoa/paperfigg)（PyPI `paperfigg`，v0.4+） | 论文(PDF/MD) → agentic 规划→生成→审查 → 出图 + **LaTeX include snippet + caption + 图元素到原文 span 的溯源映射**     | 借鉴它的 **figure plan**（先列图清单再逐张生成）和 **caption 从原文生成** 思路；但它用自家生成器，不接外部 API |
| [scitex-writer](https://github.com/SciTeX-AI/scitex-writer)                        | LaTeX 稿件管理 MCP server（`figures add fig01 plot.png "Caption"` 等 44 工具），管插图/编译不管生成                 | 插回 LaTeX 的命令式做法可参考；需要完整稿件工程，太重                                           |
| [DeTikZify](https://github.com/potamides/DeTikZify)（NeurIPS 2024 spotlight）        | 多模态模型把草图/已有图/文本 caption 合成 TikZ 矢量图                                                              | 「caption→图」方向的学术标杆；要本地 GPU + TeX Live，不适合直接集成                            |
| [paper-figure（kitcaf）](https://github.com/kitcaf/skills)、AutoResearchClaw、ARIS 等   | 数据图（matplotlib 级）+ `PAPER_PLAN.md` 图规划；**明确承认架构图/机制图自动生成质量不行**                                   | 数据图走本地脚本更省；**概念图/机制图/管线图正是 promptFigure 的强项**——两者互补不冲突                   |
| docx 侧                                                                             | 只有 python-docx 机械插图的 skill（如 `vamseeachanta/workspace-hub` 的 image-insertion），**「哪里该插图」的决策完全空白** | 定位逻辑由本文件 §1 提供                                                           |

结论：位置决策 + prompt 构造按本文件执行；不做通用工具，让 AI 现场判断。

---

## 1. 定位：哪里该出图

### LaTeX（.tex）

按优先级扫描这些信号（`grep -n` 即可）：

还有一种情况是，用户很大可能用的不是 LaTeX，而是 PDF、WPS 或其他 Word 格式的文件。针对这种情况，可以从以下两个方面入手：

1. 优化已有插图：  
   如果用户已经生成了一张图，你可以对其原始的代码结果进行优化。
2. 建议插图位置：  
   用户可能不知道哪里能插图，但有些地方其实比较适合。例如在数学建模文章中：  
   (a) 文章引入部分：刚好可以用来介绍后续各个部分的逻辑关系。  
   (b) 文章内部：是否可以增加一些插图，或者是偏文科的那种事例、示意图？此外，其他部分是不是也可以做一些优化？比如生成一些比较高级的 AI 图：
3. 原始数据分析：从原始数据入手，直接让对方的 Agent 进行分析。
4. 图像需求推演：由对方的 Agent 根据自身数据和意图，推断出在相应位置大概需要什么样的图、生成什么样的形式。
5. 提示词生成与绘图：利用我们的 skills，通过完整的判断生成高质量的提示词，再交给我们的 API 生成模型进行绘图。
6. 迭代优化：我们的 skills 要尽可能激发对方 Agent 不断地去检查和优化，并且立足于他自己的论文、论文数据以及之前做出来的图。
7.

| 信号                                                                              | 含义          | 动作                      |
| ------------------------------------------------------------------------------- | ----------- | ----------------------- |
| `\begin{figure}...\end{figure}` 空壳或缺 `includegraphics`                          | 作者留了图位      | **必插**                  |
| `% TODO: figure` / `%% FIGURE HERE` 类注释                                         | 明确占位        | **必插**                  |
| 正文有 `如图~\ref{fig:xxx}` / `as shown in Figure~\ref{...}` 但 `\label{fig:xxx}` 不存在 | 引用了不存在的图    | **必插**（label 用引用处的 key） |
| 无任何图引用                                                                          | 需要判断要不要建议插图 | 见下方「章节启发式」              |

**章节启发式**（无显式占位时，按科研论文惯例推荐插图位）：

- **引言/摘要末** → 图形摘要（graphical abstract）或 teaser 总览图，1 张，覆盖全文核心流程
- **方法/模型章节** → 架构图、管线图、机制示意图（每小节最多 1 张，总 ≤3）
- **实验设置** → 数据集/实验流程示意（可选）
- **结果分析** → **数据图优先用本地 matplotlib/Excel 出**（paper-figure 类工具已覆盖），只有「对比关系示意」这类概念图才值得用本 API

### 1.5 判定标准：这段文字配不配得上一张图

占位符信号（必插）之外，无占位段落**只有 4 类正当理由**该配图——图的唯一使命是承载文字承载不了的信息：

| 类型       | 文字判据                                  | 典型图              |
| -------- | ------------------------------------- | ---------------- |
| **结构拓扑** | 段内 ≥3 个实体 + 方向/连接词（送入、融合、拼接、输出、反馈、级联） | 管线/架构/流程图        |
| **空间形态** | 在描述「长什么样、在哪、怎么连」而非「为什么」               | 通路位置、几何/布局示意     |
| **概念对比** | 多组对象的**定性**差异（不含精确数值）                 | 方法 A vs B 流程差异示意 |
| **全文压缩** | 读者需 30 秒理解全文                          | 图形摘要 / teaser    |

口诀：**三个实体手拉手、文字读三遍才拼出结构 → 画；数字支撑 → 本地画；都没占 → 不画。**

反向排除（不该加图）：

- ❌ **带精确数值的结果图**（曲线、柱状、热图）→ 一律本地 matplotlib——AI 生图必画错数字，坐标数据必须是真数据
- ❌ 1-2 个实体、一句话说得清的关系 → 凑数
- ❌ 定义/假设/证明类纯逻辑段 → 装饰
- ❌ 该信息已有别的图覆盖 → 重复

### Word（.docx）

```python
from docx import Document
doc = Document("paper.docx")
for i, p in enumerate(doc.paragraphs):
    t = p.text
    if any(k in t for k in ("如图", "见图", "如上图", "如下图", "Figure", "Fig.", "图X", "【图")):
        print(i, p.style.name, t[:80])
```

- 命中「如图 X 所示 / Figure X」且附近无图片段落 → 该处插入
- 中文论文常写「（此处插入图 X）」或用「图 X」独立行占位 → 直接替换
- 结构启发式同 LaTeX：「方法」章 → 机制图；「摘要」后 → 图形摘要

### Markdown

`![placeholder]`、\`\`、`**[图 X]**` 等占位，逻辑同上。

---

## 2. prompt 怎么写：从上下文提取，不凭空编

**铁律不变（见 SKILL.md）**：说清「图种 + 实体 + 结构」即可，扩写交给服务端润色。关键是从文档里**提取真实实体**，而不是写通用模板句。

### 2.0 给 API 的上下文清单（最小充分集 3 项 + 建议集 4 项）

API 的润色层需要的是**意图**，不是成稿 prompt。一次性提交按此清单收敛（零反问）：

**必给 3 项（缺一图必歪）：**

| # | 项                                            | 来源          | 没有时                        |
| - | -------------------------------------------- | ----------- | -------------------------- |
| 1 | **图种**：管线 / 机制 / 对比 / 框架 / 图形摘要              | §1.5 判定类型   | 从段落动词推断（「送入/融合」→管线）        |
| 2 | **实体清单**：方法名、模块名**原样搬运**（拼写不改），实体数 ≈ panel 数 | 插图位前后 2-3 段 | 占位符（`Module A / Module B`） |
| 3 | **关系结构**：谁指向谁、分几组、左右/上下、哪条是 skip/反馈/级联       | 段内方向词       | 默认从左到右单向流                  |

**建议给 4 项（有推定默认，给了更准）：**

| # | 项                                               | 推定规则（不给时）              |
| - | ----------------------------------------------- | ---------------------- |
| 4 | 视觉角色：哪个模块是核心贡献（强调色）                             | 章节主题词 ≈ 核心模块           |
| 5 | caption 一句话（润色层的锚点）                             | 从插图位段落首句压缩             |
| 6 | 版面 ratio：单栏 `3:2`/`1:1`，跨栏（`figure*`）/全宽 `16:9` | 按 LaTeX 单双栏或 Word 页宽推  |
| 7 | 档位：投稿/对外展示 `premium`，工作稿/草稿迭代 `standard`        | 看文稿状态（预印本/投稿版→premium） |

**上下文取材优先级**：插图位前后 2-3 段 > 章节标题层级 > 全文摘要 > 用户口头描述。够不到的用占位符，不反问。

### 2.1 提取步骤

1. **读插图位前后各 2-3 段**，提取：方法/模块名（原样保留拼写，如 ResTiNet、GPX4）、模块间数据流方向、对比对象、关键数值/指标名
2. **定图种**（对照 `prompt-cookbook.md` 的五类模板）：流程/管线 → pipeline 模板；机制/通路 → mechanism 模板；多方法对比 → comparison 模板；技术路线 → framework 模板
3. **prompt 里写清楚 caption 承担不了的信息**：图不重复正文文字，要补「结构」——谁指向谁、分几组、左还是右
4. **比例按版面定**：LaTeX 单栏图 `3:2` 或 `1:1`；跨栏/双栏跨度（`figure*`）用 `16:9`；Word 全宽 `16:9`，半宽 `3:2`
5. 图形摘要/teaser → `premium` 档（对外展示，见 SKILL.md 档位表）；方法章节工作稿 → `standard`

**一个从上下文到 prompt 的实例**（方法章写道「编码器提取特征后经跨尺度融合模块送入解码器，并与低层细节特征拼接」）：

```json
{"prompt": "论文方法章配图：模型整体管线图。三个模块从左到右：Encoder（提取特征）→ Cross-scale Fusion Module（跨尺度融合，含来自低层的 skip 连接拼接）→ Decoder（输出预测）。用箭头标注数据流，模块名按英文原样标注 Encoder / Cross-scale Fusion / Decoder。扁平矢量风，白底。", "model": "standard", "ratio": "16:9"}
```

要点：模块名**原样搬运自文档**（不翻译不改写）、数据流方向照正文、结构（skip 拼接）显式写出。

---

## 3. 插回文档

### LaTeX

```latex
\begin{figure}[t]
  \centering
  \includegraphics[width=\linewidth]{figures/pipeline.png}
  \caption{Overall architecture of the proposed method.（从对应段落一句概括，照 paperfigg 的做法 caption 承担「图在说什么」，不重复正文）}
  \label{fig:pipeline}   % 若正文已用 \ref{fig:xxx} 引用，label 必须用同一个 key
\end{figure}
```

- 保存图到 `figures/`（与 `\graphicspath` 一致）；PNG 直接可用
- 位置参数：方法章机制图用 `[t]`（页顶），紧跟首次引用段落之后声明

### Word（.docx，python-docx）

```python
from docx import Document
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document("paper.docx")
target = doc.paragraphs[12]            # §1 定位到的「如图 X 所示」段落

# 图片段：插在 target 之前
img_p = target.insert_paragraph_before()
img_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
img_p.add_run().add_picture("pipeline.png", width=Inches(5.5))  # 全宽约 5.5-6.0in

# 图注段：再插一次，正好落在图片之后、原文段落之前
cap_p = target.insert_paragraph_before()
cap_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = cap_p.add_run("图 1：模型整体管线示意")
r.italic = True
r.font.size = Pt(10)

doc.save("paper.docx")
```

（图注惯例：图片下方居中，「图 1：说明」，10pt 斜体；插图后全文图号需人工复核顺延。）

### Markdown

```markdown
![模型整体管线图](figures/pipeline.png)
*图 1：Encoder → Cross-scale Fusion → Decoder 的数据流。*
```

---

## 4. 完整流程清单

1. 扫描文档 → 按 §1 列出**figure plan**（位置 + 每张的图种 + 从上下文提取的实体）——先给用户看清单再批量出图（这一步可以问，出图不问）
2. 逐张构造 prompt（§2）→ 调 `/api/v1/generate` → base64 存 PNG
3. **打开图片自查**（AI 有视觉能力就看一眼：文字乱码/实体拼写/结构对不对得上原文），不对就改 prompt 重出
4. 按版式插回（§3）+ 生成 caption
5. 汇报：每张图的「文档位置 → 图文件 → caption」对照表，提示用户全文图号/交叉引用需最终编译或人工复核
