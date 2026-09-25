// cold-start-sim.mjs — 冷启动 AI 可用性回归（2026-09-21 用户反馈"别人的 AI 根本不会用"）
//
// 验证目标：一个**没读过任何文档**的 AI，只靠插件自己的输出就能走通全流程：
//   1. 裸 `pf` 帮助第一屏就有 pf next 快速通道
//   2. 沙盒项目推到各状态，`pf next` 每次给出唯一、合法、可执行的下一步
//      （无图→context / 有锚→craft / 驳回+修正→refine / 待审→review ai /
//        通过+草稿→prompt / 通过+定稿→done）
//   3. status 结尾必带"下一步"（任何输出不许是死路）
// 零成本：不调 LLM、不出图、不碰真实项目（沙盒项目测完即删）。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(ROOT, "scripts", "fixtures", "test-paper.docx");
const imp = (p) => import(pathToFileURL(p).href);

let pass = 0, fail = 0, exitCode = 0;
function assert(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? " —— " + detail : ""}`); }
}

function pf(args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "bin", "pf.mjs"), ...args], {
    cwd: ROOT, encoding: "utf8", timeout: 60000, env: { ...process.env, FORCE_COLOR: "0", ...extraEnv },
  });
  return { code: r.status ?? 1, out: ((r.stdout || "") + (r.stderr ? "\n" + r.stderr : "")).trim() };
}

// ---------- 沙盒项目（不走 pf open，避免拉起 GUI/TeX） ----------
const { parseDocument } = await imp(path.join(ROOT, "src", "doc", "index.mjs"));
const { docIdOf } = await imp(path.join(ROOT, "src", "config.mjs"));
const store = await imp(path.join(ROOT, "src", "store.mjs"));

const abs = path.resolve(FIXTURE);
const docId = docIdOf(abs);
// 🔴 先强杀旧沙盒再重建（2026-09-21 实测：上一次运行若崩在 finally 之前，残留锚点
// 会让本轮 "无锚点 → context" 断言误挂——测试不许依赖"上次跑干净了"这种运气）
fs.rmSync(store.projectDir(docId), { recursive: true, force: true });
const parsed = await parseDocument(abs);
store.writeMeta(docId, {
  docId, source: abs, fileName: path.basename(abs), kind: "docx",
  parsedAt: new Date().toISOString(),
  blocks: parsed.blocks, outline: parsed.outline,
  figures: {}, styleCard: undefined,
});
console.log(`沙盒项目: ${docId}`);
// 🔴 执行留证门①（2026-09-23）：craft 要求 24h 内有读文档事件——沙盒绕过了 pf open，
// 这里补一条 pf doc outline 等价于真实用户的"打开后先看章节树"
{
  const o = pf(["doc", "outline", "--doc", docId]);
  if (o.code !== 0) { console.error(`outline 预备失败: ${o.out.slice(0, 200)}`); process.exit(1); }
}

const FIG = "fig_coldstart_test";
function setFigure({ model = "standard", status = "pending", fixes = [] } = {}) {
  const meta = store.readMeta(docId);
  meta.figures[FIG] = {
    figureId: FIG, at: "§1 ¶1",
    versions: [{ file: `figures/${FIG}/v1.png`, model, prompt: "cold-start test prompt", at: new Date().toISOString() }],
    activeFixes: fixes,
  };
  store.writeMeta(docId, meta);
  store.writeReview(docId, { [FIG]: { status, note: "", by: "sim", at: new Date().toISOString() } });
}

function nextStage() {
  const r = pf(["next", "--doc", docId]);
  const m = r.out.match(/── 当前阶段: (\S+) ──/);
  return { stage: m?.[1] || null, out: r.out, code: r.code };
}

try {
  // ---- 1) 帮助第一屏 ----
  console.log("\n[1] 裸帮助快速通道");
  const help = pf([]);
  assert("帮助可运行", help.code === 0);
  assert("第一屏有 pf next 快速通道", /pf next/.test(help.out) && /第一次用/.test(help.out));

  // ---- 2) 状态路由 ----
  console.log("\n[2] 状态路由（沙盒项目零图起步）");
  let s = nextStage();
  assert("无锚点 → context（读文选位）", s.stage === "context", s.out.slice(0, 200));

  store.writeAnchors(docId, [{ id: "anc_1", placement: { at: "§1 ¶1", side: "after" }, state: "set" }]);
  s = nextStage();
  assert("有锚点无图 → craft", s.stage === "craft", s.out.slice(0, 200));
  assert("craft 建议带 --out（伴随 JSON 接力）", /--out/.test(s.out));
  assert("craft 建议带 --at（溯源门 2026-09-21）", /--at/.test(s.out), s.out.slice(0, 200));

  console.log("\n[3] 图状态路由");
  setFigure({ status: "rejected", fixes: ["图例用了红色"] });
  s = nextStage();
  assert("驳回+活跃修正 → refine", s.stage === "refine", s.out.slice(0, 200));
  assert("refine 建议带 figureId", s.out.includes(FIG));

  // 2a-对账出口：活跃修正已全部写进最新 sidecar 的 --fixes（AI 已重拼好提示词，可能在等授权）
  {
    const meta = store.readMeta(docId);
    const fig = meta.figures[FIG];
    const scPath = path.join(store.projectDir(docId), "figures", FIG, "v1.craft.json");
    fs.mkdirSync(path.dirname(scPath), { recursive: true });
    fs.writeFileSync(scPath, JSON.stringify({ fixes: "图例用了红色; 模块名拼错" }), "utf8");
    fig.versions[0].sidecar = scPath;
    store.writeMeta(docId, meta);
    s = nextStage();
    assert("修正已进 sidecar → ready（不再死锁 refine）", s.stage === "ready" && /render/.test(s.out), s.out.slice(0, 200));
    fig.versions[0].sidecar = null;
    fs.rmSync(scPath, { force: true });
    store.writeMeta(docId, meta);
  }

  setFigure({ status: "rejected", fixes: [] });
  s = nextStage();
  assert("驳回无修正 → inspect+qa-list", s.stage === "fix" && s.out.includes("pf inspect"), s.out.slice(0, 200));

  setFigure({ status: "pending" });
  s = nextStage();
  assert("待审 → pf qa 核验闭环", s.stage === "review" && s.out.includes(`pf qa ${FIG}`), s.out.slice(0, 200));
  assert("待审建议带写回说明", /--pass/.test(s.out) && /--fail/.test(s.out), s.out.slice(0, 300));

  setFigure({ status: "approved", model: "standard" });
  s = nextStage();
  assert("通过+草稿 → prompt 导出", s.stage === "finalize" && s.out.includes("pf prompt"), s.out.slice(0, 200));

  setFigure({ status: "approved", model: "premium" });
  s = nextStage();
  assert("通过+定稿 → done", s.stage === "done", s.out.slice(0, 200));

  // ---- 3b) 多图路由 + board（2026-09-21 子智能体 E/F 实测升级）----
  console.log("\n[3b] 多图路由与资产总览");
  {
    const meta = store.readMeta(docId);
    const FIG2 = "fig_coldstart_second";
    meta.figures[FIG2] = {
      figureId: FIG2, at: "§1.2 ¶1",
      versions: [{ file: `figures/${FIG2}/v1.png`, model: "standard", prompt: "p2", at: new Date().toISOString() }],
      activeFixes: [],
    };
    store.writeMeta(docId, meta);
    store.writeReview(docId, { [FIG]: { status: "approved", note: "", by: "sim", at: new Date().toISOString() }, [FIG2]: { status: "pending", note: "", by: "sim", at: new Date().toISOString() } });
    s = nextStage();
    assert("多图：第一张定稿 → 路由到第二张（不再只盯最新）", s.stage === "review" && s.out.includes(FIG2), s.out.slice(0, 200));
    const bd = pf(["board", "--doc", docId]);
    assert("board 列出两张图与阶段", bd.code === 0 && bd.out.includes("资产总览") && bd.out.includes(FIG2) && bd.out.includes(FIG), bd.out.slice(0, 300));
    delete meta.figures[FIG2];
    store.writeMeta(docId, meta);
    store.writeReview(docId, { [FIG]: { status: "approved", note: "", by: "sim", at: new Date().toISOString() } });
  }

  // ---- 4) status 尾巴与命令合法性 ----
  console.log("\n[4] 输出不许是死路");
  setFigure({ status: "pending" });
  const st = pf(["status", "--doc", docId]);
  assert("status 结尾带下一步", st.code === 0 && /⏭ 下一步:/.test(st.out), st.out.slice(-200));

  const KNOWN = new Set(["login", "open", "status", "doc", "anchor", "render", "review", "style",
    "types", "examples", "craft", "qa-list", "qa", "inspect", "refine", "next", "board", "prompt", "serve", "tray", "audit",
    "stop", "doctor", "setup-tex", "help"]);
  const cmdLine = (s.out.match(/⏭ 下一步: (.+)/) || s.out.match(/  (pf .+)/) || [])[1] || "";
  const sub = cmdLine.replace(/^pf /, "").split(/\s+/)[0];
  assert(`建议命令子命令合法（${sub || "空"}）`, KNOWN.has(sub), cmdLine);

  // ---- 4b) 路径归一化 + 缺图死路 ----
  console.log("\n[4b] 子智能体实测坑回归");
  const gitPath = pf(["craft", "--at", "§9.9", "--figure-type", "pipeline",
    "--intent", "Git bash path normalization regression test with enough words to be meaningful",
    "--entities", "Alpha Mod,Beta Mod,Gamma Mod",
    "--stages", "Alpha Mod | show one box || Beta Mod | show two boxes || Gamma Mod | show three boxes",
    "--out", "/z/pf-nonexistent/x.txt", "--force", "sim: 路径归一化回归"]);
  assert("Git Bash 风格路径被归一化（/z/ → Z:\\）", gitPath.out.includes("Z:"), gitPath.out.slice(0, 200));
  assert("写盘失败带相对路径指路", /相对路径/.test(gitPath.out), gitPath.out.slice(0, 300));

  // ---- 4b-2) --force 收口（2026-09-22）：裸 force 拒绝 + 带理由放行 ----
  const bareForce = pf(["craft", "--at", "§1.2 ¶1", "--figure-type", "pipeline",
    "--intent", "Bare force bypass attempt with enough words to pass quality gate",
    "--entities", "Alpha Mod,Beta Mod,Gamma Mod",
    "--stages", "Alpha Mod | show one box || Beta Mod | show two boxes || Gamma Mod | show three boxes",
    "--out", "temp-sim-bare.txt", "--force"]);
  // 松绑轮：裸 --force 不再二次拒绝（双重墙实测劝退新手 AI），放行 + 审计记"(未给理由)"
  assert("裸 --force 放行且产出提示词（不再双重墙）", bareForce.code === 0 && /未给理由/.test(bareForce.out), bareForce.out.slice(0, 250));

  setFigure({ status: "pending" });
  const insp = pf(["inspect", FIG, "--doc", docId]);
  assert("缺图 inspect 是有出路的报错（非裸 ENOENT）", insp.code !== 0 && /--dry-run|真实渲染/.test(insp.out), insp.out.slice(0, 200));

  // ---- 4c) 环境自适应（2026-09-21 用户定规：不许写死插件作者的环境）----
  console.log("\n[4c] 无头环境自适应");
  const hTray = pf(["tray"], { PF_HEADLESS: "1" });
  assert("PF_HEADLESS=1 → pf tray 明说无头跳过（不干等 pythonw）", /无头环境/.test(hTray.out) && hTray.code === 0, hTray.out.slice(0, 150));
  const hDoctor = pf(["doctor"], { PF_HEADLESS: "1" });
  assert("无头 doctor 明示环境判定", /无头/.test(hDoctor.out), hDoctor.out.slice(0, 200));
  const hHelp = pf(["--help"]);
  assert("PF_HEADLESS 不影响纯文本命令", hHelp.code === 0, hHelp.out.slice(0, 100));

  console.log(`\n===== 冷启动模拟结束：${pass} 过 / ${fail} 挂 =====`);
  exitCode = fail ? 1 : 0;
} finally {
  // ---- 清理沙盒（🔴 process.exit 会跳过 finally，所以先清理后退出） ----
  fs.rmSync(store.projectDir(docId), { recursive: true, force: true });
  console.log("（沙盒项目已删除）");
  process.exit(exitCode || 0);
}
