#!/usr/bin/env node
// pf.mjs — promptFigure 本地插件 CLI
// 所有命令 --help 可看；AI 宿主通过 skill 学会用这些命令
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import { fileURLToPath } from "node:url";

import {
  PF_DIR, CONFIG_PATH, DAEMON_PATH, ensureDirs,
  loadConfig, saveConfig, maskKey, docIdOf, isHeadless,
} from "../src/config.mjs";
import { parseDocument, docKind } from "../src/doc/index.mjs";
import { resolveRef } from "../src/doc/para.mjs";
import { writeMeta, projectDir, readMeta, resolveDoc, readReview, readAnchors } from "../src/store.mjs";
import { readEvents, appendEvent } from "../src/events.mjs";
import { craftSidecarPath, readCraftSidecar, parseRatio } from "../src/ratio.mjs";
import { loadRefsIndex } from "../src/refs.mjs";
import { computeNext } from "../src/next.mjs";
import { buildPlan } from "../src/plan.mjs";
import { setStatus } from "../src/review.mjs";
import { hasEvidence, lastEvidence, logEvidence, shaOf, EVIDENCE_WINDOW_MS } from "../src/ledger.mjs";
import { montageStrip } from "../src/montage.mjs";
import { comparePanels, compareRows } from "../src/compare.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 🔴 版本号唯一源 = package.json（npm 发布什么，pf --version 就报什么）。
//    曾在这里写死 "0.1.0"，package.json 已 0.2.0——用户看到的版本是假的，
//    版本提示/changelog 对不上就是这么来的。
let VERSION = "0.0.0";
try {
  VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version || VERSION;
} catch { /* 读不到就保持占位；绝不让版本号把整条命令搞崩 */ }

const HELP = `
promptFigure 本地插件 v${VERSION} —— 在你的 AI 宿主里为论文配科研图

🔴 第一次用 / 不知道下一步干什么（最重要的一条命令）：
  pf next                    插件读当前状态，告诉你**唯一**的下一步命令（复制执行即可）
                             重复「执行 → pf next」就能走完全程，不用先读懂下面所有命令
  pf plan [--goal "用户原话"] 小白模式：输出①发给用户的大白话问题卡（选项来自真实文档，
                             用户回数字即可）②你拿到答复后的执行步骤。用户说不清要什么图时先跑它
  快速通道: pf login → pf open <论文> → pf plan（对齐需求）→ pf next（之后每步都听它的）

常用命令：
  pf login [pf_xxx]          配置 API key（控制台创建；不带参数时打印指引）
  pf open <path>             打开论文（.docx/.tex/.pdf）→ 独立窗口预览，打印 docId
  pf status                  当前项目总览（图 / 审批 / 最近事件；结尾带下一步建议）

文档（只读，绝不修改你的文件）：
  pf doc outline [docId]             章节树（AI 选位置用）
  pf doc search <关键词...>          全文检索：关键词 → §引用+片段（定位内容别靠猜）
  pf doc data                        定量数据句按章节列出（画结果图的数字只准从这里来）
  pf doc read <docId> --at "§3.2 ¶2" 读某段原文
  pf doc context <docId> --at "§3.2 ¶2"  段落上下文（AI 用来蒸馏实体/结构/图种）

锚点（AI 显式声明，插件不猜）：
  pf anchor set --doc <id> --at "§3.2 ¶2" --side after [--quote "原文快照"]
  pf anchor list [--doc <id>] [--changed]

风格与原图（全文画风统一）：
  pf style                          查看文档风格卡
  pf style set --text "风格描述"     设置后所有 craft 自动注入（多图不一致=画风割裂）
  pf style clear                    清除
  pf doc figures                    论文原图清单（tex 自动捕获 \includegraphics）

出图（钱在这里花：standard=$0.02 草稿；premium=$0.15 定稿需先审批通过）：
  pf next                    状态路由器：不知道下一步就跑它（输出唯一一条可执行命令+原因）
  pf board                   多图资产总览：每张图的阶段/QA/审批/文件存在性 + 风格卡 + 各自下一步（接手项目/批量配图先跑它）
  pf prompt <figureId> --out p.txt   导出某图最新版提示词（premium 定稿 render 用）
  pf types                    图型目录：12 种图型 + 选型决策（不知道能画什么图先看这个）
  pf distill --at "§3.2 ¶2"   蒸馏素材机：从原文抽候选实体/阶段句序 + craft 命令骨架（填空即可）
                                     —— 实体/结构只准从它的输出来，禁止跳过直接编内容
  pf types show <id>          某图型的选型时机/构图思考/完整示例
  pf examples                 全部图型的现成示例命令（照抄结构、换实体）
  pf craft --at "§3.2 ¶2" --intent "图意" --entities "a,b,c" [--out p.txt]
                                     （--at 必带：实体溯源拿回原文对账，缺了直接拒绝）
                                     本地规则层组装合规提示词（第二阶段）；--at 可传用于记录
                                     🔴 输入质量门：intent<6 词或纯图型名/实体<3 或占位词/阶段<3/空阶段/孤标签/零 show 句/要点整句/实体覆盖率<80%
                                        = 直接拒绝（exit 1），改完重跑；确要硬闯 --force "理由"
                                     [--figure-type pipeline|architecture|flowchart|mechanism|teaser|comparison|dataflow|hierarchy|zoomin|scene|result-style]
                                     [--preset double-column|single-column|slide] 版式预设
                                     [--journal nature|science|ieee|elsevier|thesis] 期刊画幅：字号/线宽/信息密度按最终印刷宽度反推
                                     [--fixes "上版缺陷1; 缺陷2"] 多轮精修：上版核验缺陷逐条拼接为硬性修正
                                     [--ratio 宽:高] 画布比（画布句由它拼接；缺省按预设取 16:9 / 3:4）
                                     --out 会同时写 <同名>.craft.json，render 自动继承画布比
                                     🔴 执行留证门：过去 24h 内必须真的读过这篇文档（pf open / doc outline /
                                        doc read / doc search / pf distill 任一条有记录）才放行 craft——
                                        没读过原文就画图 = 实体靠编，直接拒；确要跳过加 --force（留痕审计）
  pf render --at "§3.2 ¶2" --model standard --prompt-file p.txt [--ratio 16:9]
                                     （不传 --ratio 时自动继承 craft 伴随 JSON 里的画布比）
                                     🔴 执行留证门：真实渲染前必须先 --dry-run 排练过（24h 内有记录，
                                        零成本暴露引用错/预算爆/画布不符），没排练就烧钱会被拒
                                     [--ref prev | <草图.png>] 复刻：参考图以 img2img 条件进出图模型，
                                        布局/母题被参考图锁住，提示词只写"要改什么"。
                                        --ref prev = 上一版（premium 定稿复刻已批准草稿布局的标准做法）；
                                        --ref <png> = 论文原图/手绘草图/任意参考
                                     [--replica] 一键临摹：服务端视觉轮读参考图出结构规格再写提示词
                                        （prompt 可只写要点，如"改成中文标注"；必须配合 --ref）
  pf render list [--at "§3.2 ¶2"]
  pf qa-list                         渲染后视觉核验清单（每张图出来后必须过一遍）
  pf qa <figureId>                   🔴 核验闭环：输出核验任务包（体检数字+实体清单+阶段画法清单+Q1-Q9），
                                     亲眼读图核验后写回：
                                     --pass --note "依据"   记录 PASS + 自动写回审批通过
                                     --fail --note "缺陷1; 缺陷2"  自动驳回 + 缺陷进精修状态机
                                     🔴 approve 门禁只认最新版 QA 记录（没核验就通过会被 CLI 拒绝）
                                     🔴 执行留证门：写回 --pass/--fail 前必须真的领过该图的任务包
                                        （先跑 pf qa <figureId>，24h 内有效），没领就写回 = 拒
  pf inspect [figureId]              像素级自动体检：留白/背景白度/彩色占比/画布比（AI 核验的量化底数）
  pf refine <figureId> --fix "缺陷"  多轮精修状态机：活跃修正落盘，自动重拼下一轮 craft 命令
                                     [--settle "已遵守的修正"] 把沉淀掉的修正移出活跃集

审批（GUI 与 AI 两个入口写同一份状态）：
  pf review status
  pf review resolve <figureId> --approve|--reject [--note "意见"]
  pf review ai [<figureId>|--all]     AI 辅助审批：输出审批任务包（图路径+实体清单+阶段画法清单+核验清单+裁决流程），
                                      你读图逐条核验后把判定写回（GUI 里用户可见 AI 意见并可改判）

服务：
  pf serve                   前台启动本地服务（一般不用，pf open 会自动拉起）
  pf tray                    托盘壳（pf open 已自动拉起；用于手动补启；需 python + pystray）
  pf stop                    停掉本地服务（托盘不会自动复活；下次 pf open 恢复）

环境：
  pf doctor                  体检：TeX 引擎 / key / 服务状态 / 当前文档健康
  pf audit                   审计一键可查：绕门记录（craft.forced / gate_bypass / render.unsourced / review.forced）
  pf export svg <figureId>   最新版 PNG → 可缩放 SVG（vtracer 描摹；文字变路径不可编辑；需 npm i @visioncortex/vtracer）
                                     + 计费兜底 + 排练留痕，每条带理由——可疑版本可直接打回
  pf setup-tex               下载便携 tectonic（没有 TeX 环境时用，~20MB 免安装）
  pf doc compile [--doc <id>]  重新编译 LaTeX → PDF（改了源文件后用）

skill（npm 装的插件自带，一条命令装进宿主）：
  pf skill install            把随包的两个 skill 装进宿主技能目录（默认 ~/.claude/skills/）
                               · promptfigure-local —— 插件工作流（文档预览/锚点/审批 GUI）
                               · promptfigure-api —— 纯 REST 出图（任何能跑 curl 的宿主）
                               [--dir <路径>] 可指定其他技能目录；两者按宿主环境二选一或都装
  pf skill path               只看两个 skill 在插件包里的路径（手动拷贝/排查用）
`;

function die(msg, hintCmd) {
  console.error("❌ " + msg);
  // 🔴 2026-09-21 定规：报错不许是死路——带得上下一步命令就一定带
  if (hintCmd) console.error(`⏭ 下一步: ${hintCmd}`);
  process.exit(1);
}

// 🔴 2026-09-21 子智能体实测：宿主 AI 常用 Git Bash 风格 `/c/Users/...` 绝对路径，
// path.resolve 在 win32 会解析成 `C:\c\Users\...`（当前盘符+假目录）→ 写盘 ENOENT 且报错不指路。
// 统一归一化：`/x/...` → `X:\...`（仅 win32 生效）。
function toWinPath(p) {
  const m = String(p || "").match(/^\/([a-zA-Z])\/(.+)$/);
  if (m && process.platform === "win32") return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, "\\")}`;
  return p;
}

// 最新出的图（qa-list / inspect / qa 缺省落点共用）
function latestFigure(meta) {
  return Object.values(meta.figures || {})
    .sort((a, b) => (b.versions?.at(-1)?.at || "").localeCompare(a.versions?.at(-1)?.at || ""))[0] || null;
}

// 从 craft 提示词里抽实体清单行（QA 核验 Q2/Q4 逐字比对基准）
function entityLineOf(prompt) {
  return (prompt || "").match(/Named entities \(keep verbatim\): present each of the following as a labelled node\/block — (.+?)\./);
}

// 🔴 阶段画法清单（2026-09-23 收紧轮④）：craft 的 show 画法句是「要画什么」的逐条契约。
// qa 任务包第 3c 步与 review ai 审批任务包共用——没有这份清单，核验 AI 无从逐条比对
// 「要求画的到底画了没」（布局漂移只能等用户肉眼发现）。返回 null = sidecar 缺失/无 stages。
async function stageChecklistLines(sidecarPath) {
  try {
    if (!sidecarPath || !fs.existsSync(sidecarPath)) return null;
    const sc = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
    if (!sc?.stages) return null;
    const { parseStages } = await import("../src/craft.mjs");
    const stageList = parseStages(sc.stages);
    if (!stageList.length) return null;
    const lines = [];
    stageList.forEach((s, i) => {
      lines.push(`  阶段 ${i + 1}「${s.title}」`);
      for (const b of s.bullets) {
        const isShow = /^(show|draw|画|示意|绘制)/i.test(b.trim());
        lines.push(`    ${isShow ? "[画法]" : "[标签]"} ${b.trim()}${isShow ? "  → 图上应有对应视觉元素（以图形画出，不是文字）" : "  → 应作为 ≤5 词文字印在盒内"}`);
      }
    });
    return lines;
  } catch { return null; }
}

// 🔴 QA 清单三镜头分组（2026-09-27，用户定位：插件做工作流，教宿主 AI 审查
// **大体的结构和风格**——不是逐字母纠察）。内部编号不变，只按镜头重组呈现：
// 宿主每跑一次 QA 就被训练一次这套审查框架。
const QA_LENSES = [
  { name: "结构（大形）", intro: "布局契约/构图/版面——这张图的骨架对不对", qs: ["Q3", "Q5", "Q9"] },
  { name: "风格（大感觉）", intro: "配色/装饰/线条/印刷可读/全文统一——这套视觉语言对不对", qs: ["Q6", "Q7"] },
  { name: "保真（说的是原文、画的是契约）", intro: "实体与结构有无出处、有无编造、文字是不是你写的契约——内容对不对", qs: ["Q1", "Q2", "Q4", "Q8"] },
];
function printQaChecklist(QC, indent = "  ") {
  const byQ = {};
  QC.forEach((c) => { const m = /^(Q\d+)/.exec(c); if (m) byQ[m[1]] = c; });
  const known = new Set(QA_LENSES.flatMap((l) => l.qs));
  QA_LENSES.forEach((lens) => {
    const items = lens.qs.map((q) => byQ[q]).filter(Boolean);
    if (!items.length) return;
    console.log(`${indent}── 镜头「${lens.name}」：${lens.intro}`);
    items.forEach((c) => console.log(`${indent}${indent}${c}`));
  });
  // 兜底：新增未归类的 Q 原样打印，防静默丢失
  QC.forEach((c) => { const m = /^(Q\d+)/.exec(c); if (m && !known.has(m[1])) console.log(`${indent}${c}`); });
}

// 从图元数据重拼下一轮 craft 命令（refine 与 qa --fail 共用；sidecar 全量输入）
// 🔴 2026-09-27：不再把活跃修正拼成 --fixes —— 实测（两次独立复现）缺陷文本会被
// 图模型原样印上图（"Q2"/"Baseline" 上图）。修正的正确归宿是写进 --stages 措辞；
// 活跃修正只以「沉淀指引」形式随命令打印（见 settleGuidance）。
function refineCommand(fig) {
  const last = fig.versions[fig.versions.length - 1];
  const sidecarPath = last?.sidecar;
  if (!sidecarPath || !fs.existsSync(sidecarPath)) return null;
  const sc = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
  const q = (s) => `'${String(s || "").replace(/'/g, "'\\''")}'`;
  return [
    "pf craft",
    sc.figureType ? `--figure-type ${sc.figureType}` : "",
    sc.preset ? `--preset ${sc.preset}` : "",
    sc.journal ? `--journal ${sc.journal}` : "",
    sc.suggestedRatio ? `--ratio ${sc.suggestedRatio}` : "",
    sc.at ? `--at ${q(sc.at)}` : "",
    `--intent ${q(sc.intent)}`,
    sc.entities ? `--entities ${q(sc.entities)}` : "",
    sc.stages ? `--stages ${q(sc.stages)}` : "",
    sc.colors ? `--colors ${q(sc.colors)}` : "",
    sc.geometry ? `--geometry ${q(sc.geometry)}` : "",
    `--out temp-refine-${Date.now() % 100000}.txt`,
  ].filter(Boolean).join(" ");
}
// 活跃修正的沉淀指引（随 craft 命令打印）——把修正写进 stages 措辞，不要传 --fixes。
function settleGuidance(fig) {
  const fixes = fig.activeFixes || [];
  if (!fixes.length) return [];
  const lines = [`   ⚠️ 有 ${fixes.length} 条活跃修正——**把每条修正改写进上面的 --stages 措辞后执行**，不要加 --fixes：`];
  fixes.forEach((x, i) => lines.push(`     (${i + 1}) ${x}  → 写成 stages 里的画法/标签约束（如 "no legend" 写进 show 句）`));
  lines.push(`   已在新版图上看守住的修正：pf refine ${fig.figureId} --settle "<修正原文>" 移除（防提示词超 32000 字节预算）。`);
  lines.push(`   缺陷文本一旦进了任何参数，图模型会把它当文字印上图（2026-09-26/27 两次实测）。`);
  return lines;
}
function arg(flag) {
  const hits = [];
  let idx = 0;
  while ((idx = process.argv.indexOf(flag, idx)) > -1) { hits.push(idx); idx += 1; }
  // 🔴 红队实测（2026-09-23 fuzz）：重复 flag 静默取第一个（--at A --at B 用 A 无警告 = AI 传错锚点都不知道）
  if (hits.length > 1) {
    const vals = hits.map((i) => process.argv[i + 1]).filter((v) => v !== undefined);
    if (new Set(vals).size > 1) {
      console.error(`⚠️ 参数 ${flag} 出现了 ${hits.length} 次、值不同（${vals.slice(0, 3).join(" / ").slice(0, 120)}${vals.length > 3 ? "…" : ""}）——只采用第一个值，请检查命令是否拼错`);
    }
  }
  return hits.length ? process.argv[hits[0] + 1] : undefined;
}
function has(flag) { return process.argv.includes(flag); }

// ---- 派生图版本落库（2026-10-15 用户定规「数据库里要有不同版本优化后的图片记录存储」）----
// montage 重排/assemble 成图等"优化后"的图，凡给了 --doc 都复制进项目 figures/derived/
// 并按 <slot>_v<N>.png 递增版本，appendEvent(asset.derived) + derived/index.json 双记录
// ——用户可审计每一版优化：源图是什么、动了什么参数、产物在哪。
function registerDerived(docId, { slot, file, op, source, params }) {
  const derDir = path.join(projectDir(docId), "figures", "derived");
  fs.mkdirSync(derDir, { recursive: true });
  const existing = fs.readdirSync(derDir).filter((f) => f.startsWith(`${slot}_v`) && f.endsWith(".png")).length;
  const version = existing + 1;
  const regPath = path.join(derDir, `${slot}_v${version}.png`);
  fs.copyFileSync(file, regPath);
  const ts = new Date().toISOString();
  const rec = { slot, version, op, source, params, file: regPath, ts };
  appendEvent(docId, "asset.derived", rec);
  const idxPath = path.join(derDir, "index.json");
  const idx = fs.existsSync(idxPath) ? JSON.parse(fs.readFileSync(idxPath, "utf8")) : [];
  idx.push(rec);
  fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2), "utf8");
  return { version, regPath };
}

// ---- --force 收口（2026-09-22）：硬闯必须带理由 ----
// 红队实测：裸 --force 绕遍全部门禁且审计日志查不出动机 = 留痕了也无法追究。
// 定规：--force 必须写成 --force "<一句话理由>"；裸 --force 在任何绕门点一律拒绝。
// 理由随事件落审计日志，pf audit 一键可查。
function forceReason() {
  if (!has("--force")) return null;
  const v = process.argv[process.argv.indexOf("--force") + 1];
  return v && !v.startsWith("--") && v.trim() ? v.trim() : null;
}
function requireForceReason(site) {
  const r = forceReason();
  if (has("--force") && !r) {
    // 🔴 2026-09-23 松绑轮：裸 --force 不再二次拒绝（实测"--force 被拒→再补理由→再被拒"
    // 的双重墙让新手 AI 直接放弃）。放行 + 审计里记"(未给理由)"——绕门照样可见可追究，
    // 但不再拦住着急的用户。可疑理由（"test"/"ok"）照旧点名。
    try {
      appendEvent(path.basename(resolveDoc(arg("--doc"))), "force.refused", { site, at: new Date().toISOString(), resolved: true });
    } catch { /* 无项目上下文时跳过留痕 */ }
    console.error(`⚠️ --force 未带理由（${site}）——已放行，审计记"(未给理由)"。建议下次带一句话理由，pf audit 可查。`);
    return "(未给理由)";
  }
  return r;
}
// 理由软提示（渗透实测：理由纯自觉，"temp-A-foo.txt"这类文件名/乱串也能过）——不拒绝，但当面点破：
function warnSuspiciousReason(reason) {
  if (!reason) return;
  const looksLikeFile = /\.(txt|json|log|md|tmp)$/i.test(reason);
  const tooShort = String(reason).trim().length < 4;
  const junk = /^(test|foo|bar|baz|xxx|asdf|qwerty|temp|tmp)$/i.test(String(reason).trim());
  if (looksLikeFile || tooShort || junk) {
    console.error(`⚠️ 理由「${reason}」不像正经说明——审计会原样公示，写清楚为什么必须绕门（pf audit 可查）`);
  }
}

// ---- 调本地 daemon ----
function callDaemon(action, params = {}, doc) {
  // 🔴 弱模型实测修复（2026-09-21）：daemon.json 缺失时 readFileSync 抛 ENOENT 不可读 ——
  // 用 readDaemonRecord() 判空，报人话指引
  const d = readDaemonRecord();
  if (!d) throw new Error("本地服务未运行（pf open 会自动拉起；或 pf serve 手动启动）");
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ action, params, doc });
    const req = http.request({
      host: "127.0.0.1", port: d.port, path: "/api/cli", method: "POST",
      headers: { "Content-Type": "application/json", "x-pf-cli-token": d.cliToken },
    }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          const data = JSON.parse(raw);
          if (!res.statusCode || res.statusCode >= 400) reject(new Error(data.error || raw));
          else resolve(data.result);
        } catch { reject(new Error(raw)); }
      });
    });
    req.on("error", () => reject(new Error("本地服务未运行（pf open 会自动拉起；或 pf serve 手动启动）")));
    req.end(body);
  });
}

function readDaemonRecord() {
  try { return JSON.parse(fs.readFileSync(DAEMON_PATH, "utf8")); } catch { return null; }
}

// 端口真探活：daemon.json 可能是僵尸记录（进程死了记录还在 → pf open 会打开死地址）
function portResponds(port, timeout = 800) {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port }, () => { s.destroy(); resolve(true); });
    s.on("error", () => resolve(false));
    s.setTimeout(timeout, () => { s.destroy(); resolve(false); });
  });
}
async function daemonAlive() {
  const d = readDaemonRecord();
  if (!d?.port || process.pid === d.pid) return false;
  return portResponds(d.port);
}

const STOP_FLAG = path.join(PF_DIR, "stopped.flag"); // pf stop 写入：托盘自愈看到就不再拉活
const TRAY_JSON = path.join(PF_DIR, "tray.json");    // 托盘心跳（tray.py 每 10s 刷）

// ---- 托盘：pf open 自动拉起，不让用户手动管 ----
// 用户关掉 GUI 窗口后，托盘是唯一可见入口 —— 没有它用户会"误关闭"（以为程序没了/关不干净）
function trayHeartbeat() {
  try {
    const t = JSON.parse(fs.readFileSync(TRAY_JSON, "utf8"));
    // 🔴 pf-tray.py 写的是 time.time()（秒），Date.now() 是毫秒 —— 单位适配，别再踩
    const ms = t.t < 1e12 ? t.t * 1000 : t.t;
    return Date.now() - ms < 40000 ? t : null; // 心跳 40s 内算活着
  } catch { return null; }
}
function trayFrozen() {
  // 🔴 实测（2026-09-21）：托盘进程存在但心跳停更（>40s）= 进程被挂起/冻结
  //（宿主会话回收、系统睡眠恢复都可能触发）——不是死亡，watch_loop 也跟着停摆，
  // daemon 死了没人拉。单实例守卫看的是心跳新鲜度，此时新实例可以正常顶上。
  try {
    const t = JSON.parse(fs.readFileSync(TRAY_JSON, "utf8"));
    const ms = t.t < 1e12 ? t.t * 1000 : t.t;
    if (Date.now() - ms < 40000) return null;
    process.kill(t.pid, 0); // 抛 ESRCH = 记录是死的（正常未运行）；不抛 = 进程在但冻结
    return t;
  } catch { return null; }
}
function ensureTray() {
  // 🔴 环境自适应（2026-09-21 用户定规）：托盘是 Windows 桌面专属（pythonw + pystray）。
  // 无头环境（Codex Cloud/SSH 容器）或非 Windows 不许尝试——之前 spawn("pythonw") 报错被吞后
  // 还要干等 12s 心跳，每条 pf open 都卡 12 秒。跳过并明说，审批走 CLI/GUI 地址即可。
  if (isHeadless()) return { state: "headless" };
  if (process.platform !== "win32") return { state: "unsupported" };
  if (trayHeartbeat()) return { state: "running" };
  const wasFrozen = !!trayFrozen();
  // 🔴 实测（2026-09-20）：stdio:'ignore'（NUL）会让 pythonw/pystray 直接 exit 2；
  // stdio 必须重定向到真实文件。且必须 detached —— 否则 CLI 退出时托盘被一起回收。
  let out = -1;
  try {
    out = fs.openSync(path.join(PF_DIR, "tray.log"), "a");
  } catch {}
  try {
    const child = spawn("pythonw", [path.join(__dirname, "..", "tray", "pf-tray.py")], {
      detached: true, stdio: ["ignore", out, out], windowsHide: true,
    });
    child.on("error", () => {});
    child.unref();
  } catch { return { state: "failed" }; }
  // tray.py 第一行就写心跳（见 pf-tray.py main），起不来 = python/pystray 缺失
  // 🔴 实测 pythonw 冷启动 import pystray+PIL 可超过 12s —— 等不到别判死刑，
  //    返回 pending（托盘可能几秒后才出现，pf doctor / 下次命令的心跳能确认）
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    if (trayHeartbeat()) return { state: wasFrozen ? "restarted" : "started", frozen: wasFrozen };
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  }
  return { state: "pending", frozen: wasFrozen };
}

