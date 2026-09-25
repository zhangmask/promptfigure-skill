# 提示词质量三组对比评测报告

- 模式：**dry-run**
- 时间：2026-09-21T10:33:24.269Z
- fixture 数：8（共 24 张图计划）
- API key：pf_gweBO…
- 净化来源：src/craft.mjs
- 总预估费用（standard ≈ $0.02/张）：$0.48（仅 --run --yes 才真实发生）

## 执行计划表（每组 × 每条）

| fixture | 组 | polish | 档位 | 端点 | 预估 |
|---|---|---|---|---|---|
| detection-flow | 组1 server | polish:true | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| detection-flow | 组2 bare | polish:false | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| detection-flow | 组3 guarded | polish:false | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| signaling-pathway | 组1 server | polish:true | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| signaling-pathway | 组2 bare | polish:false | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| signaling-pathway | 组3 guarded | polish:false | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| climate-concept | 组1 server | polish:true | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| climate-concept | 组2 bare | polish:false | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| climate-concept | 组3 guarded | polish:false | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| cell-labeled | 组1 server | polish:true | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| cell-labeled | 组2 bare | polish:false | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| cell-labeled | 组3 guarded | polish:false | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| abstract-geometry | 组1 server | polish:true | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| abstract-geometry | 组2 bare | polish:false | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| abstract-geometry | 组3 guarded | polish:false | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| pipeline-flow | 组1 server | polish:true | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| pipeline-flow | 组2 bare | polish:false | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| pipeline-flow | 组3 guarded | polish:false | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| enzyme-mechanism | 组1 server | polish:true | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| enzyme-mechanism | 组2 bare | polish:false | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| enzyme-mechanism | 组3 guarded | polish:false | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| network-concept | 组1 server | polish:true | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| network-concept | 组2 bare | polish:false | standard | https://promptfigure.top/api/v1/generate | $0.02 |
| network-concept | 组3 guarded | polish:false | standard | https://promptfigure.top/api/v1/generate | $0.02 |

## 三组实际发送提示词预览

### detection-flow — 流程图·两阶段轨道缺陷检测框架
**组1 server（粗稿 = promptBare）**
```
Let me describe a figure for you. A clean academic flowchart of a two-stage track defect detection framework: stage 1 image preprocessing and data augmentation, stage 2 vision transformer classification. White background, thin blue boxes, black arrows, minimal flat style, no watermark.
```
**组2 bare（裸写直出）**
```
Let me describe a figure for you. A clean academic flowchart of a two-stage track defect detection framework: stage 1 image preprocessing and data augmentation, stage 2 vision transformer classification. White background, thin blue boxes, black arrows, minimal flat style, no watermark.
```
**组3 guarded（净化后实际发送）**
```
Let me describe a figure for you. A clean academic flowchart of a two-stage track defect detection framework: stage 1 image preprocessing and data augmentation, stage 2 vision transformer classification. White background, thin blue boxes, black arrows, minimal flat style, no watermark.
```
**净化：guard 未触发（bare 与 guarded 一致）**

### signaling-pathway — 机理图·细胞信号转导通路
**组1 server（粗稿 = promptBare）**
```
I think a good diagram would show: a biological mechanism illustration of the EGFR signaling pathway, receptor dimerization triggering downstream Ras-Raf-MEK-ERK cascade, cartoon-style cells, soft pastel colors, labeled arrows, white background.
```
**组2 bare（裸写直出）**
```
I think a good diagram would show: a biological mechanism illustration of the EGFR signaling pathway, receptor dimerization triggering downstream Ras-Raf-MEK-ERK cascade, cartoon-style cells, soft pastel colors, labeled arrows, white background.
```
**组3 guarded（净化后实际发送）**
```
I think a good diagram would show: a biological mechanism illustration of the EGFR signaling pathway, receptor dimerization triggering downstream Ras-Raf-MEK-ERK cascade, cartoon-style cells, soft pastel colors, labeled arrows, white background.
```
**净化：guard 未触发（bare 与 guarded 一致）**

### climate-concept — 概念图·多因素气候影响关系（含 hex 色值 + 混入中文 + 数值免责句，专测 guard）
**组1 server（粗稿 = promptBare）**
```
A concept map linking greenhouse gas emissions, ocean warming, ice sheet melt, and sea level rise, with connecting arrows and brief node labels, academic infographic style, light gray background. Use color #1e90ff for the warming branch. 不要编造具体数字 no fabricated numbers, values are omitted.
```
**组2 bare（裸写直出）**
```
A concept map linking greenhouse gas emissions, ocean warming, ice sheet melt, and sea level rise, with connecting arrows and brief node labels, academic infographic style, light gray background. Use color #1e90ff for the warming branch. 不要编造具体数字 no fabricated numbers, values are omitted.
```
**组3 guarded（净化后实际发送）**
```
A concept map linking greenhouse gas emissions, ocean warming, ice sheet melt, and sea level rise, with connecting arrows, and brief node labels, academic infographic style, light gray background.
```
**净化改动（被删/改的片段）：**
> arrows Use color #1e90ff for the warming branch. 不要编造具体数字 no fabricated numbers, values are omitted.

