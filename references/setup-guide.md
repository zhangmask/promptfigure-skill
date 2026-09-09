# 拿到 promptFigure API key

全程站点：https://promptfigure.pages.dev
注册 **不需要邮箱验证码**，邮箱 + 密码（≥8 位）即可。

**主路径：网页**。`/api/login`、`/api/keys` 等内部接口**面向已登录会话**，curl 注册可用但绕过了 UI（且会受 WAF UA 拦截），建议人肉注册、AI 只接管「登录后拿 key」这一步。

---

## 路径 A：网页人肉（小白 / 默认推荐）

最稳。UI 自带 401/校验/防风控。

1. 打开 https://promptfigure.pages.dev
2. 右上角点 **注册**（或 登录）。填邮箱 + 密码（≥8 位），提交即完成，**无需验证邮件**
3. 打开 https://promptfigure.pages.dev/console#account-balance 充值（$1 起、必须整数，上限 $10000；每满 $50 赠 $1 进余额——按 `floor(金额/50)` 计算，**零头不累计**：$99 只赠 $1，$100 赠 $2）
4. 打开 https://promptfigure.pages.dev/console#account-keys → 点创建 → **复制明文 key（`pf_` 开头），立刻存好**
5. 把 key 交给调用方环境变量：

```bash
export PROMPTFIGURE_KEY=pf_xxxxxxxx
```

⚠️ key 是 **会话内一次性明文**，弹窗关闭后只能看到 hint。库内只存 SHA-256 哈希 + hint。
⚠️ SPA 必须带 hash 直达标签页：`#account-keys` / `#account-balance` 缺一不可，否则落总览页。

---

## 路径 B：浏览器自动化（有桌面/浏览器控制能力的 Agent）

⚠️ **仅当路径 A 因浏览器限制不可用时用**。注册走 UI 风险大于收益，下面这版只接管「登录 + 拿 key」。

注册（请用户自己点一次 UI）：
- 邮箱 + 密码注册一次拿 `pf_` key 即可
- 注册后只登录会话：弹窗顶部是**分段控件（segmented-control），「登录」「注册」两个 tab 按钮并排**——点「登录」按钮切到 login tab → 填 email/password → 提交。**没有「已有账号？」这类链接文案**，自动化时按 segmented-control 内的按钮文本（登录 / Login）定位

登录后的 DOM 选择器（实测有效）：

| 元素 | 选择器 |
|---|---|
| 邮箱输入 | `#lite-email` |
| 密码输入 | `#lite-password` |
| 登录/注册弹窗关闭 | `.modal-close` |
| 提交按钮 | `.primary-action` |
| API 密钥标签页 | 访问 `/console#account-keys` |
| 余额标签页 | 访问 `/console#account-balance` |
| 调试台 key 输入框 | `#pf-play-key` |
| 调试台 prompt 输入框 | `#pf-play-prompt` |

要点：
- 登录入口是**右上角弹窗**，不是独立登录页——需先点触发再操作表单
- 弹窗分 登录 / 注册 两个 tab，注册按钮在同一弹窗内切换（`mode` 状态）
- SPA 路由走 `history.pushState`，自动化时应直接导航完整 URL（含 hash），不要依赖点击导航
- 创建 key 后明文弹窗通常带「复制」按钮，优先点复制；若需读取文本，直接读弹窗 DOM 文本而不用 OCR
- 浏览器 fetch 不会被 CF WAF 拦截（只有默认 UA 才拦）

---

## 路径 C：纯 curl（无 UI 场景 / 自建脚本）

⚠️ 注册/登录/建 key 都是内部 REST 接口，**没文档承诺稳定**——产品主路径是网页。这条路径出问题时，请优先回退到路径 A。

### 客户端 UA（必经）

CF WAF 会拦 `Python-urllib/*`（实测 403 error code:1010）。其它都过。**curl 默认 UA 不在拦截名单里，可以直接用**；Python `requests` 默认 UA 也能过；只有 `urllib.request` 需要手动改 UA：

```python
import urllib.request
req = urllib.request.Request(url, ...)
req.add_header("User-Agent", "Mozilla/5.0")  # 绕过 CF WAF 拦截
```

### 1. 注册（可选，有账号则跳到 2）

```bash
curl -s -X POST https://promptfigure.pages.dev/api/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"至少8位"}'
```

成功返回 `201` + `{ token, userId, email, balance: 0, ... }`。
`409 email_taken` → 跳步骤 2 直接登录。

### 2. 登录

```bash
curl -s -X POST https://promptfigure.pages.dev/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"你的密码"}'
```

返回 `{ token, userId, email, balance, credits, ... }`，token 是 session token（30 天有效）。

### 3. 创建 API key

```bash
export PF_TOKEN=<上一步的 token>
curl -s -X POST https://promptfigure.pages.dev/api/keys \
  -H "Authorization: Bearer $PF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-agent"}'
```

返回 `{ id, key:"pf_...", hint, name, createdAt }`。立刻存：

```bash
export PROMPTFIGURE_KEY=pf_xxxxxxxxxxxxxxxx
```

⚠️ **明文只在此响应中出现一次**，库里只存 SHA-256 哈希 + hint。丢了无法找回，只能吊销重建。

### 4. 充值（必须步骤）

API 计费**只从余额扣**，与会员额度完全独立。新注册余额为 0，不充值调用会 `402`。
充值走网页：https://promptfigure.pages.dev/console#account-balance（$1 起，整数）。
**付款动作不应由 Agent 代劳**，留给用户人肉操作。

### 5. 验证

```bash
curl -s -X POST https://promptfigure.pages.dev/api/v1/generate \
  -H "Authorization: Bearer $PROMPTFIGURE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Simple two-group bar chart comparing method A and method B","model":"standard"}' \
  | jq '{size, ratio, model, crafted, charged, balance}'
```

看到 `crafted: true` + `charged: 0.02` + `balance` 减少 → 打通（默认管线实测约 40–90 秒；若 502 看 `references/troubleshooting.md`）。

---

## key 管理

```bash
# 列表（不含明文，只有 hint）
curl -s https://promptfigure.pages.dev/api/keys -H "Authorization: Bearer $PF_TOKEN"
# 吊销
curl -s -X POST https://promptfigure.pages.dev/api/keys/revoke \
  -H "Authorization: Bearer $PF_TOKEN" \
  -H "Content-Type: application/json" -d '{"id":"<key id>"}'
```

每人最多 10 把未吊销 key。

---

## 安全提示

- key 不进代码仓库、不进 commit。放环境变量或 secrets store
- 怀疑泄露先吊销再重建，成本为零
- 一次性不要创建过多 key；按用途命名（如 `paper-agent`、`lab-batch`）便于追溯