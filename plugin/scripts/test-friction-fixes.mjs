// test-friction-fixes.mjs — 2026-09-27 CLI 摩擦修复回归（主力通道）
// A. Fix 3  parseRef 分隔符容错（¶/P/p/-/空白）——纯函数直测
// B. Fix 1  refine/qa --fail 重拼命令不再带 --fixes + 打印沉淀指引 —— CLI 端到端（零成本）
// C. Fix 5  qa-list / qa 任务包按「结构/风格/保真」三镜头分组 —— CLI 端到端
// D. Fix 4  premium 门禁拒绝给可复制的完整命令 —— CLI 端到端（门禁在调用渲染 API 前抛，零花费）
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (p) => import(new URL(`file://${p.replace(/\\/g, "/")}`).href);

let pass = 0, fail = 0;
const assert = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? " —— " + detail : ""}`); }
};
function pf(args, opts = {}) {
  // 🔴 本机 spawnSync 管道 stdio EBUSY（2026-10-15：node→node 间歇→持续实锤）——
  // 文件描述符正常 → 输出落临时文件再读，保持同步语义不动调用点
  for (let attempt = 0; ; attempt++) {
    const tmpOut = path.join(os.tmpdir(), `pf-ffb-out-${process.pid}-${attempt}.txt`);
    const fd = fs.openSync(tmpOut, "w");
    const r = spawnSync(process.execPath, [path.join(ROOT, "bin", "pf.mjs"), ...args], {
      cwd: opts.cwd || ROOT, timeout: 90000, stdio: ["ignore", fd, fd], env: { ...process.env, FORCE_COLOR: "0", PF_HEADLESS: "1" },
    });
    fs.closeSync(fd);
    const out = fs.existsSync(tmpOut) ? fs.readFileSync(tmpOut, "utf8") : "";
    fs.rmSync(tmpOut, { force: true });
    if (!(r.error?.code === "EBUSY" && attempt < 4)) {
      return { code: r.status ?? 1, out: out.trim() };
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
}

console.log("\n[A] Fix 3：锚点分隔符容错");
{
  const { parseRef } = await imp(path.join(ROOT, "src", "doc", "para.mjs"));
  const cases = [
    ["§3.2 ¶4", "3.2", 4],
    ["§3.2 P4", "3.2", 4],
    ["3.2 ¶4", "3.2", 4],
    ["§3.2-4", "3.2", 4],
    ["§3.2 4", "3.2", 4],
    ["S3.2 P4", "3.2", 4],
    ["§3.2", "3.2", 0],
    ["§3.2.1 ¶2", "3.2.1", 2],
  ];
  for (const [inp, sec, para] of cases) {
    try {
      const r = parseRef(inp);
      assert(`parseRef("${inp}") → §${sec} ¶${para}`, r.secPath === sec && r.para === para, JSON.stringify(r));
    } catch (e) {
      assert(`parseRef("${inp}") → §${sec} ¶${para}`, false, String(e.message).slice(0, 80));
    }
  }
  let threw = false;
  try { parseRef("garbage"); } catch { threw = true; }
  assert("垃圾引用仍然报错（容错不放纵）", threw);
}

console.log("\n[B-D] Fix 1/4/5：CLI 端到端（沙盒项目，零渲染花费）");
{
  const abs = path.resolve(ROOT, "scripts", "fixtures", "test-paper.docx");
  const docId = `sandbox_fix_${Date.now() % 100000}`;
  const store = await imp(path.join(ROOT, "src", "store.mjs"));
  // 夹具必须带 §1 的 heading + ¶1 段落块——render 的 --at 校验和彩排门都靠它
  //（空 blocks 会让 dry-run 死在 --at 校验，根本走不到被验的门禁）。
  const BLOCKS = [
    { type: "heading", secPath: "1", para: 0, i: 0, text: "1 Introduction" },
    { type: "para", secPath: "1", para: 1, i: 1, text: "First paragraph of the test section with enough words to be a paragraph." },
    { type: "para", secPath: "1", para: 2, i: 2, text: "Second paragraph of the test section with enough words to be a paragraph." },
  ];
  store.writeMeta(docId, {
    docId, source: abs, fileName: path.basename(abs), kind: "docx",
    parsedAt: new Date().toISOString(), blocks: BLOCKS, outline: [], figures: {},
  });
  const FIG = "fig_fix_test";
  const { encodePng } = await imp(path.join(ROOT, "src", "png-trim.mjs"));
  const pngDir = path.join(store.projectDir(docId), "figures", FIG);
  fs.mkdirSync(pngDir, { recursive: true });
  const W = 200, H = 120;
  const px = Buffer.alloc(W * H * 3, 0xff);
  for (let y = 40; y < 80; y++) for (let x = 60; x < 140; x++) {
    const o = (y * W + x) * 3; px[o] = 0x33; px[o + 1] = 0x66; px[o + 2] = 0xcc;
  }
  fs.writeFileSync(path.join(pngDir, "v1.png"), encodePng({ width: W, height: H, ch: 3, pixels: px }));
  const promptFile = path.join(pngDir, "prompt.txt");
  fs.writeFileSync(promptFile, "QA fixture prompt", "utf8");
  const sidecar = path.join(pngDir, "prompt.craft.json");
  fs.writeFileSync(sidecar, JSON.stringify({
    intent: "test intent", entities: "A,B", figureType: "comparison", at: "§1 ¶1",
    suggestedRatio: "1:1", geometry: "axis labels 1-8 no duplicates",
  }), "utf8");
  const setFig = ({ fixes = [] } = {}) => {
    const meta = store.readMeta(docId);
    meta.figures[FIG] = {
      figureId: FIG, at: "§1 ¶1",
      versions: [{ file: `figures/${FIG}/v1.png`, model: "standard", prompt: "Named entities (keep verbatim): present each of the following as a labelled node/block — A, B.", at: new Date().toISOString(), sidecar, ratio: "1:1" }],
      activeFixes: fixes,
    };
    store.writeMeta(docId, meta);
    // 锚点链接：render 靠 anchors.find(at+side).figure 找 prevFig，只写 meta.figures 找不到
    store.writeAnchors(docId, [{ id: `anc_${FIG}`, placement: { at: "§1 ¶1", side: "after" }, figure: FIG }]);
  };

  try {
    // ---- B：Fix 1 重拼命令无 --fixes + 沉淀指引 ----
    setFig({ fixes: ["Q2 轴标签重复出现两个 3", "Q9 阶段2虚线没画"] });
    const rf = pf(["refine", FIG, "--doc", docId]);
    const cmdLine = (rf.out.split("\n").find((l) => l.trim().startsWith("pf craft")) || "");
    assert("B1 重拼命令存在", cmdLine.includes("pf craft"), rf.out.slice(0, 200));
    assert("B2 重拼命令不含 --fixes", !cmdLine.includes("--fixes"), cmdLine.slice(0, 160));
    assert("B3 打印沉淀指引（修正→写进 stages）", /把每条修正改写进.*--stages/.test(rf.out), rf.out.slice(0, 300));
    assert("B4 指引含两条活跃修正内容", /轴标签重复/.test(rf.out) && /虚线没画/.test(rf.out));
    assert("B5 重拼命令保留 --geometry（sidecar 有几何契约）", cmdLine.includes("--geometry"), cmdLine.slice(0, 160));
    const qaf = pf(["qa", FIG, "--doc", docId, "--fail", "--note", "Q3 分界线落错行; Q9 缺跨窗弧线"]);
    const cmdLine2 = (qaf.out.split("\n").find((l) => l.trim().startsWith("pf craft")) || "");
    assert("B6 qa --fail 重拼命令也不含 --fixes", !cmdLine2.includes("--fixes"), cmdLine2.slice(0, 160));

    // ---- C：Fix 5 三镜头分组 ----
    const ql = pf(["qa-list", FIG, "--doc", docId]);
    assert("C1 含「结构」镜头头", /── 镜头「结构（大形）」/.test(ql.out), ql.out.slice(0, 200));
    assert("C2 含「风格」镜头头", /── 镜头「风格（大感觉）」/.test(ql.out));
    assert("C3 含「保真」镜头头", /── 镜头「保真/.test(ql.out));
    for (const q of ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9"]) {
      assert(`C4 ${q} 仍在清单里（编号不丢）`, ql.out.includes(`${q} `));
    }
    const qaPkg = pf(["qa", FIG, "--doc", docId]);
    assert("C5 qa 任务包也有三镜头", /── 镜头「结构（大形）」/.test(qaPkg.out), qaPkg.slice ? "" : "");

    // ---- D：Fix 4 门禁拒绝给可复制命令 ----
    // 直调 renderFigure 模块（绕开运行中的 daemon——daemon 是旧代码进程，驗新代码必须新进程）
    setFig({});
    store.writeReview(docId, { [FIG]: { status: "pending", note: "", by: "sim", at: new Date().toISOString() } });
    const { renderFigure } = await imp(path.join(ROOT, "src", "render.mjs"));
    let gateErr = null;
    try {
      await renderFigure({
        docId, prompt: "Named entities (keep verbatim): present each of the following as a labelled node/block — A, B.",
        model: "premium", at: "§1 ¶1", side: "after", promptFile, sidecar,
      });
    } catch (e) { gateErr = e; }
    const msg = String(gateErr?.message || "");
    assert("D1 premium 门禁仍然拒绝（未审批）", Boolean(gateErr) && /premium 门禁拒绝/.test(msg), msg.slice(0, 120));
    assert("D2 拒绝信息含可复制的 --force 命令", /pf render --at "§1 ¶1" --model premium .*--force/.test(msg), msg.slice(0, 200));
    assert("D3 命令里带真实提示词文件名（含扩展名）", msg.includes(path.basename(promptFile)), msg.slice(0, 200));
    assert("D4 也给了正规审批路径", /pf review ai/.test(msg) && /pf qa .*--pass/.test(msg));
  } finally {
    try { fs.rmSync(store.projectDir(docId), { recursive: true, force: true }); } catch {}
    console.log("  （沙盒项目已删除）");
  }
}

console.log(`\n===== CLI 摩擦修复回归：${pass} 过 / ${fail} 挂 =====`);
if (fail) process.exit(1);
