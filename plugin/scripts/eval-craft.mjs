// eval-craft.mjs — 提示词质量三组对比评测框架
//
// 目的：量化「本地 AI 裸写提示词 vs 服务端完整管线」的质量差，决定 skill 要写多细。
//   组1 server  ：同一粗稿发 polish:true，服务端完整管线润色后出图
//   组2 bare    ：本地 AI 裸写的提示词 polish:false 直出
//   组3 guarded ：裸写提示词过本地净化（sanitizePrompt）后 polish:false 直出
//
// 🔴 成本护栏：--run 默认不花钱，必须显式 --yes 才真出图（先打印总预估费用）
// 🔴 默认 --dry-run：只打印计划表 + 三组提示词预览，一个子儿都不花
// 🔴 key 只从 ~/.promptfigure/config.json 读，终端只打印脱敏前缀
// 🔴 craft.mjs 可能不存在（同事在写）：try/catch 动态 import，缺失时用内置简化净化
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const imp = (p) => import("file:///" + path.join(ROOT, p).replace(/\\/g, "/"));

const BASE = "https://promptfigure.top";
const GEN_URL = `${BASE}/api/v1/generate`;        // 额度通道（优先）
const GEN_BALANCE_URL = `${BASE}/api/v1/generate/balance`; // 余额通道（402 兜底）
const UA = "promptfigure-local-eval/0.2";
const COST_PER = 0.02; // standard ≈ $0.02 / 张（预估，仅护栏用）

// ---------------------------------------------------------------------------
// 净化：优先用同事写的 src/craft.mjs 的 sanitizePrompt；缺失时内置最简版
// （删自省句行：AI 常在前缀写 "Let me..." / "I think..." 等元指令，不是图内容）
// ---------------------------------------------------------------------------
let sanitizePrompt;
let sanitizeSource;
try {
  const craft = await import("file:///" + path.join(ROOT, "src/craft.mjs").replace(/\\/g, "/"));
  const fn = craft.sanitizePrompt || craft.default?.sanitizePrompt;
  if (typeof fn !== "function") throw new Error("no sanitizePrompt export");
  sanitizePrompt = fn;
  sanitizeSource = "src/craft.mjs";
} catch {
  sanitizePrompt = builtinSanitize;
  sanitizeSource = "内置简化净化（删自省句行）";
  console.warn("⚠️  src/craft.mjs 未找到，启用内置最简净化：删除疑似自省/元指令前缀行。");
}

function builtinSanitize(text = "") {
  const META = /^(i\s*think|i\s*believe|let\s*me|i\s*will|i'?ll|here'?s|the\s*following|as\s*an\s*ai|note\s*that|please|actually|this\s*is\s*a|i'?m\s*going\s*to|first,?|to\s*generate|in\s*this\s*(prompt|image|figure)|i\s*should|we\s*can|the\s*image\s*(should|will))/i;
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      return !META.test(t);
    })
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// ---------------------------------------------------------------------------
// 默认 fixtures：8 条科研场景样例，覆盖流程图/机理图/概念图/带文字标签/纯图形无文字
// promptBare 模拟「本地 AI 裸写」——有的故意带自省前缀句，用来演示组3净化差异
// ---------------------------------------------------------------------------
const DEFAULT_FIXTURES = [
  {
    name: "detection-flow",
    intent: "流程图·两阶段轨道缺陷检测框架",
    promptBare:
      "Let me describe a figure for you. A clean academic flowchart of a two-stage track defect detection framework: stage 1 image preprocessing and data augmentation, stage 2 vision transformer classification. White background, thin blue boxes, black arrows, minimal flat style, no watermark.",
  },
  {
    name: "signaling-pathway",
    intent: "机理图·细胞信号转导通路",
    promptBare:
      "I think a good diagram would show: a biological mechanism illustration of the EGFR signaling pathway, receptor dimerization triggering downstream Ras-Raf-MEK-ERK cascade, cartoon-style cells, soft pastel colors, labeled arrows, white background.",
  },
  {
    name: "climate-concept",
    intent: "概念图·多因素气候影响关系（含 hex 色值 + 混入中文 + 数值免责句，专测 guard）",
    promptBare:
      "A concept map linking greenhouse gas emissions, ocean warming, ice sheet melt, and sea level rise, with connecting arrows and brief node labels, academic infographic style, light gray background. Use color #1e90ff for the warming branch. 不要编造具体数字 no fabricated numbers, values are omitted.",
  },
  {
    name: "cell-labeled",
    intent: "带文字标签·植物细胞结构标注（含数值免责句，专测 guard）",
    promptBare:
      "Here is a labeled diagram of a plant cell: cell wall, vacuole, chloroplast, nucleus, mitochondria, each with clear text callouts and leader lines, textbook illustration style, white background, legible labels. Note: no specific numeric values are printed; values are omitted.",
  },
  {
    name: "abstract-geometry",
    intent: "纯图形无文字·抽象几何构成（纯图形，guard 不应触发）",
    promptBare:
      "An abstract composition of overlapping translucent geometric shapes — circles, triangles, rectangles — in a muted academic palette, balanced asymmetric layout, no text, no labels, white background.",
  },
  {
    name: "pipeline-flow",
    intent: "流程图·数据清洗管线",
    promptBare:
      "To generate this: a horizontal pipeline flowchart for data cleaning: ingest → deduplicate → impute → normalize → validate, rounded rectangles connected by arrows, monochrome blue, minimal, gridless, no watermark.",
  },
  {
    name: "enzyme-mechanism",
    intent: "机理图·酶催化反应机理（含 hex 色值，专测 guard）",
    promptBare:
      "A mechanism illustration of enzyme-substrate catalysis: active site binding, transition state, product release, shown as a cyclic cartoon with curved arrows, soft gradient fills #ffd700, scientific journal style, white background.",
  },
  {
    name: "network-concept",
    intent: "概念图·神经网络层级概念（含混入中文，专测 guard）",
    promptBare:
      "A concept network of a neural network: input layer, hidden layers, output layer as nodes, weights as connecting lines, with small captions, blueprint style on light blue background, thin lines, 无装饰文字 no decorative text.",
  },
];

