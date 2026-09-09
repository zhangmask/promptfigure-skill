# 常见问题与排障

## 错误码速查

| 码 | error 值 | 原因 | 处置 |
|---|---|---|---|
| 400 | `prompt_required` / `prompt_too_long` | prompt 空或 >8000 字符 | 检查请求体 |
| 401 | `invalid_api_key` | key 无效/已吊销/漏了 `Bearer ` 前缀 | 检查 header；无效则重建 key |
| 402 | `insufficient_balance` | 余额不足 | 控制台充值（$1 起，整数） |
| 403 | `error code: 1010` | **CF WAF 拦了客户端 UA**（仅 `Python-urllib/*` 默认 UA） | 切 Node / Go / Python `requests` / 浏览器；或给 urllib 加 `User-Agent: Mozilla/5.0` |
| 429 | `rate_limited` | 超 RPM | 已退款，串行 + 退避重试（1s → 2s → 4s） |
| 502 | `generation_failed` | 生图通道异常 | **已自动退款**，看 `detail` 后重试；最常见是 `orchestration_failed: empty or truncated polish output` |
| 405 | `method_not_allowed` | 用了 GET | 必须 POST |

> 注意 RPM 限制是**账号级**，与网页端工作台共享同一个分钟窗口。网页上刚连续出过图，API 立刻报 429 属正常。

---

## 🔧 502 `orchestration_failed: empty or truncated polish output`

**上游 Agnes 文本模型间歇性限频**。限频期间默认管线可能 502（约 35 秒后返回），`refunded` 标明退还金额，无需补款。服务端已内置回落：主模型 agnes-2.5-flash 撞 429 时会自动用 agnes-2.0-flash 整体重试一次；两层都撞上才会 502。

⚠️ 重要：**这是上游运维状态，不是产品形态。** `/api/v1/generate` 的设计就是默认走完整润色管线，与网页同款。不要把 `polish:false` 当常态。

### 真实根因（2026-09-09 实证，已修订）

上游返回 **`429 "Too many requests. Please try again in a moment."`**——**与本方用量完全无关**（实测窗口内仅 7 次调用 / 配额 7500，依然 429；数小时后自行恢复）。重要线索：同 key 同模型从本机直连不限流、只有站点出口被限 → **疑似 Agnes 按出口 IP 频控**，换模型未必躲得开，等服务端回落+稍后重试是正解。

**已修复的误导**：此前四种不同失败（配额耗尽/key 冷却/上游空响应/被上游拒绝）统一报成 `empty or truncated polish output`。**现在错误 detail 里带 `last_text_failure:` 字段**，直接给出上游真实状态码和响应片段——看到它就不用再猜。

### 如何区分「平台故障」vs「我自己的问题」

| 特征 | 平台限频（本次） | 自己的问题 |
|---|---|---|
| 错误 detail | 含 `upstream 429` | 含 `prompt`/参数类提示 |
| 耗时 | 恒定 ~35s（重试耗尽） | 秒级返回 |
| `polish:false` 同参数重试 | ✅ 能出图 | 也失败 |
| 隔一段时间重试 | ✅ 自愈 | 仍失败 |

### 处置

**首选：等几分钟到几小时后原样重试**（限频会自行解除；2026-09-09 实测当天恢复，默认管线 42–90s 成功出图）。

赶时间时的临时绕过：

```json
{ "prompt": "<完整英文提示词>", "polish": false, "model": "standard" }
```

⚠️ `polish:false` 时服务端**不润色不扩写**，prompt 原样进图模型——所以必须自己写完整英文提示词（写法见 `prompt-cookbook.md` 的「降级模式」）。

### 何时回到正常

无需操作——限频解除后默认管线自动恢复（响应里 `crafted: true`）。`polish:false` 仅作为绕过手段保留。

---

## 🔴 CF WAF 403 `error code: 1010`

实测拦截列表（2026-09-09）：