// ---- 拉起 daemon（分离进程）----
async function ensureDaemon() {
  if (await daemonAlive()) return;
  fs.rmSync(DAEMON_PATH, { force: true }); // 清掉僵尸记录再启动
  fs.rmSync(STOP_FLAG, { force: true }); // 重新开工 = 清掉手动停止标记，托盘自愈恢复工作
  const cfg = loadConfig();
  const port = cfg.port || (await import("../src/config.mjs")).DEFAULT_PORT;
  // 🔴 stdio 用文件重定向，不用 "ignore"（NUL）：托盘同款教训（2026-09-20 实测 NUL 句柄
  // 会弄死 pythonw）；daemon 前台实测正常、后台秒死且零输出，文件日志至少留下临终证据
  let dout = -1;
  try {
    fs.mkdirSync(path.join(PF_DIR, "logs"), { recursive: true });
    dout = fs.openSync(path.join(PF_DIR, "logs", "daemon.log"), "a");
    fs.writeSync(dout, `\n---- spawn ${new Date().toISOString()} port=${port} pid(父)=${process.pid} ----\n`);
  } catch {}
  const child = spawn(process.execPath, [path.join(__dirname, "..", "src", "server.mjs"), String(port)], {
    detached: true, stdio: dout === -1 ? "ignore" : ["ignore", dout, dout],
    windowsHide: true,
  });
  child.unref();
  // 轮询等 daemon.json 就绪
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) {
    try {
      const d = JSON.parse(fs.readFileSync(DAEMON_PATH, "utf8"));
      if (d.port === port) return;
    } catch {}
  }
}

// ---- 浏览器独立窗口 ----
// 🔴 环境自适应（2026-09-21）：返回 false = 没开成（无头/无浏览器），调用方按"只给 URL"降级。
// 之前 Linux 无 `cmd` 时 spawn error 无监听会直接崩 CLI；Edge/Chrome 候选也是纯 Windows 路径。
function openWindow(url2) {
  if (isHeadless()) return false;
  const opts = { detached: true, stdio: "ignore", windowsHide: true };
  const safe = (cmd, args) => {
    try {
      const c = spawn(cmd, args, opts);
      c.on("error", () => {}); // 没装/没有该命令 → 静默降级，不许崩 CLI
      c.unref();
      return true;
    } catch { return false; }
  };
  if (process.platform === "darwin") return safe("open", [url2]);
  if (process.platform !== "win32") return safe("xdg-open", [url2]);
  const candidates = [
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft/Edge/Application/msedge.exe"),
    process.env["ProgramFiles"] && path.join(process.env["ProgramFiles"], "Microsoft/Edge/Application/msedge.exe"),
    process.env["ProgramFiles"] && path.join(process.env["ProgramFiles"], "Google/Chrome/Application/chrome.exe"),
    process.env["LOCALAPPDATA"] && path.join(process.env["LOCALAPPDATA"], "Google/Chrome/Application/chrome.exe"),
  ].filter(Boolean);
  const browser = candidates.find((c) => fs.existsSync(c));
  if (browser) {
    // --app= 独立窗口：没有地址栏、关掉不影响 daemon
    return safe(browser, [`--app=${url2}`, `--user-data-dir=${path.join(PF_DIR, "browser-profile")}`]);
  }
  return safe("cmd", ["/c", "start", "", url2]);
}

// ================= 子命令 =================
const [cmd, ...rest] = process.argv.slice(2);

// ---- 版本更新提示（每天最多查一次，任何失败静默跳过，绝不阻塞主命令）----
// 用户停在旧版本就看不到新能力，所以：查到 npm 上有更新 → 提示 + 带上该版本
// 改了什么（changelog 从官网端点取，与 skill 的 version.json 同一套发布位）。
// 🔴 只打固定 https + 固定 host（registry.npmjs.org / promptfigure.top），
//    不接受任何用户输入拼 URL；网络异常/超时/解析失败一律当没这功能。
const UPDATE_CACHE = path.join(PF_DIR, "update-check.json");
const UPDATE_TTL_MS = 24 * 3600 * 1000;

async function fetchLatestVersion() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch("https://registry.npmjs.org/promptfigure/latest", { signal: ctrl.signal });
    if (!res.ok) return "";
    const j = await res.json();
    return String(j?.version || "");
  } finally {
    clearTimeout(timer);
  }
}

async function fetchReleaseNotes(latest) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch("https://promptfigure.top/downloads/pf-changelog.json", { signal: ctrl.signal });
    if (!res.ok) return [];
    const j = await res.json();
    if (String(j?.version || "") !== latest) return [];
    return Array.isArray(j.notes) ? j.notes.slice(0, 3).map((s) => String(s)) : [];
  } finally {
    clearTimeout(timer);
  }
}

