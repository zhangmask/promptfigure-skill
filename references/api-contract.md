# API 契约完整版

**站点**：https://promptfigure.top

---

## ⚠️ 必看

1. **默认就是完整润色管线**——`/api/v1/generate` 与网页工作台同一套（编排 + 净化 + 审查 + 出图），只是没有网页的多轮问询/二次确认。**不要因为要"一次性答完"就绕过润色。**
2. **`polish:false` 仅是紧急绕过**（服务端不扩写，需自己写完整英文提示词），平时**不要传**。上游文本限频期服务端会自动回落重试（主模型 agnes-2.5-flash → 备用 agnes-2.0-flash）。
3. **CF WAF 拦 `Python-urllib/*`**——其它客户端都过。
4. **`balance` 字段滞后**——`/api/login`、`/api/me` 返回的 balance 不等于真实余额。

---

## 路径 A：API 直调（v1，同步）

**Endpoint**：`POST https://promptfigure.top/api/v1/generate`
**鉴权**：`Authorization: Bearer pf_...`
**CORS**：全开（`Access-Control-Allow-Origin: *`），鉴权靠 key 不靠 cookie。

### Request

```jsonc
{
  "prompt":      "",        // ✅ 必填，大白话即可，≤8000 字符
  "polish":      true,      // 默认润色；false 仅紧急绕过（服务端不扩写，平时不要传）
  "model":       "standard" | "premium",   // 服务端默认 standard；非 "premium" 一律 standard
  "size":        "1K" | "2K",              // 仅 premium 生效，默认 2K
  "ratio":       "1:1" | "3:2" | "2:3" | "16:9" | "9:16",  // 默认 1:1，非法值回落 1:1
  "refUrl":      "https://.../ref.png",    // 公网图片直链，PNG ≤8MB
  "refDataUrl":  "data:image/png;base64,...",  // base64 后 ≤8MB
  "mode":        "replica"                 // 一键临摹（2026-09-18）；别名 "replica":true、"mode":"一键临摹"
}
```

规则：
- `prompt` 空或缺失 → `400 prompt_required`（**临摹模式例外**：`mode:"replica"` 时 `prompt` 可留空，服务端补一句中性复刻指令）
- `prompt` >8000 字符 → `400 prompt_too_long`
- `model` 非 `"premium"` 任何值 → `standard`
- `size` 非 `"1K"` → 2K；`standard` 恒输出 1K
- `refUrl` + `refDataUrl` 都传 → **`refDataUrl` 优先**
- `refUrl` 服务端安全限制：只接 `http(s)`；`localhost`/`.local`/`.internal`/环回与私网 IP 拒绝；校验 PNG 文件魔数（不看 content-type）；≤8MB；拉取超时 20s
- **注意**：上游 `/images/edits` 端点 2026-09-07 起持续 503。`refUrl`/`refDataUrl` 当前可能 `refIgnored: true`（被忽略，**当次照常出图并计费**）

### Response

成功 `200`：

```jsonc
{
  "b64_json": "<PNG base64>",
  "size":     "2K",
  "ratio":    "16:9",
  "model":    "premium",
  "provider": "premium",      // agnes=standard, premium=premium 档（高级档中转通道）
  "crafted":  false,          // false=polish:false 直出
  "charged":  0.15,
  "balance":  12.34,
  // 仅 mode:"replica" 出现：
  "mode":          "replica",
  "referenceSpec": { /* 见下「一键临摹」 */ },
  "specError":     null       // 非 null = 参考图规格提取失败，已退化（不额外计费）
}
```

失败：

```jsonc
{ "error": "insufficient_balance", "required": 0.15, "balance": 0.02 }   // 402
{ "error": "rate_limited", "limit": 5 }                                   // 429，已退款
{ "error": "generation_failed", "detail": "orchestration_failed: ...", "refunded": 0.15 }  // 502，已退款
{ "error": "invalid_api_key" }                                            // 401
```

### 计费

| model | 单价 | 输出 | 备注 |
|---|---|---|---|
| `standard` | **$0.02** / 次 | 恒 1K（Agnes） | 草稿、迭代、批量试错 |
| `premium` | **$0.15** / 次 | 1K 或 2K **同价** | 终稿、正式交付、入 paper |

✅ 尺寸不影响价格 → premium 无脑用 2K。
✅ 每 key 关联账号，**只从余额扣**，与会员订阅额度独立。
✅ **生成失败自动原路退款**（含 RPM 429 场景）。

**RPM（每分钟请求数），与网页端共享同一窗口**：免费 5 · Lite 10 · Plus 15 · Pro 40 · Ultra 80。
未订阅 = 免费层 5 RPM，批量任务务必串行 + 退避。