### cell-labeled — 带文字标签·植物细胞结构标注（含数值免责句，专测 guard）
**组1 server（粗稿 = promptBare）**
```
Here is a labeled diagram of a plant cell: cell wall, vacuole, chloroplast, nucleus, mitochondria, each with clear text callouts and leader lines, textbook illustration style, white background, legible labels. Note: no specific numeric values are printed; values are omitted.
```
**组2 bare（裸写直出）**
```
Here is a labeled diagram of a plant cell: cell wall, vacuole, chloroplast, nucleus, mitochondria, each with clear text callouts and leader lines, textbook illustration style, white background, legible labels. Note: no specific numeric values are printed; values are omitted.
```
**组3 guarded（净化后实际发送）**
```
Here is a labeled diagram of a plant cell: cell wall, vacuole, chloroplast, nucleus, mitochondria, each with clear text callouts, and leader lines, textbook illustration style, white background, legible labels.
```
**净化改动（被删/改的片段）：**
> callouts Note: no specific numeric values are printed; values are omitted.

### abstract-geometry — 纯图形无文字·抽象几何构成（纯图形，guard 不应触发）
**组1 server（粗稿 = promptBare）**
```
An abstract composition of overlapping translucent geometric shapes — circles, triangles, rectangles — in a muted academic palette, balanced asymmetric layout, no text, no labels, white background.
```
**组2 bare（裸写直出）**
```
An abstract composition of overlapping translucent geometric shapes — circles, triangles, rectangles — in a muted academic palette, balanced asymmetric layout, no text, no labels, white background.
```
**组3 guarded（净化后实际发送）**
```
An abstract composition of overlapping translucent geometric shapes — circles, triangles, rectangles — in a muted academic palette, balanced asymmetric layout, no text, no labels, white background.
```
**净化：guard 未触发（bare 与 guarded 一致）**

### pipeline-flow — 流程图·数据清洗管线
**组1 server（粗稿 = promptBare）**
```
To generate this: a horizontal pipeline flowchart for data cleaning: ingest → deduplicate → impute → normalize → validate, rounded rectangles connected by arrows, monochrome blue, minimal, gridless, no watermark.
```
**组2 bare（裸写直出）**
```
To generate this: a horizontal pipeline flowchart for data cleaning: ingest → deduplicate → impute → normalize → validate, rounded rectangles connected by arrows, monochrome blue, minimal, gridless, no watermark.
```
**组3 guarded（净化后实际发送）**
```
To generate this: a horizontal pipeline flowchart for data cleaning: ingest → deduplicate → impute → normalize → validate, rounded rectangles connected by arrows, monochrome blue, minimal, gridless, no watermark.
```
**净化：guard 未触发（bare 与 guarded 一致）**

### enzyme-mechanism — 机理图·酶催化反应机理（含 hex 色值，专测 guard）
**组1 server（粗稿 = promptBare）**
```
A mechanism illustration of enzyme-substrate catalysis: active site binding, transition state, product release, shown as a cyclic cartoon with curved arrows, soft gradient fills #ffd700, scientific journal style, white background.
```
**组2 bare（裸写直出）**
```
A mechanism illustration of enzyme-substrate catalysis: active site binding, transition state, product release, shown as a cyclic cartoon with curved arrows, soft gradient fills #ffd700, scientific journal style, white background.
```
**组3 guarded（净化后实际发送）**
```
A mechanism illustration of enzyme-substrate catalysis: active site binding, transition state, product release, shown as a cyclic cartoon with curved arrows, soft gradient fills yellow, scientific journal style, white background.
```
**净化改动（被删/改的片段）：**
> #ffd700,

### network-concept — 概念图·神经网络层级概念（含混入中文，专测 guard）
**组1 server（粗稿 = promptBare）**
```
A concept network of a neural network: input layer, hidden layers, output layer as nodes, weights as connecting lines, with small captions, blueprint style on light blue background, thin lines, 无装饰文字 no decorative text.
```
**组2 bare（裸写直出）**
```
A concept network of a neural network: input layer, hidden layers, output layer as nodes, weights as connecting lines, with small captions, blueprint style on light blue background, thin lines, 无装饰文字 no decorative text.
```
**组3 guarded（净化后实际发送）**
```
A concept network of a neural network: input layer, hidden layers, output layer as nodes, weights as connecting lines, with small captions, blueprint style on light blue background, thin lines, no decorative text.
```
**净化改动（被删/改的片段）：**
> 无装饰文字