// semver 比较：只有 registry 的 latest 严格大于本地版本才提示
// （此前只做字符串不等比较——latest=0.3.0 而本地 0.3.2 时误报「有新版本」）
function isNewer(latest, local) {
  const parse = (v) => String(v || "").replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const a = parse(latest), b = parse(local);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

function printUpdateHint(latest, notes) {
  console.log(`⬆️  pf 有新版本 v${latest}（当前 v${VERSION}）—— 升级：npm i -g promptfigure`);
  for (const n of notes) console.log(`   · ${n}`);
}

async function maybeHintUpdate() {
  if (process.env.PF_NO_UPDATE_CHECK || has("--json")) return;
  try {
    const now = Date.now();
    let cache = {};
    try { cache = JSON.parse(fs.readFileSync(UPDATE_CACHE, "utf8")); } catch { /* 首次/损坏：当没查过 */ }
    if (Number(cache.checked_at) && now - Number(cache.checked_at) < UPDATE_TTL_MS) {
      if (cache.latest && isNewer(cache.latest, VERSION)) printUpdateHint(String(cache.latest), Array.isArray(cache.notes) ? cache.notes : []);
      return;
    }
    const latest = await fetchLatestVersion();
    const notes = latest && isNewer(latest, VERSION) ? await fetchReleaseNotes(latest) : [];
    try { fs.writeFileSync(UPDATE_CACHE, JSON.stringify({ checked_at: now, latest, notes })); } catch { /* 缓存写不进就每次现查，功能不依赖它 */ }
    if (latest && isNewer(latest, VERSION)) printUpdateHint(latest, notes);
  } catch { /* 更新检查是锦上添花：任何意外都不许影响用户真正的命令 */ }
}

async function main() {
  ensureDirs();
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") { console.log(HELP); return; }
  if (cmd === "--version" || cmd === "-v") { console.log(VERSION); return; }
  await maybeHintUpdate();

  switch (cmd) {
    case "login": {
      const key = rest[0];
      if (key && key.startsWith("pf_")) {
        saveConfig({ key });
        console.log(`✅ key 已保存（${maskKey(key)}）→ ${CONFIG_PATH}`);
        return;
      }
      console.log(`
① 浏览器打开 https://promptfigure.top → 登录 → 控制台 → API Keys → 新建
   （额度规则见官网：默认扣套餐额度，额度用完自动按次扣余额）
② 然后执行：
   pf login pf_你复制来的key
`);
      return;
    }

    case "open": {
      const filePath = path.resolve(toWinPath(rest[0]) || die("用法：pf open <论文路径>"));
      if (!fs.existsSync(filePath)) die(`文件不存在：${filePath}`);
      const kind = docKind(filePath); // .wps/.doc 等会在这里被拒绝
      const docId = docIdOf(filePath);
      const parsed = await parseDocument(filePath);

      const meta = {
        docId, source: filePath, fileName: path.basename(filePath), kind,
        parsedAt: new Date().toISOString(),
        blocks: parsed.blocks, outline: parsed.outline,
        figures: readMeta(docId)?.figures || {},
        // 🔴 重开文档要保留用户已设的风格卡（2026-09-21 弱模型实测：open 一次卡片蒸发，
        // 之后 craft 全部失去统一风格 → 全文画风割裂复发）
        styleCard: readMeta(docId)?.styleCard,
      };
      projectDir(docId);

      // LaTeX：找本机引擎编译成 PDF 给 GUI 渲染（产物只进插件目录，零侵入）
      // 失败不阻塞打开 —— GUI 自动降级为文本渲染，并把失败原因打在这里
      if (kind === "tex") {
        process.stdout.write("⏳ 正在用本地 TeX 引擎编译（首次可能较慢）...\n");
        const { compileTex } = await import("../src/doc/texbuild.mjs");
        const built = compileTex(filePath, { outDir: projectDir(docId) });
        if (built.ok) {
          meta.pdfReady = true;
          meta.pdfEngine = built.engine;
          console.log(`✅ 编译成功（${built.engine}）→ GUI 将显示排版后的 PDF`);
        } else {
          meta.pdfReady = false;
          meta.pdfFailReason = built.reason;
          console.log(`⚠️ 编译失败：${built.message}`);
          if (built.logTail) console.log(built.logTail.split("\n").slice(-12).join("\n"));
          console.log("   本次先以文本模式预览；修复环境后执行 pf doc compile 重编译");
        }
      }

      fs.writeFileSync(path.join(projectDir(docId), "meta.json"), JSON.stringify(meta, null, 2));
      // 显式记录最近文档（config.lastDocId）：不带 --doc 的命令解析优先用它，
      // 防止被 e2e 测试等新建项目按 mtime 抢走"最近"（2026-09-21 实测污染）
      const { saveConfig } = await import("../src/config.mjs");
      saveConfig({ lastDocId: docId });
      // 🔴 执行留证（2026-09-23）：打开文档本身 = "读过"的第一条证据，craft 留证门对账用
      logEvidence(docId, "doc.open", { file: path.basename(filePath) });

      await ensureDaemon();
      const d = JSON.parse(fs.readFileSync(DAEMON_PATH, "utf8"));
      // 托盘自动拉起：关掉 GUI 窗口后托盘图标仍在（打开工作台/重启/退出），不会"误关闭"
      const url2 = `http://127.0.0.1:${d.port}/?doc=${docId}&token=${d.guiToken}`;
      const tr = ensureTray();
      if (tr.state === "running") console.log(`   托盘:   已在运行（关窗口后从托盘可重新打开工作台）`);
      else if (tr.state === "started") console.log(`   托盘:   已自动启动（关窗口不影响服务；真正退出请用托盘菜单）`);
      else if (tr.state === "restarted") console.log(`   托盘:   旧托盘进程被冻结（心跳停更）——已用新实例顶替，服务恢复受保护`);
      else if (tr.state === "headless") console.log(`   环境:   无头（无 GUI）——跳过托盘/开窗；审批与预览走 CLI（pf review / pf qa / pf doc read）`);
      else if (tr.state === "unsupported") console.log(`   环境:   非 Windows——托盘不可用；GUI 地址可手动浏览器打开（见下）`);
      else console.log(`   托盘:   启动中/未确认 —— python 冷启动较慢时几秒后图标才出现；pf doctor 可查状态`);
      const opened = openWindow(url2);
      console.log(`✅ 已打开 ${meta.fileName}`);
      console.log(`   docId:  ${docId}`);
      console.log(`   章节:   ${parsed.outline.length} 个 / 段落: ${parsed.blocks.filter((b) => b.type === "para").length} 段`);
      if (!opened) console.log(`   窗口:   未自动打开（无头环境/无浏览器）——GUI 地址: ${url2}`);
      console.log(`   提示：关闭窗口不会停掉本地服务（AI 命令继续可用）；${tr.state === "headless" || tr.state === "unsupported" ? "停止服务用 pf stop" : "真正退出走托盘菜单或 pf stop"}`);
      return;
    }

    case "status": {
      const dir = resolveDoc(arg("--doc"));
      const docId = path.basename(dir);
      const meta = readMeta(docId);
      const figures = Object.keys(meta.figures || {});
      const origFigs = (meta.blocks || []).filter((b) => b.images?.length).length;
      console.log(`文档: ${meta.fileName}  (${docId})`);
      console.log(`图:   已生成 ${figures.length} 张 / 论文原图 ${origFigs} 张（pf doc figures 看清单）`);
      if (figures.length > 1) console.log(`⏭ 多图进度/资产体检: pf board（每张图做到哪一步、有没有坏，一眼看完）`);
      console.log(`风格卡: ${meta.styleCard?.text ? "已设置 ✅" : "未设置 ⚠️（pf style set）"}`);
      // 优雅降级：审批状态走 daemon，服务没起也不让 status 整体失败——
      // 宿主 AI 看到 exit!=0 会误判环境坏了（2026-09-21 实测）
      try {
        const r = await callDaemon("review.status", {}, docId);
        console.log(`待审批: ${r.pending.length} / 已通过: ${r.approved.length} / 被驳回: ${r.rejected.length}`);
      } catch {
        console.log(`审批状态: 暂不可查（本地服务未运行，pf open 恢复）`);
      }
      for (const e of readEvents(docId, 5)) console.log(`  · ${e.t?.slice(11, 19)} ${e.type}${e.figure ? " " + e.figure : ""}`);
      // 🔴 状态结尾必带下一步（2026-09-21 定规：任何命令的输出都不许是死路）
      const nx = computeNext({ docId, meta, cfg: loadConfig() }, { readReview, readAnchors });
      console.log(`\n⏭ 下一步: ${nx.cmd}`);
      console.log(`   （${nx.why}）`);
      return;
    }

    case "provenance": {
      // 🔴 图级溯源回放（2026-10-13 provenance P0，对标调研见 ref-provenance-research.md）：
      // 任意新会话的宿主 AI 一条命令恢复这张图的全部上下文——锚点/原文摘录/原图与数据文件
      // （绝对路径+sha1，tex 来源）/版本史/QA 结论/活跃修正。老项目无字段时优雅降级。
      const docId = path.basename(resolveDoc(arg("--doc")));
      const meta = readMeta(docId);
      const atArgP = arg("--at");
      const fidP = rest[0] && !rest[0].startsWith("--") ? rest[0] : null;
      if (!fidP && !atArgP) {
        die('用法: pf provenance <figureId> 或 pf provenance --at "§3.2 ¶2"（--doc 缺省用当前项目）',
          "pf doc figures 看现有图与锚点；pf provenance 的答案也可以直接喂给用户问“这张图数据哪来的”");
      }
      const anchors = readAnchors(docId) || [];
      let anchor = null, fig = null;
      if (fidP) {
        fig = meta.figures?.[fidP];
        if (!fig) die(`未知 figureId "${fidP}"（pf doc figures 看现有图）`);
        anchor = anchors.find((a) => a.figure === fidP) || null;
      } else {
        anchor = anchors.find((a) => a.placement?.at === atArgP) || null;
        fig = anchor?.figure ? meta.figures?.[anchor.figure] : null;
        if (!anchor) console.error("⚠️ 该位置没有锚点——只显示原文上下文与同节原图溯源。");
      }
      const at = anchor?.placement?.at || atArgP;
      console.log("═══ 图级溯源（provenance）═══");
      console.log(`锚点: ${at || "(未锚定)"}${anchor ? ` | figure=${anchor.figure || "(未链接)"} | side=${anchor.placement?.side || "-"}` : ""}`);
      if (anchor?.placement?.quote) console.log(`锚点引文: ${anchor.placement.quote.slice(0, 120)}`);
      if (fig) {
        const last = (fig.versions || []).at(-1);
        console.log(`渲染: ${fig.versions?.length || 0} 版${last ? ` | 最新 ${last.file}（${last.model}，${last.at}）` : ""} | QA: ${JSON.stringify(fig.qa ?? "未跑")} | 活跃修正: ${(fig.activeFixes || []).length}`);
      } else {
        console.log("渲染: 该锚点尚无已链接的图（未 render 或老项目未链 figure）");
      }
      // 原文摘录：锚点 ±1 段（on-demand 从 blocks 计算——老项目零迁移可用）
      if (at) {
        try {
          const target = resolveRef(meta.blocks || [], at);
          const idx = (meta.blocks || []).findIndex((b) => b.secPath === target.secPath && b.para === target.para);
          if (idx >= 0) {
            const near = (meta.blocks || []).slice(Math.max(0, idx - 1), idx + 2)
              .filter((b) => b.type === "para" || b.type === "caption");
            console.log("── 原文摘录（锚点 ±1 段）──");
            near.forEach((b) => console.log(`  [${b.type === "caption" ? "图注" : "段落"} ${b.secPath} ¶${b.para}] ${(b.text || "").slice(0, 200)}`));
            // 同节原图/数据文件溯源（tex 来源才有 materials；docx/pdf 优雅降级提示）
            const caps = (meta.blocks || []).filter((b) => b.type === "caption" && b.materials?.length && b.secPath === target.secPath);
            if (caps.length) {
              console.log("── 同节原图/数据文件（tex provenance，sha1 校验防替换）──");
              for (const c of caps) {
                console.log(`  [图注 ${c.secPath} ¶${c.para}] ${(c.text || "").slice(0, 80)}${c.labels?.length ? `  label: ${c.labels.join(", ")}` : ""}`);
                for (const m2 of c.materials) {
                  console.log(`    ${m2.role}: ${m2.path}${m2.sha1 ? ` (sha1 ${m2.sha1.slice(0, 12)}…)` : " (⚠️ 文件不存在或解析不到)"}`);
                }
                if (c.refParagraphs?.length) console.log(`    被引用于: ${c.refParagraphs.map((r2) => `${r2.secPath} ¶${r2.para}`).join(", ")}`);
              }
            }
          }
        } catch (e) {
          console.error(`⚠️ --at 引用无效：${e.message}`);
        }
      }
      return;
    }

    case "refs": {
      // 🔴 参考库检索（2026-10-14 参考链路 P0）：从顶会真实论文图（PaperBananaBench，
      // NeurIPS 2025 方法图 590 张）检索同模块画法，宿主 AI 多模态看图提炼规范画法。
      // 位置：distill 之后、craft 之前。查询包（本名+同义词+类别族+操作动词）由宿主 AI
      // 生成，本命令只做确定性 BM25 排序——零依赖、零 API 成本、离线可用。
      const q0 = rest[0] && !rest[0].startsWith("--") ? rest[0] : null;
      const qPackArg = arg("--queries");
      const queries = [];
      if (q0) queries.push(q0);
      if (qPackArg) for (const q of String(qPackArg).split(/[;|]/)) if (q.trim()) queries.push(q.trim());
      if (!queries.length) {
        die('用法: pf refs "<模块名/意图>" --queries "同义词;类别族;操作动词" [--k 5] [--min 0.15] [--json]',
          "查询包由你（宿主 AI）扩写：模块本名 + 英文同义词 + 类别族（如 augmentation module）+ 操作动词。" +
          "检索是文本 BM25——模块名搜不到时类别族大概率搜得到；全没中走原语映射兜底（SKILL.md 零命中链）。");
      }
      const k = Math.max(1, Math.min(20, parseInt(arg("--k") || "5", 10) || 5));
      const minRatio = parseFloat(arg("--min") || "0.15") || 0.15;
      const refsDir = arg("--refs-dir") || path.join(os.homedir(), ".promptfigure", "references");
      const idx = loadRefsIndex(refsDir);
      if (!idx || !idx.docs.length) {
        die(`参考库不存在或为空：${refsDir}`,
          "下载 PaperBananaBench（hf-mirror.com/datasets/dwzhu/PaperBananaBench）解压到该目录，或用 --refs-dir 指向已有库");
      }
      const { results, total, topScore } = idx.search(queries, { k, minScore: minRatio });
      if (has("--json")) {
        console.log(JSON.stringify({ queries, totalCandidates: total, topScore, results: results.map((r) => ({ id: r.id, score: +(r.score / (topScore || 1)).toFixed(3), nQueries: r.nQueries, category: r.fig.figType, image: r.fig.imageAbs, caption: r.fig.caption, excerpt: r.bestChunk })) }, null, 1));
        return;
      }
      console.log(`═══ pf refs 参考检索（${idx.docs.length} 张顶会真实论文图）═══`);
      console.log(`查询包: ${queries.join(" | ")}`);
      if (!results.length) {
        console.log("\n❌ 零命中（阈值 " + (minRatio * 100).toFixed(0) + "% of top）——不要发明具象图标！走零命中链：");
        console.log("   ① 从 provenance/materials 取该模块的真实数据类型（图像/特征图/向量/图结构/标量…）");
        console.log("   ② 按原语映射写 show 句（SKILL.md 原语表）；③ 或改用用户原图 --ref 临摹");
        return;
      }
      results.forEach((r, i) => {
        console.log(`\n${i + 1}. [${(r.score / (topScore || 1)).toFixed(2)}] ${r.id} · ${r.fig.figType || "?"}${r.nQueries > 1 ? ` · ${r.nQueries} 个查询命中` : ""}`);
        console.log(`   图: ${r.fig.imageAbs}`);
        console.log(`   图注: ${r.fig.caption.slice(0, 220)}${r.fig.caption.length > 220 ? "…" : ""}`);
        if (r.bestChunk) console.log(`   正文: ${r.bestChunk.slice(0, 220)}…`);
      });
      console.log("\n── 使用规则（宿主 AI 必读）──");
      console.log("• 逐张【打开图片看】回答两问：① 这张图画的方法模块与我们要画的是同类吗？② 画法值得模仿吗（结构清晰/学术规范/母题可提炼）？两个都过才把画法写进 show 句");
      console.log("• 只提炼画法（怎么画），不搬内容（画什么）——内容必须来自用户文档");
      console.log("• 最相关的图可直接临摹布局: pf render --ref \"<图路径>\" …");
      console.log("• 全部不过 = 零命中 → show 句由原语映射生成（SKILL.md），并提示用户可补参考图");
      return;
    }

    case "render-icon": {
      // 🔴 分部分出图（2026-10-14 用户定规「一张图要多图层多部分区分开」）：整图一把渲
      // 画不好复杂小图标——icon 槽位（{{icon:名|描述}}）的小图单独渲染，compose 再统一贴入。
      // 每个 icon 一次 standard 小图渲染（1:1 白底无字），渲完登记进伴随 JSON icons 段，
      // compose 自动查表贴入。--dry-run 只列清单不烧额度。
      const pFileI = toWinPath(arg("--prompt-file"));
      if (!pFileI) die("用法: pf render-icon --prompt-file <p.txt> [--name <icon名> | --all] [--model standard]",
        "icon 槽位在 craft --scene 里用 {{icon:名|描述}} 声明；伴随 JSON 的 slots 里 kind=icon 的就是待渲小图。");
      const scI = readCraftSidecar(pFileI);
      if (!scI) die(`伴随 JSON 不存在（${path.basename(craftSidecarPath(pFileI))}）——先 pf craft --scene 产出`, "icon 小图的描述/配色契约都在伴随 JSON 里，没有它渲不了");
      const iconSlots = (scI.slots || []).filter((s) => s.kind === "icon");
      if (!iconSlots.length) die("伴随 JSON 里没有 icon 槽位（scene 里没写 {{icon:名|描述}}）——只有复杂图标才单独渲；几何元素（箭头/方框）让整图直接画就行。");
      const nameArg = arg("--name");
      const targets = nameArg ? iconSlots.filter((s) => s.name === nameArg) : iconSlots;
      if (nameArg && !targets.length) die(`找不到 icon 槽位 "${nameArg}"——伴随 JSON 里有：${iconSlots.map((s) => s.name).join("、")}`);
      const docIdI = path.basename(resolveDoc(arg("--doc")));
      const styleI = scI.colors ? `Colour palette: ${scI.colors}.` : "Colour palette: restrained academic palette (Okabe-Ito colourblind-safe).";
      if (has("--dry-run")) {
        console.log(`【DRY-RUN】将渲 ${targets.length} 张 icon 小图（${arg("--model") || "standard"} · 1:1 白底无字）：`);
        targets.forEach((s) => console.log(`  · ${s.name} ← ${s.value}`));
        return;
      }
      for (const s of targets) {
        const iconPrompt =
          `Small standalone icon illustration on a pure white background, no text, no letters, no numbers, ` +
          `publication-grade flat vector style, clean sharp edges, centered with generous margins: ${s.value}. ` +
          `${styleI} No watermark, no drop shadows, no gradient decoration, no photorealistic textures.`;
        const outI = await callDaemon("render", {
          prompt: iconPrompt, model: arg("--model") || "standard",
          promptFile: pFileI, at: scI.at || die("伴随 JSON 缺 at 锚点"), side: "after",
          ratio: "1:1", force: false, forceReason: null, sidecar: path.resolve(craftSidecarPath(pFileI)),
          ref: null, refQuality: null, replica: false,
        }, docIdI);
        // 从图库取渲好的文件，复制成 icon 素材（compose 查表用）
        const metaI = readMeta(docIdI);
        const figI = (metaI.figures || {})[outI.figureId];
        const relI = figI?.versions?.[figI.versions.length - 1]?.file;
        if (!relI) { console.error(`⚠️ ${s.name}：渲好了但取不到图文件（figureId ${outI.figureId}）——跳过登记`); continue; }
        const absI = path.join(projectDir(docIdI), relI);
        const iconDir = path.join(projectDir(docIdI), "figures", "icons");
        fs.mkdirSync(iconDir, { recursive: true });
        const iconPath = path.join(iconDir, `${s.name}.png`);
        fs.copyFileSync(absI, iconPath);
        scI.icons = { ...(scI.icons || {}), [s.name]: iconPath };
        console.log(`✅ icon "${s.name}" 已渲并登记：${iconPath}（figureId ${outI.figureId}，留库可审计）`);
        try {
          appendEvent(docIdI, "icon.rendered", { name: s.name, figureId: outI.figureId, file: iconPath, at: new Date().toISOString() });
        } catch { /* 记账失败不阻塞 */ }
      }
      fs.writeFileSync(path.resolve(craftSidecarPath(pFileI)), JSON.stringify(scI, null, 2), "utf8");
      const leftI = iconSlots.filter((s) => !(scI.icons || {})[s.name]);
      console.log(leftI.length ? `⏭ 未渲完：${leftI.map((s) => s.name).join("、")}（--name 单独渲）` : "⏭ 全部 icon 就绪 → 重跑 pf compose 贴入");
      return;
    }

    case "assemble": {
      // 🔴 模板装配（2026-10-14 二轮返工）：**排版交给浏览器引擎**（高星项目共识——mermaid/D2
      // 用 dagre/ELK，AutoFigure 用真实渲染器；手写坐标实锤出留白/错位）。本命令发 HTML/CSS
      // （flexbox 拉平等宽、行高按内容实测、文字由 Chromium 排），--png 用本机 Chrome/Edge
      // headless 截图。文字拼错/卡数错/对齐歪这类整图渲染问题整类消灭。
      const pFileA = toWinPath(arg("--prompt-file"));
      const scA = pFileA ? readCraftSidecar(pFileA) : null;
      if (!scA) die("用法: pf assemble --prompt-file <p.txt> [--out final.html] [--png final.png] [--map \"槽名=卡号,...\"]",
        "需要 craft 伴随 JSON（stages + slots + icons）；数据齐了才装配得了。");
      const { buildTemplateSvg } = await import("../src/template.mjs");
      const { buildPalette } = await import("../src/figure-catalog.mjs");
      const pal = buildPalette({ colors: scA.colors || "" });
      // asset 路径表：slot.value 即路径（craft 已存）；icons 查登记段；
      // crop 槽位预裁剪（宿主 AI 看图定的真实像素坐标，量高比/内嵌吃裁后文件）
      const assetPaths = {};
      for (const s of scA.slots || []) if (s.kind === "asset") assetPaths[s.name] = s.value;
      const { prepareAssetImage } = await import("../src/assets.mjs");
      for (const s of scA.slots || []) {
        if (s.kind === "asset" && s.crop && !s.refOnly) {
          const p0 = assetPaths[s.name];
          if (p0) assetPaths[s.name] = await prepareAssetImage(p0, s.crop);
        }
      }
      const { html, placed, geometry, assignMeta, skipped, clashes, emptyCards } = await buildTemplateSvg({
        stagesStr: scA.stages, slots: scA.slots || [], iconPaths: scA.icons || {},
        assetPaths, palette: pal, ratio: scA.suggestedRatio || "1:1", map: arg("--map") || "",
      });
      const outHtml = path.isAbsolute(toWinPath(arg("--out")) || "") ? toWinPath(arg("--out"))
        : path.resolve(toWinPath(arg("--out")) || (pFileA ? pFileA.replace(/\.txt$/i, "") + ".html" : "assembled.html"));
      fs.writeFileSync(outHtml, html, "utf8");
      console.log(`═══ pf assemble：模板装配（HTML/CSS 排版 + Chromium 光栅化）═══`);
      console.log(`  📐 网格 ${geometry.rows}×${geometry.cols} · 画布 ${geometry.width}×${geometry.height} · 卡 ${geometry.cardW}×${geometry.cardH} · 边距 ${geometry.margin} 间隙 ${geometry.gap}`);
      const stageTitles = (scA.stages || "").split("||").map((s) => s.split("|")[0].trim());
      for (const p of placed) {
        // 找该图对应的槽位名：crop 预裁剪会改文件名（源名_c...png），按源文件名主干包含匹配
        const slotHit = (scA.slots || []).find((s) => {
          const v = s.kind === "icon" ? (scA.icons || {})[s.name] : (assetPaths[s.name] || s.value);
          if (v === p.src) return true;
          const stem = path.basename(String(s.value)).replace(/\.\w+$/i, "");
          return String(p.src).includes(stem);
        });
        const am = slotHit ? (assignMeta || {})[slotHit.name] : null;
        const how = am ? (am.how === "map" ? "显式映射" : am.how === "scene" ? "scene语义归属" : "顺序兜底") : "?";
        const stage = stageTitles[p.card - 1] || "";
        console.log(`  ✅ 卡${p.card}「${stage}」${p.kind === "asset" ? "真图" : "icon"} ← ${String(p.src).split(/[\\/]/).pop()}  [${how}]`);
      }
      for (const nm of skipped || []) console.log(`  🚫 槽位 "${nm}" 是方法参考图（scene 标了仅参考/never pasted）——不进卡面。要贴就删掉参考措辞重 craft。`);
      for (const c of clashes || []) console.log(`  ⚠️ ${c}`);
      // 🔴 省略清单随成图回显（2026-10-15 用户定规「省略必须给理由，拿不准问用户」）：
      // 用户看装配结果时应该同时看到"原图哪些模块没进图、为什么"——没这段 = 没交代
      const recon = scA.reconciliation || [];
      if (recon.length) {
        console.log(`  📋 省略清单（原文模块未进图）：`);
        for (const o of recon) console.log(`     · ${o.module}${o.reason ? ` = ${o.reason}` : "（⚠️ 没写理由——必须补理由或问用户）"}`);
      }
      // 🔴 成图质量标准验收（2026-10-16 用户定规「要形成一个标准」，细则见 SKILL.md
      // 「成图质量标准」节）：sidecar 必须带 acceptance 块，装配时逐项回显供宿主对照；
      // 缺失 = 告警；enhancement 出现白名单外动作（清晰度提升/内容重绘类措辞）= 阻断。
      const acc = scA.acceptance;
      if (!acc || !acc.story || !acc.segmentation || !acc.alignment) {
        console.log(`  ⚠️ 验收块缺失：sidecar 没有 acceptance{story,segmentation,alignment,enhancement}——按 SKILL.md「成图质量标准」补齐后再交付。没有标准 = 又回到凭感觉拼接。`);
      } else {
        console.log(`  🎯 验收标准（交付前逐条对照）：`);
        console.log(`     · 这张图要让读者记住：${acc.story}`);
        console.log(`     · 分段 = ${acc.segmentation}`);
        console.log(`     · 对齐 = ${acc.alignment}`);
        const enh = acc.enhancement || [];
        if (enh.length) {
          for (const e of enh) console.log(`     · 增强声明：${e}`);
          if (enh.some((e) => /超分|去噪|修复|super.?resolution|denoise|restor|sharpen/i.test(String(e)))) {
            die(`acceptance.enhancement 含白名单外动作（清晰度提升/内容重绘类）——SKILL.md 优化白名单只许显示性增强/结构编辑，先改声明再装配。`);
          }
        } else {
          console.log(`     · 增强声明：无（全部原样引用——确认这是有意选择而不是漏报）`);
        }
      }
      // 🔴 语义审查告警（grid6 教训：结果图塞进方法卡没人拦）。词面无关联≠一定错，但必须宿主
      // AI 亲眼看图核对——方法卡应放方法过程图，结果卡才放结果图。
      const reviewNeeded = [];
      for (const p of placed) {
        const slotHit = (scA.slots || []).find((s) => {
          const v = s.kind === "icon" ? (scA.icons || {})[s.name] : (assetPaths[s.name] || s.value);
          if (v === p.src) return true;
          return String(p.src).includes(path.basename(String(s.value)).replace(/\.\w+$/i, ""));
        });
        const am = slotHit ? (assignMeta || {})[slotHit.name] : null;
        if (am && (am.how === "order" || am.how === "map")) reviewNeeded.push(`卡${p.card}「${stageTitles[p.card - 1] || ""}」← ${String(p.src).split(/[\\/]/).pop()}（${am.how === "order" ? "scene 里没写归属句子" : "显式指定"}）`);
        // 🔴 操作位贴原图拦截（2026-10-15 用户定规「操作卡该画示意图而不是结果」）：词面判为
        // 操作/方法步的卡贴了原图整图（无 crop）——grid6 Denoise 卡被塞结果图的同类错配，
        // 装配端再拦一道，宿主必须亲眼确认或改道。
        if (slotHit && slotHit.kind === "asset" && slotHit.role === "operation" && !slotHit.crop && !slotHit.refOnly) {
          reviewNeeded.push(`卡${p.card}「${stageTitles[p.card - 1] || ""}」是**操作/方法步**，贴的却是原图整图（${String(p.src).split(/[\\/]/).pop()}）——亲眼确认它是方法示意图而非结果图；不符就改 {{icon:名|示意图描述}} 画示意，或加 crop= 只裁方法部分`);
        }
      }
      if (reviewNeeded.length) {
        console.log(`  ⚠️ 图-卡语义未过词面校验，装配后必须逐卡看图核对（方法卡=方法过程图，结果卡=结果图）：`);
        for (const r of reviewNeeded) console.log(`     · ${r}`);
        console.log(`     不符就改 scene 槽位归属句 / --map 重装配——别让无关图混进方法步。`);
      }
      const noArt = (scA.stages || "").split("||").length - placed.length - (skipped || []).length;
      if (noArt > 0) {
        const names = (emptyCards || []).map((cn) => `卡${cn}「${stageTitles[cn - 1] || ""}」`).join("、");
        console.log(`  ⚠️ ${noArt} 张卡无视觉素材（占位框已标「待绘制」）：${names}——补 {{asset}} / {{icon}} 槽位或用 render-icon 渲卡内小图；确属待绘制部分，成图后必须重装配替换`);
      }
      // 🔴 行内内容量失衡告警（2026-10-15 mod-v2 实锤：0.16 条图 vs 0.85 折线图差 5 倍，
      // 同排等高注定空位巨大——排版无法消除内容不足，必须在 crop 层面解决）。
      // 只比真实图（imgAspects 占位卡 = null）：别建议用户给「待绘制」占位框换 crop。
      {
        const { rows, cols, imgAspects } = geometry;
        const ia = imgAspects || [];
        for (let r = 0; r < rows; r++) {
          const seg = ia.slice(r * cols, r * cols + cols).map((a, k) => ({ a, k })).filter((x) => x.a != null);
          if (seg.length < 2) continue;
          const mx = Math.max(...seg.map((x) => x.a)), mn = Math.min(...seg.map((x) => x.a));
          if (mx > 0 && mx / mn > 2.2) {
            const cards = seg.filter((x) => x.a === mx || x.a === mn).map((x) => `卡${r * cols + x.k + 1}(${x.a.toFixed(2)})`);
            console.log(`  ⚠️ 第 ${r + 1} 行图宽高比失衡 ${cards.join(" vs ")}（差 ${(mx / mn).toFixed(1)} 倍）——同排等高排版本行内容满格是学术排版底线。解决：换 crop= 范围让各卡图形状接近；宽条图用 pf montage 重排成网格（自动找白隙）；或一卡多图并排。空位是内容问题不是排版问题，重装配前必须处理。`);
          }
        }
      }
      // PNG 光栅化：本机 Chromium 内核浏览器 headless 截图（零依赖，不引 puppeteer）。
      // 🔴 必须异步 spawn——本机 spawnSync 对 chrome/msedge 稳定 EBUSY（python.exe 同），async spawn 正常
      const pngOutRaw = toWinPath(arg("--png"));
      const pngOut = pngOutRaw ? (path.isAbsolute(pngOutRaw) ? pngOutRaw : path.resolve(pngOutRaw)) : null;
      if (pngOut) {
        const { spawn } = await import("node:child_process");
        const candidates = [
          process.env.CHROME_PATH,
          "C:/Program Files/Google/Chrome/Application/chrome.exe",
          "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
          "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
          "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        ].filter(Boolean);
        const browser = candidates.find((p) => fs.existsSync(p));
        if (!browser) die("本机找不到 Chrome/Edge（PNG 光栅化需要）", "装 Chrome/Edge，或用 CHROME_PATH 环境变量指定浏览器路径；HTML 已生成可直接打开。");
        // 🔴 截图先落临时名再校验 mtime：目标 PNG 可能被预览器锁住（OneDrive），Chrome 静默
        // 不写盘 exit 0——存在性校验会被旧文件骗过（2026-10-14 实锤），必须比 HTML 新才算成功。
        const shotTmp = pngOut.replace(/\.png$/i, "") + ".shot-" + Date.now() + ".png";
        const udd = path.join(os.tmpdir(), "pf-chrome-profile-" + Date.now());
        const exitCode = await new Promise((resolve, reject) => {
          const child = spawn(browser, [
            "--headless", "--disable-gpu", "--hide-scrollbars", "--default-background-color=FFFFFFFF",
            "--user-data-dir=" + udd,
            `--window-size=${geometry.width},${geometry.height}`, `--screenshot=${shotTmp}`,
            "file:///" + outHtml.replace(/\\/g, "/"),
          ], { stdio: ["ignore", "ignore", "pipe"] });
          let errTail = "";
          child.stderr.on("data", (d) => { errTail = (errTail + d).slice(-400); });
          const t = setTimeout(() => { child.kill(); reject(new Error("Chromium 截图超时 60s")); }, 60000);
          child.on("error", (e) => { clearTimeout(t); reject(e); });
          child.on("exit", (code) => { clearTimeout(t); resolve({ code, errTail }); });
        }).then((r) => r).catch((e) => die(`Chromium 截图失败：${e.message}`, "HTML 已生成可直接浏览器打开核对；或检查 CHROME_PATH。"));
        const htmlMtime = fs.statSync(outHtml).mtimeMs;
        if (!fs.existsSync(shotTmp)) die(`Chromium exit ${exitCode.code} 但没写截图`, (exitCode.errTail || "无 stderr").slice(-300) + "；重试或直接打开 HTML 核对排版。");
        if (fs.statSync(shotTmp).mtimeMs < htmlMtime) die("Chromium 截图比 HTML 旧——写盘被静默跳过", "关掉可能锁目标的预览器后重试。");
        fs.copyFileSync(shotTmp, pngOut);
        fs.rmSync(shotTmp, { force: true });
        console.log(`  🖼 PNG（Chromium 光栅化）→ ${pngOut}`);
      }
      console.log(`✅ 模板 HTML（可编辑，元素带 id）→ ${outHtml}`);
      try {
        appendEvent(path.basename(resolveDoc(arg("--doc"))), "figure.assembled", {
          cards: (scA.stages || "").split("||").length, placed: placed.length, ts: new Date().toISOString(),
        });
        // 🔴 assemble 成图也按版本落库（用户定规「不同版本优化后的图片要记录存储」）：
        // 同一 figure 反复重排版时，derived/ 里 v1/v2/v3… 全程可回溯
        if (pngOut && fs.existsSync(pngOut)) {
          const regA = registerDerived(path.basename(resolveDoc(arg("--doc"))), {
            slot: "assemble_" + (scA.at || "fig").replace(/[^\w-]/g, "_"),
            file: pngOut, op: "assemble", source: craftSidecarPath(pFileA),
            params: { cards: (scA.stages || "").split("||").length, placed: placed.length },
          });
          console.log(`🗄 成图已落库：${regA.regPath}（assemble v${regA.version}）`);
        }
      } catch { /* 记账失败不阻塞 */ }
      return;
    }

    case "montage": {
      // 🔴 宽条图重排成网格（2026-10-15 用户定规「什么效果好用什么，只有实测效果好才行」）：
      // assemble 的行内宽高比失衡告警给出三个出口（换 crop / 拆子图网格 / 一卡多图），
      // 其中「条图重排网格」原本是宿主手工 sharp——收编成命令，自动找白隙、自动选列数。
      // 实测教训：目测均分裁切必带黑边（子图间隔不均匀），列亮度扫描才裁得准。
      const inP = toWinPath(arg("--in"));
      const outP = toWinPath(arg("--out"));
      if (!inP || !outP) die("用法: pf montage --in <条图|整页图> --out <网格.png> [--crop 左,上,宽,高] [--cols N | --rows N] [--target 0.7] [--segments \"左,右;左,右\"] [--doc <docId> --slot <槽名>]",
        "输入可以是整页 PDF 光栅图（配 --crop 取出条图），也可以是已裁好的条图。列数缺省自动选（网格宽高比最接近 --target，默认 0.7≈典型卡图）。--doc 落库：产物复制进项目 figures/derived/ 按版本存档（可审计）。");
      if (!fs.existsSync(inP)) die(`输入图不存在：${inP}`);
      try {
        const r = await montageStrip({
          src: inP, out: outP,
          crop: arg("--crop"),
          cols: arg("--cols") ? parseInt(arg("--cols"), 10) : undefined,
          rows: arg("--rows") ? parseInt(arg("--rows"), 10) : undefined,
          target: arg("--target") ? parseFloat(arg("--target")) : 0.7,
          segments: arg("--segments"),
        });
        console.log(`✅ 网格重排完成：${r.n} 个子图 → ${r.rows}×${r.cols}，输出 ${r.width}×${r.height}（宽高比 ${r.aspect.toFixed(2)}）`);
        console.log(`   子图边界: ${r.bounds.map(([l, rr]) => `${l}-${rr}`).join(" / ")} → ${outP}`);
        // 派生图版本落库（--doc 给了才记；用户可审计每版优化的源图+参数）
        if (arg("--doc")) {
          try {
            const docIdM = path.basename(resolveDoc(arg("--doc")));
            const reg = registerDerived(docIdM, {
              slot: arg("--slot") || path.basename(outP).replace(/\.png$/i, ""),
              file: outP, op: "montage", source: inP,
              params: { crop: arg("--crop") || null, cols: arg("--cols") || "auto", rows: arg("--rows") || "auto", target: arg("--target") || 0.7, segments: arg("--segments") || null },
            });
            console.log(`🗄 已落库：${reg.regPath}（v${reg.version}，事件 asset.derived，derived/index.json 可查）`);
          } catch (e) { console.error(`⚠️ 落库失败（不阻塞产物）：${e?.message || e}`); }
        }
      } catch (e) {
        die(`montage 失败：${e?.message || e}`, "常见原因：--crop 越界（先 pf inspect 或 Read 原图确认尺寸）；阈值不合适加 --threshold 240 重试。");
      }
      return;
    }

    case "compare": {
      // 🔴 原图 vs 产出对比（2026-10-15 用户定规「原图美化美化了什么，要给用户看的对比」）：
      // 交付优化结果（montage 重排/assemble 排版/精修）时必须附对照图——用户一眼判断
      // 动了什么、没动什么。
      // 🔴 2026-10-15 二轮定规「这只是展示结果示意图，为什么没有对应的示意」——光把结果
      // 并排不算对比，用户核对不了操作链。对比图必须是「操作示意」三件套：
      //   --box   在面板上画红框标取材区（panel:x,y,w,h[:标签]，原图像素坐标自动缩放）
      //   --steps 每面板一句操作说明（分号分隔，一一对应；编号徽章自动加）
      //   --flow  面板间流程箭头
      const before = toWinPath(arg("--before"));
      const after = toWinPath(arg("--after"));
      const mids = [];
      { let i = 0; while ((i = process.argv.indexOf("--mid", i)) > -1) { const v = process.argv[i + 1]; if (v) mids.push(toWinPath(v)); i += 1; } }
      const outC = toWinPath(arg("--out"));
      const styleArg = arg("--style") || "pipeline";
      if (!["pipeline", "comparison"].includes(styleArg)) die(`--style 只认 pipeline（方法图式操作链，直线箭头）或 comparison（Cell 式结果对比，行=对比对象、列按同一身份对齐）`,
        "体裁二选一（2026-10-16 用户定规：结果对比还是方法图必须想清楚，一张图只能是一种）：比「同一内容不同来源/条件」用 comparison --row；讲「操作顺序」才用 pipeline。");
      // 🔴 comparison 体裁：--row "行标签:图1,图2,..."（可多次），列 = 同一身份对齐；
      // --highlight 行序号（从 1 数）加粗行标 + 浅色底带。无箭头无红框。
      if (styleArg === "comparison") {
        const rowArgs = [];
        { let i = 0; while ((i = process.argv.indexOf("--row", i)) > -1) { const v = process.argv[i + 1]; if (v) rowArgs.push(v); i += 1; } }
        if (rowArgs.length < 2 || !outC) die("用法: pf compare --style comparison --row \"Paper:图1,图2,...\" --row \"promptFigure:图1,图2,...\" --out <对比.png> [--highlight 2]",
          "列必须按同一身份对齐（每列上下是同一张子图，只是来源/条件不同）——对齐靠像素匹配或已知置换，别拿不相干的图凑列。");
        const rows = rowArgs.map((ent, ri) => {
          const ci = ent.search(/[:：]/);
          if (ci < 0) die(`--row 第 ${ri + 1} 条缺行标签（格式 标签:图1,图2,...）：${ent.slice(0, 60)}`);
          const label = ent.slice(0, ci).trim();
          const imgs = ent.slice(ci + 1).split(/[,，]/).map((s) => toWinPath(s.trim())).filter(Boolean);
          if (!label || !imgs.length) die(`--row 第 ${ri + 1} 条解析失败：标签和图都要有`);
          for (const p of imgs) if (!fs.existsSync(p)) die(`对比输入不存在：${p}`);
          return { label, imgs };
        });
        const hiRaw = parseInt(arg("--highlight") || "2", 10);
        const highlight = (Number.isFinite(hiRaw) ? hiRaw : 2) - 1;
        if (highlight < 0 || highlight >= rows.length) die(`--highlight ${hiRaw} 超出范围（1~${rows.length}）`);
        try {
          const r = await compareRows({ rows, highlight, out: outC });
          console.log(`✅ 对比图（${r.rows} 行 × ${r.cols} 列，${r.width}×${r.height}）→ ${outC}`);
          console.log("   自检：每列上下真是同一内容吗（逐列验）？行标说清对比对象了吗？对比图里不放箭头/红框/流程叙事。");
          if (arg("--doc") && arg("--slot")) {
            const dId = path.basename(resolveDoc(arg("--doc")));
            const rec = registerDerived(dId, {
              slot: arg("--slot"), file: outC, op: "compare-comparison", source: path.basename(rows[0].imgs[0] || ""),
              params: { highlight: highlight + 1, rows: rows.map((rw) => ({ label: rw.label, imgs: rw.imgs.map((p) => path.basename(p)) })) },
            });
            console.log(`   已落库 derived/${arg("--slot")}_v${rec.version}.png + asset.derived 事件。`);
          }
        } catch (e) {
          die(`compare 失败：${e?.message || e}`, "检查输入图是否可读。");
        }
        return;
      }
      if (!before || !after || !outC) die("用法: pf compare --before <原图> --after <成图> --out <对比.png> [--mid <中间产物>（可多次）] [--labels \"…\"] [--steps \"…\"] [--box \"面板:x,y,w,h[:标签]\"] [--flow] [--layout auto|strip] [--maxw 4800] ｜ 对比体裁: --style comparison --row \"标签:图,...\"（可多次）",
        "对比是宿主 AI 的自检工具：交付优化结果前跑这条、看输出、--doc 落库。图面默认无标题解释（只有 (a)(b) 角标+红框+箭头），溯源与过程参数全走落库。");
      for (const p of [before, after, ...mids]) {
        if (!fs.existsSync(p)) die(`对比输入不存在：${p}`);
      }
      const imgs = [before, ...mids, after];
      // 🔴 2026-10-15 六轮定规「图为什么要有那种标题解释」：图就是图，默认不画任何标题/说明——
      // 解释由宿主 AI 交付时说、由数据库记。--labels/--steps 是可选项（给了才上图，数量必须对齐）。
      const labelsArg = arg("--labels");
      let labels;
      if (labelsArg) {
        labels = labelsArg.split(/[;；]/).map((s) => s.trim()).filter(Boolean);
        if (labels.length !== imgs.length) die(`--labels 数量（${labels.length}）和图数（${imgs.length}）不一致——用分号分隔，一一对应`);
      }
      const stepsArg = arg("--steps");
      let steps;
      if (stepsArg) {
        steps = stepsArg.split(/[;；]/).map((s) => s.trim()).filter(Boolean);
        if (steps.length !== imgs.length) die(`--steps 数量（${steps.length}）和面板数（${imgs.length}）不一致——每个面板一句「这一步做了什么」，用分号分隔`);
      }
      const boxArg = arg("--box");
      let boxes;
      if (boxArg) {
        boxes = [];
        for (const ent of boxArg.split(/[;；]/)) {
          const s = ent.trim(); if (!s) continue;
          let panel = 0, rest = s;
          const pm = s.match(/^(\d+)\s*[:：]/);
          if (pm) { panel = parseInt(pm[1], 10); rest = s.slice(pm[0].length); }
          const m = rest.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:[:：](.*))?$/);
          if (!m) die(`--box 条目无法解析：「${ent}」——格式 面板序号:x,y,w,h[:红框标签]（如 0:0,2570,5366,850:Ours 行），分号分隔多个`);
          if (panel >= imgs.length) die(`--box 面板序号 ${panel} 超出范围（只有 ${imgs.length} 个面板，从 0 数起）`);
          if (!boxes[panel]) boxes[panel] = [];
          boxes[panel].push({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], label: (m[5] || "").trim() });
        }
      }
      try {
        const layoutArg = arg("--layout") || "auto";
        if (!["auto", "strip"].includes(layoutArg)) die(`--layout 只认 auto（超宽自动折行成网格）或 strip（强制单行）`);
        const maxTotalW = parseInt(arg("--maxw") || "4800", 10) || 4800;
        const r = await comparePanels({ imgs, labels, steps, boxes, flow: has("--flow"), out: outC, layout: layoutArg, maxTotalW });
        console.log(`✅ 对比图（${r.panels} 张面板${r.rows > 1 ? `、自动折成 ${r.rows} 行` : ""}，${r.width}×${r.height}）→ ${outC}`);
        console.log("   自检工作流：① 红框标对位置了吗（亲眼验）？② derived/index.json 里记录齐了吗（labels/steps/boxes/inputs）？③ 交付时解释由你（宿主 AI）说，不烙在图上。");
        // 🔴 2026-10-15 用户定规「你数据库要写，为什么放在图里面」：过程元数据（crop 坐标、
        // 红框几何、步骤原文、layout 参数）全量进 derived 落库，图面只留语义。给 --doc+--slot 即记。
        if (arg("--doc") && arg("--slot")) {
          const dId = path.basename(resolveDoc(arg("--doc")));
          const rec = registerDerived(dId, {
            slot: arg("--slot"), file: outC, op: "compare", source: path.basename(before),
            params: { labels, steps, boxes, flow: has("--flow"), layout: layoutArg, maxTotalW, inputs: imgs.map((p) => path.basename(p)) },
          });
          console.log(`   已落库 derived/${arg("--slot")}_v${rec.version}.png + asset.derived 事件（标注/参数全量可审计）。`);
        }
      } catch (e) {
        die(`compare 失败：${e?.message || e}`, "检查输入图是否可读（PDF 不行，先用 pf montage --crop 光栅产物）。");
      }
      return;
    }

    case "compose": {
      // 🔴 资产合成（2026-10-14 槽位链路 P0）：渲后把 scene 槽位声明的真图/图标贴进
      // 渲染图里的纯品红占位块。数据源 = craft 伴随 JSON 的 slots（asset=原文例图，
      // icon=单独渲的小图标）。贴入即记账（asset.placed），宿主 AI 从回显知道全部状态。
      const pngIn = toWinPath(arg("--png"));
      if (!pngIn || !fs.existsSync(pngIn)) {
        die('用法: pf compose --prompt-file <p.txt> --png <渲染图.png> [--out <合成图.png>]',
          "槽位在 craft --scene 里用 {{asset:名|图片路径}} 声明（craft 回显会列出清单）；渲染图里对应位置应是纯品红 (#FF00FF) 色块。");
      }
      const pFile = toWinPath(arg("--prompt-file"));
      const scCompose = pFile ? readCraftSidecar(pFile) : null;
      const slots = scCompose?.slots || [];
      if (!slots.length) {
        die("伴随 JSON 里没有槽位记录——craft --scene 里的 {{asset:名|路径}} 标记没被解析（语法：双花括号 + 竖线分隔，例 {{asset:face|C:/pics/example.png}}）",
          "无槽位就不需要 compose——没有要贴的真图时别加槽位标记。");
      }
      const outPng = toWinPath(arg("--out")) || pngIn.replace(/\.png$/i, ".composed.png");
      const { composeSlots } = await import("../src/assets.mjs");
      // 🔴 icon 槽位素材查表：render-icon 渲好的小图登记在伴随 JSON icons 段
      const report = await composeSlots(pngIn, slots, outPng, { iconPaths: scCompose.icons || {} });
      console.log(`═══ pf compose：scene 声明 ${slots.length} 槽位 ═══`);
      if (report.aligned) console.log(`  📐 行带对齐：${report.aligned} 个槽位几何向行内中位数收敛（top/height/width 对齐后再贴）`);
      for (const p of report.placed) console.log(`  ✅ "${p.name}" [${p.source}] ← ${p.path}  @ (${p.left},${p.top}) ${p.width}×${p.height}`);
      for (const m of report.missing) console.log(`  ⚠️ ${m}`);
      // 🔴 来源分布（用户 2026-10-14 定规「不是原图的要在数据库标记」）：
      // original=原文原图直贴 / reproduced=源码复现图 / drawn=AI 画——成图里哪些元素是原图
      // 哪些是画的必须可查，宿主 AI 读伴随 JSON 的 compose 段即知，不用翻事件流。
      const srcCount = {};
      for (const p of report.placed) srcCount[p.source] = (srcCount[p.source] || 0) + 1;
      if (report.placed.length) {
        console.log(`来源标记：` + Object.entries(srcCount).map(([k, v]) => `${k}×${v}`).join(" · "));
        console.log(`✅ 合成图已写入 ${outPng}（原渲染图不动）`);
      }
      try {
        // 记账三落点：① 事件流（回放审计）② 伴随 JSON compose 段（宿主 AI 主查询口）
        // ③ 渲染留证门（provenance 链：这张图的卡内元素哪些是真图哪些是画的）
        appendEvent(path.basename(resolveDoc(arg("--doc"))), "asset.placed", {
          slots: slots.length, placed: report.placed.length,
          sources: srcCount,
          names: report.placed.map((p) => `${p.name}:${p.source}`), ts: new Date().toISOString(),
        });
      } catch { /* 记账失败不阻塞合成 */ }
      if (pFile && scCompose && fs.existsSync(path.resolve(craftSidecarPath(pFile)))) {
        try {
          const scPath2 = path.resolve(craftSidecarPath(pFile));
          const sc2 = JSON.parse(fs.readFileSync(scPath2, "utf8"));
          sc2.compose = {
            at: new Date().toISOString(),
            png: outPng,
            slots: slots.map((s) => ({ name: s.name, kind: s.kind, source: s.source, value: s.value, role: s.role })),
            placed: report.placed,
            missing: report.missing,
            sources: srcCount,
          };
          fs.writeFileSync(scPath2, JSON.stringify(sc2, null, 2), "utf8");
          console.log(`📒 来源标记已写入 ${path.basename(scPath2)} 的 compose 段（original/reproduced/drawn 分类可查）`);
        } catch (e) { console.error(`⚠️ 伴随 JSON 写回失败（${e.message}）——事件流仍有记录`); }
      }
      return;
    }

    case "doc": {
      // 弱模型实测修复：原 `arg("--doc") || rest[1]` 会把 `pf doc context --at "§3.2"` 的
      // "--at" 当成 docId（报"找不到项目 --at"）。文档定位只认 --doc，缺省回退最近项目。
      const dir = resolveDoc(arg("--doc"));
      const docId = path.basename(dir);
      const meta = readMeta(docId);
      const at = arg("--at");
      // 🔴 执行留证（2026-09-23）：outline/read/context/search/data 都是"真的读过文档"的证据，
      // craft 留证门对这些事件对账——AI 想跳过读原文直接 craft，流水里一条记录都没有，拒。
      if (["outline", "read", "context", "search", "data"].includes(rest[0])) {
        logEvidence(docId, "doc.read", { sub: rest[0], at: at || null });
      }
      if (rest[0] === "outline") {
        for (const o of meta.outline) console.log(`${"  ".repeat(o.level - 1)}§${o.path}  ${o.title}`);
        return;
      }
      if (rest[0] === "read") {
        const { resolveRef } = await import("../src/doc/para.mjs");
        const b = resolveRef(meta.blocks, at || die("--at 必填"));
        console.log(`[${b.type} §${b.secPath}${b.para ? " ¶" + b.para : ""}]\n${b.text}`);
        return;
      }
      if (rest[0] === "context") {
        const out = await callDaemon("doc.context", { at }, docId);
        console.log(`# §${out.section} 上下文（${out.chars} 字）\n`);
        (out.blocks || []).forEach((b) => {
          const tag = b.type === "caption" ? "（图注，占 ¶ 号）" : "";
          console.log(`¶${b.para}${tag} ${b.text}
`);
        });
        return;
      }
      if (rest[0] === "search") {
        // 🔴 全文检索（2026-09-21 "找不到结果数据"）：弱 AI 只有章节树，定位内容全靠猜。
        // 关键词命中 → 给 §引用 + 片段，AI 拿引用去 pf doc read / pf distill，不用猜。
        const kws = rest.slice(1)
          // 🔴 红队实测：`pf doc search 病害 --doc X` 会把 "--doc" 和它的值当查询词
          .filter((t, i, arr) => t !== "--doc" && !(i > 0 && arr[i - 1] === "--doc"))
          .map((t) => t.trim())
          // 🔴 红队实测（2026-09-23 fuzz）：空串关键词绕过检查输出误导空结果
          .filter(Boolean);
        if (!kws.length) die('用法：pf doc search <关键词1> [关键词2 ...]（如 "search WBF fusion" 或中文 "融合 加权"）', "pf doc outline 先看章节树也行，但 search 能直接定位关键词");
        const { searchBlocks } = await import("../src/docsearch.mjs");
        const hits = searchBlocks(meta.blocks || [], kws);
        if (!hits.length) {
          console.log(`（全文没有命中「${kws.join(" ")}」——换同义词再试，或 pf doc outline 通读章节树）`);
          return;
        }
        console.log(`—— 「${kws.join(" ")}」命中 ${hits.length} 处（docId ${docId}，按命中次数排序）——`);
        for (const h of hits) {
          console.log(`\n${h.ref}  [${h.type}·${h.hits}次命中]`);
          console.log(`  ${h.snippet}`);
        }
        console.log(`\n⏭ 下一步: pf doc read --at "${hits[0].ref}" 读全文，或 pf distill --at "${hits[0].ref}" 直接抽素材`);
        return;
      }
      if (rest[0] === "data") {
        // 🔴 结果数据定位（2026-09-21）：定量句（%/小数/×/±/指标名）按章节聚合——
        // 画对比图/趋势图/结果表的素材全部来自这里，禁止凭空造数字。
        const { dataBySection } = await import("../src/docsearch.mjs");
        const groups = dataBySection(meta.blocks || []);
        if (!groups.length) {
          console.log("（全文没抽到定量句——这篇可能没有数值实验，用 pf doc search 找定性结论）");
          return;
        }
        console.log(`—— 定量数据句（docId ${docId}，按章节分组；画图用数字只准从这里来，禁止编造）——`);
        for (const g of groups) {
          console.log(`\n§${g.secPath}（${g.items.length} 句）`);
          for (const it of g.items) console.log(`  ${it.ref}  ${it.sentence}`);
        }
        console.log(`\n⏭ 下一步: 选定数据所在章节后 pf distill --at "<该章节 ¶>" 抽实体/阶段，再 craft`);
        return;
      }
      if (rest[0] === "snippet") {
        // 🔴 只生成插入片段文本，绝不写用户文件 —— 由用户/AI 自己粘贴
        const figureId = arg("--figure");
        if (!at) die("--at 必填（写图要插在哪个位置，如 \"§3 ¶2 after\"）", 'pf doc outline 看章节段号 → pf doc snippet --at "§3 ¶2" --figure <figureId>');
        console.log(`<!-- promptFigure 插图片段（手动插入到 ${at} ${arg("--side") || "after"}） -->`);
        console.log(`<figure id="${figureId || "fig_PLACEHOLDER"}">`);
        console.log(`  <img src="figures/${figureId || "<figureId>"}/v1.png" alt="请填写图的内容描述">`);
        console.log(`  <figcaption>图 X ｜ 请在此填写中文图题（English caption）</figcaption>`);
        console.log(`</figure>`);
        return;
      }
      if (rest[0] === "compile") {
        if (meta.kind !== "tex") die("只有 LaTeX 文档需要编译");
        const { compileTex } = await import("../src/doc/texbuild.mjs");
        console.log("⏳ 编译中（tectonic 首次要在线拉宏包，可能几分钟）...");
        const built = compileTex(meta.source, { outDir: dir });
        if (!built.ok) die(`${built.message}${built.logTail ? "\n" + built.logTail.split("\n").slice(-12).join("\n") : ""}`);
        const m = readMeta(docId);
        m.pdfReady = true; m.pdfEngine = built.engine;
        writeMeta(docId, m);
        console.log(`✅ 编译成功（${built.engine}）→ 刷新 GUI 即可看到排版后的 PDF`);
        return;
      }
      if (rest[0] === "figures") {
        // 原图清单：tex 的 \includegraphics（挂在 caption 块上）—— 全文优化前必须先过一遍，
        // 重绘部分图、保留其余原图 = 画风割裂（用户实测反馈）
        const caps = (meta.blocks || []).filter((b) => b.images?.length || b.type === "caption");
        if (!caps.length) { console.log("（没捕获到原图 —— LaTeX 走 \\includegraphics 自动捕获；docx 内嵌图暂不支持）"); return; }
        let n = 0;
        for (const b of caps) {
          if (!b.images?.length) continue;
          n += 1;
          console.log(`${n}. §${b.secPath}${b.para ? " ¶" + b.para : ""}  图源: ${b.images.join(", ")}`);
          console.log(`   图注: ${b.text.slice(0, 90)}`);
        }
        const onlyCap = caps.filter((b) => !b.images?.length).length;
        if (onlyCap) console.log(`（另有 ${onlyCap} 个只有图注没捕获到图源的位置 —— 多为表格 caption）`);
        if (n) console.log(`\n⚠️ 全文优化铁律：要重绘就全部 ${n} 张统一重绘（先 pf style set 定风格卡），不要只改一两张`);
        return;
      }
      die("未知子命令（doc outline|read|context|search|data|snippet|figures|compile）");
      return;
    }

    case "anchor": {
      const doc = arg("--doc") || undefined;
      if (rest[0] === "set") {
        const at = arg("--at") || die("--at 必填，如 \"§3.2 ¶2\"");
        const side = arg("--side") || "after";
        if (!["before", "after"].includes(side)) die(`--side 只能是 before | after（收到 ${side}）`);
        const anchor = await callDaemon("anchor.set", { at, side, quote: arg("--quote"), figure: arg("--figure") }, doc);
        console.log(`✅ 锚点 ${anchor.id} → §${at.replace(/^\s*§?/, "")} ${side}${anchor.reused ? "（复用已有锚点）" : ""}`);
        // 🔴 2026-09-21 弱模型实测：编造引文被静默收下 → 当场对账，对不上打警告
        if (anchor.quoteOk === false) {
          console.error(`⚠️ --quote 在原文中找不到（疑似编造/自行转写）——锚点已标记 changed。`);
          console.error(`   引文必须从 pf doc read / pf distill 输出里逐字复制；改图时 pf anchor list --changed 会暴露失效锚点。`);
        }
        return;
      }
      if (rest[0] === "list") {
        const anchors = await callDaemon("anchor.list", { changed: has("--changed") }, doc);
        if (!anchors.length) { console.log("（还没有锚点）"); return; }
        for (const a of anchors) {
          console.log(`${a.id}  ${a.placement.side === "before" ? "↑" : "↓"} §${a.placement.at.replace(/^\s*§?/, "")}  图:${a.figure || "-"}  状态:${a.state}`);
        }
        return;
      }
      die("未知子命令（anchor set|list）");
      return;
    }

    case "render": {
      if (rest[0] === "list") {
        const figs = await callDaemon("render.list", { at: arg("--at") }, arg("--doc"));
        if (!figs.length) { console.log("（没有图）"); return; }
        for (const f of figs) {
          console.log(`${f.figureId}  @${f.at}  ${f.versions.map((v) => `${v.model}/v${v.channel}`).join(" → ")}`);
          // 直接给出最新版绝对路径：宿主 AI 拿到就能用看图工具做渲染后视觉核验（qa-list）
          const last = f.versions[f.versions.length - 1];
          if (last?.file) {
            const abs = path.join(projectDir(path.basename(resolveDoc(arg("--doc")))), last.file);
            console.log(`   图文件（读它核验）: ${abs}`);
          }
        }
        return;
      }
      const promptFile = arg("--prompt-file") && toWinPath(arg("--prompt-file"));
      let prompt = arg("--prompt");
      if (!prompt && promptFile) {
        if (!fs.existsSync(path.resolve(promptFile))) {
          die(`提示词文件不存在：${promptFile}——用 pf craft --out <文件> 生成，或检查路径（相对路径以当前目录为准）`,
            'pf craft --at "<章节 段号>" --intent "图意" --entities "a,b,c" --out p.txt && pf render --at ... --prompt-file p.txt');
        }
        prompt = fs.readFileSync(path.resolve(promptFile), "utf8");
      }
      if (!prompt) die("必须给 --prompt 或 --prompt-file", "pf craft --at \"<章节 段号>\" --intent \"图意\" --entities \"a,b,c\" --out p.txt 先生成提示词，再回来 render --prompt-file p.txt（卡住了就 pf next）");
      // 🔴 画布比自动继承（V10 事故修复）：craft 的伴随 JSON 里存了 suggestedRatio，
      // 不传 --ratio 就继承它 —— 保证提示词里的画布句和实际渲染的画布比强一致。
      let ratio = arg("--ratio");
      const sidecar = promptFile ? readCraftSidecar(promptFile) : null;
      if (sidecar?.suggestedRatio) {
        if (!ratio) {
          ratio = sidecar.suggestedRatio;
          console.error(`📐 画布比 ${ratio}（自动继承自 ${path.basename(craftSidecarPath(promptFile))}）`);
        } else if (ratio !== sidecar.suggestedRatio) {
          console.error(`⚠️ --ratio ${ratio} 与 craft 建议的 ${sidecar.suggestedRatio} 不一致 —— 提示词里的画布句说的是 ${sidecar.suggestedRatio}，画布不符会把内容压变形（V10 事故）。要么删掉 --ratio 让插件继承，要么回 craft 用同一比例重拼。`);
        }
      }
      // 🔴 渲染溯源门（2026-09-23 收紧轮）：没有 craft 伴随 JSON 的提示词 = 手工拼的——
      // 实体溯源/画布比/期刊字号/实体清单基准（QA 第 3 步的比对底数）全部没走质量门，
      // 渲染它 = 整条质量链失效。craft --out 会自动写伴随 JSON；pf prompt 导出会带出来。
      // 确要渲染外部提示词：--force "理由"（留痕 render.unsourced，pf audit 可查）。
      const unsourced = !sidecar;
      if (unsourced && !has("--dry-run")) {
        if (!has("--force")) {
          die("render 拒绝：提示词没有 craft 伴随 JSON（*.craft.json）——不是 pf craft 产出的提示词，绕过了全部质量门禁（实体溯源/画布比/字号契约/QA 比对基准）。用 pf craft 重新生成（--out 自动写伴随 JSON），或 pf prompt <figureId> 导出已入库提示词（自动带伴随 JSON）；确要渲染外部提示词加 --force \"理由\"",
            'pf craft --at "<章节 段号>" --intent "…" --entities "…" --stages "…" --out p.txt && pf render --at "…" --prompt-file p.txt');
        }
        requireForceReason("render 渲染无溯源提示词");
        try {
          appendEvent(path.basename(resolveDoc(arg("--doc"))), "render.unsourced", {
            bytes: Buffer.byteLength(String(prompt).trim(), "utf8"), reason: forceReason() || "(无理由)", at: new Date().toISOString(),
          });
          console.error("📎 无 craft 溯源的提示词已渲染（render.unsourced 留痕，pf audit 可查）");
        } catch { /* 无打开项目时跳过留痕 */ }
      }
      // 🔴 渲染端能力前置检查（V13 实测：standard 只有 1024x1024 方图档）——
      // standard + 横/竖版比例 = 必然 ratio_mismatch 白烧一次额度，出图前就拦下提醒
      const model = arg("--model") || "standard";
      // 🔴 复刻参考图（2026-10-13）：--ref prev | <png路径> —— 参考图以 img2img 条件进出图模型，
      // 布局/母题被参考图锁住，提示词只写"要改什么"；--replica 交服务端视觉轮读图出规格重写提示词。
      const refArg = arg("--ref");
      const replica = has("--replica");
      // 🔴 用户原图分档覆盖（2026-10-14 参考链路）：宿主 AI 按四项 rubric 给参考图分 A/B/C
      // （A=可临摹 / B=只定拓扑内容 / C=仅意图证据），用户坚持按自己的图画时用本 flag 一票覆盖。
      const refQuality = arg("--ref-quality");
      if (refQuality && !/^[abc]$/i.test(refQuality)) {
        die(`--ref-quality 只接受 a|b|c（A=可临摹 B=只定拓扑 C=仅意图证据），收到 "${refQuality}"`);
      }
      if (replica && !refArg) die("--replica 需要配合 --ref <png路径>（一键临摹必须有参考图，服务端会 400 拒绝）", "pf render --at ... --ref prev --replica  或  --ref <草图.png> --replica");
      let refParam = null;
      if (refArg) {
        if (refArg === "prev") refParam = "prev";
        else {
          const rp = toWinPath(refArg);
          if (!fs.existsSync(path.resolve(rp))) die(`--ref 参考图不存在：${rp}`, "传 --ref prev 复刻上一版，或给一个真实存在的 PNG 路径（论文原图路径见 pf doc figures）");
          refParam = path.resolve(rp);
        }
      }
      const rr = ratio && parseRatio(ratio);
      if (model === "standard" && rr && Math.abs(rr.w / rr.h - 1) > 0.15) {
        console.error(`⚠️ standard 渲染端只出方图（1024x1024），给不了 ${ratio} —— 实测必报画布比不符（V13 白烧一次额度）。出路：① 改 --ratio 1:1 走 standard；② 宽幅/竖版可走 premium（链路同上），但 **premium 端也会把宽幅裁回方图**（实测 5:3 被降级 1:1 后裁剩 49.9%）——真要宽幅只能出图后自己拼接/裁副，或接受 1:1；完整链路 = standard 方图草稿 → pf qa 核验 --pass → pf review resolve --approve（或 GUI 点通过）→ render --model premium（premium 门禁会查审批，修正迭代轮才可用 --force "理由" 豁免）。`);
      }
      // 🔴 渲染端字节预算（32000，2026-10-13 从 8000 放开——v18 时代 8205 被拒的事故已不适用）——花钱之前先拦
      const promptBytes = Buffer.byteLength(String(prompt).trim(), "utf8");
      if (has("--force")) requireForceReason("render 门禁豁免"); // premium 门禁/字节预算的豁免都要留理由
      if (promptBytes > 32000 && !has("--force")) {
        die(`提示词 ${promptBytes} 字节超渲染端预算（32000，对齐 premium 上游原生上限）——直接渲染会被 prompt_too_long 拒绝白烧额度。回 craft 精简：已验证遵守的 fix 沉淀进 --stages 并从 --fixes 删除，或砍次要要点`,
          `pf refine <figureId> 看活跃修正（--settle 沉淀）后重拼 craft`);
      }
      // 🔴 排练模式（2026-09-21）：--dry-run 走完所有前置检查但不调 daemon、不花钱、不写图库。
      // 用途：宿主 AI 排练全流程 / 验证提示词预算与画布比，不烧额度。
      if (has("--dry-run")) {
        const dryAt = arg("--at") || die('--at 必填，如 "§3.2 ¶2"（dry-run 同样校验引用与预算）', "pf doc outline 看可用章节");
        try {
          const dd = path.basename(resolveDoc(arg("--doc")));
          resolveRef(readMeta(dd).blocks || [], dryAt);
        } catch (e) {
          die(`--at 校验失败：${e.message}`, "pf doc outline 看可用章节，或 pf doc search <关键词> 定位");
        }
        console.log(`【DRY-RUN 排练模式】未调用渲染、未扣额度、未写图库。本次调用若真实执行将：`);
        console.log(`  模型 ${model} · 画布比 ${ratio || "默认"} · 位置 ${dryAt} · 提示词 ${promptBytes} 字节（预算内 ✓）`);
        if (model === "premium") console.log(`  ⚠️ premium 门禁只在真实执行时校验（需最新版 qa PASS 或 --force "理由" 豁免）；排练不代表门禁通过`);
        // 🔴 排练留痕（2026-09-21 子智能体 E 实测：dry-run 不落任何记录，AI 排练了三轮
        // status 仍说"0 张图"——进度全靠 AI 自己记）。写审计事件，pf board 能看到排练次数。
        try {
          const dryDoc = path.basename(resolveDoc(arg("--doc")));
          appendEvent(dryDoc, "render.dryrun", { at: dryAt, model, bytes: promptBytes, hash: shaOf(prompt), ts: new Date().toISOString() });
        } catch { /* 无打开项目时不留痕 */ }
        console.log(`⏭ 排练通过 → 去掉 --dry-run 真实渲染；渲染后 pf qa <figureId> 核验（卡住就 pf next）`);
        return;
      }
      // ---- 🔴 执行留证门②（2026-09-23 用户拍板"明确执行才放行"）：真实渲染前必须真的排练过 ----
      // 排练（--dry-run）零成本：走完全部前置检查（引用/预算/溯源/画布），不调渲染不扣额度。
      // 24h 内没有任何 dry-run 记录就真渲染 = 没验过就烧钱，拒。裸 --force 放行，render.no_rehearsal 留痕。
      try {
        const rdDoc = path.basename(resolveDoc(arg("--doc")));
        if (!hasEvidence(rdDoc, ["render.dryrun"])) {
          if (has("--force")) {
            logEvidence(rdDoc, "render.no_rehearsal", { figure: null, forced: true, reason: forceReason() || "(无理由)" });
            console.error("📎 未排练直接渲染（--force 放行，render.no_rehearsal 留痕，pf audit 可查）");
          } else {
            logEvidence(rdDoc, "render.no_rehearsal", { forced: false });
            die("render 拒绝：过去 24h 内没有 --dry-run 排练记录——排练零成本（不调渲染、不扣额度），能提前暴露引用错/预算爆/画布不符。先跑排练，通过后再去掉 --dry-run",
              `pf render --at "<位置>" --model ${model} --prompt-file <同一个提示词文件> --dry-run  排练通过 → 去掉 --dry-run 真实渲染；确要跳过加 --force（留痕审计）`);
          }
        } else {
          const lastDry = lastEvidence(rdDoc, "render.dryrun");
          if (lastDry?.hash && lastDry.hash !== shaOf(prompt)) {
            console.error("⚠️ 排练记录与本次提示词指纹不一致（提示词在排练后改过没重排）——建议重新 --dry-run 再渲染。");
          }
        }
      } catch { /* 无项目上下文时跳过（daemon 调用会自行报错） */ }
      const out = await callDaemon("render", {
        prompt, model,
        // 🔴 promptFile 原样下发（2026-09-27）：门禁拒绝信息要给出可复制的完整命令，
        // 而从 sidecar 反推文件名会丢扩展名（p.txt → p.craft.json，替换式生成）
        promptFile: promptFile || null,
        at: arg("--at") || die('--at 必填，如 "§3.2 ¶2" —— 插件不猜位置'),
        side: arg("--side") || "after",
        ratio,
        // 🔴 premium 门禁豁免（多轮精修修正轮专用）：显式声明这轮是已授权的修正迭代，事件留痕可审计
        force: has("--force"),
        forceReason: forceReason(),
        // sidecar 路径落盘进版本（pf refine 重拼下一轮命令的依据）
        sidecar: promptFile ? path.resolve(craftSidecarPath(promptFile)) : null,
        // 🔴 复刻参考图（2026-10-13）："prev" 或 PNG 绝对路径；replica=true 走服务端一键临摹
        ref: refParam,
        refQuality: refQuality ? refQuality.toLowerCase() : null,
        replica,
      }, arg("--doc"));
      console.log(`✅ 图 ${out.figureId} v${out.version}（${out.model} / 计费通道 ${out.channel}）已入库`);
      if (out.pixels) console.log(`   画布: ${out.ratio || "默认"} → 实测 ${out.pixels}${out.ratioIssue ? "  ⚠️ 与请求比不符" : ""}`);
      // 🔴 quota 是对象（{tier, standard:{used,limit}, premium:{used,limit}}），直接插值会打出 [object Object]
      const q = out.quota;
      if (q && typeof q === "object") {
        const fmt = (t) => (t && typeof t === "object" ? `${t.used}/${t.limit}${t.bonus ? `+${t.bonus}` : ""}` : String(t ?? "?"));
        console.log(`   额度(${q.tier || "?"}): standard ${fmt(q.standard)} premium ${fmt(q.premium)}${out.balance != null ? ` 余额: $${Number(out.balance).toFixed(2)}` : ""}`);
        const stdLeft = (q.standard?.limit ?? 0) + (q.standard?.bonus ?? 0) - (q.standard?.used ?? 0);
        const premLeft = (q.premium?.limit ?? 0) + (q.premium?.bonus ?? 0) - (q.premium?.used ?? 0);
        if (out.model === "premium" && premLeft <= 0) console.log("   ⚠️ premium 额度已用尽（将按次扣余额 $0.15/张）");
        if (stdLeft <= 0 && premLeft <= 0 && (out.balance ?? 0) < 0.15) console.log("   ⚠️ 额度与余额接近见底 —— 批量出图前先去控制台充值/领额度，否则下一张就会失败");
      } else if (q != null) {
        console.log(`   额度: ${q}${out.balance != null ? ` 余额: $${Number(out.balance).toFixed(2)}` : ""}`);
      }
      console.log(`   ${out.note}`);
      // 🔴 2026-09-21 定规：出图 ≠ 完工，输出必须指向核验（数字靠 inspect，语义靠 AI 读图）
      console.log(`⏭ 下一步: pf qa ${out.figureId}`);
      console.log(`   （核验任务包+写回：全 PASS → --pass --note "依据"；有缺陷 → --fail --note "缺陷1; 缺陷2" 自动进精修状态机。卡住就 pf next）`);
      return;
    }

    case "review": {
      const doc = arg("--doc");
      if (rest[0] === "status") {
        const r = await callDaemon("review.status", {}, doc);
        const fmt = (x) => `  ${x.figureId}  @${x.at}  [${x.review.status}]${x.review.note ? "  意见: " + x.review.note : ""}`;
        console.log(`待审批 ${r.pending.length} 张:`); r.pending.forEach((x) => console.log(fmt(x)));
        console.log(`已通过 ${r.approved.length} 张:`); r.approved.forEach((x) => console.log(fmt(x)));
        console.log(`被驳回 ${r.rejected.length} 张:`); r.rejected.forEach((x) => console.log(fmt(x)));
        if (r.history.length) {
          console.log("最近审批事件:");
          for (const e of r.history.slice(-8)) console.log(`  · ${e.t?.slice(5, 19)} ${e.type} ${e.figure || ""}${e.note ? " — " + e.note : ""}`);
        }
        return;
      }
      if (rest[0] === "resolve") {
        const figureId = rest[1] || die("用法：pf review resolve <figureId> --approve|--reject [--note]", "pf review status 先看待审清单（figureId 都在里面）");
        // 🔴 审批门禁（2026-09-21 "别放水"定规）：approve 必须有**最新版**的 QA 核验记录。
        // 弱模型实测会"不读图直接 approve"——没有核验记录就通过 = 放水，CLI 层硬拦。
        // GUI（人类）审批不受此限；确要跳过加 --force "理由"（理由进 note + review.forced 审计事件）。
        if (has("--approve") && !has("--force")) {
          const metaG = readMeta(path.basename(resolveDoc(doc)));
          const fG = (metaG.figures || {})[figureId];
          if (fG) {
            const { qaState, isQuantifiedNote } = await import("../src/quality.mjs");
            const qs = qaState(fG);
            if (!qs.fresh) {
              die(`审批被拒：图 ${figureId} 最新版（v${fG.versions.length}）没有 QA 核验记录——没核验就通过 = 放水（V11 事故教训）`,
                `pf qa ${figureId} 读核验任务包 → 亲眼读图逐条核验 → pf qa ${figureId} --pass --note "依据"（通过并写回）`);
            }
            if (qs.verdict === "fail") {
              die(`审批被拒：图 ${figureId} 最新版 QA 判 FAIL（${qs.qa.note || "无意见"}）——先修缺陷再出新版`,
                `缺陷已自动进精修状态机：pf refine ${figureId} 看重拼命令 → render --force "修正轮" → 重新 pf qa`);
            }
            // 🔴 2026-09-23 收紧轮：PASS 记录的依据也必须量化——无数字 note 的"通过"
            // = 凭印象核验（可能根本没读图）。重新走一遍 qa --pass --note "量化依据"。
            if (qs.verdict === "pass" && !isQuantifiedNote(qs.qa?.note)) {
              die(`审批被拒：图 ${figureId} 的 QA 通过记录没有量化依据（note："${(qs.qa?.note || "").slice(0, 60)}"）——无数字 = 凭印象核验 = 无效`,
                `pf qa ${figureId} 重看任务包体检数字 → 亲眼读图 → pf qa ${figureId} --pass --note "文字 N 条全对、色相 X、留白 Y%"`);
            }
            // 🔴 2026-09-23 变异+红队轮：图文件不存在 = 无核验对象，QA 记录再漂亮也是编的
            if (qs.verdict === "pass" && !fs.existsSync(path.join(projectDir(path.basename(resolveDoc(doc))), fG.versions[fG.versions.length - 1]?.file || "_"))) {
              die(`审批被拒：图 ${figureId} 的图文件不存在——QA 通过记录无效（没有图就没有核验对象）`,
                `pf render 重新出图 → pf qa ${figureId} 重新核验`);
            }
          }
        }
        // --force 豁免同样收口：必须写理由，理由进 note 并落审计事件（pf audit 可查）
        let forcedNote = "";
        if (has("--approve") && has("--force")) {
          forcedNote = requireForceReason("审批跳过 QA 门禁");
          try {
            appendEvent(path.basename(resolveDoc(doc)), "review.forced", { figureId, reason: forcedNote, at: new Date().toISOString() });
          } catch { /* 无项目时跳过 */ }
        }
        const out = await callDaemon("review.resolve", {
          figureId, approve: has("--approve"), note: arg("--note") || forcedNote,
        }, doc);
        console.log(`✅ ${figureId} → ${out.status}${out.note ? "（" + out.note + "）" : ""}`);
        return;
      }
      if (rest[0] === "ai") {
        // 🔴 AI 辅助审批（用户要求：让 AI 帮用户审核图片符不符合要求/质量过不过关）：
        // 输出"审批任务包"——图文件路径（全版本）+ 实体清单（Q2/Q4 比对基准）+ QA 清单 +
        // 裁决流程与写回命令。审批人是你（宿主 AI，有视觉能力），最终状态写进 review.json，
        // GUI 里用户随时能看到 AI 的判定意见并改判（by=ai 留痕，与用户手批区分）。
        const { QA_CHECKLIST } = await import("../src/craft-rules.mjs");
        const docId2 = path.basename(resolveDoc(doc));
        const st = await callDaemon("review.status", {}, docId2);
        const targets = rest[1] && rest[1] !== "--all"
          ? [rest[1]]
          : st.pending.map((x) => x.figureId);
        if (!targets.length) { console.log("没有待审批的图（pf review status 看全量状态）"); return; }
        const meta2 = readMeta(docId2);
        const dir2 = projectDir(docId2);
        for (const fid of targets) {
          const f = (meta2.figures || {})[fid];
          if (!f) { console.log(`⚠️ 找不到图 ${fid}，跳过`); continue; }
          const rev = st.pending.find((x) => x.figureId === fid)?.review
            || { status: "unknown", note: "" };
          console.log(`\n════ AI 审批任务包 · ${fid} ════`);
          console.log(`位置 @${f.at} · ${f.versions.length} 版 · 当前状态 ${rev.status}${rev.note ? `（既有意见：${rev.note}）` : ""}`);
          console.log(`—— 第 1 步：用你的看图能力逐张打开（旧→新，最后一版是送审版）——`);
          f.versions.forEach((v, i) => {
            console.log(`  v${i + 1}（${v.model}${v.pixels ? ` · ${v.pixels}` : ""}）: ${path.join(dir2, v.file)}`);
          });
          const last = f.versions[f.versions.length - 1];
          console.log(`—— 第 2 步：实体清单（Q2/Q4 逐字比对的基准，来自 craft 提示词）——`);
          const entLine = (last.prompt || "").match(/Named entities \(keep verbatim\): present each of the following as a labelled node\/block — (.+?)\./);
          console.log(entLine ? `  ${entLine[1]}` : `  （craft 提示词里自行找实体清单）\n${(last.prompt || "").slice(0, 600)}`);
          // 🔴 2026-09-23 收紧轮④：阶段画法清单（Q9 比对基准，与 qa 任务包共用）——
          // 审批也要查「要求画的到底画了没」，只查实体清单抓不住布局漂移
          const scLines2 = await stageChecklistLines(last.sidecar);
          if (scLines2) {
            console.log(`—— 第 2.5 步：阶段画法核验（Q9 比对基准）——`);
            scLines2.forEach((l) => console.log(l));
            console.log(`  任何阶段盒子缺失/标题不符/[画法]元素没画 = 布局漂移，Q9 FAIL（缺陷写具体到阶段）。`);
          }
          console.log(`—— 第 3 步：逐条核验（按三个镜头过；每条给 PASS/FAIL + 你在图里看到的证据）——`);
          printQaChecklist(QA_CHECKLIST);
          console.log(`—— 第 3.5 步：从严纪律（AI 审放水 = 白审，V11 事故教训）——`);
          console.log(`  ① 核验 Q2 前必须先输出「图上全部可见文字清单」（逐条列出，一张不漏），再逐条对照白名单——不许凭印象说"标签都对"；`);
          console.log(`  ② PASS 必须带可复查的量化证据（数出来的元素个数、留白大约占比、色相个数），只写"看起来没问题"= 无效核验；`);
          console.log(`  ③ 存疑时从严：说不清是否违规的项按 FAIL 处理并在 note 里写明存疑点，宁可多一轮返工不可放过次品；`);
          console.log(`  ④ 你的上一轮裁决会留在事件流里：同一张图反复放水会被用户看到历史，审出问题不是你的错，放水才是。`);
          console.log(`—— 第 4 步：写回裁决（approve 门禁只认最新版 QA 记录，必须走 pf qa 写回）——`);
          console.log(`  全部 PASS →  pf qa ${fid} --pass --note "AI审: 可见文字 N 条全对、色相 X 个、留白约 Y%（必含数字，无数字写回被拒）"`);
          console.log(`  任何 FAIL →  pf qa ${fid} --fail --note "AI审: Qx FAIL —— 缺陷1; 缺陷2"（自动驳回+缺陷进精修状态机）`);
          console.log(`  ⚠️ 你只给判定与依据，改判权在用户：GUI 队列里用户能看到你的 note 并重新裁决；`);
          console.log(`     用户没授权代批时，先把结论汇报给用户等确认。`);
        }
        console.log(`\n（共 ${targets.length} 张待审；跑完逐张 resolve 后 pf review status 复查）`);
        return;
      }
      die("未知子命令（review status|resolve|ai）");
      return;
    }

    case "style": {
      // 文档级风格卡：全文多图画风统一的关键 —— 设置一次，之后所有 pf craft 自动注入
      const docId = path.basename(resolveDoc(arg("--doc")));
      const meta = readMeta(docId);
      if (rest[0] === "set") {
        const text = arg("--text");
        if (!text) die('用法：pf style set --text "统一风格描述（色板/线条/布局基调，英文更稳）"');
        meta.styleCard = { text, setAt: new Date().toISOString() };
        writeMeta(docId, meta);
        console.log("✅ 风格卡已保存 —— 之后所有 pf craft 自动带上这段风格，全文图画风一致");
        console.log(`   内容: ${text.slice(0, 120)}`);
        return;
      }
      if (rest[0] === "clear") {
        delete meta.styleCard;
        writeMeta(docId, meta);
        console.log("✅ 风格卡已清除");
        return;
      }
      if (meta.styleCard?.text) {
        console.log(`风格卡（${meta.styleCard.setAt?.slice(0, 10)} 设置）：\n${meta.styleCard.text}`);
      } else {
        console.log("（本文档还没有风格卡）");
        console.log('设置：pf style set --text "muted blue-grey palette, thin sans-serif labels, flat vector, generous whitespace"');
        console.log("多图不共用风格卡 = 各画各的，放在一起画风割裂");
      }
      return;
    }

    case "types": {
      // 图型目录：宿主 AI 不知道"能做什么图"时的选项菜单（选型时机+构图思考+示例）
      const { FIGURE_CATALOG, TYPE_DECISION } = await import("../src/figure-catalog.mjs");
      const showId = rest[0] === "show" ? rest[1] : null;
      if (showId) {
        const t = FIGURE_CATALOG.find((x) => x.id === showId);
        if (!t) die(`未知图型 "${showId}"。全部：pf types`);
        console.log(`【${t.name}】 (${t.id})${t.guide ? "" : "  [选型参考型，借道其他图型出图]"}`);
        console.log(`什么时候用: ${t.when}`);
        console.log(`构图思考:   ${t.think || "（见示例）"}`);
        console.log(`完整示例:`);
        console.log(`  图意: ${t.example.intent}`);
        console.log(`  实体: ${t.example.entities}`);
        if (t.example.structure) console.log(`  结构: ${t.example.structure}`);
        console.log(`  命令: ${t.example.cmd}`);
        // 🔴 成品叙述范文（2026-10-13 组词重构，对标 PaperBanana 的参考示例 ICL）：
        // 用示例的 stages 实时渲染出 craft 会生成的场景叙述段——宿主 AI 照这个
        // "画面感"水准写自己的 stages（每个元素：形状/颜色/内嵌小图/连接，具体到可画）。
        if (t.example.stages || /--stages "/.test(t.example.cmd || "")) {
          try {
            const { buildStageSceneNarrative } = await import("../src/craft.mjs");
            const { STAGE_COLOR_CYCLE } = await import("../src/figure-catalog.mjs");
            const stagesSrc = t.example.stages || (t.example.cmd.match(/--stages "([^"]+)"/) || [])[1] || "";
            const stages = stagesSrc.split(/\s*\|\|\s*/).map((chunk) => {
              const [title, rest2] = chunk.split(/\s*\|\s*/);
              return { title: title.trim(), bullets: (rest2 || "").split(/\s*;\s*/).filter(Boolean) };
            });
            if (stages.length >= 2) {
              const scene = buildStageSceneNarrative({ stages, palette: { cycle: STAGE_COLOR_CYCLE }, figureType: t.id });
              if (scene?.text) console.log(`  成品叙述范文（craft 会把你的 stages 拼成这个画面段）:\n    ${scene.text}`);
            }
          } catch { /* 范文只是辅助展示，失败不阻断 types show */ }
        }
        return;
      }
      console.log("图型目录（craft --figure-type 用；详情 pf types show <id>）：\n");
      for (const t of FIGURE_CATALOG) {
        console.log(`  ${t.id.padEnd(13)} ${t.name}`);
        console.log(`  ${" ".repeat(13)} ${t.when.split("。")[0]}。`);
      }
      console.log("\n选型决策（拿到内容先问自己）：");
      TYPE_DECISION.forEach((d) => console.log("  · " + d));
      console.log("\n现成示例（照抄改变量）：pf examples");
      return;
    }

    case "examples": {
      // 示例库：每种图型一条完整可改编的示例命令（学 awesome-gpt-image-2「找案例→抽结构→换变量」）
      const { FIGURE_CATALOG } = await import("../src/figure-catalog.mjs");
      console.log("图型示例库 —— 找最接近你要的案例，照抄结构、替换成你论文的实体/结构：\n");
      console.log('⚠️ 示例里的 --at "§X ¶Y" 是占位锚点，执行前必须换成你文档的真实位置（pf doc outline 查），否则会被溯源门拒绝：\n');
      for (const t of FIGURE_CATALOG) {
        console.log(`◆ ${t.name} (${t.id})`);
        console.log(`  图意: ${t.example.intent}`);
        console.log(`  实体: ${t.example.entities}`);
        if (t.example.structure) console.log(`  结构: ${t.example.structure}`);
        console.log(`  ${t.example.cmd}`);
        console.log("");
      }
      return;
    }

    case "craft": {
      const { craftPrompt, promptSelfCheck } = await import("../src/craft.mjs");
      const intent = arg("--intent") || die('--intent 必填，写图意（如 "两级检测框架流程图"）——塞实体/结构，别塞原文段落', '完整示例: pf examples（照抄结构换实体）；不知道画什么图先 pf types；卡住了 pf next');
      // ---- 🔴 执行留证门①（2026-09-23 用户拍板"明确执行才放行"）：craft 前必须真的读过文档 ----
      // 证据（24h 内任一，事件流水对账）：pf open（doc.open）/ pf doc outline|read|context|search|data
      // （doc.read）/ pf distill（distill.run）。一条都没有 = 跳过读原文直接编素材，拒。
      // 裸 --force 可放行（宽松轮定规），craft.no_read 留痕进 pf audit。
      try {
        const cgDoc = path.basename(resolveDoc(arg("--doc")));
        if (!hasEvidence(cgDoc, ["doc.open", "doc.read", "distill.run"])) {
          if (has("--force")) {
            logEvidence(cgDoc, "craft.no_read", { forced: true, reason: forceReason() || "(无理由)" });
            console.error("📎 未读过文档直接 craft（--force 放行，craft.no_read 留痕，pf audit 可查）");
          } else {
            logEvidence(cgDoc, "craft.no_read", { forced: false });
            die("craft 拒绝：过去 24h 内没有读过这篇文档的任何记录（open / doc outline / doc read / doc search / distill 一条都没有）——没读过原文就画图，实体只能靠编（V4-V8 事故全源于此）。先执行下面任一条拿到真实素材",
              `pf doc outline 看章节树 → pf distill --at "<章节 段号>" 抽实体/阶段/数据 → 按骨架填空再 craft；确要跳过加 --force（留痕审计）`);
          }
        }
      } catch { /* 无项目上下文时跳过该门（--at 校验与溯源门会另行拦截） */ }
      const entities = (arg("--entities") || "").split(/[,，]/).map((s) => s.trim()).filter(Boolean);

      // 🔴 思考外置·出题模式（2026-10-14，用户定调"从拼接提示词变成调用用户 AI 思考"）：
      // 不拼提示词，输出"思考任务包"——宿主 AI 看图思考后写 scene 段，再 craft --scene 阅卷。
      // 插件的定位从组词者变成出题人 + 阅卷人：喂什么材料（原文/真图/约束）是插件的活，
      // 画什么怎么画（画面语义）是宿主 AI 的活——图模型天生懂学术惯例，不需要词典教。
      if (has("--brief")) {
        console.log("═══ pf craft --brief：scene 思考任务包 ═══");
        console.log("\n【任务】为下面的图写一段自然语言 scene 画面描述（英文，250-450 词），宿主 AI 直接产出文本，随后用 craft --scene 直通。");
        console.log("\n【写法规范】");
        console.log("• 每张卡一句话：先说卡标题，再说卡内画什么（可数部件+数量+相对位置），最后说小标签");
        console.log('• 图标必须「可数解剖」：如 "three stacked slabs in slight perspective, each showing a faint grid"、"five circles, two pairs joined by bold lines"——不可数的模糊名词会画出渐变方块');
        console.log("• 画法参考下面的顶会真图（你是多模态的，打开图片看），只学画法不搬内容");
        console.log("• 内容必须来自原文摘录与实体清单，禁止编造；要印的文字全部用双引号括起");
        console.log("• 布局：卡片等宽等高同一水平轴，箭头高中线连接，文字只出现在卡内");
        console.log("\n【原文摘录】(--at 溯源锚点: " + (arg("--at") || "未给，强烈建议补 --at") + ")");
        try {
          const bDoc = path.basename(resolveDoc(arg("--doc")));
          const bMeta = readMeta(bDoc);
          const bAt = arg("--at");
          if (bAt) {
            const b2 = resolveRef(bMeta.blocks || [], bAt);
            const srcText = String(b2.text || "").slice(0, 1600);
            console.log(srcText + (String(b2.text || "").length > 1600 ? "…" : ""));
          } else {
            console.log("（未给 --at：无原文摘录。画面内容将只依赖实体清单——实体必须全部来自此前 distill）");
          }
        } catch (e) {
          console.log("（原文不可用：" + e.message + "）");
        }
        console.log("\n【意图】" + (arg("--intent") || "(未给)"));
        // 🔴 原文例图清单（2026-10-14 资产槽位链路）：原文 \includegraphics 捕获的真实图——
        // 视觉识别例子图/数据集样例/结果可视化等。宿主 AI 亲眼看并判定用途：
        // 该贴原图的位置用 {{asset:名|绝对路径}}（缺省标 original）槽位声明（渲后 pf compose 贴入），
        // 别让模型画假图。2026-10-14 用户定规：原图缺失时宿主 AI 自己去找（PDF 抽图/源码复现），
        // 复现图用 |repro 标记——不是原图的必须在账本里标清来源。
        try {
          const aDoc = path.basename(resolveDoc(arg("--doc")));
          const aMeta = readMeta(aDoc);
          const imgBlocks = (aMeta.blocks || []).filter((b) => b.images && b.images.length);
          if (imgBlocks.length) {
            console.log("\n【原文已有图——逐张判定用途，别急着当参考】");
            console.log("• 例图/数据集样例/结果可视化/输入输出实例 → 这类图是数据本身，卡面必须贴原图：scene 写 {{asset:名|绝对路径}}（缺省标 original），禁止让图模型重画——重画 = 造假数据");
            console.log("• 文件不存在的（编译产物丢了/仓库只有 \\includegraphics 引用）→ 你（宿主 AI）去找：① 从原文 PDF 对应 Figure 抽图；② 论文有开源代码就跑出原图。找到后槽位标 |repro：{{asset:名|路径|repro}}；找不到就明确告知用户，别用画的糊弄");
            console.log("• 方法图/流程图/其他论文画法图 → 不贴，当画法参考（对照下面的顶会参考图学怎么画）");
            const base = String(aMeta.source || "").replace(/[\\/][^\\/]+$/, "");
            imgBlocks.forEach((b, i) => {
              const p = String(b.images[0]).replace(/^\.\.[\\/]/, "");
              // includegraphics 相对目录不统一（相对 sec/ 或主文件）——多候选探测，存在的优先
              const candidates = [path.resolve(base, p), path.resolve(base, "..", p), path.resolve(base, "sec", p)];
              const abs = candidates.find((c) => fs.existsSync(c)) || candidates[1];
              console.log(`${i + 1}. ${abs}${fs.existsSync(abs) ? "" : "  ⚠️ 文件不存在——按上面第二条去找（PDF 抽图或源码复现，找到标 |repro）"}`);
              if (b.text) console.log(`   图注: ${String(b.text).replace(/\s+/g, " ").slice(0, 120)}`);
            });
          }
        } catch { /* 例图清单是增强项，拿不到不阻塞出题 */ }
        console.log("【实体清单】" + (entities.join(", ") || "(未给)"));
        console.log("【阶段骨架】" + (arg("--stages") || "(未给——骨架只定结构，画面细节写在 scene 里)"));
        console.log("【图型】" + (arg("--figure-type") || "flowchart") + " · 【画布比】" + (arg("--ratio") || "按预设缺省"));
        // refs 自动检索：实体名+意图作查询包（宿主也可自己跑 pf refs 换查询包）
        try {
          const refsDirB = path.join(os.homedir(), ".promptfigure", "references");
          const idxB = loadRefsIndex(refsDirB);
          if (idxB && idxB.docs.length) {
            const qs = [arg("--intent") || "", ...entities].filter(Boolean).slice(0, 6);
            const { results: refHits } = idxB.search(qs, { k: 3 });
            console.log("\n【顶会参考图】（打开看，提炼画法）");
            if (refHits.length) {
              refHits.forEach((r, i) => {
                console.log(`${i + 1}. ${r.fig.imageAbs}`);
                console.log(`   图注: ${r.fig.caption.slice(0, 180)}${r.fig.caption.length > 180 ? "…" : ""}`);
              });
            } else {
              console.log("零命中——按写法规范自推（数据类型→学术原语），不要发明具象图标");
            }
          }
        } catch { /* 参考库缺失不阻塞出题 */ }
        console.log("\n【硬约束】(craft 阅卷时强制)");
        console.log("• 可印文字白名单 = 实体清单 + 阶段标题 + scene 内双引号标签——白名单外的文字不会上卡面");
        console.log("• 贴原图的槽位必须带来源标记：原文图 {{asset:名|路径}}（=original）、源码复现图 {{asset:名|路径|repro}}——来源分类会写进伴随 JSON 账本，AI 画的元素不许冒充原图（compose 拒贴 |drawn 的 asset）");
        console.log("• 提示词总预算 32000 字节；scene 过长会被拒");
        console.log("• 完成后执行: pf craft --scene \"<你写的 scene 段>\"（其余参数照旧）→ render");
        return;
      }

      // 文档级风格卡自动注入：全文多图画风统一（用户实测：只优化部分图、画风各異 → 割裂）
      let card = null;
      try { card = readMeta(arg("--doc"))?.styleCard?.text || null; } catch {}
      if (!card) {
        console.error("⚠️ 本文档还没有统一风格卡 —— 多图各用各的画风会割裂。");
        console.error('   建议先执行: pf style set --text "<全文统一的色板/线条/布局描述>"（一次设置，之后每张 craft 自动带上）');
      }
      const styleHints = [card, arg("--style")].filter(Boolean).join("; ");
      const r = craftPrompt({
        intent, entities,
        structure: arg("--structure") || "",
        // 布局契约阶段（对标 PaperBanana 成品提示词）："标题 | 要点1; 要点2 || 标题 | show …"
        stages: arg("--stages") || "",
        figureType: arg("--figure-type") || "flowchart",
        lang: arg("--lang") || "en",
        styleHints,
        // 🔴 用户色板："deep red #C0392B, teal #16A085, …" —— 优先于风格卡与缺省 Okabe-Ito
        colors: arg("--colors") || "",
        preset: arg("--preset") || "",
        journal: arg("--journal") || "",
        // 🔴 画布比（V10 事故修复）：画布句从这里拼接，并经伴随 JSON 传给 render
        ratio: arg("--ratio") || "",
        // 🔴 承载意思的几何约束（2026-09-26 Swin 实测补）：精确结构类图必填，
        // QA 包据此出逐项几何核验清单（AI 渲染保证不了，见 craft.mjs 同参注释）
        geometry: arg("--geometry") || "",
        // 🔴 思考外置（2026-10-14）：宿主 AI 看图思考后写的自然语言画面段，直通进提示词
        // 主体并跑护栏；带 --scene 时跳过内置词典推导（词典降为无 scene 时的兜底）
        scene: arg("--scene") || "",
        // 🔴 多轮精修（2026-09-21）：上一版视觉核验的缺陷逐条拼接，"缺陷1; 缺陷2"
        fixes: arg("--fixes") || "",
      });
      // 提示词走 stdout（--out 或重定向都行）；诊断走 stderr 不污染
      // ---- 🔴 模块对账审查（2026-10-15 用户问「有没有真正尊重原文」——实锤：宿主 AI 拿了原图
      // 可以只贴一角/示意性重画，没人核对原图模块是否被交代）。规则：图注里出现的模块/方法
      // 术语必须在 scene/stages/intent 里可查；缺了 = 告警要求宿主 AI 亲眼看原图逐模块决定
      // 去留并写理由（省略要有意，不许默认丢失）。整图贴 = 全量保真；取局部用 crop= 标签。
      // ---- 🔴 省略清单（2026-10-15 用户定规「用户ai必须给出去掉的原因，否则基本尊重原作者意图，
      // 拿不准要问用户」）：--omissions "模块=理由; 模块2=理由2" 是省略的**唯一**合法出口——
      // 写在 scene 里的"省略理由"机制读不到，等于没写。声明的省略落 sidecar reconciliation
      // 段，assemble 时随成图回显（用户一眼看到少了什么、为什么少）；未声明的缺失术语 =
      // 告警升级：补图 / 声明理由 / 问用户，三选一，不许默默省略。
      // 🔴 位置修正（2026-10-15 自查实锤）：原放在质量门/字节预算/产物体检三道 die **之后**——
      // 门禁拒绝时对账告警永远不出现，恰是宿主最需要它的场景。搬到 craftPrompt 返回后立即跑、
      // 立即打印（结尾总打印处过滤【模块对账】防重复），die 前也可见。
      {
        const omissions = (arg("--omissions") || "")
          .split(/[;；]/).map((s) => s.trim()).filter(Boolean)
          .map((pair) => {
            const eq = pair.indexOf("=");
            return eq > 0
              ? { module: pair.slice(0, eq).trim(), reason: pair.slice(eq + 1).trim() }
              : { module: pair, reason: "" };
          });
        const omissionsCover = (term) => {
          const t = term.toLowerCase();
          // 词级覆盖（"LiSiam" 能被 "LiSiam、LRL 行=图注已说明只对比方法" 这类声明盖住）：
          // 声明模块名与术语互含，或拆词后任一实词互含
          return omissions.some((o) => {
            const m = o.module.toLowerCase();
            if (m.includes(t) || t.includes(m)) return true;
            const mw = m.split(/\s+/).filter((w) => w.length >= 3);
            return mw.some((w) => t.includes(w) || w.includes(t));
          });
        };
        try {
          const mDoc = path.basename(resolveDoc(arg("--doc")));
          const mMeta = readMeta(mDoc);
          const mImgBlocks = (mMeta.blocks || []).filter((b) => b.images && b.images.length);
          // 🔴 槽位标记剥离（2026-10-15 自查实锤）：scene 里 {{asset:DFDC_ours|C:/...DFDC.pdf}}
          // 的名字/路径含术语时，「文件名里出现」被误判成「图里已交代」——自指污染，
          // 对账永远查不出这类缺失。对账看的是画面内容规划，不是文件名。
          const hayAll = [arg("--scene"), arg("--stages"), arg("--intent")].filter(Boolean).join(" ")
            .replace(/\{\{[^}]*\}\}/g, " ").toLowerCase();
          const GENERIC = /^(figure|fig|the|this|we|our|note|given|overview|qualitative|quantitative|comparison|evaluations?|visual|correlation|ablation|study|results?|table|left|right|top|bottom|framework|method|approach|dataset|performance|different|various|across|from|denotes)$/i;
          const reconLedger = [];
          for (const s of r.slots || []) {
            if (s.kind !== "asset") continue;
            const base = path.basename(String(s.value).split(/[\\/]/).pop()).replace(/\.(pdf|png|jpe?g)$/i, "");
            const hit = mImgBlocks.find((b) => b.images.some((im) => path.basename(String(im)).replace(/\.\w+$/i, "") === base));
            const caption = hit ? String(hit.text || "") : "";
            if (!caption) continue;
            const terms = [...new Set((caption.match(/\b[A-Z][A-Za-z0-9]{3,}(?:\s+[A-Z][A-Za-z0-9]{3,})*/g) || []))]
              .map((t) => t.trim()).filter((t) => !GENERIC.test(t));
            // 多词短语拆到词级查：任一实词命中即算体现（"Qualitative DSSIM"→scene 有 DSSIM 就不报）
            const missing = terms.filter((t) => {
              const words = t.toLowerCase().split(/\s+/).filter((w) => !GENERIC.test(w));
              if (!words.length) return false;
              if (words.some((w) => hayAll.includes(w))) return false;
              return !omissionsCover(t); // 已声明省略的术语不再算缺失（理由落库可审计）
            });
            const omitted = terms.filter((t) => omissionsCover(t));
            if (omitted.length) reconLedger.push({ figure: base, omitted, omissions: omissions.filter((o) => omitted.some((t) => omissionsCover(t))) });
            if (missing.length) {
              r.warnings.push(`【模块对账·未交代】"${base}" 的原文图注提到 ${missing.join("、")}，scene/stages/intent 里没出现、也没有省略声明——基本尊重原作者意图：要么这些模块进图（整图贴=全量保真；取局部用 {{asset:名|路径|crop=左,上,宽,高}}，坐标按真实像素），要么 --omissions "${missing[0]}=<去掉的理由>" 声明（理由会随成图回显给用户）；**给不出理由或拿不准该不该省——停下来问用户，不许默默省略**。示意性重画不许替代原图模块。`);
            }
          }
          if (omissions.length) r.reconciliation = omissions; // sidecar 落库（assemble 回显）
          // 立即打印：后面三道门禁任何一道 die，这里已经看到了
          r.warnings.filter((w) => w.includes("【模块对账")).forEach((w) => console.error("⚠️ " + w));
        } catch { /* 模块对账是增强审查，meta 缺失不阻塞出题 */ }
      }
      // ---- 🔴 输入质量门（2026-09-21 定规）：劣质输入出不了提示词文件 ----
      // 弱模型无视 stderr 的 ⚠️，所以 blocker 直接 exit 1：weak AI 看到 exit!=0 会读 stdout 改命令重试
      const { scoreCraft } = await import("../src/quality.mjs");
      const atArg = arg("--at");
      const q = scoreCraft({
        intent: arg("--intent") || "",
        entities: arg("--entities") || "",
        stages: arg("--stages") || "",
        figureType: arg("--figure-type") || "flowchart",
        // 🔴 2026-09-21 "不读文章"后门封堵：不带 --at 溯源整段跳过 → 直接 blocker
        hasAt: !!atArg,
        // 🔴 2026-09-23 松绑轮：缺省宽松档（结构性必废才拦，质量降级类警告放行）；
        // --strict 或 PF_STRICT=1 恢复全量硬拦（质量优先的宿主 AI / 老用户）
        strict: has("--strict") || process.env.PF_STRICT === "1",
      });
      console.error(`── 输入质量分 ${q.score}/100（阶段 ${q.stageCount} · 实体 ${q.entityCount}）──`);
      q.blockers.forEach((b) => console.error("🚫 " + b));
      q.notes.forEach((n) => console.error("💡 " + n));

      // ---- 🔴 实体溯源（2026-09-21 第 2 层质量门）：--at 给了锚点就把实体拿回原文对账 ----
      // 质量门只能查"实体进了 stages"，查不了"实体是不是编的"——全文零命中的实体清单 = 疑似编造，拒绝。
      const srcForced = atArg && entities.length && has("--force"); // force 跳溯源 = 绕门，下面留痕
      if (srcForced) requireForceReason("craft 跳过实体溯源");
      if (atArg && entities.length && !has("--force")) {
        let srcText3 = null;
        try {
          const docId3 = path.basename(resolveDoc(arg("--doc")));
          const meta3 = readMeta(docId3);
          const target3 = resolveRef(meta3.blocks || [], atArg);
          // 🔴 2026-09-23 收紧轮：溯源窗口从 ±2 段扩到**整节**——真实体写在同节第 5 段，
          // 旧窗口会对不上账（要么误报 missing，要么把对账变成 skipped = fail open）。
          // 整节全部 para/caption 拼成对账语料；跨节实体仍需用对照格式声明原文词。
          const sibs3 = (meta3.blocks || []).filter((b) => (b.type === "para" || b.type === "caption") && b.secPath === target3.secPath);
          srcText3 = sibs3.map((b) => b.text).join("\n");
        } catch (e) {
          const em = String(e?.message || e);
          // 🔴 2026-09-21 红队实测：--at "abc"/畸形引用曾静默跳过溯源（= 绕过质量门）——
          // 除"项目不存在"外的一切引用错误都必须拦（引用错 = 溯源对不了账）
          if (!/项目/.test(em)) {
            const blocker = `--at 引用无效：${em}（引用错 = 溯源对不了账，必须改对章节再出）`;
            q.blockers.push(blocker);
            console.error("🚫 " + blocker);
          }
        }
        if (srcText3 != null) {
          const { checkEntitySource } = await import("../src/quality.mjs");
          const es = checkEntitySource({ entities, sourceText: srcText3 });
          if (es.blocker) { q.blockers.push(es.blocker); console.error("🚫 " + es.blocker); }
          else if (es.note) console.error("💡 " + es.note);
        }
      }

      if (q.blockers.length && has("--force")) requireForceReason("craft 质量门硬闯");
      if (q.blockers.length && !has("--force")) {
        // 🔴 小白增强（2026-09-22）：弱 AI 看"规则描述"不会改，看"❌/✅ 对照示范"才会改——
        // 按 code 出示范，再 die
        const { fixExamples } = await import("../src/quality.mjs");
        const ex = fixExamples(q.codes || []);
        if (ex.length) {
          console.error("── 改法示范（对照着改你的命令）──");
          ex.forEach((l) => console.error(l));
        }
        die(`craft 拒绝：输入质量不达标（${q.blockers.length} 个 blocker，见上）。逐条改完重跑（确要硬闯加 --force "理由"）`,
          `pf distill --at "<章节 段号>" —— 从原文抽实体/阶段素材再填空`);
      }
      const bytesOverCraft = Buffer.byteLength(r.prompt, "utf8") > 32000;
      if (has("--force") && (q.blockers.length || srcForced || bytesOverCraft)) {
        // 🔴 红队实测：--force 硬闯无留痕（events.jsonl 查不到）——绕门必须落审计事件（带理由）
        try {
          appendEvent(path.basename(resolveDoc(arg("--doc"))), "craft.forced", {
            hasAt: !!atArg,
            reason: forceReason() || "(收口前遗留，无理由)",
            skippedSource: srcForced,
            bytesOver: bytesOverCraft,
            blockers: q.blockers.map(String).slice(0, 5),
            at: new Date().toISOString(),
          });
          console.error(`📎 --force 硬闯已留痕（craft.forced，理由：${forceReason()}；pf audit 可查）`);
          warnSuspiciousReason(forceReason());
        } catch { /* 无打开项目时跳过留痕 */ }
      }

      // ---- 🔴 提示词字节预算（32000，2026-10-13 从 8000 放开；旧 v18 事故 8205 被拒已不适用）----
      // craft 是唯一能提前看到全量的地方——超预算在这里拦，别等 render 花钱才知道。
      const promptBytes = Buffer.byteLength(r.prompt, "utf8");
      console.error(`── 提示词 ${promptBytes} 字节（渲染端上限 32000）──`);
      if (promptBytes > 32000 && !has("--force")) {
        die(`提示词 ${promptBytes} 字节，超渲染端预算（32000）——先精简再出：把已验证遵守的 fix 沉淀进 --stages 措辞并从 --fixes 删除（pf refine 看活跃修正），或砍掉次要阶段要点`,
          `pf refine <figureId> 看活跃修正清单（--settle 沉淀已遵守项）`);
      } else if (promptBytes > 30000) {
        console.error(`⚠️ 提示词 ${promptBytes} 字节逼近预算——这轮能出，但再叠 fixes 可能爆；已遵守的修正及时沉淀。`);
      }

      // ---- 🔴 输出侧体检（2026-09-23 收紧轮③）：组装+净化后的提示词自检 ----
      // 输入门拦劣质输入，这层查门内产物：实体/阶段标题回声、护盾残留、配色句与画布比契约、长度下限。
      // 失败 = "标签/阶段/配色契约不会出现在图上"级别的产物损坏，渲染必废 → 拦（--force 豁免留痕）。
      const sc = promptSelfCheck({ prompt: r.prompt, entities, stageTitles: r.stageTitles || [], suggestedRatio: r.suggestedRatio });
      console.error(`── 产物体检：${sc.issues.length ? sc.issues.length + " 项异常" : "通过（实体回声/阶段标题/配色/画布比/长度）"} ──`);
      sc.issues.forEach((s) => console.error("🚫 " + s));
      if (sc.issues.length && !has("--force")) {
        die(`craft 产物体检失败（${sc.issues.length} 项，见上）——这类问题等于图上会丢实体/丢阶段/丢配色契约，渲染必废。常见根因：实体或标题里含引号等特殊字符击穿净化护盾——去掉特殊字符重跑；确要硬闯 --force "理由"`,
          'pf craft --at "…" --intent "…" --entities "Input Image,Coarse Filter,Fine Grader" --stages "…"（干净的标签+标题）');
      }
      if (sc.issues.length && has("--force")) {
        requireForceReason("craft 产物体检硬闯");
        try {
          appendEvent(path.basename(resolveDoc(arg("--doc"))), "craft.selfcheck", {
            issues: sc.issues.map(String).slice(0, 5),
            reason: forceReason() || "(无理由)",
            at: new Date().toISOString(),
          });
          console.error(`📎 产物体检硬闯已留痕（craft.selfcheck，理由：${forceReason()}；pf audit 可查）`);
        } catch { /* 无打开项目时跳过留痕 */ }
      }

      // （模块对账/省略清单已搬到 craftPrompt 返回后、门禁 die 之前——2026-10-15 自查修正）
      const out = toWinPath(arg("--out"));
      if (out) {
        // 🔴 红队实测（2026-09-23 fuzzA）：--out 静默覆盖任意已存在文件 = 弱 AI 指向论文/配置即数据损毁
        const absOut = path.resolve(out);
        if (fs.existsSync(absOut) && !absOut.endsWith(".craft.json") && !has("--force")) {
          die(`--out 目标已存在，拒绝覆盖（防误毁用户文件）：${out}——换个文件名，或确认无价值后 --force 覆盖`,
            `ls 看下这个文件是什么 → 不是你创建的就换名（--out temp-prompt-2.txt）`);
        }
        try {
          fs.writeFileSync(absOut, r.prompt + "\n", "utf8");
        } catch (e) {
          die(`提示词写盘失败（${out}）：${e.code || e.message}——用相对路径重试（当前目录下，如 --out temp-prompt.txt）`,
            `pf craft --at "<章节 段号>" ... --out temp-prompt.txt（相对路径最稳）`);
        }
        // 🔴 伴随 JSON：render 自动继承 suggestedRatio —— 画布句说的比例 = 实际渲染比例，
        // 不靠宿主 AI 记得传 --ratio（V10 事故：提示词说 16:5、渲染 16:9 → 内容压缩）
        const sidecar = craftSidecarPath(out);
        fs.writeFileSync(path.resolve(sidecar), JSON.stringify({
          // 🔴 全量输入落盘（pf refine 重拼下一轮命令的依据，2026-09-21）
          intent: arg("--intent") || "",
          entities: arg("--entities") || "",
          structure: arg("--structure") || "",
          stages: arg("--stages") || "",
          figureType: arg("--figure-type") || "flowchart",
          preset: arg("--preset") || "",
          journal: arg("--journal") || "",
          colors: arg("--colors") || "",
          lang: arg("--lang") || "en",
          fixes: arg("--fixes") || "",
          // 🔴 scene 直通原文落盘（refine 重拼依据）；slots = 资产槽位清单（pf compose 用）
          scene: arg("--scene") || "",
          slots: r.slots || [],
          // 🔴 省略清单落库（2026-10-15）：--omissions 声明的模块省略+理由——assemble 随成图
          // 回显，用户一眼看到图里少了哪些原文模块、为什么少；没有这段=没交代
          reconciliation: r.reconciliation || [],
          at: atArg || "",
          suggestedRatio: r.suggestedRatio,
          // 🔴 承载意思的几何约束（2026-09-26）：QA 包逐项核验的基准
          geometry: r.geometry || arg("--geometry") || "",
          generatedAt: new Date().toISOString(),
          warnings: r.warnings || [],
        }, null, 2), "utf8");
        console.log(`✅ 提示词已写入 ${path.resolve(out)}（pf render --prompt-file 用）`);
        if (r.suggestedRatio) console.log(`📐 画布比 ${r.suggestedRatio}（写进 ${path.basename(sidecar)}，render 自动继承）`);
        // 🔴 2026-09-21 弱模型实测：craft 成功输出不带下一步 → 弱模型转头先试 premium 被门禁拦。
        // craft 的输出必须直接给出正确顺序的 render 命令（standard 草稿在先）
        console.log(`\n⏭ 下一步: pf render --at "<原文位置>" --model standard --prompt-file ${out}`);
        console.log(`   （先 standard 草稿 → qa-list 核验 → 审批通过后才 premium 定稿；卡住就 pf next）`);
      } else {
        console.log(r.prompt);
      }
      console.error("");
      if (r.warnings?.length) r.warnings.filter((w) => !w.includes("【模块对账")).forEach((w) => console.error("⚠️ " + w));
      if (r.reconciliation?.length) {
        console.error("── 省略清单（已声明，理由随成图回显）──");
        for (const o of r.reconciliation) console.error(`   · ${o.module}${o.reason ? ` = ${o.reason}` : "（⚠️ 没写理由——补上，或问用户）"}`);
      }
      if (r.typeMeta) {
        console.error(`── 图型「${r.typeMeta.name}」──`);
        console.error(`   什么时候用: ${r.typeMeta.when}`);
        console.error(`   构图思考:   ${r.typeMeta.think || "（见 pf types show " + r.typeMeta.id + " 的示例）"}`);
        // 🔴 成品示例（2026-10-13 调研 PaperBanana：Planner 靠「文本→成品图」示例对学会写描述）：
        // 宿主 AI 是本产品的 Planner——craft 时当场给它一条照抄结构的示范，show 句的
        // 具体度（形状/颜色/母题）就是它该达到的水平
        if (r.typeMeta.example?.cmd) {
          console.error(`   成品示例（照抄结构、换实体；注意 show 句的具体度）:`);
          console.error(`     ${r.typeMeta.example.cmd}`);
        }
      }
      console.error("── 写手守卫（你写/改提示词时遵守；已内建在规则层，勿写进图模型提示词）──");
      r.writerGuard?.forEach((g, i) => console.error(`G${i + 1}. ${g.slice(0, 100)}…`));
      if (r.checklist?.length) {
        console.error("── 出图前自审（规则层已过，判断层归你）──");
        r.checklist.forEach((c, i) => console.error(`${i + 1}. ${c}`));
      }
      console.error("── 渲染后视觉核验（图出来后必须亲眼读图逐条过；对标 ARS VLM 核验，pf qa-list 随时看）──");
      r.qaChecklist?.forEach((c) => console.error(c));
      return;
    }

    case "qa-list": {
      // 渲染后视觉核验清单（宿主 AI 出图后读图逐条核验；不达标带反馈重出 standard）
      // 带 figureId 时附上该图的实体清单（来自 craft prompt）与图文件绝对路径——
      // 核验员（你自己的视觉能力/视觉模型）没拿到实体清单就做不了 Q2/Q4 逐字比对（2026-09-21 实测）
      const { QA_CHECKLIST } = await import("../src/craft-rules.mjs");
      // 🔴 figureId 可省（缺省落最新出的图）：2026-09-21 弱模型实测，出图后不知道 figureId、
      // 拿 --at 乱试直接死——核验清单这种高频命令不该有必填 id
      let figId = rest[0] && !rest[0].startsWith("--") ? rest[0] : null;
      const docId2 = path.basename(resolveDoc(arg("--doc")));
      const meta2 = readMeta(docId2);
      if (!figId) {
        figId = Object.values(meta2.figures || {}).sort((a, b) => (b.versions?.at(-1)?.at || "").localeCompare(a.versions?.at(-1)?.at || ""))[0]?.figureId || null;
      }
      const f = figId ? (meta2.figures || {})[figId] : null;
      if (figId && !f) die(`找不到图 ${figId}（pf render list 查 figureId）`);
      if (f) {
        const last = f.versions[f.versions.length - 1];
        console.log(`图 ${figId} @${f.at}（${f.versions.length} 版，最新 ${last.model}）`);
        const abs = path.join(projectDir(docId2), last.file);
        console.log(`图文件（用你的看图能力打开它）: ${abs}`);
        console.log(`—— 该图的实体清单（Q2/Q4 逐字比对的基准，来自 craft 提示词）——`);
        const entLine = (last.prompt || "").match(/Named entities \(keep verbatim\): present each of the following as a labelled node\/block — (.+?)\./);
        console.log(entLine ? entLine[1] : `（craft 提示词全文，自行找实体清单）\n${(last.prompt || "").slice(0, 800)}`);
        console.log("");
      } else {
        console.log("渲染后视觉核验（每张图必过；按「结构/风格/保真」三个镜头逐条过，任何一条不过 = standard 重出，别把问题图推给用户审批）：");
        console.log("（提示：pf qa <figureId> 是核验闭环命令——任务包+--pass/--fail 写回；approve 只认最新版 QA 记录）");
      }
      printQaChecklist(QA_CHECKLIST, "");
      console.log("\n写回: pf qa <figureId> --pass --note \"依据\" / --fail --note \"缺陷1; 缺陷2\"");
      return;
    }

    case "qa": {
      // 🔴 QA 核验闭环（2026-09-21 "别放水"定规的执行端，用户批评"AI 审批放水"）：
      //   pf qa <id>             核验任务包（体检数字+实体清单+核验清单+写回命令）
      //   pf qa <id> --pass      记录 PASS + 自动写回审批通过（by=ai，GUI 用户可见可改判）
      //   pf qa <id> --fail      记录 FAIL + 自动驳回 + 缺陷逐条自动进精修状态机（fail→fix 缝合）
      // 审批门禁按最新版对账：出新版本旧 QA 作废（render.mjs 清记录+审批重置），定稿也要重新核验。
      const docId2 = path.basename(resolveDoc(arg("--doc")));
      const meta2 = readMeta(docId2);
      const figs2 = meta2.figures || {};
      let fid = rest[0] && !rest[0].startsWith("--") ? rest[0] : latestFigure(meta2)?.figureId;
      if (!fid || !figs2[fid]) die("找不到图。用法：pf qa <figureId> [--pass|--fail] [--note \"...\"]", "pf render list 查全部 figureId");
      const fig = figs2[fid];
      const last = fig.versions[fig.versions.length - 1];
      const { qaState } = await import("../src/quality.mjs");
      const verdict = has("--pass") ? "pass" : has("--fail") ? "fail" : null;

      // ---- 🔴 执行留证门③（2026-09-23 用户拍板"明确执行才放行"）：写回核验结论前必须真的领过任务包 ----
      // 任务包里有体检数字/实体清单/阶段画法基准，没领过就写回 = 没读图就裁决。24h 内对该图无
      // qa.pack 记录 → 拒；裸 --force 放行，qa.no_pack 留痕进 pf audit。
      if (verdict) {
        const packed = hasEvidence(docId2, ["qa.pack"], { filter: (e) => e.figure === fid });
        if (!packed) {
          if (has("--force")) {
            logEvidence(docId2, "qa.no_pack", { figure: fid, forced: true, reason: forceReason() || "(无理由)" });
            console.error("📎 未领任务包直接写回核验结论（--force 放行，qa.no_pack 留痕，pf audit 可查）");
          } else {
            logEvidence(docId2, "qa.no_pack", { figure: fid, forced: false });
            die(`qa 拒绝：过去 24h 内没有领取过 ${fid} 的核验任务包——任务包里有体检数字、实体清单、阶段画法基准，跳过它写回 = 凭印象裁决（= 放水）。先执行 pf qa ${fid}`,
              `pf qa ${fid} 按任务包逐步核验（第 3c 步逐阶段比对）→ 再带 --pass/--fail --note 写回`);
          }
        }
      }

      // ---- 写回模式（--pass / --fail）----
      if (verdict) {
        let note = arg("--note") || "";
        const { isQuantifiedNote } = await import("../src/quality.mjs");
        if (verdict === "fail" && !note.trim()) {
          die('--fail 必须带 --note "缺陷1; 缺陷2" —— 缺陷会逐条进精修状态机，没有缺陷清单的驳回 = 白白浪费一轮',
            `pf qa ${fid} 先看任务包，逐条核验后把 FAIL 项写进 note`);
        }
        // 🔴 2026-09-23 收紧轮：PASS 必须带**量化依据**——"看起来没问题" = 凭印象核验 = 放水。
        // 🔴 2026-09-23 松绑轮：量化依据不再强制 AI 手写——插件能算的（留白/彩色占比/尺寸）
        // 自动测算拼进 note，AI 只补语义结论（标签对不对/画法画了没）。没有图可算时才拦。
        // 🔴 2026-09-23 变异+红队轮：图文件**不存在** = 没有核验对象，编个带数字的 note
        // 也不能 PASS（fuzzA 实测：PNG 缺失 + "文字 5 条全对" → 直接 approved）。
        if (verdict === "pass" && !fs.existsSync(path.join(projectDir(docId2), last.file))) {
          die(`PASS 被拒：图文件不存在（${last.file}）——没有图就没有核验对象，任何 note 都是编造`,
            `pf qa ${fid} 任务包里第 1 步就是找到图文件；渲染失败回 pf render 重出，或 pf refine 看上一轮失败原因`);
        }
        if (verdict === "pass" && !isQuantifiedNote(note)) {
          let autoBasis = null;
          try {
            const { pngStats } = await import("../src/png-trim.mjs");
            const st = pngStats(fs.readFileSync(path.join(projectDir(docId2), last.file)));
            if (st) autoBasis = `auto体检: 留白${st.wastePct}%·彩色占比${st.satPct}%·${st.w}x${st.h}`;
          } catch { /* 图读不到时无兜底 */ }
          if (autoBasis) {
            note = note.trim() ? `${note.trim()}；${autoBasis}` : `${autoBasis}（量化依据由插件自动测算；标签/画法的语义核验责任在核验 AI——放水会在 GUI 与审计留痕）`;
            console.error(`ℹ️ note 未含量化数字——已自动拼入插件体检数据（${autoBasis}）。语义核验（Q2/Q4/Q9）仍需你亲眼读图确认。`);
          } else {
            die(`--pass 必须带 --note "量化依据"（图文件读不到，无法自动测算）——无依据的通过 = 放水（V11 事故教训），审批门禁也不认这种记录`,
              `pf qa ${fid} 按任务包逐条核验，note 写清：可见文字 N 条全对上、色相 X 个、留白约 Y%、最小字号 ≥ Zpx`);
          }
        }
        fig.qa = { version: fig.versions.length, verdict, note, by: "ai", at: new Date().toISOString() };
        writeMeta(docId2, meta2);
        const st = verdict === "pass"
          ? setStatus(docId2, fid, "approved", `QA通过(v${fig.versions.length}): ${note}`.slice(0, 300), "ai")
          : setStatus(docId2, fid, "rejected", `QA驳回(v${fig.versions.length}): ${note}`.slice(0, 300), "ai");
        appendEvent(docId2, verdict === "pass" ? "qa.pass" : "qa.fail", { figure: fid, version: fig.versions.length, note });
        console.log(`✅ QA ${verdict.toUpperCase()} 已记录（v${fig.versions.length}）→ 审批状态: ${st.status}`);
        if (verdict === "pass") {
          if (last.model === "premium") {
            console.log(`⏭ 下一步: 这张图已定稿 ✅ —— pf doc figures 挑下一张要重画的（全部完成则收工）`);
          } else {
            console.log(`⏭ 下一步: pf prompt ${fid} --out <名字>.txt 导出定稿提示词 → pf render --at "${fig.at}" --model premium --prompt-file <名字>.txt`);
          }
        } else {
          // fail→fix 缝合：缺陷逐条进精修状态机（与 refine --fix 同规则去重）
          fig.activeFixes = fig.activeFixes || [];
          const fixes = note.split(/[;；]/).map((s) => s.trim()).filter(Boolean);
          let added = 0;
          for (const fx of fixes) {
            if (!fig.activeFixes.some((x) => x === fx)) { fig.activeFixes.push(fx); added++; }
          }
          writeMeta(docId2, meta2);
          console.log(`   ${added} 条缺陷已写进精修状态机（活跃修正共 ${fig.activeFixes.length} 条）`);
          const cmd = refineCommand(fig);
          if (cmd) {
            console.log(`—— 下一轮 craft 命令（直接复制执行；修正已改为沉淀指引，见下方）——`);
            console.log(`  ${cmd}`);
            settleGuidance(fig).forEach((l) => console.log(l));
            console.log(`  流程：按上方指引把修正写进 --stages 后 craft → pf render --force "修正轮: 理由" --ref prev（premium 修正轮；--ref prev 带上一版做 img2img 条件，画对的部分不漂移）→ 亲眼核验 → pf qa ${fid} --pass`);
          } else {
            console.log(`⏭ 下一步: pf refine ${fid} —— 最新版无 craft 伴随 JSON，手动重拼命令（修正写进 --stages 措辞，不要传 --fixes）`);
          }
        }
        return;
      }

      // ---- 任务包模式（不带 --pass/--fail）----
      const { QA_CHECKLIST: QC } = await import("../src/craft-rules.mjs");
      const { pngStats } = await import("../src/png-trim.mjs");
      const abs = path.join(projectDir(docId2), last.file);
      console.log(`════ QA 核验任务包 · ${fid} v${fig.versions.length}（${last.model}）@${fig.at} ════`);
      // 🔴 执行留证（2026-09-23）：领任务包 = 写回核验结论的前置证据（qa 写回留证门③对账用）
      logEvidence(docId2, "qa.pack", { figure: fid, version: fig.versions.length });
      const qs = qaState(fig);
      console.log(`QA 记录: ${qs.fresh ? `${qs.verdict.toUpperCase()}（${qs.qa.note || "无意见"}）` : "无/已过期 —— 本版必须核验后才能通过审批"}`);
      console.log(`—— 第 1 步：打开图（用你的看图能力）——`);
      console.log(`  ${abs}`);
      try {
        const st = pngStats(fs.readFileSync(abs));
        if (st) {
          console.log(`—— 第 2 步：自动体检数字（裁前口径，判定 Q5/Q7 的底数）——`);
          console.log(`  尺寸 ${st.w}x${st.h}${last.trimmedFrom ? `（裁剪自 ${last.trimmedFrom}）` : ""} · 留白 ${st.wastePct}% · 边缘白度 ${st.edgeWhitePct}% · 彩色占比 ${st.satPct}%${st.satPct < 8 ? "  🚫 <8% 黑白线稿风回归（Q7 FAIL，V17 事故）" : ""}`);
          // 🔴 期刊字号物理核验（2026-09-22 用户拍板补差距③）：craft 带 --journal 时，
          // 把"最小文字应为多少 px 高"按印刷宽度换算出来——AI 量图上最小文字即可判定，
          // 不用猜"看起来够不够大"。
          try {
            const scQ = last.sidecar && fs.existsSync(last.sidecar) ? JSON.parse(fs.readFileSync(last.sidecar, "utf8")) : null;
            if (scQ?.journal) {
              const fc = (await import("../src/journal.mjs")).fontCheck({ journal: scQ.journal, preset: scQ.preset || "", pngW: st.w });
              if (fc) console.log(`  期刊字号核验（${fc.journal}，${fc.preset}，印刷宽 ${fc.colMm}）: 图上**最小**文字高度应 ≥ ${fc.minTextPx}px（${fc.minPt}pt @ ${fc.mmPerPx}mm/px）——量到更小 = 字号没被遵守，FAIL`);
            }
          } catch { /* sidecar 缺失/损坏时跳过 */ }
        }
      } catch { /* 图文件读不到时让 AI 自己开 */ }
      console.log(`—— 第 3 步：实体清单（Q2/Q4 逐字比对基准，来自 craft 提示词）——`);
      const entLine = entityLineOf(last.prompt);
      console.log(entLine ? `  ${entLine[1]}` : `  （craft 提示词自行找实体清单）\n${(last.prompt || "").slice(0, 600)}`);
      // 🔴 双语对照核验（渗透实测补的语义层）：确定性溯源只能验"原文侧词存在"，
      // 验不了"英文标签真的对应那个词"（蹭词攻击）——对应关系由 Q4 语义核验把关
      try {
        const scE = last.sidecar && fs.existsSync(last.sidecar) ? JSON.parse(fs.readFileSync(last.sidecar, "utf8")) : null;
        const pairs = String(scE?.entities || "").split(/[,，]/).map((s) => s.trim()).filter((s) => s.includes("|"));
        if (pairs.length) {
          console.log(`—— 第 3b 步：双语对照核验（逐对回答"这个英文标签是该中文词的合理翻译吗？"）——`);
          pairs.forEach((p) => console.log(`  ${p.replace("|", "  ←  ")}`));
          console.log(`  任何一对"标签与原词意思对不上" = 伪造出处，Q4 FAIL（原文侧词存在 ≠ 翻译正确）。`);
        }
      } catch { /* sidecar 缺失时跳过 */ }
      // 🔴 2026-09-23 收紧轮④：阶段画法核验（Q9 比对基准，与 review ai 审批任务包共用 stageChecklistLines）
      const scLines = await stageChecklistLines(last.sidecar);
      if (scLines) {
        console.log(`—— 第 3c 步：阶段画法核验（Q9 比对基准；逐阶段回答：盒子在吗？标题对吗？画法元素真画了吗？）——`);
        scLines.forEach((l) => console.log(l));
        console.log(`  任何阶段盒子缺失/标题不符/[画法]元素没画 = 布局漂移，Q9 FAIL（缺陷写具体到阶段，精修按阶段定位）。`);
      }
      // 🔴 通道归因（2026-09-26 Swin 实测定级）：standard + 图带文字 = Q1 预期 FAIL，
      // 但这是通道问题不是设计缺陷——提前说清，宿主别把额度烧在 standard 精修循环里。
      try {
        const scCh = last.sidecar && fs.existsSync(last.sidecar) ? JSON.parse(fs.readFileSync(last.sidecar, "utf8")) : null;
        const hasText = Boolean(entityLineOf(last.prompt)) || Boolean(String(scCh?.entities || "").trim());
        if (last.model === "standard" && hasText) {
          console.log(`—— ⚠️ 通道告警：本版 standard 且图带文字标签 ——`);
          console.log(`  standard 档文字质量不可靠（2026-09-27 四样本复测：字符乱码或内容污染/轴标签错乱都可能出现，4/4 中招）：Q1/Q2/Q3 预期 FAIL。性质 = 通道选错，不是设计缺陷——直接 render --model premium --force "文字图不走 standard: 换通道重出" ，别在 standard 上反复精修。`);
        }
        // 🔴 承载意思的几何核验清单（2026-09-26）：craft 声明过 --geometry 才有此节
        const geo = String(scCh?.geometry || "").trim();
        if (geo) {
          console.log(`—— 第 3d 步：几何核验（Q3 比对基准；AI 渲染不保证几何精确——逐项亲眼核对）——`);
          geo.split(/[;；]/).map((g) => g.trim()).filter(Boolean).forEach((g) => console.log(`  □ ${g}`));
          console.log(`  任何一项与图不符（轴标签重复/分界线落错行/偏移量不足）= 意思错，Q3 阻断级；精确结构类图建议直接走脚本/矢量路径，别反复烧 premium。`);
        }
      } catch { /* sidecar 缺失/损坏时跳过 */ }
      console.log(`—— 第 4 步：逐条核验（按三个镜头过：结构/风格/保真；每条 PASS/FAIL + 图里的证据；先列出图上全部可见文字再逐条对照）——`);
      printQaChecklist(QC);
      console.log(`  通过标准：三个镜头各给一条量化依据（结构=盒子/元素数、风格=色相数/留白、保真=可见文字对上几条）——无数字的通过 = 放水，写回会被拒`);
      console.log(`—— 第 5 步：写回（approve 门禁只认最新版 QA 记录）——`);
      console.log(`  全部 PASS →  pf qa ${fid} --pass --note "量化依据（必填且须含数字：可见文字 N 条全对上/色相 X 个/留白 Y%/最小字号 Zpx）——无数字的通过 = 放水，写回会被拒"`);
      console.log(`  任何 FAIL →  pf qa ${fid} --fail --note "缺陷1; 缺陷2"（自动驳回+缺陷进精修状态机）`);
      return;
    }

    case "inspect": {
      // 🔴 像素级自动体检（2026-09-21 定规：核验数字由插件算，AI 只做语义判断）——
      // 留白占比/边缘白度/彩色像素占比/像素比全部量化输出，AI 核验以这些数字为底数
      const { pngStats } = await import("../src/png-trim.mjs");
      const { pngDims, ratioMismatch } = await import("../src/ratio.mjs");
      const docId2 = path.basename(resolveDoc(arg("--doc")));
      const meta2 = readMeta(docId2);
      const figs = meta2.figures || {};
      const fid = rest[0] || Object.values(figs).sort((a, b) => (b.versions?.at(-1)?.at || "").localeCompare(a.versions?.at(-1)?.at || ""))[0]?.figureId;
      if (!fid || !figs[fid]) die("找不到图。用法：pf inspect [figureId]", "pf render list 查全部 figureId");
      const f = figs[fid];
      const last = f.versions[f.versions.length - 1];
      const abs = path.join(projectDir(docId2), last.file);
      if (!fs.existsSync(abs)) {
        // 🔴 2026-09-21 子智能体实测：dry-run/占位路径下裸 ENOENT = 死路，必须说明核验的出路
        die(`图文件不存在：${abs}（典型原因：最近一次是 --dry-run 排练/沙盒占位路径，没产真图）`,
          `真实渲染一次（去掉 --dry-run）拿到真图后再 pf inspect ${fid}；渲染需授权/花钱时，把现状如实回报用户`);
      }
      const buf = fs.readFileSync(abs);
      const st = pngStats(buf);
      console.log(`════ 自动体检 · ${fid} v${f.versions.length}（${last.model}）════`);
      console.log(`  图文件: ${abs}`);
      if (st) {
        console.log(`  尺寸: ${st.w}x${st.h}${last.trimmedFrom ? `（自动裁剪自 ${last.trimmedFrom}）` : ""}`);
        console.log(`  留白占比(裁前): ${st.wastePct}%   ── >30% = Q5 FAIL（已由自动裁剪兜底则看 trimmedFrom）`);
        console.log(`  边缘带白度: ${st.edgeWhitePct}%   ── 仅未裁剪版本作判定（<98% = 背景斑纹，Q5 FAIL）；裁后图内容贴边，此值仅参考`);
        console.log(`  彩色像素占比: ${st.satPct}%   ── <8% 且本图要求彩色内容 = 黑白线稿风回归（Q7 FAIL，V17 事故 4.6% / 正常彩色 15~24%）`);
        const rr = last.ratio && !last.trimmedFrom && pngDims(buf) ? ratioMismatch(last.ratio, { w: st.w, h: st.h }) : null;
        console.log(`  画布比: 请求 ${last.ratio || "默认"} → 实测 ${(st.w / st.h).toFixed(2)}:1${last.trimmedFrom ? "（自动裁剪后比例，非异常）" : rr ? `  ⚠️ 偏差 ${rr.dev}%` : ""}`);
      } else {
        console.log("  ⚠️ PNG 解析失败（图可能损坏）——直接重出");
      }
      console.log(`  craft 伴随: ${last.sidecar || "（无——旧版本，refine 需先重 craft）"}`);
      console.log(`—— 以下仍需 AI 亲眼核验（OCR 级检查插件做不了）——`);
      console.log(`  ① 全部可见文字逐条列出对照实体白名单（Q1/Q2）；② 结构方向与阶段顺序（Q3）；`);
      console.log(`  ③ 无编造元素（Q4）；④ 色相个数与红绿唯一区分（Q6）；⑤ 原文溯源与原图对照（Q8）`);
      return;
    }

    case "refine": {
      // 🔴 多轮精修状态机（2026-09-21 定规）：活跃修正落盘进图元数据，自动重拼下一轮 craft 命令
      // 用法：pf refine <figureId> --fix "新缺陷" / --settle "已遵守的修正" / --show
      const { writeMeta: wm } = await import("../src/store.mjs");
      const docId2 = path.basename(resolveDoc(arg("--doc")));
      const meta2 = readMeta(docId2);
      const fid = rest[0];
      if (!fid || !meta2.figures?.[fid]) die("用法：pf refine <figureId> --fix \"缺陷\" / --settle \"修正\" / --show", "pf render list 查全部 figureId");
      const fig = meta2.figures[fid];
      fig.activeFixes = fig.activeFixes || [];
      const fixText = arg("--fix");
      const settleText = arg("--settle");
      if (fixText) {
        for (const fx of fixText.split(/[;；]/).map((s) => s.trim()).filter(Boolean)) {
          if (!fig.activeFixes.some((x) => x === fx)) fig.activeFixes.push(fx);
        }
      }
      if (settleText) {
        for (const sx of settleText.split(/[;；]/).map((s) => s.trim()).filter(Boolean)) {
          fig.activeFixes = fig.activeFixes.filter((x) => !x.includes(sx) && !sx.includes(x));
        }
      }
      writeMeta(docId2, meta2);
      console.log(`════ 精修状态 · ${fid}（v${fig.versions.length}）════`);
      console.log(`活跃修正（${fig.activeFixes.length} 条）：`);
      fig.activeFixes.forEach((x, i) => console.log(`  (${i + 1}) ${x}`));
      // 自动重拼下一轮 craft 命令（与 qa --fail 共用同一份重拼逻辑）
      const cmd = refineCommand(fig);
      if (cmd) {
        console.log(`—— 下一轮 craft 命令（直接复制执行；修正已改为沉淀指引，见下方）——`);
        console.log(`  ${cmd}`);
        settleGuidance(fig).forEach((l) => console.log(l));
      } else {
        console.log(`  ⚠️ 最新版无 craft 伴随 JSON（旧版本）——回 craft 手动重拼（修正写进 --stages 措辞，不要传 --fixes）`);
      }
      console.log(`  流程：render --force "修正轮" --ref prev（premium 修正轮；--ref prev = 上一版做 img2img 条件，修缺陷不重掷骰子）→ pf inspect + 亲眼核验 → 零存疑才 review resolve --approve`);
      return;
    }

    case "next": {
      // 🔴 状态路由器（2026-09-21 用户反馈"别人的 AI 根本不会用"）：
      // 冷启动 AI 只需要反复 pf next → 执行 → pf next，不需要先读懂几十条命令
      const cfg = loadConfig();
      let docId = null, meta = null;
      try {
        const dir = resolveDoc(arg("--doc"));
        docId = path.basename(dir);
        meta = readMeta(docId);
      } catch { /* 没打开文档，让 next 指路 */ }
      const r = computeNext({ docId, meta, cfg }, { readReview, readAnchors });
      console.log(`── 当前阶段: ${r.stage} ──`);
      console.log(`下一步（复制执行，<尖括号> 是要你自己填的）:`);
      console.log(`  ${r.cmd}`);
      console.log(`为什么: ${r.why}`);
      console.log(`（之后每做完一步都再跑一次 pf next，它会跟着状态走）`);
      return;
    }

    case "plan": {
      // 🔴 小白对齐器（2026-09-22 "数模小白用不出好效果"）：next 解决"AI 不知道下一步"，
      // plan 解决"用户说不清要什么"——输出给用户的大白话问题卡（选项来自真实文档）+
      // AI 拿到答复后的执行步骤。弱 AI 照着两段输出走，不用自己发明流程。
      const cfg = loadConfig();
      let docId = null, meta = null;
      try {
        const dir = resolveDoc(arg("--doc"));
        docId = path.basename(dir);
        meta = readMeta(docId);
      } catch { /* 没打开文档，plan 会引导用户给文件 */ }
      const p = buildPlan({ docId, meta, cfg, goal: arg("--goal") || "" }, { readReview, readAnchors });
      console.log(`════ 配图计划${docId ? ` · ${docId}` : ""} ════`);
      console.log(`\n—— 第 1 步：把下面的话发给用户（原样转述，等他答复）——`);
      p.userLines.forEach((l) => console.log("  " + l));
      console.log(`\n—— 第 2 步：拿到答复后按顺序执行（<尖括号> 是要你自己填的）——`);
      p.steps.forEach((s, i) => {
        console.log(`  ${i + 1}. ${s.cmd}`);
        console.log(`     为什么: ${s.why}`);
      });
      console.log(`\n（用户答复有变就重新跑 pf plan --goal "<用户最新的话>"，计划会跟着状态更新）`);
      return;
    }

    case "board": {
      // 🔴 资产总览/多图看板（2026-09-21 子智能体 E/F 实测：批量配图时 status 只会说
      // "已生成 0 张"，接手别人项目要拼 5 条命令才能摸清现状）。board = 只读体检：
      // 每张图的版本/审批/QA/修正/资产存在性 + 风格卡 + 每张图下一步命令。
      const { figureNext } = await import("../src/next.mjs");
      const docId2 = path.basename(resolveDoc(arg("--doc")));
      const meta2 = readMeta(docId2);
      const rev2 = readReview(docId2) || {};
      const anchors2 = readAnchors(docId2) || [];
      const figs = Object.values(meta2.figures || {});
      console.log(`════ 资产总览 · ${docId2} ════`);
      console.log(`  风格卡: ${meta2.styleCard ? "已设置 ✓" : "未设置 ⚠️ 多图风格统一靠它——pf style set --text \"<统一风格描述>\"，之后每张 craft 自动注入"}`);
      try {
        const dryEvts = readEvents(docId2).filter((e) => e.type === "render.dryrun");
        if (dryEvts.length) console.log(`  排练:   累计 ${dryEvts.length} 次 --dry-run（最近 ${dryEvts[dryEvts.length - 1]?.ts || "?"}）；真实渲染后闭环才推进`);
      } catch { /* 事件读不到不阻塞 */ }
      if (figs.length === 0) {
        console.log("  （还没有图——pf next 看从哪开始）");
        return;
      }
      const ordered2 = figs.slice().sort((a, b) => (a.versions?.[0]?.at || "").localeCompare(b.versions?.[0]?.at || ""));
      let doneN = 0, brokenN = 0;
      for (const fig of ordered2) {
        const last = fig.versions?.at(-1);
        const fileAbs = last?.file ? path.join(projectDir(docId2), last.file) : null;
        const fileOk = fileAbs ? fs.existsSync(fileAbs) : false;
        const scOk = last?.sidecar ? fs.existsSync(last.sidecar) : null;
        const st = (rev2[fig.figureId] || {}).status || "pending";
        const qa = fig.qa ? String(fig.qa.verdict || "?").toUpperCase() + `(v${fig.qa.version})` : "—";
        const r = figureNext(fig, rev2);
        if (!r) doneN++;
        if (!fileOk) brokenN++;
        console.log(`\n  ▸ ${fig.figureId} · ${fig.at || "?"} · v${fig.versions.length}（${last?.model || "?"}）`);
        console.log(`    审批:${st}  QA:${qa}  修正:${(fig.activeFixes || []).length} 条  阶段:${r ? r.stage : "done ✅"}`);
        console.log(`    图文件:${fileOk ? "在 ✓" : "❌ 丢失"}  craft JSON:${last?.sidecar ? (scOk ? "在 ✓" : "❌ 丢失") : "无（旧版/refine 重拼不可用）"}`);
        if (r) console.log(`    下一步: ${r.cmd}`);
        if (!fileOk && st === "approved") {
          console.log(`    ⚠️ 已批准但 PNG 丢失（审批记录兜不住资产）——重出：pf craft --at "${fig.at || "<原文位置>"}" --intent "<重建图意>" --entities "<实体>" --stages "<阶段>" --out <名字>.txt → pf render --at "${fig.at || "<原文位置>"}" --force "资产重建，审批仍在" --model premium --prompt-file <名字>.txt（审批仍在，premium 门禁可直接过）`);
        }
      }
      const changedA = anchors2.filter((a) => a.state && a.state !== "ok" && a.state !== "set");
      if (changedA.length) console.log(`\n  ⚠️ ${changedA.length} 个锚点失效（原文变动/引文对不上）——pf anchor list --changed 查看，对应位置可能要重选`);
      console.log(`\n  进度: ${doneN}/${ordered2.length} 定稿${brokenN ? ` · ${brokenN} 张资产丢失 ⚠️` : ""} —— pf next 自动路由到第一张没完工的图`);
      return;
    }

    case "prompt": {
      // 导出某图最新版的提示词为文件（premium 定稿 render 要用 --prompt-file）
      const docId2 = path.basename(resolveDoc(arg("--doc")));
      const meta2 = readMeta(docId2);
      const f = (meta2.figures || {})[rest[0]];
      if (!f) die(`找不到图 ${rest[0]}（pf render list 查 figureId）`, `pf render list`);
      const last = f.versions[f.versions.length - 1];
      if (!last?.prompt) die(`图 ${rest[0]} 最新版没有存提示词（旧版本）`, `pf refine ${rest[0]}`);
      const out = arg("--out") || `temp-prompt-${rest[0]}.txt`;
      fs.writeFileSync(path.resolve(out), last.prompt + "\n", "utf8");
      // 🔴 2026-09-23 收紧轮：导出必须带出 craft 伴随 JSON——render 有溯源门（无伴随 JSON 拒渲染）。
      // 原版有 sidecar 就复制；旧版本没有就合成最小伴随（entities/ratio 从版本数据回填），
      // 保证 "pf prompt 导出 → premium 定稿 render" 这条正规流程不被溯源门拦死。
      try {
        const { craftSidecarPath } = await import("../src/ratio.mjs");
        const scPath = craftSidecarPath(path.resolve(out));
        let scData = null;
        if (last.sidecar && fs.existsSync(last.sidecar)) {
          scData = JSON.parse(fs.readFileSync(last.sidecar, "utf8"));
        } else {
          scData = {
            exportedFrom: rest[0],
            suggestedRatio: last.ratio || null,
            entities: (last.prompt || "").match(/Named entities \(keep verbatim\): present each of the following as a labelled node\/block — (.+?)\./)?.[1] || "",
          };
        }
        fs.writeFileSync(scPath, JSON.stringify(scData, null, 2), "utf8");
        console.log(`   伴随 JSON 已带出: ${scPath}（render 溯源门可过）`);
      } catch (e) {
        console.error(`⚠️ 伴随 JSON 写出失败（${String(e?.message || e)}）——render 溯源门会拒绝这份提示词`);
      }
      console.log(`✅ 提示词已导出 ${path.resolve(out)}`);
      console.log(`下一步:`);
      console.log(`  pf render --at "${f.at}" --model ${last.model === "premium" ? `premium --force "修正轮"` : "premium"} --prompt-file ${out}`);
      return;
    }

    case "distill": {
      // 🔴 蒸馏素材机（2026-09-21 用户反馈"别人 AI 用着质量不行"）：
      // 弱 AI 跳过读原文直接编实体/阶段 → 图内容无中生有（V4-V8 事故）。
      // distill 把"读原文"变成工具化步骤：素材（原文/候选实体/候选阶段序）全部从真实正文抽取，
      // craft 命令骨架预先填好 --at，弱 AI 只需要"挑选+填空"，没读过原文连命令都拼不出来。
      const at = arg("--at") || die('用法：pf distill --at "§3.2 ¶2" [--span 1] [--figure-type pipeline]', "pf doc outline 先看章节树选位置");
      const docId2 = path.basename(resolveDoc(arg("--doc")));
      const meta2 = readMeta(docId2);
      const blocks = meta2.blocks || [];
      const span = Number(arg("--span")) || 1;
      const target = resolveRef(blocks, at);
      // 🔴 执行留证（2026-09-23）：distill 是最硬的"读过原文"证据，craft 留证门对账用
      logEvidence(docId2, "distill.run", { at, span });
      // 目标段 + 同章节相邻段（--span 控制上下文宽度）
      const siblings = blocks.filter((b) => (b.type === "para" || b.type === "caption") && b.secPath === target.secPath);
      const idx = siblings.findIndex((b) => b.i === target.i);
      const scope = siblings.slice(Math.max(0, idx - span), idx + span + 1);
      const text = scope.map((b) => b.text).join("\n\n");
      console.log(`════ 蒸馏素材 · ${at}（${scope.length} 段，docId ${docId2}）════`);
      console.log(`—— 原文（实体/结构/图种只准从这里来，禁止编造）——`);
      console.log(text.slice(0, 2600) + (text.length > 2600 ? "\n…(截断，pf doc read 看全文)" : ""));

      // ---- 候选实体（2026-09-22 多语言：Unicode script 切 run——汉字/假名/韩文/泰文走
      // n-gram 频次，拉丁/西里尔/希腊/阿拉伯等走大写术语+高频词；中文后缀表只是启发式之一）----
      const { candidateEntities, splitSentences } = await import("../src/extract.mjs");
      const ents = candidateEntities(text, { limit: 12 });
      console.log(`\n—— 候选实体核对清单（统计性抽取 ≠ 结论；逐条选用/剔除是宿主的内容判断，插件只记录你的决定）——`);
      if (!ents.length) {
        console.log("（没抽到——这段可能太短，试 --span 2 扩上下文；抽不出 ≠ 没有：直接从上面原文逐个拆名词模块，实体仍必须是原文里出现的词）");
      } else {
        // 🔴 证据分级（2026-09-22 竞品差距③：ResearchFigureSkill 要求图上信息可溯源）——
        // 每个候选标注全文出现次数 + 首现章节：只在 §x.x 出现一次 = 原文证据弱，人工确认再用
        const paras = blocks.filter((b) => b.type === "para" || b.type === "caption");
        for (const e of ents) {
          const hits = paras.filter((b) => String(b.text || "").includes(e));
          const first = hits[0];
          const cnt = hits.reduce((n, b) => n + String(b.text).split(e).length - 1, 0);
          const weak = cnt <= 1 ? "  ⚠️ 低证据（仅出现 1 次）" : "";
          console.log(`  □ ${e}  ×${cnt} · 首现 §${first ? first.secPath : "?"}${weak}`);
        }
        // 🔴 2026-09-27 流程化（用户定位：不做词汇规则，核对动作交给宿主）：
        // 候选只是统计起点——误抽要剔、漏抽要补，判断权在宿主；插件把"逐条核对+补抽"
        // 变成 craft 前的固定步骤（实测：直接拿候选 craft 会漏掉后面段落才定义的主角模块）。
        console.log(`  ── 逐条核对（必须做，这是你的内容判断）──`);
        console.log(`  · 每个候选回上面原文核对：✓ 选用（记下 §¶ 出处）或 ✗ 剔除（误抽的功能词/LaTeX 残渣）`);
        console.log(`  · 主动补抽：这段要画但候选没有的模块（如在后文段落才定义的主角）——从上面原文补进来，必须是原文出现的词`);
        console.log(`  · 核对完的最终实体清单才配填 --entities；分组结构（多数据集/类别/基线）整组丢失是最常见的漏法`);
        console.log(`  ℹ️ 想用英文标签（standard 档中文会乱码）→ 对照格式挑：--entities "英文标签|上面的中文原词, …"（英文进卡面、原文管溯源对账）`);
      }

      // ---- 候选阶段：句子按原文顺序（分句中英通用；流程图的阶段顺序就该跟正文叙事走）----
      // LaTeX 残渣句（以 \ 开头 / 含 \begin）不是可读素材，滤掉
      const sents = splitSentences(text)
        .filter((s) => s.length > 20 && !/^[\s\\]/.test(s) && !s.includes("\\begin"))
        .slice(0, 8);
      console.log(`\n—— 候选阶段素材（句子按原文顺序；流程/方法图的阶段序=正文叙事序）——`);
      sents.forEach((s, i) => console.log(`  (${i + 1}) ${s.slice(0, 130)}${s.length > 130 ? "…" : ""}`));

      // ---- 候选数据句（2026-09-21 "找不到结果数据"）：定量句直接抽出，画结果图不再猜数字 ----
      const { dataSentences } = await import("../src/docsearch.mjs");
      const dataSents = dataSentences(scope, { limit: 6 });
      if (dataSents.length) {
        console.log(`\n—— 候选数据句（本段定量句；图上数字只准从这里来，禁止编造/约等于）——`);
        dataSents.forEach((d, i) => console.log(`  (${i + 1}) ${d.sentence}`));
      }

      console.log(`\n—— craft 命令骨架（挑选+填空后执行；质量门会挡住空泛输入）——`);
      const ft = arg("--figure-type") || "pipeline";
      console.log(`  pf craft --at "${at}" --figure-type ${ft} --preset double-column \\`);
      console.log(`    --intent "<一句话图意：读者看完必须记住什么>" \\`);
      console.log(`    --entities "<从候选实体挑，逗号分隔>" \\`);
      console.log(`    --stages "<标题 | show 画法（show 开头）|| 标题 | …>" \\`);
      console.log(`    --out temp-distill-${Date.now() % 100000}.txt`);
      console.log(`⏭ 填好后直接执行；craft 有质量分（<60 分会被拒绝），低分命令照着 blocker 提示改`);

      // ---- 用户确认卡（2026-09-22 小白增强）：渲染要花钱，小白用户说不清需求时
      // AI 常闷头编完直接 render —— 出来不是用户想要的，钱白烧。craft 前把方案说成人话给用户确认。
      const { figureTypeBrief } = await import("../src/plan.mjs");
      console.log(`\n—— 用户确认卡（转给用户时用用户的语言；等他确认/修改后再 craft）——`);
      console.log(`  我计划在「${at}」这段后面配一张${figureTypeBrief(ft)}，内容取自这段原文：`);
      console.log(`  · 拟画进图的要素：${ents.slice(0, 6).join("、") || "（待定——需要你告诉我这段里哪些词必须出现在图上）"}（候选仅供参考，我已按上面核对清单逐条筛选/补抽，最终以我填的 --entities 为准）`);
      if (sents.length) console.log(`  · 拟按这个顺序画：${sents.slice(0, 3).map((s) => s.slice(0, 30)).join(" → ")}`);
      console.log(`  · 有要增删的要素、或想换图的位置/类型，直接说；确认没问题回复"可以"我就开始出图`);
      return;
    }

    case "tray": {
      // 托盘常驻壳：一般不用手动跑（pf open 已自动拉起），这里用于手动补启/重启后恢复
      const tr = ensureTray();
      if (tr.state === "running") console.log("✅ 托盘已在运行，无需重复启动");
      else if (tr.state === "started") console.log("✅ 托盘已启动 —— 关闭 GUI 窗口服务不死，托盘菜单可打开工作台/真正退出");
      else if (tr.state === "restarted") console.log("✅ 旧托盘进程被冻结（心跳停更但进程还在）—— 已用新实例顶替，自愈恢复工作");
      else if (tr.state === "pending") console.log("⏳ 托盘已发起启动但暂未确认（python 冷启动较慢）—— 图标几秒后出现；pf doctor 可复查");
      else if (tr.state === "headless") console.log("ℹ️ 无头环境（Codex Cloud/SSH 容器等）：没有托盘可启动，属正常——审批走 pf qa / pf review，预览走 pf doc read");
      else if (tr.state === "unsupported") console.log("ℹ️ 非 Windows 平台无托盘——不影响出图；审批走 pf qa / pf review，GUI 地址可手动浏览器打开");
      else console.log("⚠️ 托盘未能确认启动：需要 python + pystray（pip install pystray pillow）。没有也不影响出图，只是关窗口后没有托盘入口");
      return;
    }

    case "doctor": {
      console.log(`promptFigure 本地插件 v${VERSION} 体检`);
      console.log(`  node:      ${process.version}`);
      const { detectTexEngine } = await import("../src/doc/texbuild.mjs");
      const eng = detectTexEngine();
      console.log(`  TeX 引擎:  ${eng ? `${eng.engine}（${eng.cmd}${eng.origin === "plugin" ? "，插件自带" : ""}）` : "无 —— LaTeX 无法编译预览，跑 pf setup-tex 可自动装"}`);
      const cfg = loadConfig();
      console.log(`  API key:   ${cfg.key ? "已配置（" + maskKey(cfg.key) + "）" : "未配置 —— pf login pf_xxx"}`);
      console.log(`  本地服务:  ${(await daemonAlive()) ? "运行中" : "未运行"}`);
      if (isHeadless()) {
        console.log(`  环境:      无头（PF_HEADLESS 或无 GUI）——托盘/开窗已跳过，属正常；审批走 pf qa / pf review，预览走 pf doc read`);
      } else {
        const frozen = trayFrozen();
        console.log(`  托盘:      ${trayHeartbeat() ? "运行中（关窗口后入口在这里）" : frozen ? "⚠️ 进程在但心跳停更（被挂起/冻结，自愈已停摆）—— pf tray 用新实例顶替" : process.platform === "win32" ? "未运行 —— pf open 会自动拉起；缺 python+pystray 时起不来" : "非 Windows 不可用（GUI 审批用 pf review 命令行）"}`);
      }
      // 当前文档健康 + 目录可写性（2026-09-22 增强）：弱 AI 卡住时常是文档状态/权限问题，体检直接给底数
      try {
        const dIdD = path.basename(resolveDoc(undefined));
        const mD = readMeta(dIdD);
        const figsD = Object.values(mD.figures || {});
        const brokenD = figsD.filter((f) => {
          const v = f.versions?.at(-1);
          return v?.file ? !fs.existsSync(path.join(projectDir(dIdD), v.file)) : false;
        }).length;
        console.log(`  当前文档:  ${mD.fileName || dIdD}（${(mD.blocks || []).length} 块 · ${figsD.length} 张图${brokenD ? ` · ⚠️ ${brokenD} 个 PNG 丢失（pf board 看明细）` : ""}）`);
      } catch {
        console.log(`  当前文档:  未打开 —— pf open <论文文件>`);
      }
      try {
        fs.accessSync(PF_DIR, fs.constants.W_OK);
        console.log(`  目录可写:  ✓`);
      } catch {
        console.log(`  ⚠️ 目录不可写: ${PF_DIR} —— 配置/项目/审计日志都会写失败，检查权限`);
      }
      console.log(`  插件目录:  ${PF_DIR}`);
      return;
    }

    case "export": {
      // 🔴 SVG 矢量导出（2026-09-22 用户拍板：方案用他早期点名的 GitHub 高星项目
      // visioncortex/vtracer，本机 vectorize-probe 已验证甜点管线——见 skill pf-vectorize-eval）。
      // 用法: pf export svg <figureId> [--ver N] [--quality draft|high]
      const sub = rest[0];
      if (sub !== "svg") {
        die("用法: pf export svg <figureId> [--ver N] [--quality draft|high]", "pf render list 查全部 figureId");
      }
      const { pngToSvg, INSTALL_HINT } = await import("../src/vectorize.mjs");
      const docIdE = path.basename(resolveDoc(arg("--doc")));
      const metaE = readMeta(docIdE);
      const figsE = metaE.figures || {};
      const fidE = rest[1] && !rest[1].startsWith("--") ? rest[1] : latestFigure(metaE)?.figureId;
      const figE = fidE ? figsE[fidE] : null;
      if (!figE) die(`找不到图。用法: pf export svg <figureId>`, "pf render list 查全部 figureId");
      // 🔴 渗透实测：--ver 0/负数/非数字此前静默当最新版 —— 现在显式拒绝
      let verE = figE.versions.length;
      if (arg("--ver") !== undefined) {
        const n = Number(arg("--ver"));
        if (!Number.isInteger(n) || n < 1 || n > figE.versions.length) {
          die(`--ver 必须是 1..${figE.versions.length} 的整数（图 ${fidE} 共 ${figE.versions.length} 版）`, `pf export svg ${fidE} --ver 1`);
        }
        verE = n;
      }
      const vE = figE.versions[verE - 1];
      if (!vE) die(`图 ${fidE} 没有 v${verE}（共 ${figE.versions.length} 版）`);
      const pngAbsE = path.join(projectDir(docIdE), vE.file);
      if (!fs.existsSync(pngAbsE)) die(`PNG 不存在: ${pngAbsE}`, "board 体检会标出文件丢失的图——先重出");
      const qualityE = arg("--quality") === "high" ? "high" : "draft";
      const rE = await pngToSvg(fs.readFileSync(pngAbsE), { quality: qualityE });
      if (rE.error === "not-installed") {
        die("缺少矢量化依赖 @visioncortex/vtracer —— 装一次即可（纯 WASM，无原生编译）", INSTALL_HINT);
      }
      if (rE.error === "convert-failed") {
        die(`矢量化失败（图可能退化或损坏）：${rE.detail}`, `换 --quality high 重试一次；仍失败说明源 PNG 有问题，重出图`);
      }
      const svgNameE = vE.file.replace(/\.png$/, ".svg");
      const { saveFigureFile } = await import("../src/store.mjs");
      const relE = saveFigureFile(docIdE, fidE, path.basename(svgNameE), Buffer.from(rE.svg, "utf8"));
      appendEvent(docIdE, "export.svg", { figure: fidE, version: verE, quality: qualityE, bytes: rE.bytes, paths: rE.paths });
      console.log(`✅ SVG 已导出: ${path.join(projectDir(docIdE), relE)}`);
      console.log(`   v${verE} → SVG（${qualityE} 档，${(rE.bytes / 1024).toFixed(1)} KB，${rE.paths} 条路径）`);
      console.log(`   ⚠️ 描摹矢量：图上文字全部变成了路径——**不可编辑、不可搜索**。要改文字/结构，走 refine 重出图，别手改 SVG。`);
      console.log(`⏭ 下一版渲染后重新导出即可（每次 export 都按当时的最新版转换）`);
      return;
    }

    case "audit": {
      // 审计一键可查（2026-09-22 --force 收口配套）：留了痕没人看 = 等于没留。
      // 列出绕门/兜底/排练类事件——宿主 AI 或用户随时能追究"谁绕过门、绕的哪道、理由是什么"。
      const docIdA = path.basename(resolveDoc(arg("--doc")));
      const evs = readEvents(docIdA, 1000);
      const WATCH = ["craft.forced", "craft.selfcheck", "craft.no_read", "figure.gate_bypass", "render.forced", "render.unsourced", "render.no_rehearsal", "review.forced", "force.refused", "qa.no_pack", "billing.fallback", "render.dryrun"];
      const hits = evs.filter((e) => WATCH.includes(e.type));
      if (!hits.length) {
        console.log(`✅ 审计干净：最近 ${evs.length} 条事件里没有绕门/兜底记录（craft.forced / gate_bypass / billing.fallback 均无）`);
        return;
      }
      const counts = {};
      for (const h of hits) counts[h.type] = (counts[h.type] || 0) + 1;
      console.log(`── 审计事件 ${hits.length} 条（共 ${evs.length} 条事件）──`);
      for (const [t, c] of Object.entries(counts)) console.log(`  ${t} × ${c}`);
      console.log("");
      for (const h of hits.slice(-20)) {
        const who = h.reason ? `理由：${h.reason}` : h.note ? `note：${h.note}` : "（无理由——收口前的遗留记录）";
        // 🔴 接手测试（2026-09-22 子智能体 B）：skippedSource 这类黑话要读 events.jsonl 才懂——当场翻译
        const flags = [];
        if (h.skippedSource) flags.push("跳过了实体溯源（实体未对过原文）");
        if (h.hasAt === false) flags.push("无原文锚点");
        if (h.bytesOver) flags.push("字节预算超限");
        console.log(`• ${h.t}  ${h.type}${h.figure ? ` ${h.figure}` : ""}${h.blockers?.length ? ` · blockers ${h.blockers.length}` : ""}${flags.length ? ` · ${flags.join(" · ")}` : ""}`);
        console.log(`    ${who}`);
      }
      if (hits.some((h) => /forced|gate_bypass/.test(h.type) && (!h.reason || h.reason === "(无理由)" || h.reason === "(收口前遗留，无理由)"))) {
        console.log("\n⚠️ 存在无理由的绕门记录（2026-09-22 收口前的遗留）——这些版本的可信度需人工复核");
      }
      console.log(`\n追究出口：pf inspect <figureId> 看图 · pf qa <figureId> 重新核验 · 对可疑版本直接 review resolve --reject 打回`);
      return;
    }

    case "setup-tex": {
      const { setupTex } = await import("../src/doc/texbuild.mjs");
      const r = await setupTex();
      if (!r.ok) die(r.message);
      console.log("现在重新 pf open 论文即可编译预览");
      return;
    }

    case "skill": {
      // 随包发行的两个 skill 一键装进宿主（npm i -g promptfigure 后的落地步骤）
      const PKG_ROOT = path.resolve(__dirname, "..");
      const SKILLS = ["promptfigure-local", "promptfigure-api"];
      const sub = rest[0] || "install";
      if (sub === "path" || sub === "list") {
        for (const s of SKILLS) console.log(path.join(PKG_ROOT, "skill", s));
        return;
      }
      if (sub !== "install") {
        die(`用法：pf skill install [--dir <技能目录>]｜pf skill path 只看路径`, "pf skill install");
      }
      const destRoot = arg("--dir") || path.join(os.homedir(), ".claude", "skills");
      for (const s of SKILLS) {
        if (!fs.existsSync(path.join(PKG_ROOT, "skill", s, "SKILL.md"))) {
          die(`找不到 skill 源：${path.join(PKG_ROOT, "skill", s)} —— 插件包不完整？`, "重装：npm i -g promptfigure");
        }
      }
      fs.mkdirSync(destRoot, { recursive: true });
      for (const s of SKILLS) {
        const dest = path.join(destRoot, s);
        fs.cpSync(path.join(PKG_ROOT, "skill", s), dest, { recursive: true });
        console.log(`✅ ${s} → ${dest}`);
      }
      console.log(`⏭ 其他宿主：Codex 把 ${path.join(PKG_ROOT, "adapters", "codex", "promptfigure")} 拷进 plugins 目录；`);
      console.log(`   无技能目录的宿主（任意 Agent），把某个 skill 的 SKILL.md 内容追加进 AGENTS.md / CLAUDE.md 末尾。`);
      return;
    }

    case "serve": {
      const { startServer } = await import("../src/server.mjs");
      const port = Number(arg("--port")) || loadConfig().port || (await import("../src/config.mjs")).DEFAULT_PORT;
      const { guiToken } = await startServer({ port });
      console.log(`[pf] 服务运行中 127.0.0.1:${port}（Ctrl+C 停止）`);
      console.log(`[pf] GUI: http://127.0.0.1:${port}/?token=${guiToken}`);
      return;
    }

    case "stop": {
      // 先写停止标记再杀进程：托盘自愈线程看到标记就不会 10s 后把服务复活
      fs.rmSync(STOP_FLAG, { force: true });
      fs.writeFileSync(STOP_FLAG, new Date().toISOString());
      const d = readDaemonRecord();
      let killed = false;
      if (d?.pid) {
        try { process.kill(d.pid); killed = true; } catch {} // ESRCH = 进程本来就没活，忽略
        // 🔴 杀完必须验证（2026-09-21 实测）：Windows 上对计划任务拉起的进程 kill 可能
        // EPERM 静默失败——记录删了、进程还活着占着端口，托盘重启还会撞端口
        if (killed) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
          try { process.kill(d.pid, 0); killed = false; } catch { killed = true; } // 还活着 = 没杀掉
        }
      }
      try { if (killed || !d?.pid) fs.unlinkSync(DAEMON_PATH); } catch {}
      // 🔴 杀不掉时保留 daemon.json：记录还在，CLI 至少能报对端口/进程；
      // 删了记录 = 活着的服务变成"孤儿"，CLI 和托盘都找不到它
      if (killed) {
        console.log("✅ 本地服务已停止（托盘不会再自动拉起；下次 pf open 自动恢复服务+托盘）");
      } else if (d?.pid) {
        console.log(`⚠️ 停止标记已写入，但进程 ${d.pid} 杀不掉（权限不足）——请手动结束该进程，`);
        console.log("   否则它一直占着端口（Windows: Stop-Process -Id " + d.pid + " -Force；macOS/Linux: kill " + d.pid + "）");
      } else {
        console.log("✅ 停止标记已写入、残留记录已清理（服务本就不在运行；下次 pf open 自动拉起）");
      }
      return;
    }

    case "upgrade": {
      // 🔴 环境自适应：之前写死 `cmd /c npm update -g`，非 Windows 直接 ENOENT
      const { execFileSync } = await import("node:child_process");
      const npm = process.platform === "win32" ? "npm.cmd" : "npm";
      execFileSync(npm, ["update", "-g", "promptfigure"], { stdio: "inherit", shell: process.platform === "win32" });
      return;
    }

    default:
      die(`未知命令 "${cmd}"，pf --help 查看全部`);
  }
}

main().catch((e) => {
  // 🔴 红队实测（2026-09-23 fuzz）：畸形 meta.json 会炸出裸 TypeError（Cannot read properties of
  // null），违反"报错不许是死路"。识别常见坏档形态，翻译成带下一步的报错。
  const msg = String(e?.message || e);
  if (/Cannot read propert/.test(msg)) {
    die(`项目元数据损坏或文件缺失（${msg}）——多半是手工改过 projects/ 下的 meta.json/review.json。恢复办法：删除损坏的项目目录后 pf open 重新灌文；不要手工编辑项目内部文件`,
      "pf status 看项目列表 → 定位损坏项目 → 删目录 → pf open <原文> 重来");
  }
  die(msg);
});
