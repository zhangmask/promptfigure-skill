# prompt 构造手册

## 先分清两种模式

| | 默认模式（产品形态） | 降级模式 `polish:false`（紧急绕过） |
|---|---|---|
| 服务端 | LLM 编排 → 净化 → 审查 → 出图 | **跳过润色**，你的 prompt 直接进图模型 |
| 你要写 | **大白话 + 意图说清楚** | **完整英文专业提示词** |
| 难度 | 低 | 高 |

⚠️ **默认模式才是产品的正常形态。** 降级模式仅在上游文本限频期默认管线连续失败时作为紧急绕过，平时不要用。

---

# 默认模式（正常形态）

服务端会把你的大白话扩写成专业提示词。**你的职责是把用户意图一次性说清楚，不是替服务端写长提示词。**

## 三要素，缺一项就补一项

| 要素 | 说明 | 反例 |
|---|---|---|
| **图种** | flow / mechanism / pipeline / comparison / roadmap / graphical abstract | 「画个图」 |
| **实体** | 组名、模型名、基因名、数值、实验条件——**这是最重要的** | 「两种方法的效果」 |
| **结构** | 几个 panel、流向、是否要图例 | 完全不提布局 |

**实体齐全度直接决定出图信息密度**。服务端能扩写句式，但扩写不出你没告诉它的实体。

## 「一次性说清楚」的写法

```
✅ "对比 ResTiNet 和 CNN baseline 在 OCT 影像分类上的表现。
    左图：数据流从输入经 4 个残差块到分类头。
    右图：柱状图，准确率 94.2% vs 88.7%，推理时间 12ms vs 31ms。"

❌ "画个深度学习对比图"    ← 无实体无结构，服务端无从扩写
```

注意：
- **中英文都可以**——服务端负责润色，中文也可以（但 technical 名词保持原文大小写：`GPX4`、`ResTiNet`、`p < 0.001`、µm 等）
- **数值要真实**：没有的数据留占位符或干脆不写。**编造的数值会被原样印到图上**
- 一句话到三句话通常够，不必堆砌

## 常见图种的意图描述要点

- **技术路线图**：几个阶段、从左到右、每阶段的关键动作
- **机制/信号通路**：谁激活谁、谁抑制谁、最终结果；如有亚细胞定位一并说明
- **实验管线**：原始输入 → 各处理步骤 → 输出；每步的方法名
- **对比图**：比什么对象、在什么指标上、用什么图表类型（柱状/折线/箱线）
- **图形摘要**：核心结论一句话 + 支撑它的 2–3 个要素

组合式多 panel 写法见线上：https://promptfigure.pages.dev/docs/zh-CN/figure-structure
（多 panel 图记得把 `ratio` 设成 `16:9`）

## 参考图怎么用

有参考图时**必须拆到特征级**——不要只写「参考这个风格」，那样必返工。逐项对照：

方向（横/竖）· panel 数量 · 图表类型 · 图标风格 · 数据标注密度 · 配色分布

把这些特征写进意图描述，参考图作为补充。

```json
{ "prompt": "...", "refUrl": "https://...直链.png" }
```

⚠️ **当前参考图端点可用性**：上游 `/images/edits` 自 2026-09-07 起持续 503。`refUrl`/`refDataUrl` 经常被忽略（`refIgnored: true`，**当次照常出图并计费**）。看到这种情况，**暂时改用纯文字精确描述**更好。

---

# 降级模式（`polish:false`，紧急绕过）

服务端不润色，你的 prompt **原样**进图模型。此时必须自己写完整英文专业提示词。

## 关键差异

- ❌ prompt 必须**英文**（中文会被当噪声处理）
- ❌ **没有服务端修正**：写错就错
- ✅ 要把"图种 + 结构 + 风格 + 标签"全部写死
- ⚠️ 图模型英文文字渲染差，关键标签必须**逐字写对**

## 降级模式模板

### 技术路线图

