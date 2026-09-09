---
name: promptfigure-api
description: 用 promptFigure 生成科研/学术配图（流程图、机制图、管线图、技术路线图、图形摘要），以及优化已有图表、整文批量升级（数据图本地重绘 + 示意图 AI 重构 + 追溯台账）。当用户要「画一张图」「生成论文配图/示意图/机制图/graphical abstract」「把论文里的图变好看/变高级」「批量优化整篇文章的图」、给了 PDF/WPS/Word 文稿要配图或要主动建议插图位、或要配置 promptFigure API key、或要用 REST 接口批量出图时使用。走 https://promptfigure.pages.dev 的 /api/v1/generate，Bearer pf_ key 鉴权，返回 base64 PNG。网页端有多轮问询/二次确认，API 端一次性提交——所以要把用户绘图意图一次说清楚，服务端负责润色成完整示意。
version: 1.4.0
license: MIT
metadata:
  version: "1.4.0"
  author: promptFigure (zhangmask)
  homepage: https://promptfigure.pages.dev
  repository: https://github.com/zhangmask/promptfigure-skill
  latest-check: https://promptfigure.pages.dev/downloads/promptfigure-api.version.json
---

# promptFigure 出图技能

把一句大白话变成可直接放进论文的科研图。整套管线（LLM 编排 + 提示词工程 + 审查 + 出图）都在服务端，调用方只需把**用户的绘图意图说清楚**。

**线上站点**：https://promptfigure.pages.dev

## 🔴 工作流总览：先对齐，后花钱

**整个流程里唯一花钱的动作是 API 调用**。所有迭代都在本地免费环节完成：

```
阶段 0 意图确认（对用户）→ 阶段 1 写提示词 → 阶段 2 提示词审核 → 阶段 3 API 出图
                                ↑__________ 打回/不满意只回到这里改 prompt，免费 __________↓
```

- **阶段 0-2 强制免费前置**：意图没对齐、prompt 没过审，不准调 API。详见 `references/prompt-review-workflow.md`
- **双 Agent 模式（推荐给用户）**：Agent A（有用户上下文）写提示词，另开 Agent B 按 8 项清单审核 `handoff.json`，pass 才出图——把返工从"花钱买废图"变成"出图前两秒发现"
- 出图本身一次到位率 >> 边出边改

---

## 网页 vs API：同一个管线，少一步问询

**`/api/v1/generate` 跑的就是网页工作台那一套完整管线**——LLM 编排、意图路由、确定性净化、独立审查、出图，全部包含。**唯一区别**：

| | 网页工作台 | `/api/v1/generate` |
|---|---|---|
| 管线 | 完整 | **同款完整** |
| 交互 | 多轮问询 + 二次确认 | **一次性提交，无问询** |
| 结果 | 页面展示 + 下载 | JSON 返回 base64 PNG |

所以**「一次性答完」指的是补全用户的绘图意图，不是替服务端写提示词**。

- ✅ 正确：一次性说清「画什么图、有哪些实体、什么结构」→ 交给服务端润色扩写成完整示意
- ❌ 错误：以为没有网页问询就可以自作主张改写/增删用户意图——那会丢信息

---

## 🔴 反问边界：先澄清意图，出图过程零反问

**阶段 0（对用户）——意图不明必须主动澄清**：实体是泛称、结构推不出来、用户材料里找不到对应物时，**停下来问**，一次问完（给选项不给开放题）。这是买保险：30 秒的确认换掉 $0.15 的废图。清晰输入则回显确认卡后直接执行，不打断用户。

**阶段 3（对 API）——零反问**：出图过程不向用户追问任何参数。信息不足就从上下文推断 + 占位符补全，一次性提交。

- ❌ 禁止（任何时候）：「你想画什么风格？」「用什么配色？」「比例几比几？」——按一次性收敛表推定
- ✅ 阶段 0 允许且必须：「三个模块用论文原名还是占位名？」「A→B 是单向还是有反馈？」——**只问意图级问题，一次问完**
- ✅ 阶段 3 正确：确认卡已过 → 提交 → 出图 → 不满意回阶段 1 改 prompt

完整协议（5 项意图清单 / 两档处理 / 确认卡模板）见 `references/prompt-review-workflow.md`。整文级批量任务的开工澄清（场景/模式/原始材料/档位）见 `references/figure-upgrade-workflow.md` §1。

---

## ✅ 管线状态（2026-09-09 核对）

默认润色管线**正常**。润色文本模型已升级为 `agnes-2.5-flash`，并内置上游 429 自动回落（`agnes-2.0-flash` 整体重试一次）——调用方无感。

| 项 | 状态 |
|---|---|
| `/api/v1/generate` 默认（带润色） | ✅ 实测 42–90s 出图，`crafted: true` |
| 上游 429 限频期 | 服务端自动回落重试；若仍 502，看 `detail` 里的 `last_text_failure`，稍后原样重试即可（会自动退款） |
| `polish:false` 直出 | ✅ ~11s，**仅紧急绕过用**（服务端不扩写，需自己写完整英文提示词） |