| 客户端 | UA | 结果 |
|---|---|---|
| curl | `curl/7.x` | ✅ 200 |
| Node fetch | `node` | ✅ 200 |
| Python `requests` | `python-requests/2.x` | ✅ 200 |
| Go `net/http` | `Go-http-client/1.1` | ✅ 200 |
| 浏览器 fetch | `Mozilla/5.0 ...` | ✅ 200 |
| Python `urllib.request` | **`Python-urllib/3.x`** | ❌ 403 |

**修法**：
- Python `urllib`：手动加 `User-Agent: Mozilla/5.0`
- 或换 `requests` / `httpx` / Node / Go

---

## 🔴 `balance` 字段滞后

`/api/login` 和 `/api/me` 返回的 `balance` **不等于真实余额**（实测：`me` 返回 0，扣费 0.02 后真实余额 0.09，扣费仍成功）。

可能解释：这两接口里 `balance` 字段没同步 D1，或来自一个非权威缓存层。

**操作规则**：
- 不要因为 `balance` 看起来够而**预先估算**余额
- 看到 `402` 不要立即判定没钱，先看 D1 控制台 https://promptfigure.pages.dev/console#account-balance
- 用户报告「明明有钱却被 402」时，先核对控制台余额（不是接口返回的）

---

## 注册 / key 相关

**Q：注册要收邮箱验证码吗？**
不用。邮箱 + 密码（≥8 位）提交即完成，session token 立即可用。

**Q：key 明文丢了怎么办？**
找不回来。库内只存 SHA-256 哈希。吊销旧的重建：
`POST /api/keys/revoke {"id":"..."}` → `POST /api/keys {"name":"..."}`。

**Q：余额和会员额度是一回事吗？**
不是。API 只从**余额**扣，与订阅赠送的额度完全独立。有会员但余额为 0 → 调用仍会 402。反过来，只充值不订阅也能一直用 API（免费层 5 RPM）。

**Q：能创建几把 key？**
每人最多 10 把未吊销。按用途命名便于追溯。

**Q：为什么会 401 但我明明没吊销？**
先查 `Authorization` header —— 必须是 `Bearer pf_xxx`。写成 `Token pf_xxx` 或直接裸 key 都会 401。

---

## 参考图

**Q：`refIgnored: true` 是什么意思？**
参考图缺失/非法/拉取失败，**已被忽略，当次照常出图并计费**。按序排查：

1. URL 是图片**直链**吗？（浏览器打开直接显示图片，不是含图的网页）
2. 是 PNG 吗？（某些 .webp/.jpg 后缀但实际格式不符会失败）
3. 超过 8MB 吗？
4. 是私网/本地地址吗？（会被拒绝）
5. 图床是否还在？（免费图床政策常变）

**Q：参考图端点是不是有问题？**
**是**。上游 `/images/edits` 自 2026-09-07 起持续 503。`refUrl`/`refDataUrl` 当前经常 `refIgnored: true`。
**绕开方案**：暂时改用「纯文字精确描述」——把参考图的特征（方向/panel 数/图表类型/图标风格/数据标注密度/色分布）全部写进 prompt。修复后第一时间回写到本文件。

**Q：有既稳定又省事的方案吗？**
图在公网 → 用 `refUrl`（服务器代取，你不用下载也不用转 base64）。
图在本地且较小 → 用 `refDataUrl`。
图在本地且较大 → 先挂免费图床：
`curl -F "file=@ref.png" https://x0.at`

---

## 出图质量

**Q：图里的文字糊/有乱码英文？**
polish:false 直出时图模型对英文文字标签渲染差（实测出 "Mcıuacy" 这种乱码）。
**修法**：prompt 里**逐字写对**所有英文标签，加一句 "All on-figure text labels in English, spelled correctly"。重要场合用 `premium`（gpt-image 文字渲染显著优于 Agnes standard）。

