// test-process-gate.mjs — 执行留证门回归（2026-09-23 用户拍板"让用户的 AI 明确执行才放行"）
// 断言三条留证门：
//   ① craft 前 24h 内必须有读文档证据（doc.open/doc.read/distill.run 或 parsedAt 新鲜）
//   ② 真实渲染前必须有 --dry-run 排练记录（含提示词指纹对账）
//   ③ qa 写回前必须真的领过该图的任务包（qa.pack）
// 零成本：本地 tex fixture + store 直写沙盒；只测拒绝路径（放行路径用 ledger 断言，
// 不真正调 daemon —— 防止机器上碰巧有活 daemon + key 时烧真实额度）。

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

function pf(args, env = {}) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "bin", "pf.mjs"), ...args], {
    cwd: ROOT, encoding: "utf8", timeout: 60000, env: { ...process.env, FORCE_COLOR: "0", ...env },
  });
  return { code: r.status ?? 1, out: ((r.stdout || "") + (r.stderr ? "\n" + r.stderr : "")).trim() };
}

const { docIdOf } = await imp(path.join(ROOT, "src", "config.mjs"));
const { parseDocument } = await imp(path.join(ROOT, "src", "doc", "index.mjs"));
const store = await imp(path.join(ROOT, "src", "store.mjs"));
const ledger = await imp(path.join(ROOT, "src", "ledger.mjs"));
const { appendEvent } = await imp(path.join(ROOT, "src", "events.mjs"));

// ---- 本地 tex fixture（实体词已知，溯源对账可过）----
const texPath = path.join(os.tmpdir(), `pf-gate-fixture-${Date.now() % 1000000}.tex`);
fs.writeFileSync(texPath, [
  "\\documentclass{article}", "\\begin{document}",
  "\\section{Method}",
  "Our pipeline first applies the Alpha Module to expand candidate hypotheses from raw inputs.",
  "The Beta Module then merges overlapping candidates by iterative consensus voting.",
  "Finally the Gamma Module filters inconsistent detections to produce the final result.",
  "\\end{document}",
].join("\n"), "utf8");

const docId = docIdOf(texPath);
fs.rmSync(store.projectDir(docId), { recursive: true, force: true });
const parsed = await parseDocument(texPath);
// 🔴 关键：parsedAt 设为 3 天前 —— 关掉"刚 open 过"的天然豁免，让留证门真的开火
const STALE = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
store.writeMeta(docId, {
  docId, source: texPath, fileName: path.basename(texPath), kind: "tex",
  parsedAt: STALE, blocks: parsed.blocks, outline: parsed.outline, figures: {},
});

const CRAFT_ARGS = [
  "craft", "--at", "§1 ¶1", "--figure-type", "pipeline",
  "--intent", "Three-module pipeline that expands hypotheses then merges and filters them",
  "--entities", "Alpha Module,Beta Module,Gamma Module",
  "--stages", "Alpha Module | show expanded hypothesis dots || Beta Module | show consensus merge of overlapping boxes || Gamma Module | show filtered final detections",
];

let texPath2 = null, docIdB = null, gateFreshDocId = null, gateOldDocId = null;