## 结果对照表

| 名称 | 组 | 通道 | 耗时 | 产物路径 | 备注 |
|---|---|---|---|---|---|
| detection-flow | 组1 server | - | - | （dry-run 未出图） | 服务端完整管线润色（粗稿→润色） |
| detection-flow | 组2 bare | - | - | （dry-run 未出图） | 本地 AI 裸写直出 |
| detection-flow | 组3 guarded | - | - | （dry-run 未出图） | 本地净化后直出（src/craft.mjs） |
| signaling-pathway | 组1 server | - | - | （dry-run 未出图） | 服务端完整管线润色（粗稿→润色） |
| signaling-pathway | 组2 bare | - | - | （dry-run 未出图） | 本地 AI 裸写直出 |
| signaling-pathway | 组3 guarded | - | - | （dry-run 未出图） | 本地净化后直出（src/craft.mjs） |
| climate-concept | 组1 server | - | - | （dry-run 未出图） | 服务端完整管线润色（粗稿→润色） |
| climate-concept | 组2 bare | - | - | （dry-run 未出图） | 本地 AI 裸写直出 |
| climate-concept | 组3 guarded | - | - | （dry-run 未出图） | 本地净化后直出（src/craft.mjs） |
| cell-labeled | 组1 server | - | - | （dry-run 未出图） | 服务端完整管线润色（粗稿→润色） |
| cell-labeled | 组2 bare | - | - | （dry-run 未出图） | 本地 AI 裸写直出 |
| cell-labeled | 组3 guarded | - | - | （dry-run 未出图） | 本地净化后直出（src/craft.mjs） |
| abstract-geometry | 组1 server | - | - | （dry-run 未出图） | 服务端完整管线润色（粗稿→润色） |
| abstract-geometry | 组2 bare | - | - | （dry-run 未出图） | 本地 AI 裸写直出 |
| abstract-geometry | 组3 guarded | - | - | （dry-run 未出图） | 本地净化后直出（src/craft.mjs） |
| pipeline-flow | 组1 server | - | - | （dry-run 未出图） | 服务端完整管线润色（粗稿→润色） |
| pipeline-flow | 组2 bare | - | - | （dry-run 未出图） | 本地 AI 裸写直出 |
| pipeline-flow | 组3 guarded | - | - | （dry-run 未出图） | 本地净化后直出（src/craft.mjs） |
| enzyme-mechanism | 组1 server | - | - | （dry-run 未出图） | 服务端完整管线润色（粗稿→润色） |
| enzyme-mechanism | 组2 bare | - | - | （dry-run 未出图） | 本地 AI 裸写直出 |
| enzyme-mechanism | 组3 guarded | - | - | （dry-run 未出图） | 本地净化后直出（src/craft.mjs） |
| network-concept | 组1 server | - | - | （dry-run 未出图） | 服务端完整管线润色（粗稿→润色） |
| network-concept | 组2 bare | - | - | （dry-run 未出图） | 本地 AI 裸写直出 |
| network-concept | 组3 guarded | - | - | （dry-run 未出图） | 本地净化后直出（src/craft.mjs） |

## 人工评审指引（质量必须人眼评，脚本只负责把图排好）

把 `scripts/eval-out/<组>/<name>/v1.png` 三张并排对照，按以下维度打分：

| 维度 | 看什么 | 评分建议 |
|---|---|---|
| 图内文字是否乱码 | 带标签的图（cell-labeled / climate-concept / network-concept）最易暴露。英文单词是否断裂、重复、胡编字符 | server 通常最好，bare/guarded 看本地 AI 写法 |
| 结构是否对 | 流程图箭头方向、机理图因果链、概念图节点关系是否成立 | 对照 intent 字段 |
| 风格是否科研 | 是否白底、扁平/卡通学术风、无 watermark、无花哨装饰 | 三组的基线风格应一致 |
| 实体有没有缺漏 | 应出现的方框/细胞器/层级节点是否齐全 | 尤其 bare 组易漏 |

**结论用法**：若 bare 与 guarded 明显差于 server → skill 需写细（补净化/结构约束）；若 guarded≈server → 本地净化已够，skill 可精简。

---
*由 scripts/eval-craft.mjs 生成。成本护栏：--run 需显式 --yes。*