function loadFixtures(p) {
  if (!p) return DEFAULT_FIXTURES;
  const raw = fs.readFileSync(p, "utf8");
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr) || !arr.length) throw new Error("fixtures 必须是非空数组");
  for (const it of arr) {
    if (!it.name || !it.promptBare) throw new Error("每条 fixture 需含 name 与 promptBare");
  }
  return arr;
}

// ---------------------------------------------------------------------------
// 外呼（照 render.mjs：402 自动换余额通道；非 JSON 响应要报 content-type 前 80 字符）
// ---------------------------------------------------------------------------
async function callGenerate(url, key, body) {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "User-Agent": UA,
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const contentType = resp.headers.get("content-type") || "(无 content-type)";
  let data = null;
  let rawText = "";
  try {
    rawText = await resp.text();
    data = JSON.parse(rawText);
  } catch {
    return {
      status: resp.status,
      ok: false,
      contentType,
      data: {
        error: "non_json_response",
        detail: rawText.slice(0, 160).replace(/<[^>]+>/g, " ").trim(),
      },
    };
  }
  return { status: resp.status, ok: resp.ok, contentType, data };
}

// 单组单条出图；返回 { channel, b64, error, timeMs }
async function generateOne(key, group, prompt) {
  const body = { prompt: prompt.trim(), model: "standard", polish: group.polish };
  const t0 = Date.now();
  let channel = "quota";
  let resp = await callGenerate(GEN_URL, key, body);
  if (resp.status === 402 && resp.data?.error === "quota_exhausted") {
    channel = "balance";
    resp = await callGenerate(GEN_BALANCE_URL, key, body);
  }
  const timeMs = Date.now() - t0;
  if (resp.status === 429) {
    return { channel, b64: null, timeMs, error: `RPM 限流（${resp.data?.limit ?? "?"}/分），稍等再试` };
  }
  if (!resp.ok || !resp.data?.b64_json) {
    // 非 JSON（CF 质询页）要显式报 content-type 前 80，别静默
    if (resp.data?.error === "non_json_response") {
      return {
        channel,
        b64: null,
        timeMs,
        error: `非 JSON 响应（疑似 CF 质询页）content-type=${resp.contentType.slice(0, 80)} | ${resp.data.detail}`,
      };
    }
    const detail = resp.data?.detail || resp.data?.error || `HTTP ${resp.status}`;
    const refunded = resp.data?.refunded ? "（已自动退款/还原额度）" : "";
    return { channel, b64: null, timeMs, error: `出图失败：${detail}${refunded}` };
  }
  return { channel, b64: resp.data.b64_json, timeMs, error: null };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildGroups(fix) {
  const guarded = sanitizePrompt(fix.promptBare);
  return [
    { key: "server", label: "组1 server", polish: true, prompt: fix.promptBare, note: "服务端完整管线润色（粗稿→润色）" },
    { key: "bare", label: "组2 bare", polish: false, prompt: fix.promptBare, note: "本地 AI 裸写直出" },
    { key: "guarded", label: "组3 guarded", polish: false, prompt: guarded, note: `本地净化后直出（${sanitizeSource}）` },
  ];
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------
function renderPlanTable(fixtures) {
  const rows = [];
  for (const fix of fixtures) {
    for (const g of buildGroups(fix)) {
      rows.push(
        `| ${fix.name} | ${g.label} | ${g.polish ? "polish:true" : "polish:false"} | standard | ${g.polish ? GEN_URL : GEN_URL} | $${COST_PER.toFixed(2)} |`
      );
    }
  }
  return `| fixture | 组 | polish | 档位 | 端点 | 预估 |\n|---|---|---|---|---|---|\n${rows.join("\n")}`;
}

// 词级 diff：找出 bare 中在 guarded 里消失/被改的片段（guard 触发痕迹）
function diffRemoved(bare, guarded) {
  if (bare === guarded) return [];
  const toks = (s) => s.split(/(\s+)/).map((t) => t.trim()).filter(Boolean);
  const kept = new Set(toks(guarded));
  return toks(bare).filter((w) => !kept.has(w));
}

function renderPromptPreview(fixtures) {
  const blocks = [];
  for (const fix of fixtures) {
    const guarded = sanitizePrompt(fix.promptBare);
    const removed = diffRemoved(fix.promptBare, guarded);
    blocks.push(
      `### ${fix.name} — ${fix.intent}\n` +
        `**组1 server（粗稿 = promptBare）**\n\`\`\`\n${fix.promptBare}\n\`\`\`\n` +
        `**组2 bare（裸写直出）**\n\`\`\`\n${fix.promptBare}\n\`\`\`\n` +
        `**组3 guarded（净化后实际发送）**\n\`\`\`\n${guarded}\n\`\`\`\n` +
        (removed.length
          ? `**净化改动（被删/改的片段）：**\n> ${removed.map((r) => r.slice(0, 50)).join(" ")}\n`
          : `**净化：guard 未触发（bare 与 guarded 一致）**\n`)
    );
  }
  return blocks.join("\n");
}

function writeReport({ mode, fixtures, results, keyMask, totalCost }) {
  const outDir = path.join(__dirname, "eval-out");
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(__dirname, "eval-report.md");

  const resultRows = [];
  if (results && results.length) {
    for (const r of results) {
      resultRows.push(
        `| ${r.name} | ${r.group} | ${r.channel} | ${r.timeMs != null ? (r.timeMs / 1000).toFixed(1) + "s" : "-"} | ${r.path || "-"} | ${r.error ? "❌ " + r.error : "✅"} |`
      );
    }
  } else {
    // dry-run 骨架
    for (const fix of fixtures) {
      for (const g of buildGroups(fix)) {
        resultRows.push(`| ${fix.name} | ${g.label} | - | - | （dry-run 未出图） | ${g.note} |`);
      }
    }
  }

  const guide = `## 人工评审指引（质量必须人眼评，脚本只负责把图排好）

把 \`scripts/eval-out/<组>/<name>/v1.png\` 三张并排对照，按以下维度打分：

| 维度 | 看什么 | 评分建议 |
|---|---|---|
| 图内文字是否乱码 | 带标签的图（cell-labeled / climate-concept / network-concept）最易暴露。英文单词是否断裂、重复、胡编字符 | server 通常最好，bare/guarded 看本地 AI 写法 |
| 结构是否对 | 流程图箭头方向、机理图因果链、概念图节点关系是否成立 | 对照 intent 字段 |
| 风格是否科研 | 是否白底、扁平/卡通学术风、无 watermark、无花哨装饰 | 三组的基线风格应一致 |
| 实体有没有缺漏 | 应出现的方框/细胞器/层级节点是否齐全 | 尤其 bare 组易漏 |

**结论用法**：若 bare 与 guarded 明显差于 server → skill 需写细（补净化/结构约束）；若 guarded≈server → 本地净化已够，skill 可精简。`;

  const md =
`# 提示词质量三组对比评测报告

- 模式：**${mode}**
- 时间：${new Date().toISOString()}
- fixture 数：${fixtures.length}（共 ${fixtures.length * 3} 张图计划）
- API key：${keyMask || "(未配置，dry-run 不影响)"}
- 净化来源：${sanitizeSource}
- 总预估费用（standard ≈ $${COST_PER.toFixed(2)}/张）：$${totalCost.toFixed(2)}（仅 --run --yes 才真实发生）

## 执行计划表（每组 × 每条）

${renderPlanTable(fixtures)}

## 三组实际发送提示词预览

${mode === "dry-run" ? renderPromptPreview(fixtures) : "（--run 模式下预览见上方计划；实际发送内容同各 fixture 的 promptBare / 净化结果）"}

## 结果对照表

| 名称 | 组 | 通道 | 耗时 | 产物路径 | 备注 |
|---|---|---|---|---|---|
${resultRows.join("\n")}

${guide}

---
*由 scripts/eval-craft.mjs 生成。成本护栏：--run 需显式 --yes。*
`;
  fs.writeFileSync(reportPath, md);
  console.log(`📝 报告已写：${reportPath}`);
  return reportPath;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : null;
};

const fixturesPath = val("--fixtures");
const runMode = has("--run");
const yes = has("--yes");
const dryRun = !runMode; // 默认 dry-run

const fixtures = loadFixtures(fixturesPath);
const { loadConfig, maskKey } = await imp("src/config.mjs");
const cfg = loadConfig();
const key = cfg.key;
const keyMask = maskKey(key);

const totalCost = fixtures.length * 3 * COST_PER;

// 成本护栏：--run 必须 --yes
if (runMode && !yes) {
  console.log(`\n💰 --run 总预估费用：$${totalCost.toFixed(2)}（${fixtures.length} 条 × 3 组 × $${COST_PER.toFixed(2)}）`);
  console.log("⛔ 未传 --yes，已中止，未花一分钱。确认要真实出图请加 --yes。\n");
  process.exit(0);
}

console.log(`\n=== 提示词质量三组评测 (${dryRun ? "DRY-RUN" : "RUN"}) ===`);
console.log(`fixtures: ${fixtures.length} 条 | key: ${keyMask} | 净化: ${sanitizeSource}`);
console.log(`总预估费用：$${totalCost.toFixed(2)}`);
console.log(renderPlanTable(fixtures).split("\n").slice(0, 4).join("\n") + "\n… (完整计划见报告)");

let results = null;
if (!dryRun) {
  if (!key) {
    console.error("❌ 没有配置 pf_ key（~/.promptfigure/config.json）。先 pf login 或跑 real-key-test.mjs。");
    process.exit(1);
  }
  results = [];
  for (const fix of fixtures) {
    const groups = buildGroups(fix);
    for (const g of groups) {
      const r = await generateOne(key, g, g.prompt);
      const relDir = path.join("eval-out", g.key, fix.name);
      let savedPath = null;
      if (r.b64) {
        const absDir = path.join(__dirname, relDir);
        fs.mkdirSync(absDir, { recursive: true });
        const fpath = path.join(absDir, "v1.png");
        fs.writeFileSync(fpath, Buffer.from(r.b64, "base64"));
        savedPath = relDir.replace(/\\/g, "/") + "/v1.png";
      }
      results.push({
        name: fix.name,
        group: g.label,
        channel: r.channel,
        timeMs: r.timeMs,
        path: savedPath,
        error: r.error,
      });
      if (r.error) console.log(`  ❌ ${fix.name}/${g.label}: ${r.error}`);
      else console.log(`  ✅ ${fix.name}/${g.label}: channel=${r.channel} ${(r.timeMs / 1000).toFixed(1)}s → ${savedPath}`);
      await sleep(2000); // 每条之间 sleep 2s，护 RPM
    }
  }
}

writeReport({
  mode: dryRun ? "dry-run" : "run",
  fixtures,
  results,
  keyMask,
  totalCost,
});
console.log(dryRun ? "\n✅ dry-run 完成，未出图、未花钱。" : `\n✅ run 完成，实际花费约等于 $${totalCost.toFixed(2)}（取决于通道）。`);