### 调用示例

#### Bash / curl（默认 UA 不会被 WAF 拦）

🔴 **响应必须落文件，禁止把原始响应直接回显进对话**——`b64_json` 是几百 KB 的 base64
（数十万 token 级），直接打印轻则污染上下文、重则撑爆会话（2026-09-25 实测）。
照下面的范式：管道进文件，jq 只回显元数据字段。

```bash
gen() {
  curl -s -X POST https://promptfigure.top/api/v1/generate \
    -H "Authorization: Bearer $PROMPTFIGURE_KEY" \
    -H "Content-Type: application/json" \
    -d "$1" | tee /tmp/pf.json | jq -r .b64_json | base64 -d > "${2:-figure.png}"
  jq '{size,model,crafted,charged,balance,refIgnored}' /tmp/pf.json
}
gen '{"prompt":"对比 ResTiNet 和 CNN 在 OCT 分类上的表现，左侧数据流右侧柱状图","model":"premium","ratio":"16:9"}' fig1.png
# 紧急绕过（平时不需要）：末尾加 "polish":false，且 prompt 需自己写成完整英文专业提示词
# gen '{"prompt":"<完整英文提示词>","model":"premium","polish":false,"ratio":"16:9"}' fig1.png
```

#### Node（fetch 默认 UA 不过 WAF）

```js
const B = "https://promptfigure.top";
const b64 = await fetch(B + "/api/v1/generate", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.PROMPTFIGURE_KEY}`,
             "Content-Type": "application/json" },
  body: JSON.stringify({ prompt, model: "premium", ratio: "16:9" }),  // 正常：不传 polish
  // 紧急绕过（平时不需要）：加 polish: false，且 prompt 需写成完整英文专业提示词
}).then(r => r.json());
require("fs").writeFileSync("figure.png", Buffer.from(b64.b64_json, "base64"));
```

#### Python `requests`（UA 安全，需 `pip install requests`）

```python
import os, base64, requests
r = requests.post(
    "https://promptfigure.top/api/v1/generate",
    headers={"Authorization": f"Bearer {os.environ['PROMPTFIGURE_KEY']}"},
    json={"prompt": "对比 ResTiNet 和 CNN 在 OCT 分类上的表现，左侧数据流右侧柱状图",
          "model": "premium", "ratio": "16:9"},   # 正常：不传 polish
          # 紧急绕过（平时不需要）：加 "polish": False，prompt 需写成完整英文专业提示词
    timeout=300,
)
if not r.ok:
    raise SystemExit(f"{r.status_code} {r.json()}")
d = r.json()
open("figure.png", "wb").write(base64.b64decode(d["b64_json"]))
print(d["charged"], d["balance"], d.get("refIgnored"))
```

#### Python `urllib.request`（⚠️ 必须改 UA，否则 403）

```python
import json, base64, urllib.request
req = urllib.request.Request(
    "https://promptfigure.top/api/v1/generate",
    data=json.dumps({"prompt":"...","model":"premium","ratio":"16:9"}).encode(),
    # 紧急绕过（平时不需要）：dict 里加 "polish": False
    headers={
        "Authorization": f"Bearer {os.environ['PROMPTFIGURE_KEY']}",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",  # 绕开 CF WAF 拦截
    },
    method="POST",
)
d = json.loads(urllib.request.urlopen(req, timeout=300).read())
open("figure.png", "wb").write(base64.b64decode(d["b64_json"]))
```

### 客户端 `timeout`

默认管线实测 42–90s；premium 2K 偶尔更久。**所有客户端 timeout 建议 ≥ 300s**。

---

## 路径 B：网页工作流等价的异步流程

完整 4 步（路径 B 走默认润色，无 polish 开关）：

```js
const B = "https://promptfigure.top";
const post = (p, b, t) => fetch(B+p, {
  method:"POST",
  headers:{"Content-Type":"application/json", Authorization:`Bearer ${t}`},
  body:JSON.stringify(b),
}).then(r=>r.json());

// 1. 登录
const { token: tok } = await post("/api/login", {email, password});

// 2. 铸造 gen token（此处扣费）
//    body: { token: tok, prompt, size: "1K"|"2K", pool: "premium"|null, ratio }
const { token: gt } = await post("/api/generate-token", {
  token: tok,
  prompt: "...",
  size: "1K",
  pool: null,        // null=标准池；premium 显式传 "premium"
  ratio: "16:9",
});

// 3. 入队
const { jobId } = await post("/api/gen-async", { token: gt });