**`polish:false` 不是常态**。仅当默认管线连续失败且 `detail` 显示上游故障、你又赶时间时才用。写法见 `references/prompt-cookbook.md` 的「降级模式」章节。

⚠️ 走 `polish:false` 时图模型英文文字渲染明显下降（实测出 "Mcıuacy" 这类乱码）。重要场合用 `premium`（gpt-image 文字渲染优于 standard 的 Agnes）。

---

## 一次性收敛：交请求前内部定下 6 项

| 项 | 必填 | 推定规则（按序命中即停） |
|---|---|---|
| `prompt` | ✅ 唯一必填 | **大白话即可，把意图说清楚**——服务端会润色扩写。关键是**实体写全**（组名/模型名/基因名/数值/实验条件）。详见 `references/prompt-cookbook.md` |
| `model` | 推荐显式传 | 草稿/自用验证/批量试错的迭代稿 → `standard`（$0.02）；**正式交付、放进论文或汇报 → `premium`（$0.15）**。拿不准就用 `premium`。服务端默认 `standard` |
| `size` | 默认 2K | 仅 `premium` 可设；1K/2K **同价**，无脑 2K。`standard` 恒 1K |
| `ratio` | 默认 `1:1` | 多 panel 组合图 / 技术路线图 / 图形摘要 / 横向流程 → `16:9`；纵向信号通路、级联瀑布 → `9:16`；期刊单幅 Results 图 → `3:2`；方法示意图、单主体图 → `1:1` |
| `refUrl` / `refDataUrl` | 无则不传 | 有参考图 → 优先 `refUrl`（公网图片直链，服务器代取）。本地图 → 挂免费图床（x0.at / uguu.se）拿直链，或用 `refDataUrl`（base64 PNG ≤8MB）。二选一，`refDataUrl` 优先 |
| `polish` | 默认润色 | 正常不需要传。仅默认管线连续失败且 `detail` 显示上游故障时，才传 `false` 紧急绕过 |

---

## 调用

```bash
curl -s -X POST https://promptfigure.pages.dev/api/v1/generate \
  -H "Authorization: Bearer $PROMPTFIGURE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"<大白话描述，实体写全>","model":"premium","ratio":"16:9"}'
```

响应 `.b64_json` 是 PNG：

```bash
curl -s ... | jq -r .b64_json | base64 -d > figure.png
```

⚠️ **CF WAF 拦 `Python-urllib/*`**（403 error code:1010）。curl / Node / Go / Python `requests` / 浏览器 fetch 都能过；urllib 需加 `User-Agent: Mozilla/5.0`。
⚠️ **超时**：客户端 `timeout` 设 **≥ 300s**（完整润色管线是串行 3 次 LLM，premium 2K 偶尔更久）。

---

## 网页工作流等价的异步流程（可选）

网页真实流水：**登录 → 拿 gen token（扣费）→ 提交异步任务 → 轮询结果**。AI 想拿与网页完全一致的处理可用这条。

```js
const tok = (await post("/api/login", {email, password})).token;
const genToken = (await post("/api/generate-token", { token: tok, prompt, size:"1K", ratio:"16:9" })).token;
const { jobId } = await post("/api/gen-async", { token: genToken });
// 轮询 status: queued → polishing → imaging → qa → done（终态还有 error）
const result = await poll("/api/gen-result", { token: tok, id: jobId });
// result.imageUrl 图；result.prompt 服务端润色后的最终提示词
```

⚠️ 此路径**无 `polish:false` 开关**；上游文本限频期可能偏慢或失败，急用走 API 直调。

完整契约、多语言示例、批处理见 `references/api-contract.md`。

---

## 响应与错误码

成功：`{ b64_json, size, ratio, model, provider, crafted, charged, balance }`
- `crafted: true` = 走了润色；`false` = `polish:false` 直出
- `provider` = `agnes`（standard）/ `modelflare`（premium，gpt-image 系列）

| 码 | 含义 | 处置 |
|---|---|---|
| 401 | key 无效/已吊销 | 检查 `Authorization: Bearer pf_...`；重建 key |
| 402 | 余额不足（不扣费） | 控制台充值（$1 起整数）后重试。**批处理/迭代任务开工前先查余额**（`balance` 字段滞后，以控制台为准），预估张数×单价+重试余量；中断时已完成图不回滚，从断点续跑 |
| 429 | 超 RPM（免费 5 / Lite 10 / Plus 15 / Pro 40 / Ultra 80，账号级共享） | 串行 + 退避 |
| 502 | 生成失败 | **已自动退款**；看 `detail` 的 `last_text_failure:`——含 `upstream 429` 是上游限频（稍后重试即愈），其余按 detail 判断；赶时间可临时 `polish:false` |
| 403 | `error code: 1010` | CF WAF 拦了 `Python-urllib/*` UA，换客户端 |
| 400 | `prompt_required` / `prompt_too_long` | prompt ≤8000 字符 |

