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
import { computeNext } from "../src/next.mjs";
import { buildPlan } from "../src/plan.mjs";
import { setStatus } from "../src/review.mjs";
import { hasEvidence, lastEvidence, logEvidence, shaOf, EVIDENCE_WINDOW_MS } from "../src/ledger.mjs";

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

// 从图元数据重拼下一轮 craft 命令（refine 与 qa --fail 共用；sidecar 全量输入 + 活跃修正全集）
function refineCommand(fig) {
  const last = fig.versions[fig.versions.length - 1];
  const sidecarPath = last?.sidecar;
  if (!sidecarPath || !fs.existsSync(sidecarPath)) return null;
  const sc = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
  const q = (s) => `'${String(s || "").replace(/'/g, "'\\''")}'`;
  const fixesAll = (fig.activeFixes || []).join("; ");
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
    fixesAll ? `--fixes ${q(fixesAll)}` : "",
    `--out temp-refine-${Date.now() % 100000}.txt`,
  ].filter(Boolean).join(" ");
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
      if (cache.latest && cache.latest !== VERSION) printUpdateHint(String(cache.latest), Array.isArray(cache.notes) ? cache.notes : []);
      return;
    }
    const latest = await fetchLatestVersion();
    const notes = latest && latest !== VERSION ? await fetchReleaseNotes(latest) : [];
    try { fs.writeFileSync(UPDATE_CACHE, JSON.stringify({ checked_at: now, latest, notes })); } catch { /* 缓存写不进就每次现查，功能不依赖它 */ }
    if (latest && latest !== VERSION) printUpdateHint(latest, notes);
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
        out.paragraphs.forEach((t, i) => console.log(`¶${i + 1} ${t}\n`));
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
      const rr = ratio && parseRatio(ratio);
      if (model === "standard" && rr && Math.abs(rr.w / rr.h - 1) > 0.15) {
        console.error(`⚠️ standard 渲染端只出方图（1024x1024），给不了 ${ratio} —— 实测必报画布比不符（V13 白烧一次额度）。出路：① 改 --ratio 1:1 走 standard；② 宽幅/竖版必须走 premium，完整链路 = standard 方图草稿 → pf qa 核验 --pass → pf review resolve --approve（或 GUI 点通过）→ render --model premium（premium 门禁会查审批，修正迭代轮才可用 --force "理由" 豁免）。`);
      }
      // 🔴 渲染端字节预算（v18 事故实测：8205 字节被 prompt_too_long 拒绝）——花钱之前先拦
      const promptBytes = Buffer.byteLength(String(prompt).trim(), "utf8");
      if (has("--force")) requireForceReason("render 门禁豁免"); // premium 门禁/字节预算的豁免都要留理由
      if (promptBytes > 8000 && !has("--force")) {
        die(`提示词 ${promptBytes} 字节超渲染端预算（≈8000）——直接渲染会被 prompt_too_long 拒绝白烧额度。回 craft 精简：已验证遵守的 fix 沉淀进 --stages 并从 --fixes 删除，或砍次要要点`,
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
        at: arg("--at") || die('--at 必填，如 "§3.2 ¶2" —— 插件不猜位置'),
        side: arg("--side") || "after",
        ratio,
        // 🔴 premium 门禁豁免（多轮精修修正轮专用）：显式声明这轮是已授权的修正迭代，事件留痕可审计
        force: has("--force"),
        forceReason: forceReason(),
        // sidecar 路径落盘进版本（pf refine 重拼下一轮命令的依据）
        sidecar: promptFile ? path.resolve(craftSidecarPath(promptFile)) : null,
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
          console.log(`—— 第 3 步：逐条核验（每条给 PASS/FAIL + 你在图里看到的证据）——`);
          QA_CHECKLIST.forEach((c) => console.log("  " + c));
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
        // 🔴 多轮精修（2026-09-21）：上一版视觉核验的缺陷逐条拼接，"缺陷1; 缺陷2"
        fixes: arg("--fixes") || "",
      });
      // 提示词走 stdout（--out 或重定向都行）；诊断走 stderr 不污染
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
      const bytesOverCraft = Buffer.byteLength(r.prompt, "utf8") > 8000;
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

      // ---- 🔴 提示词字节预算（v18 事故：8205 字节被渲染端 prompt_too_long 拒绝，白烧一轮）----
      // craft 是唯一能提前看到全量的地方——超预算在这里拦，别等 render 花钱才知道。
      const promptBytes = Buffer.byteLength(r.prompt, "utf8");
      console.error(`── 提示词 ${promptBytes} 字节（渲染端上限 ≈8000）──`);
      if (promptBytes > 8000 && !has("--force")) {
        die(`提示词 ${promptBytes} 字节，超渲染端预算（≈8000，实测 8205 会被 prompt_too_long 拒绝）——先精简再出：把已验证遵守的 fix 沉淀进 --stages 措辞并从 --fixes 删除（pf refine 看活跃修正），或砍掉次要阶段要点`,
          `pf refine <figureId> 看活跃修正清单（--settle 沉淀已遵守项）`);
      } else if (promptBytes > 7600) {
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
          at: atArg || "",
          suggestedRatio: r.suggestedRatio,
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
      if (r.warnings?.length) r.warnings.forEach((w) => console.error("⚠️ " + w));
      if (r.typeMeta) {
        console.error(`── 图型「${r.typeMeta.name}」──`);
        console.error(`   什么时候用: ${r.typeMeta.when}`);
        console.error(`   构图思考:   ${r.typeMeta.think || "（见 pf types show " + r.typeMeta.id + " 的示例）"}`);
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
        console.log("渲染后视觉核验（每张图必过；任何一条不过 = standard 重出，别把问题图推给用户审批）：");
        console.log("（提示：pf qa <figureId> 是核验闭环命令——任务包+--pass/--fail 写回；approve 只认最新版 QA 记录）");
      }
      QA_CHECKLIST.forEach((c) => console.log(c));
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
            console.log(`—— 下一轮 craft 命令（直接复制执行）——`);
            console.log(`  ${cmd}`);
            console.log(`  流程：craft → pf render --force "修正轮"（premium 修正轮）→ pf inspect + 亲眼核验 → pf qa ${fid} --pass`);
          } else {
            console.log(`⏭ 下一步: pf refine ${fid} —— 最新版无 craft 伴随 JSON，手动重拼命令并把上面修正全量传 --fixes`);
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
      console.log(`—— 第 4 步：逐条核验（每条 PASS/FAIL + 图里的证据；先列出图上全部可见文字再逐条对照）——`);
      QC.forEach((c) => console.log("  " + c));
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
        console.log(`—— 下一轮 craft 命令（直接复制执行；已遵守的修正先 --settle 移除再跑，防超 8000 字节）——`);
        console.log(`  ${cmd}`);
      } else {
        console.log(`  ⚠️ 最新版无 craft 伴随 JSON（旧版本）——回 craft 手动重拼，把上面活跃修正全量传 --fixes`);
      }
      console.log(`  流程：render --force "修正轮"（premium 修正轮）→ pf inspect + 亲眼核验 → 零存疑才 review resolve --approve`);
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
      console.log(`\n—— 候选实体（统计性抽取，任何语言都可能误抽——每个都要回上面原文核对出处再用；漏了分组结构=图不完整）——`);
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
          const weak = cnt <= 1 ? "  ⚠️ 低证据（仅出现 1 次，人工确认再用）" : "";
          console.log(`  ${e}  ×${cnt} · 首现 §${first ? first.secPath : "?"}${weak}`);
        }
        // 🔴 双语对照格式提示（2026-09-22 用户拍板）：要英文卡面就带原文对照，溯源不断链
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
      console.log(`  · 拟画进图的要素：${ents.slice(0, 6).join("、") || "（待定——需要你告诉我这段里哪些词必须出现在图上）"}`);
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