try {
  console.log("\n[1] 留证门① craft 前没读过文档 → 拒");
  const g1 = pf([...CRAFT_ARGS, "--out", "temp-gate-p1.txt", "--doc", docId]);
  assert("无任何读文档证据被拒", g1.code !== 0 && /没有读过/.test(g1.out), `code=${g1.code} ${g1.out.slice(0, 200)}`);
  assert("拒绝信息给出确切下一步命令", /pf distill|pf doc outline/.test(g1.out), g1.out.slice(0, 250));
  assert("拒绝尝试落审计（craft.no_read）",
    ledger.lastEvidence(docId, "craft.no_read")?.forced === false, JSON.stringify(ledger.readEvents ? "no" : ""));

  console.log("\n[2] 执行 pf doc outline 留证后 → 门放行，craft 正常产出");
  const o1 = pf(["doc", "outline", "--doc", docId]);
  assert("outline 可执行", o1.code === 0, o1.out.slice(0, 120));
  assert("outline 留证（doc.read）", ledger.hasEvidence(docId, ["doc.read"]));
  const c2 = pf([...CRAFT_ARGS, "--out", "temp-gate-p2.txt", "--doc", docId]);
  assert("读过后 craft 放行（exit 0）", c2.code === 0, c2.out.slice(0, 250));
  assert("提示词文件写出", fs.existsSync(path.join(ROOT, "temp-gate-p2.txt")));
  assert("伴随 craft.json 写出", fs.existsSync(path.join(ROOT, "temp-gate-p2.craft.json")));

  console.log("\n[3] 留证门② 真实渲染前没排练过 → 拒");
  const atMeta = store.readMeta(docId);
  const r3 = pf(["render", "--at", "§1 ¶1", "--prompt-file", "temp-gate-p2.txt", "--doc", docId]);
  assert("无 dry-run 记录被拒", r3.code !== 0 && /排练/.test(r3.out), `code=${r3.code} ${r3.out.slice(0, 250)}`);
  assert("拒绝信息给出排练命令", /--dry-run/.test(r3.out), r3.out.slice(0, 250));
  assert("拒绝尝试落审计（render.no_rehearsal）", !!ledger.lastEvidence(docId, "render.no_rehearsal"));

  console.log("\n[4] --dry-run 排练留痕（含提示词指纹）→ 留证门②放行条件成立");
  const d4 = pf(["render", "--at", "§1 ¶1", "--prompt-file", "temp-gate-p2.txt", "--doc", docId, "--dry-run"]);
  assert("dry-run 正常", d4.code === 0, d4.out.slice(0, 200));
  const dryEv = ledger.lastEvidence(docId, "render.dryrun");
  assert("dry-run 事件落账", !!dryEv);
  assert("事件含提示词指纹且与当前一致", dryEv?.hash === ledger.shaOf(fs.readFileSync(path.join(ROOT, "temp-gate-p2.txt"), "utf8")),
    `event=${JSON.stringify(dryEv)}`);
  assert("留证门②证据成立（hasEvidence）", ledger.hasEvidence(docId, ["render.dryrun"]));

  console.log("\n[5] 留证门③ qa 写回前没领任务包 → 拒");
  // 造一张图（encodePng 生成真 PNG —— 2026-09-23 硬门：图不存在 = 无核验对象）
  const { encodePng: encPng } = await imp(path.join(ROOT, "src", "png-trim.mjs"));
  const figDir = path.join(store.projectDir(docId), "figures", "fig_gate_test");
  fs.mkdirSync(figDir, { recursive: true });
  fs.writeFileSync(path.join(figDir, "v1.png"), encPng({ width: 200, height: 120, ch: 3, pixels: Buffer.alloc(200 * 120 * 3, 0xff) }));
  atMeta.figures["fig_gate_test"] = {
    figureId: "fig_gate_test", at: "§1 ¶1",
    versions: [{ file: "figures/fig_gate_test/v1.png", model: "standard", prompt: "gate test", at: new Date().toISOString() }],
    activeFixes: [],
  };
  store.writeMeta(docId, atMeta);
  store.writeReview(docId, { fig_gate_test: { status: "pending", note: "", by: "sim", at: new Date().toISOString() } });
  const q5 = pf(["qa", "fig_gate_test", "--pass", "--note", "可见文字 5 条全对、色相 2、留白 30%", "--doc", docId]);
  assert("没领任务包写回被拒", q5.code !== 0 && /任务包/.test(q5.out), `code=${q5.code} ${q5.out.slice(0, 250)}`);
  assert("拒绝尝试落审计（qa.no_pack）", !!ledger.lastEvidence(docId, "qa.no_pack", { filter: (e) => e.figure === "fig_gate_test" }));

  console.log("\n[6] 领过任务包（qa.pack 留证）→ 写回放行");
  const pkg = pf(["qa", "fig_gate_test", "--doc", docId]);
  assert("任务包可运行", pkg.code === 0, pkg.out.slice(0, 150));
  assert("领包留证（qa.pack，对到 figure）",
    ledger.hasEvidence(docId, ["qa.pack"], { filter: (e) => e.figure === "fig_gate_test" }));
  const q6 = pf(["qa", "fig_gate_test", "--pass", "--note", "可见文字 5 条全对、色相 2、留白 30%", "--doc", docId]);
  assert("领包后写回放行（exit 0）", q6.code === 0, q6.out.slice(0, 250));
  assert("审批状态 approved", /approved/.test(q6.out), q6.out.slice(0, 200));

  console.log("\n[7] 裸 --force 豁免留证门（宽松轮定规）+ 留痕");
  // 独立 stale fixture：[2] 的 outline 已给 docId 留了证，门不会火——force 豁免必须用零证据项目验
  texPath2 = path.join(os.tmpdir(), `pf-gate-fixture2-${Date.now() % 1000000}.tex`);
  fs.writeFileSync(texPath2, fs.readFileSync(texPath, "utf8"), "utf8");
  docIdB = docIdOf(texPath2);
  fs.rmSync(store.projectDir(docIdB), { recursive: true, force: true });
  store.writeMeta(docIdB, {
    docId: docIdB, source: texPath2, fileName: path.basename(texPath2), kind: "tex",
    parsedAt: STALE, blocks: parsed.blocks, outline: parsed.outline, figures: {},
  });
  const f7 = pf(["craft", "--at", "§1 ¶1", "--figure-type", "pipeline",
    "--intent", "Force bypass attempt with enough words to be meaningful here",
    "--entities", "Alpha Module,Beta Module,Gamma Module",
    "--stages", "Alpha Module | show one box || Beta Module | show two boxes || Gamma Module | show three boxes",
    "--out", "temp-gate-p7.txt", "--doc", docIdB, "--force"]);
  // 门放行（no_read 留痕 forced:true），后续溯源正常对账通过 → exit 0
  assert("裸 --force 放行 craft", f7.code === 0, `code=${f7.code} ${f7.out.slice(0, 250)}`);
  assert("留痕 forced:true", ledger.lastEvidence(docIdB, "craft.no_read")?.forced === true,
    JSON.stringify(ledger.lastEvidence(docIdB, "craft.no_read")));
  assert("stderr 有留痕提示", /craft\.no_read/.test(f7.out), f7.out.slice(0, 200));

  console.log("\n[8] parsedAt 新鲜 ≠ 豁免 —— 证据只认事件流水（pf open 才会落 doc.open）");
  gateFreshDocId = `sandbox_gate_fresh_${Date.now() % 1000000}`;
  store.writeMeta(gateFreshDocId, {
    docId: gateFreshDocId, source: texPath, fileName: path.basename(texPath), kind: "tex",
    parsedAt: new Date().toISOString(), blocks: parsed.blocks, outline: parsed.outline, figures: {},
  });
  const c8 = pf([...CRAFT_ARGS, "--out", "temp-gate-p8.txt", "--doc", gateFreshDocId]);
  assert("无事件记录的沙盒（哪怕 parsedAt 新鲜）仍被拒", c8.code !== 0 && /没有读过/.test(c8.out),
    `code=${c8.code} ${c8.out.slice(0, 200)}`);

  console.log("\n[9] 证据窗口过滤：30 小时前的 doc.open 不算证据（24h 窗口）");
  gateOldDocId = `sandbox_gate_old_${Date.now() % 1000000}`;
  store.writeMeta(gateOldDocId, {
    docId: gateOldDocId, source: texPath, fileName: path.basename(texPath), kind: "tex",
    parsedAt: STALE, blocks: parsed.blocks, outline: parsed.outline, figures: {},
  });
  // 手工落一条 30h 前的 doc.open —— 窗口过滤正确时应被无视
  const OLD_TS = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
  fs.mkdirSync(store.projectDir(gateOldDocId), { recursive: true });
  appendEvent(gateOldDocId, "doc.open", { at: OLD_TS, ts: OLD_TS });
  assert("30h 前的证据被 hasEvidence 无视（窗口过滤生效）",
    !ledger.hasEvidence(gateOldDocId, ["doc.open"]), JSON.stringify(ledger.lastEvidence(gateOldDocId, "doc.open")));
  const c9 = pf([...CRAFT_ARGS, "--out", "temp-gate-p9.txt", "--doc", gateOldDocId]);
  assert("只有过期证据的 craft 仍被拒", c9.code !== 0 && /没有读过/.test(c9.out),
    `code=${c9.code} ${c9.out.slice(0, 200)}`);
  assert("留痕 forced:false", ledger.lastEvidence(gateOldDocId, "craft.no_read")?.forced === false);
} finally {
  // 清理
  fs.rmSync(store.projectDir(docId), { recursive: true, force: true });
  for (const f of ["temp-gate-p1.txt", "temp-gate-p2.txt", "temp-gate-p2.craft.json",
    "temp-gate-p7.txt", "temp-gate-p7.craft.json", "temp-gate-p8.txt", "temp-gate-p8.craft.json",
    "temp-gate-p9.txt", "temp-gate-p9.craft.json"]) {
    try { fs.rmSync(path.join(ROOT, f), { force: true }); } catch {}
  }
  try { fs.rmSync(texPath, { force: true }); } catch {}
  try { fs.rmSync(texPath2, { force: true }); } catch {}
  try { fs.rmSync(store.projectDir(docIdB), { recursive: true, force: true }); } catch {}
  if (gateFreshDocId) try { fs.rmSync(store.projectDir(gateFreshDocId), { recursive: true, force: true }); } catch {}
  if (gateOldDocId) try { fs.rmSync(store.projectDir(gateOldDocId), { recursive: true, force: true }); } catch {}
}

console.log(`\n===== 执行留证门测试：${pass} 过 / ${fail} 挂 =====`);
process.exit(fail ? 1 : 0);
