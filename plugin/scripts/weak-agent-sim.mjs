// weak-agent-sim.mjs — 让弱模型（agnes-2.5-flash）真跑插件 CLI 全工作流，找 skill/CLI 的坑
//
// 设计：agnes-2.5 拿 SKILL.md 当唯一说明书，扮演用户本地的宿主 AI；
//      本脚本当执行器：解析它输出的 ```pf 代码块 → node bin/pf.mjs <args> → 结果贴回。
// 安全：白名单子命令；render 最多 2 次（限 standard）；禁 stop/serve/tray/setup-tex/login/stop。
// 产物：temp/weak-agent-sim-<ts>.json（完整转录）+ 控制台转录。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const agnesKey = fs.readFileSync(path.join(ROOT, "..", "EasyDraw-main", ".dev.vars"), "utf8").match(/AGNES_API_KEYS=(\S+)/)?.[1];
if (!agnesKey) { console.error("没找到 AGNES_API_KEYS"); process.exit(1); }
const API = "https://apihub.agnes-ai.com/v1/chat/completions";
const MODEL = "agnes-2.5-flash";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const skillMd = fs.readFileSync(path.join(ROOT, "skill", "promptfigure-local", "SKILL.md"), "utf8");

const TASK = `用户请求：「我在写论文，文件在 D:/xiangmu/CVPRugc/pf-optimize-work/author-kit-CVPR2026-v1-latex-/main.tex。请帮我在 §3.2 方法部分后面配一张方法流程图，主题是论文提出的方法框架。」

你的环境：
- 当前工作目录：${ROOT}
- promptfigure 插件已安装，CLI 命令就是 SKILL.md 里写的 pf 命令
- 已有 key 配置完毕，不用 pf login

执行规则（严格遵守）：
1. 每轮只输出**一个**要执行的命令，放在 \`\`\`pf 代码块里，例如：\`\`\`pf\nstatus\n\`\`\`（不要写 node、不要写 pf 前缀，执行器会自动加）
2. 不允许任何其他 shell 命令、解释代码块之外的无关内容
3. 看到执行结果后决定下一步；任务完成（图已出、锚已建、状态已确认）输出 DONE
4. 遇到报错就根据报错修正命令重试，不要放弃`;

// 🔴 黑名单制（2026-09-21 实测）：白名单制漏收新命令（qa-list/types/style/examples），
// 弱模型想跑视觉核验被拒两次 —— 允许列表永远追不上插件演进，只拦危险命令。
// 🔴 next/prompt/refine/inspect 同样漏过一次（第二轮 sim 实测：AI 学会跑 pf next 却被拦）——
// 以后新命令只进 DENIED 判断，别再往 ALLOWED 手工加。
const ALLOWED = new Set(["open", "status", "doc", "anchor", "craft", "render", "review", "doctor", "help", "--help", "-h", "qa-list", "types", "examples", "style", "next", "prompt", "refine", "inspect", "distill", "qa"]);
const DENIED = new Set(["stop", "serve", "tray", "setup-tex", "login"]);
// 🔴 默认零渲染（PF_SIM_RENDER=1 才放开）：演示号余额 ~$0.08，2026-09-21 凌晨已烧 3 张。
// 无渲染也能测工作流/提示词/命令链路（render 会报 key/余额错误，弱模型照常走后续步骤）
const MAX_RENDERS = process.env.PF_SIM_RENDER === "1" ? 2 : 0;
let renderCount = 0;
const transcript = [];