**Q：数值和我给的不一致？**
polish:false 时图模型会忠实画你给的数值，但也可能把"上下文中相似数字"画错。关键数值在 prompt 里重复一次并显式绑定单位。⚠️ 没有真实数据就别写——补出来的数值会被当成事实印到图上。

**Q：配色太单调，全是一个色系？**
prompt 里写了单一色相约束（如 `"muted steel-blue fills"`）。改用语义化多色（详见 `prompt-cookbook.md` 的配色小节）。

**Q：机制图被画成了 3D？**
prompt 里加 `2D flat`, `white background`, `no gradients, no photorealism`。

**Q：构图和我给的参考图差很远？**
「参考风格」不拆特征是必返工的。拆到特征级——方向、panel 数、图表类型、图标风格、标注密度、色分布——逐条写进 prompt 正文。参考图只是补充（且当前参考图端点 503）。

**Q：prompt 很长但出图反而更差？**
超 400 词后信息超载。压到 150–300 词，只保留核心实体与结构。

**Q：为什么图快/出图秒成但像样？**
polish:false 直出时快（~11s）但少了编排层润色，**质量低于正常管线是预期**，不是异常。正常管线应看到 `crafted: true` 的更慢但更好的结果。

---

## 计费

**Q：既然 premium 1K 和 2K 同价，为什么还要选 1K？**
基本不用选，默认 2K。仅当需要快速迭代或尺寸受限时用 1K。

**Q：失败会扣钱吗？**
不会。502、429 都会自动原路退款（响应里看 `refunded`）。只有成功出图才真扣费。

**Q：RPM 不够用怎么办？**
提升订阅档（Lite 10 / Plus 15 / Pro 40 / Ultra 80 RPM）。短期也可以：错峰、把批量任务摊到不同分钟。

---

## 时效

**Q：响应要多久？**
polish:false 实测 ~11s（standard）/ 60–120s（premium 2K 偶尔更长）。**客户端 timeout ≥ 300s**。
⚠️ 别设 30s/60s 就以为服务挂了——通常是你自己先断开了。

**Q：网页工作台和 API 一样慢/卡吗？**
管线正常时网页与 API 同速（都在服务端润色）。网页端**没有 `polish:false` 等价开关**——上游限频期网页会卡在 polishing，急用请走 API 路径 A。

---

## 仍然解决不了

- 线上文档（权威，比本文件更新）：https://promptfigure.pages.dev/docs/zh-CN/faq
- 在线调试台（隔离是代码问题还是账号问题）：https://promptfigure.pages.dev/docs/zh-CN/api-playground
- 服务状态/更新：https://promptfigure.pages.dev/news

---

## premium 被内容审核误伤（502 `content moderation`，2026-09-10 CVPR 实测）

现象：502 + `detail.error = modelflare rejected` + 上游报 "rejected by content moderation"，**自动退款**。

关键实测结论（二分验证）：

- 触发是**整段组合判断，不是单词命中**——把整段 prompt 里的词逐个/分组喂给极简探针全部通过，合在一起就被拒。密集的「检测/候选框/过滤/一致性」类 CV 术语组合（如 …Candidate Boxes + Consensus + Filtering + 本地化器… 同屏多个）容易触发
- 单个可疑缩写也可能命中（实测 `WBF` 被拒，全称 Weighted Box Fusion 反而通过）——先用极简探针 + 可疑词单独测，拒=免费，通过=正常扣费，别拿整段 prompt 反复烧钱试

处置顺序：

1. 拒了就换措辞重试**最多 2 次**（每次拒绝免费）；去掉标题/缩写、把检测类词汇换成中性词（Estimator/Candidate）常能过
2. 还不过 → **不要继续试探**：改走 standard 出图（Agnes 通道审核宽松，同样内容能过），拼写/小字问题用 PIL 本地修补（采样盒底色覆盖 + Arial 按原字号重写标签），成本为零且拼写百分百正确
3. 台账里记 `moderation_blocked: true` 与被拒 prompt，便于服务端侧后续排查
