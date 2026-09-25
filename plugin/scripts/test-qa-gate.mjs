// test-qa-gate.mjs — QA 核验闭环回归（2026-09-21 "别放水"定规）
// 断言：pf qa 任务包 / --pass 自动 approve / --fail 自动 reject+缺陷进精修状态机 /
//       approve 门禁（无 QA 记录拒、FAIL 记录拒、PASS 放行）
// 零成本：沙盒项目直写 store，不出图、不碰真实项目（测完即删）。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (p) => import(new URL(`file://${p.replace(/\\/g, "/")}`).href);

let pass = 0, fail = 0;
const assert = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? " —— " + detail : ""}`); }
};

function pf(args) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "bin", "pf.mjs"), ...args], {
    cwd: ROOT, encoding: "utf8", timeout: 60000, env: { ...process.env, FORCE_COLOR: "0" },
  });
  return { code: r.status ?? 1, out: ((r.stdout || "") + (r.stderr ? "\n" + r.stderr : "")).trim() };
}

const store = await imp(path.join(ROOT, "src", "store.mjs"));


// ---- 沙盒项目（绕开 pf open，避免拉 GUI）----
const abs = path.resolve(ROOT, "scripts", "fixtures", "test-paper.docx");
const docId = `sandbox_qa_${Date.now() % 1000000}`;
store.writeMeta(docId, {
  docId, source: abs, fileName: path.basename(abs), kind: "docx",
  parsedAt: new Date().toISOString(), blocks: [], outline: [], figures: {},
});
const FIG = "fig_qa_gate_test";
const { encodePng } = await imp(path.join(ROOT, "src", "png-trim.mjs"));

function setFigure({ versions = 1, qa = null, fixes = [], reviewStatus = "pending", withPng = true } = {}) {
  const meta = store.readMeta(docId);
  meta.figures[FIG] = {
    figureId: FIG, at: "§1 ¶1",
    versions: Array.from({ length: versions }, (_, i) => ({
      file: `figures/${FIG}/v${i + 1}.png`, model: "standard", prompt: "qa gate test prompt",
      at: new Date().toISOString(),
    })),
    activeFixes: fixes, ...(qa ? { qa } : {}),
  };
  store.writeMeta(docId, meta);
  // 🔴 2026-09-23 硬门（图不存在 = 无核验对象）后，PASS 路径的 fixture 必须有真图
  if (withPng) for (let i = 1; i <= versions; i++) writePng(i);
  store.writeReview(docId, { [FIG]: { status: reviewStatus, note: "", by: "sim", at: new Date().toISOString() } });
}

function writePng(v) {
  const W = 200, H = 120;
  const px = Buffer.alloc(W * H * 3, 0xff);
  for (let y = 40; y < 80; y++) for (let x = 60; x < 140; x++) {
    const o = (y * W + x) * 3; px[o] = 0x33; px[o + 1] = 0x66; px[o + 2] = 0xcc;
  }
  const pngPath = path.join(store.projectDir(docId), "figures", FIG, `v${v}.png`);
  fs.mkdirSync(path.dirname(pngPath), { recursive: true });
  fs.writeFileSync(pngPath, encodePng({ width: W, height: H, ch: 3, pixels: px }));
  return pngPath;
}

try {
  console.log("\n[1] 任务包模式（只读）");
  setFigure({});
  const pkg = pf(["qa", FIG, "--doc", docId]);
  assert("任务包可运行", pkg.code === 0, pkg.out.slice(0, 150));
  assert("任务包含体检/实体/写回三要素", /QA 记录/.test(pkg.out) && /实体清单/.test(pkg.out) && /--pass/.test(pkg.out) && /--fail/.test(pkg.out));
  assert("缺省 figureId 落最新图", pf(["qa", "--doc", docId]).out.includes(FIG));

  console.log("\n[1b] 任务包：阶段画法核验（第 3c 步 + Q9，2026-09-23 收紧轮④）");
  {
    const meta = store.readMeta(docId);
    const scPath = path.join(store.projectDir(docId), "figures", FIG, "v1.craft.json");
    fs.mkdirSync(path.dirname(scPath), { recursive: true });
    fs.writeFileSync(scPath, JSON.stringify({
      stages: "Input Image | show 3 augmented thumbnails || Weighted Box Fusion | show IoU-map consensus merging boxes; merged boxes || Context-Aware Gate | show threshold gate separating kept and rejected boxes",
    }), "utf8");
    meta.figures[FIG].versions[0].sidecar = scPath;
    store.writeMeta(docId, meta);
    const pkg = pf(["qa", FIG, "--doc", docId]);
    assert("任务包含第 3c 步（阶段画法核验）", /第 3c 步：阶段画法核验/.test(pkg.out), pkg.out.slice(0, 300));
    assert("逐条区分 [画法]/[标签]", /\[画法\]/.test(pkg.out) && /\[标签\]/.test(pkg.out));
    assert("阶段标题逐个出现", /Weighted Box Fusion/.test(pkg.out) && /Context-Aware Gate/.test(pkg.out));
    assert("指路 Q9（漏画 = FAIL）", /Q9 FAIL/.test(pkg.out), pkg.out.slice(-400));
    const ql = pf(["qa-list"]);
    assert("qa-list 含 Q9 画法落实", /Q9 画法落实/.test(ql.out), ql.out.slice(-300));
  }

  console.log("\n[2] --pass 写回：记录 + 自动 approve（收紧轮：量化依据；松绑轮：无数字由插件自动兜底）");
  setFigure({ reviewStatus: "pending" });
  const p0 = pf(["qa", FIG, "--pass", "--note", "全项通过（测试）", "--doc", docId]);
  assert("无数字 note 自动兜底放行（插件体检拼入）", p0.code === 0 && /auto体检|PASS/.test(p0.out), p0.out.slice(0, 200));
  const p0b = pf(["qa", FIG, "--pass", "--doc", docId]);
  assert("无 note 的 pass 同样自动兜底", p0b.code === 0, p0b.out.slice(0, 200));
  const p1 = pf(["qa", FIG, "--pass", "--note", "可见文字 14 条全对上、色相 3、留白 18%（测试）", "--doc", docId]);
  assert("带量化 note 的 pass 成功", p1.code === 0, p1.out.slice(0, 200));
  assert("审批状态 → approved", store.readReview(docId)[FIG].status === "approved");
  const meta1 = store.readMeta(docId);
  assert("QA 记录落盘（version=1 pass）", meta1.figures[FIG].qa?.verdict === "pass" && meta1.figures[FIG].qa?.version === 1);

  console.log("\n[2c] --pass 自动量化兜底（松绑轮：无数字 note 由插件体检数据兜底，不再硬拦）");
  {
    setFigure({ reviewStatus: "pending", versions: 1 });
    // 造一张真 PNG（png-trim 的 encodePng，白底 + 蓝块），图存在 → autoBasis 可算
    const W = 200, H = 120;
    const px = Buffer.alloc(W * H * 3, 0xff);
    for (let y = 40; y < 80; y++) for (let x = 60; x < 140; x++) {
      const o = (y * W + x) * 3; px[o] = 0x33; px[o + 1] = 0x66; px[o + 2] = 0xcc;
    }
    const pngPath = path.join(store.projectDir(docId), "figures", FIG, "v1.png");
    fs.mkdirSync(path.dirname(pngPath), { recursive: true });
    fs.writeFileSync(pngPath, encodePng({ width: W, height: H, ch: 3, pixels: px }));
    const q0 = pf(["qa", FIG, "--pass", "--note", "标签都对（无数字）", "--doc", docId]);
    assert("无数字 note 不再被拒（自动量化兜底）", q0.code === 0, q0.out.slice(0, 250));
    const metaQ = store.readMeta(docId);
    assert("note 已自动拼入体检数字", /auto体检/.test(metaQ.figures[FIG].qa?.note || ""), metaQ.figures[FIG].qa?.note);
    assert("审批放行", store.readReview(docId)[FIG].status === "approved");
    // 图不存在 + 无数字 note → 仍然拦（无兜底可用）
    setFigure({ reviewStatus: "pending", versions: 1, withPng: false });
    fs.rmSync(path.join(store.projectDir(docId), "figures", FIG, "v1.png"), { force: true });
    const q1 = pf(["qa", FIG, "--pass", "--note", "看起来没问题", "--doc", docId]);
    assert("图缺失时 pass 被拒（无核验对象）", q1.code !== 0 && /图文件不存在/.test(q1.out), q1.out.slice(0, 200));

    console.log("  [2d] 图不存在 = 没有核验对象（变异+红队轮：编数字也放不了行）");
    const q2d = pf(["qa", FIG, "--pass", "--note", "文字 5 条全对、色相 2", "--doc", docId]);
    assert("图缺失 + 带数字 note 仍被拒（PASS 硬门）", q2d.code !== 0 && /图文件不存在/.test(q2d.out),
      `code=${q2d.code} ${q2d.out.slice(0, 220)}`);
    // QA 记录指向缺失图 → approve 也拒
    setFigure({ reviewStatus: "pending", versions: 1, withPng: false, qa: { version: 1, verdict: "pass", note: "文字 5 条全对、色相 2、留白 30%" } });
    const a2d = pf(["review", "resolve", FIG, "--approve", "--doc", docId]);
    assert("审批复查发现图缺失拒绝 approve", a2d.code !== 0 && /图文件不存在/.test(a2d.out),
      `code=${a2d.code} ${a2d.out.slice(0, 220)}`);
    // 恢复 PNG，approve 恢复正常（防误伤）
    writePng(1);
    const a2dOk = pf(["review", "resolve", FIG, "--approve", "--doc", docId]);
    assert("图恢复后 approve 放行（无误伤）", a2dOk.code === 0, a2dOk.out.slice(0, 200));
  }

  console.log("\n[3] --fail 写回：记录 + 自动 reject + 缺陷进精修状态机");
  setFigure({ reviewStatus: "pending", versions: 2 });
  const f1 = pf(["qa", FIG, "--fail", "--note", "图例多了第三项; 背景米色斑纹", "--doc", docId]);
  assert("fail 命令成功", f1.code === 0, f1.out.slice(0, 200));
  assert("审批状态 → rejected", store.readReview(docId)[FIG].status === "rejected");
  const meta2 = store.readMeta(docId);
  assert("缺陷逐条进 activeFixes（2 条）", meta2.figures[FIG].activeFixes?.length === 2, JSON.stringify(meta2.figures[FIG].activeFixes));
  assert("fail 输出给重拼 craft 命令或 refine 指路", /pf craft|pf refine/.test(f1.out), f1.out.slice(-300));
  assert("fail QA 记录版本 = 2", meta2.figures[FIG].qa?.version === 2 && meta2.figures[FIG].qa?.verdict === "fail");

  console.log("\n[4] --fail 无缺陷清单 = 拒绝（没有清单的驳回是浪费）");
  const f2 = pf(["qa", FIG, "--fail", "--doc", docId]);
  assert("无 note 的 fail 被拒", f2.code !== 0 && /--note/.test(f2.out));

  console.log("\n[5] approve 门禁（review resolve）");
  setFigure({ reviewStatus: "pending", versions: 3 }); // 无 QA 记录
  const g1 = pf(["review", "resolve", FIG, "--approve", "--doc", docId]);
  assert("无 QA 记录 approve 被拒", g1.code !== 0 && /没有 QA 核验记录/.test(g1.out), g1.out.slice(0, 200));
  assert("被拒后状态仍 pending", store.readReview(docId)[FIG].status === "pending");
  setFigure({ reviewStatus: "pending", versions: 3, qa: { version: 2, verdict: "pass", note: "旧版" } }); // 过期 QA
  const g2 = pf(["review", "resolve", FIG, "--approve", "--doc", docId]);
  assert("过期 QA（v2 vs v3）approve 被拒", g2.code !== 0, g2.out.slice(0, 150));
  setFigure({ reviewStatus: "pending", versions: 3, qa: { version: 3, verdict: "fail", note: "乱码" } });
  const g3 = pf(["review", "resolve", FIG, "--approve", "--doc", docId]);
  assert("FAIL 记录 approve 被拒", g3.code !== 0 && /FAIL/.test(g3.out), g3.out.slice(0, 150));
  setFigure({ reviewStatus: "pending", versions: 3, qa: { version: 3, verdict: "pass", note: "ok" } });
  const g3b = pf(["review", "resolve", FIG, "--approve", "--doc", docId]);
  assert("PASS 记录无量化依据 approve 被拒", g3b.code !== 0 && /量化/.test(g3b.out), g3b.out.slice(0, 200));
  setFigure({ reviewStatus: "pending", versions: 3, qa: { version: 3, verdict: "pass", note: "文字 12 条全对、色相 3、留白 20%" } });
  const g4 = pf(["review", "resolve", FIG, "--approve", "--note", "测试放行", "--doc", docId]);
  assert("最新版 PASS 记录 approve 放行", g4.code === 0 && store.readReview(docId)[FIG].status === "approved", g4.out.slice(0, 200));

  console.log("\n[6] next 路由：待审 → pf qa");
  setFigure({ reviewStatus: "pending", versions: 1 });
  const nx = pf(["next", "--doc", docId]);
  assert("pending 建议 pf qa", nx.out.includes(`pf qa ${FIG}`), nx.out.slice(0, 250));

  console.log(`\n===== QA 门禁测试：${pass} 过 / ${fail} 挂 =====`);
} finally {
  fs.rmSync(store.projectDir(docId), { recursive: true, force: true });
  console.log("（沙盒项目已删除）");
  // 🔴 用 exitCode 而不是 process.exit：try 内 uncaught 异常时 finally 先跑，
  //    process.exit 会把崩溃栈一起吞掉（表现为"静默停止 exit 0"，实测踩过）
  process.exitCode = fail ? 1 : 0;
}