```
A horizontal 4-stage technical roadmap for <主题>, left to right:
Stage 1 <名>, Stage 2 <名>, Stage 3 <名>, Stage 4 <名>.
Each stage is a rounded rectangle with a short label and 2-3 sub-bullets.
Arrows connect consecutive stages. Flat vector style, white background,
thin dark-gray outlines, every stage in a distinct pastel color.
All labels in English, spelled correctly.
```

### 机制 / 信号通路

```
A 2D flat conceptual diagram of <机制名>. <实体A> activates <实体B>,
which inhibits <实体C>, leading to <结果>. Include: membrane boundary,
receptor icon, arrow cascade with clear direction, and a labeled legend.
No 3D, no gradients, no photorealism. White background, thin outlines.
English text labels only, correct spelling (e.g. exactly "GPX4").
```

⚠️ 必须显式写 "2D flat"——不写容易出立体渲染。
⚠️ 拼写逐字检查：这条模式下写错就是在图上印刷错误。

### 实验管线

```
An experimental pipeline diagram, top to bottom: raw data acquisition →
preprocessing (<步骤>) → feature extraction (<方法>) → model training →
evaluation (accuracy <数值>%, F1 <数值>). Each stage is a full-width
block with an icon and one-line caption in English. Flat vector, white
background, consistent stroke width, distinct pastel color per stage.
```

### 对比图

```
A two-panel comparison of <方法A> vs <方法B> on <任务>.
Left panel: <图表类型> showing <指标1> <数值A> vs <数值B>.
Right panel: <图表类型> showing <指标2> <数值A> vs <数值B>.
Both panels share the same vertical scale. Include axis labels with
units. Clean scientific style, white background, panels labeled (a)(b).
Axis labels in English: "Accuracy (%)", "Time (ms)".
```

### 图形摘要

```
A single-panel graphical abstract summarizing <论文主题>.
Center: <核心对象>. Left inflow: <输入/数据源>. Right outcome: <结论/指标>.
All labels in English. Generous whitespace, high visual hierarchy,
white background, professional journal style.
```

## 配色（两种模式都适用）

🚫 **禁止**约束单一色相。事故写法：

- ❌ `"muted steel-blue fills"`
- ❌ `"restrained navy/gray/teal palette"`
- ❌ `"monochrome professional style"`

图模型忠实执行 → 全图一个色系。

✅ **语义化多色**：每个颜色对应一个角色。

```
coral-red for task labels, pastel green for model blocks,
warm amber for training/evaluation blocks, sky blue for metric chips,
pale pink for data blocks. White background, dark-gray outlines.
Every color has a meaning — different roles get different hues.
```

5–7 个语义色通常刚好。**例外**：纯数据图表（柱状/折线）反而克制，≤4 色相 + 1–2 强调色。

---

## 降级模式专属：英文标签渲染

实测（2026-09-09）polish:false 直出时图模型会画出 "Mcıuacy" 这类乱码：

1. 关键标签在 prompt 里**逐字写好**，别写模糊描述让它猜
2. 结尾加一句 `"All on-figure text labels in English, spelled correctly"`
3. 重要场合用 `premium`（gpt-image 文字渲染显著优于 standard 的 Agnes）
4. 出现乱码就换写法重试

---

## 发送前 Checklist

**默认模式**
- [ ] 图种说清楚了
- [ ] 实体写全（组名/模型名/数值/条件）
- [ ] 结构说了（panel 数/流向/图例）
- [ ] 数值真实（没有的用占位符，绝不反问）
- [ ] 多 panel 配了 `ratio: "16:9"`
- [ ] `model` 选对（正式交付 = premium）

**降级模式（额外）**
- [ ] `"polish": false` 已设
- [ ] 英文
- [ ] 关键英文标签逐字写对
- [ ] 150–300 词，>400 词会信息超载
- [ ] 机制图标了 "2D flat"
- [ ] 没有约束单一色相