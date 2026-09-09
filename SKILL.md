---
name: promptfigure-api
description: 用 promptFigure 生成科研/学术配图（流程图、机制图、管线图、技术路线图、图形摘要）。当用户要「画一张图」「生成论文配图/示意图/机制图/ graphical abstract」、或要配置 promptFigure API key、或要用 REST 接口批量出图时使用。走 https://promptfigure.pages.dev 的 /api/v1/generate，Bearer pf_ key 鉴权，返回 base64 PNG。网页端有多轮问询/二次确认，API 端一次性提交——所以要把用户绘图意图一次说清楚，服务端负责润色成完整示意。
---

# promptFigure 出图技能

把一句大白话变成可直接放进论文的科研图。整套管线（LLM 编排 + 提示词工程 + 审查 + 出图）都在服务端，调用方只需把**用户的绘图意图说清楚**。

**线上站点**：https://promptfigure.pages.dev

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

## 🔴 铁律：零反问

API 出图时**不要向用户追问画图参数**。信息不足就从上下文推断 + 占位符补全，一次性提交。

理由：网页能来回问是因为用户在界面里；调用方 AI 的上下文通常已经有所需信息（正在写的论文、实验记录、前面对话）。反问会打断工作流。

- ❌ 禁止：「你想画什么风格？」「用什么配色？」「比例几比几？」
- ✅ 正确：推断 → 提交 → 出图 → 若不满意再根据反馈迭代。

**信息不足时**：用语义化占位符（`group A / group B`、`sample N=...`），绝不停下来问。

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
| 402 | 余额不足 | 控制台充值（$1 起整数）后重试 |
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

---

## 参考文件

| 文件 | 何时读 |
|---|---|
| `references/setup-guide.md` | 还没有 key，需要注册/登录/建 key/充值（含自动化选择器 + curl 路径） |
| `references/prompt-cookbook.md` | **默认模式**：怎么把用户意图一次性说清楚。**降级模式**（polish:false）怎么写完整英文提示词 |
| `references/api-contract.md` | 完整契约、网页工作流 4 步、多语言示例、批处理、WAF |
| `references/troubleshooting.md` | 润色失败、WAF 403、balance 滞后、出图质量差 |