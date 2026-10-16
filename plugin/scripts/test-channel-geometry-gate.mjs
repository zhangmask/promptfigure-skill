// test-channel-geometry-gate.mjs — 2026-09-26 Swin 实测后的三道新防线回归
// 零成本：craft 层走 craftPrompt 纯函数；QA 层走沙盒项目直写 store，不出图。
// 断言：
//   A. craft 卡片纪律阈值 >5 词告警（旧阈值 >8 有盲区，v1 六词碎片漏网后上图为乱码）
//   B. craft 指令前缀剥离（"label W-MSA" → 只印 "W-MSA"，剥离留痕）
//   C. craft 母题污染告警（comparison 的 baseline/ours/Slot 框架词）
//   D. craft --geometry 告警 + 返回透传
//   E. QA 包通道告警（standard + 带文字 → Q1 预期 FAIL 的通道归因；premium 无）
//   F. QA 包第 3d 步几何核验清单（sidecar.geometry 逐项列出）
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

function pf(args) {
  // 🔴 本机 spawnSync 管道 stdio EBUSY（2026-10-15：node→node 间歇→持续实锤；chrome/msedge/python 早已实锤）
  // 文件描述符正常 → 输出落临时文件再读，保持同步语义不动调用点
  for (let attempt = 0; ; attempt++) {
    const tmpOut = path.join(os.tmpdir(), `pf-cg-out-${process.pid}-${attempt}.txt`);
    const fd = fs.openSync(tmpOut, "w");
    const r = spawnSync(process.execPath, [path.join(ROOT, "bin", "pf.mjs"), ...args], {
      cwd: ROOT, timeout: 60000, stdio: ["ignore", fd, fd], env: { ...process.env, FORCE_COLOR: "0" },
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

const { craftPrompt } = await imp(path.join(ROOT, "src", "craft.mjs"));
const store = await imp(path.join(ROOT, "src", "store.mjs"));

console.log("\n[A-D] craft 层：四道新防线（纯函数，零成本）");
{
  const badStages = "Panel 1 Regular Partitioning | show an 8x8 patch grid; 2x2 bold windows anchored top-left; label W-MSA; no legend, no (a)(b) panel tags || Panel 2 Shifted Partitioning | Shift by floor(M/2); SW-MSA; show the same 8x8 grid with every window displaced by half a window";
  const r = craftPrompt({
    intent: "Shifted window partitioning: regular 2x2 windows vs the same grid displaced by floor(M/2) pixels",
    entities: ["Feature Map 8x8", "Regular Window Partitioning", "Shifted Window Partitioning", "W-MSA", "SW-MSA"],
    stages: badStages,
    figureType: "comparison",
    geometry: "8x8 grid with 1-8 axis labels no duplicates; window boundaries at row 4 and column 4",
    hasAt: true,
  });
  const w = (r.warnings || []).join("\n");
  assert("A 卡片纪律：>5 词要点告警（旧阈值 8 词盲区已修）", /超过 5 词/.test(w), w.slice(0, 300));
  assert("A2 告警带实测证据（6 词碎片也会上图）", /anchared top-elelf/.test(w));
  assert("B 指令前缀剥离留痕（label W-MSA → 只印 W-MSA）", /已剥离指令前缀/.test(w) && /只印 "W-MSA"/.test(w), w.slice(0, 400));
  assert("B2 提示词里不再出现指令词 label", !/"label W-MSA"/.test(r.prompt) && /"W-MSA"/.test(r.prompt));
  assert("C 母题污染告警（comparison 框架词）", /母题自带框架词/.test(w) && /"baseline"/.test(w) && /"Slot 1"/.test(w));
  assert("D 几何约束告警", /已声明几何约束/.test(w));
  assert("D2 geometry 透传到返回值", r.geometry === "8x8 grid with 1-8 axis labels no duplicates; window boundaries at row 4 and column 4");
}

console.log("\n[E-F] QA 层：通道告警 + 几何核验清单（沙盒项目，零成本）");
{
  const abs = path.resolve(ROOT, "scripts", "fixtures", "test-paper.docx");
  const docId = `sandbox_chg_${Date.now() % 1000000}`;
  store.writeMeta(docId, {
    docId, source: abs, fileName: path.basename(abs), kind: "docx",
    parsedAt: new Date().toISOString(), blocks: [], outline: [], figures: {},
  });
  const FIG = "fig_chg_test";
  const { encodePng } = await imp(path.join(ROOT, "src", "png-trim.mjs"));
  const pngDir = path.join(store.projectDir(docId), "figures", FIG);
  fs.mkdirSync(pngDir, { recursive: true });
  const W = 200, H = 120;
  const px = Buffer.alloc(W * H * 3, 0xff);
  for (let y = 40; y < 80; y++) for (let x = 60; x < 140; x++) {
    const o = (y * W + x) * 3; px[o] = 0x33; px[o + 1] = 0x66; px[o + 2] = 0xcc;
  }
  fs.writeFileSync(path.join(pngDir, "v1.png"), encodePng({ width: W, height: H, ch: 3, pixels: px }));
  const scPath = path.join(pngDir, "v1.craft.json");
  fs.writeFileSync(scPath, JSON.stringify({
    entities: "Feature Map 8x8,Regular Window Partitioning,W-MSA",
    geometry: "window boundaries at row 4 and column 4; shift exactly floor(M/2)=2 cells",
  }), "utf8");
  const withVersion = (model) => {
    const meta = store.readMeta(docId);
    meta.figures[FIG] = {
      figureId: FIG, at: "§3.2 ¶4",
      versions: [{ file: `figures/${FIG}/v1.png`, model, prompt: "Named entities (keep verbatim): present each of the following as a labelled node/block — Feature Map 8x8, W-MSA.", at: new Date().toISOString(), sidecar: scPath }],
      activeFixes: [],
    };
    store.writeMeta(docId, meta);
  };

  try {
    withVersion("standard");
    const pkgStd = pf(["qa", FIG, "--doc", docId]);
    assert("E standard+带文字：通道告警出现", /通道告警：本版 standard 且图带文字标签/.test(pkgStd.out), pkgStd.out.slice(0, 200));
    assert("E2 通道告警指路 premium 而非精修", /别在 standard 上反复精修/.test(pkgStd.out));
    assert("F 第 3d 步几何核验清单出现", /第 3d 步：几何核验/.test(pkgStd.out), pkgStd.out.slice(0, 300));
    assert("F2 几何项逐条列出", /window boundaries at row 4 and column 4/.test(pkgStd.out) && /shift exactly floor\(M\/2\)=2 cells/.test(pkgStd.out));
    assert("F3 几何项判级说明（Q3 阻断级）", /Q3 阻断级/.test(pkgStd.out));

    withVersion("premium");
    const pkgPrem = pf(["qa", FIG, "--doc", docId]);
    assert("E3 premium 版：无通道告警", !/通道告警/.test(pkgPrem.out));
    assert("F4 premium 版：几何清单仍在（几何与档位无关）", /第 3d 步：几何核验/.test(pkgPrem.out));
  } finally {
    try { fs.rmSync(store.projectDir(docId), { recursive: true, force: true }); } catch {}
    console.log("  （沙盒项目已删除）");
  }
}

console.log(`\n===== 通道/几何/卡片纪律门禁：${pass} 过 / ${fail} 挂 =====`);
if (fail) process.exit(1);