async function chat(messages, { maxTokens = 900, temperature = 0.2 } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(API, {
        method: "POST",
        headers: { Authorization: `Bearer ${agnesKey}`, "Content-Type": "application/json", "User-Agent": "pf-weak-agent-sim/0.1" },
        body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature }),
      });
      if (resp.status === 429) { await sleep(36000); continue; }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 150)}`);
      const data = await resp.json();
      return (data.choices?.[0]?.message?.content || "").trim();
    } catch (e) {
      if (attempt === 2) throw e;
      await sleep(5000);
    }
  }
}

function runPfSync(args) {
  const sub = args[0];
  if (DENIED.has(sub)) return { code: 1, out: "（执行器拒绝：该命令在本次会话中禁用）" };
  if (!ALLOWED.has(sub)) return { code: 1, out: `（执行器拒绝：未知子命令 "${sub}"。可用：${[...ALLOWED].join(" ")}）` };
  // 🔴 只有真出图（render 且非 list）才计数/限次：render list 是只读查询，2026-09-21 实测被误拦
  if (sub === "render" && args[1] !== "list") {
    if (args.includes("--model") && args[args.indexOf("--model") + 1] === "premium") {
      return { code: 1, out: "（执行器拦截：本次评测禁止 premium，请用 --model standard）" };
    }
    if (!args.includes("--model")) {
      return { code: 1, out: "（执行器提示：render 必须显式给 --model；本次评测只允许 --model standard）" };
    }
    renderCount += 1;
    if (renderCount > MAX_RENDERS) return { code: 1, out: MAX_RENDERS === 0
      ? "（执行器：本次为 dry-run 模拟，不真正出图。假设 render 已成功返回一张草稿图，请继续走 qa-list <figureId> 读图核验 → review status 流程，然后 DONE）"
      : `（执行器限制：本次最多 ${MAX_RENDERS} 次出图，已达上限）` };
  }
  const r = spawnSync(process.execPath, [path.join(ROOT, "bin", "pf.mjs"), ...args], {
    cwd: ROOT, encoding: "utf8", timeout: 180000, env: { ...process.env, FORCE_COLOR: "0" },
  });
  let out = ((r.stdout || "") + (r.stderr ? "\n[stderr] " + r.stderr : "")).trim();
  if (out.length > 3500) out = out.slice(0, 3500) + `\n…(截断，共 ${out.length} 字符)`;
  return { code: r.status ?? 1, out };
}

// ---------- 视觉 QA：拦截 "Read <png>"，把图喂给 agnes 过 Q1-Q7 ----------
// 目的：验证 agnes-2.5 到底有没有渲染后核验的视觉能力（此前只是假设宿主 AI 能看图）
async function visionQa(pngPath) {
  let b64;
  try { b64 = fs.readFileSync(pngPath).toString("base64"); }
  catch { return { code: 1, out: `（执行器：读不到文件 ${pngPath}）` }; }
  const qaText = fs.readFileSync(path.join(ROOT, "src", "craft-rules.mjs"), "utf8");
  const qLines = (qaText.match(/"(Q\d{1}[^"]*)",/g) || []).map((s) => s.slice(1, -2));
  const verdict = await chat([
    { role: "system", content: "你是科研配图的视觉核验员。对给出的图逐条检查以下清单，每条回答 通过/不通过+一行证据，最后一行输出总结论：PASS 或 FAIL（任一条不过即 FAIL）。只输出核验结果。\n\n" + qLines.join("\n") },
    { role: "user", content: [
      { type: "text", text: "请核验这张图。" },
      { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
    ] },
  ], { maxTokens: 1200, temperature: 0.1 });
  return { code: 0, out: "（视觉核验员 agnes 返回）\n" + String(verdict).slice(0, 2000) };
}

async function runPf(args) {
  // 宿主 AI 用自己的 Read 工具读图（真实环境）/ 模拟器拦下来走 agnes 视觉 QA
  if (args[0] && args[0].toLowerCase() === "read" && /\.png$/i.test(args[1] || "")) {
    return await visionQa(args[1]);
  }
  const r = runPfSync(args);
  return r;
}

// ---------- 主循环 ----------
const messages = [
  { role: "system", content: "你是用户本地的 AI 编码助手（能力一般的通用助手）。下面的 SKILL.md 是你唯一能参考的插件说明书：\n\n" + skillMd },
  { role: "user", content: TASK },
];

const MAX_TURNS = 14;
let done = false;
for (let turn = 1; turn <= MAX_TURNS && !done; turn++) {
  const reply = await chat(messages);
  messages.push({ role: "assistant", content: reply });
  console.log(`\n──── 第 ${turn} 轮 AI ────\n${reply.slice(0, 500)}`);

  if (/DONE/i.test(reply) && !/```/.test(reply)) { done = true; break; }

  const m = reply.match(/```pf\s*\n([\s\S]*?)```/) || reply.match(/```(?:bash|sh|shell)?\s*\n(pf\s+[\s\S]*?)```/);
  if (!m) {
    const nudge = "（执行器：没有解析到 ```pf 代码块命令。要么给一个 pf 命令，要么单独一行输出 DONE 结束。）";
    messages.push({ role: "user", content: nudge });
    transcript.push({ turn, ai: reply, exec: nudge });
    continue;
  }
  const cmd = m[1].replace(/^\s*pf\s+/, "").trim();
  const args = cmd.match(/(?:[^\s"]+|"[^"]*")+/g).map((s) => s.replace(/^"|"$/g, ""));
  console.log(`>>>> pf ${args.join(" ")}`);
  const r = await runPf(args);
  console.log(`[exit ${r.code}]\n${r.out.slice(0, 900)}`);
  transcript.push({ turn, ai: reply, command: `pf ${args.join(" ")}`, exitCode: r.code, output: r.out });
  messages.push({ role: "user", content: `执行结果（exit ${r.code}）：\n${r.out}` });
  await sleep(1200);
}

const ts = Date.now();
const outFile = path.join(ROOT, "..", "temp", `weak-agent-sim-${ts}.json`);
fs.writeFileSync(outFile, JSON.stringify({ model: MODEL, turns: transcript, renderCount }, null, 2));
console.log(`\n===== 模拟结束（${transcript.length} 轮，出图 ${renderCount} 次）=====\n转录: ${outFile}`);