// 4. 轮询 /api/gen-result，status 序列：queued → polishing → imaging → qa → done（终态还有 error）
for (;;) {
  const r = await post("/api/gen-result", { token: tok, id: jobId });
  if (r.status === "done") return r.imageUrl;        // 直接可用的图 URL
  if (r.status === "error" || r.error) throw new Error(JSON.stringify(r));
  await new Promise(s => setTimeout(s, 5000));
}
```

⚠️ 路径 B **没有等价 `polish:false` 开关**——上游限频期偏慢或失败时，急用请走路径 A。

---

## 一键临摹 `mode: "replica"`（2026-09-18）

**什么时候用**：用户给了一张现成的科研图（示意图 / 流程图 / 机制图 / 图形摘要 / 体系结构图），要求"照这个画一版 / 重画一张 / 保持结构一致"，或者想把别人论文里那张图重做成自己的一套图。**这是这种需求的首选参数**，比自己揣摩着写 prompt 准得多。

**和普通参考图的区别**（关键，决定该不该用它）：

| | 普通参考图（refUrl/refDataUrl） | 一键临摹（+ mode:"replica"） |
|---|---|---|
| 参考图给谁 | 只给生图模型，提示词层不知道它存在 | 先送**视觉模型**读成结构化清单，再由清单驱动提示词与审查 |
| 保真依据 | 靠模型看图即兴 | 清单逐条比对（漏项/多项/编造都能判） |
| 适合 | 只借风格、构图、配色 | 要**结构一致**的复刻 |

**请求**（必须带参考图，`prompt` 可留空）：

```bash
gen '{"mode":"replica","refUrl":"https://.../figure3.png","model":"premium","ratio":"16:9"}' replica.png
# prompt 也可以写要点，例如 {"mode":"replica","prompt":"改成中文标注","refUrl":"..."}
```

**响应里的 `referenceSpec` 就是那份清单**，可拿来核对本次出图：

```jsonc
{
  "canvas": "16:9 landscape",          // ⚠️ 视觉模型对该字段不稳定，仅供方向参考（真实比例由 ratio 决定）
  "layout": "three phases stacked vertically, Phase II splits into 3 parallel columns",
  "sections": [{ "id": "a", "role": "..." }],
  "palette":  [{ "role": "process steps", "color": "light green" }],
  "text":     [{ "s": "MAPE 8.3%", "kind": "label", "lang": "en", "readable": true }],
  "elements": [{ "name": "Data preprocessing box", "kind": "box", "note": "green rounded" }],
  "relations":["Data -> Raw data box", "Decision diamond -> ... (no/tighten constraints)"],
  "photos":   ["western blot panel"],
  "ambiguities": ["exact arrow connectivity not individually drawn"]
}
```

- `text` 是**原样抄录**（不翻译、不纠错），出图的图上文字按它逐字渲染——所以它也是"中文/英文标注是否正确"的验收依据。`readable:false` 的条目会用中性占位，不会瞎猜。
- `photos` 里的区域会以**示意方式**重绘，不会伪造显微照片/电泳条带细节（科研场景伪造图像属于学术不端）。

**约束与错误码**：

| 情况 | 结果 |
|---|---|
| 没带参考图 | `400 replica_requires_reference`（不扣费） |
| 参考图 base64 后 >8MB | `413 replica_reference_too_large`（临摹要把图送视觉模型，上限比普通参考图紧；压缩/裁剪后重试） |
| 视觉轮失败 | 不报错：退化为"带图直接写提示词"，`specError` 带原因，正常计费 |
| 润色失败 | `502 orchestration_failed` + **自动退款**（与普通生成同一闭环） |

**不适合临摹的**：照片/显微照片/电泳图**本身**（要的是保真像素，不是重画）；数据图表里要精确到像素的坐标轴排布。

---

## 批处理

必须串行 + 429 退避：

```python
import time, requests
def gen(prompt, **kw):
    for attempt in range(4):
        r = requests.post(URL, headers=H,
            json={"prompt": prompt, **kw},   # 正常：不传 polish
            timeout=300)
        if r.status_code == 429:
            time.sleep(2 ** attempt); continue
        if r.status_code == 502:
            time.sleep(1); continue   # 已退款，可安全重试
        r.raise_for_status()
        return r.json()
    raise RuntimeError("retry exhausted")
```

❌ 不要并发——RPM 是账号级窗口，并发只会换来 429，总吞吐不变。
✅ 预算有限时先跑 `standard` 看构图，定了再跑 `premium` 出终稿。

---

## 不适合本 API 的场景

- 需要**精确数据绑定**的图表（要有真实 CSV 数值驱动）→ 用 matplotlib / ggplot 画更准确
- 超大分辨率打印级图（最高 2K）
- 严格可复现、像素级可控的排版