⚠️ **`balance` 字段滞后**：`/api/login`、`/api/me` 返回的 `balance` 不等于真实余额（实测返回 0 但扣费成功后余额 0.09）。判断余额以控制台 https://promptfigure.pages.dev/console#account-balance 为准。

---

## 首次使用：拿 key

需要 `PROMPTFIGURE_KEY`。**网页为主路径**（含小白 + 浏览器自动化 AI），curl 仅高级补充。详见 `references/setup-guide.md`。

1. 打开 https://promptfigure.pages.dev → 右上角 **登录/注册**（邮箱 + 密码 ≥8 位，**无邮箱验证**）
2. 进 https://promptfigure.pages.dev/console#account-balance 充值（$1 起整数）
3. 进 https://promptfigure.pages.dev/console#account-keys 创建 key → **明文 `pf_` 开头只出现一次**，立刻复制存好
4. `export PROMPTFIGURE_KEY=pf_xxxx`

⚠️ 明文丢失无法找回，只能吊销重建。

---

## 保持最新（重要）

**上面「管线状态」是 2026-09-09 的核对快照。** 每次使用前若距上次核对 > 7 天，或用户报告了与本技能不符的行为，先探一次默认润色：

```bash
curl -s -X POST https://promptfigure.pages.dev/api/v1/generate \
  -H "Authorization: Bearer $PROMPTFIGURE_KEY" -H "Content-Type: application/json" \
  -d '{"prompt":"two-group bar chart comparing A and B","model":"standard"}' | jq .
```

`crafted: true` + 200 = 管线健康，无需任何特殊处理；502 看 `last_text_failure`（见 `references/troubleshooting.md`）。

```text
https://promptfigure.pages.dev/docs/zh-CN/api          # API 概览
https://promptfigure.pages.dev/docs/zh-CN/api-playground  # 在线调试台
https://promptfigure.pages.dev/docs/zh-CN/faq          # 常见问题
https://promptfigure.pages.dev/pricing                 # 定价与额度
https://promptfigure.pages.dev/news                    # 更新日志（看运维动态）
```

English 版把 `zh-CN` 换成 `en`。拿到新信息后**回写本技能文件**，别只在当次对话里用。

本技能的**最新版打包**：https://promptfigure.pages.dev/downloads/promptfigure-api.zip —— 若发现本文件内容与线上文档不一致，可下载新版覆盖。

### 版本自查（skill 与更新）

本技能遵循 [Agent Skills 规范](https://agentskills.io/specification)，版本写在 frontmatter（`version` 顶层 + `metadata.version`，语义化版本）：

- **查当前安装的版本**：读本文件 frontmatter 的 `version` 字段即可。
- **查线上最新版本**（程序化，不用下载整个 zip）：

```bash
curl -s https://promptfigure.pages.dev/downloads/promptfigure-api.version.json
# → {"name":"promptfigure-api","version":"1.1.0","updated":"2026-09-09","download":".../promptfigure-api.zip","changelog":"..."}
```

- 本地 `version` < 线上 `version` → 下载 zip 覆盖本地目录（保留 `pf_` key 等环境变量，它们不存放在 skill 目录里）。
- 版本号含义：**主版本**变更 = 接口/流程不兼容改动（需重读 SKILL.md）；**次版本** = 新增能力（如新增参考文档）；**修订号** = 文字勘误。

---

## 参考文件

| 文件 | 何时读 |
|---|---|
| `references/setup-guide.md` | 还没有 key，需要注册/登录/建 key/充值（含自动化选择器 + curl 路径） |
| `references/prompt-cookbook.md` | **默认模式**：怎么把用户意图一次性说清楚。**降级模式**（polish:false）怎么写完整英文提示词 |
| `references/prompt-review-workflow.md` | **每次出图前必读**：四阶段协议（意图确认→写提示词→审核→出图）、5 项意图清单、8 项审核清单、双 Agent 互审与 `handoff.json` 交接契约 |
| `references/api-contract.md` | 完整契约、网页工作流 4 步、多语言示例、批处理、WAF |
| `references/troubleshooting.md` | 润色失败、WAF 403、balance 滞后、出图质量差 |
| `references/document-workflow.md` | 用户给了 `.tex` / `.docx` / `.md` 文稿要配图：怎么定位插图位、从上下文写 prompt、插回文档；LaTeX 编译环境探测与官方下载指引（MiKTeX/TeX Live/TinyTeX/Tectonic/Overleaf） |
| `references/figure-upgrade-workflow.md` | 用户要**优化已有图表**或**整文批量升级**：结果图数据溯源+本地重绘、示意图 AI 升级、结构组合、单图精修/整文批处理两种模式、figure-ledger.json 追溯台账 |
| `references/proactive-upgrade.md` | 用户给的是 **PDF/WPS**（非 LaTeX）、说不出哪里插图要你**主动建议**、要从**原始数据**推演配图、或想参考顶会/SCI 论文的图学风格：PDF 解析、MCM 插图位惯例、四步管线（分析→推演→提示词→迭代）、refs/ 风格库与合规红线 |