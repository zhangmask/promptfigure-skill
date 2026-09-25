// test-anchor-quote.mjs — 锚点引文防编造回归（2026-09-21 weak-agent-sim 第 14 轮实测：
// 弱 AI 编造 quote 被 anchor set 静默收下、state 写死 "ok"）。
// 断言：编造 quote → state:"changed" + quoteOk:false；真实 quote → "ok"；复用路径同样对账。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (p) => import(pathToFileURL(p).href);

const store = await imp(path.join(ROOT, "src", "store.mjs"));
const { parseDocument } = await imp(path.join(ROOT, "src", "doc", "index.mjs"));
const { docIdOf } = await imp(path.join(ROOT, "src", "config.mjs"));
const { setAnchor } = await imp(path.join(ROOT, "src", "anchor.mjs"));

const results = [];
const assert = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "✅" : "❌"} ${name}${cond ? "" : " —— " + extra}`);
};

const FIXTURE = path.join(ROOT, "scripts", "fixtures", "test-paper.docx");
const abs = path.resolve(FIXTURE);
const docId = `sandbox_anchor_${Date.now() % 1000000}`;
let parsed;
try {
  parsed = await parseDocument(abs);
} catch (e) {
  console.error(`❌ fixture 解析失败（${e.message}）——检查 scripts/fixtures/test-paper.docx`);
  process.exitCode = 1;
  process.exit(1);
}
store.writeMeta(docId, {
  docId, source: abs, fileName: path.basename(abs), kind: "docx",
  parsedAt: new Date().toISOString(),
  blocks: parsed.blocks, outline: parsed.outline, figures: {},
});

// 取一段真实原文做对照（fixture 段落较短，阈值 20 字）
const para = parsed.blocks.find((b) => b.type === "para" && (b.text || "").length > 20);
const realQuote = para.text.slice(0, 20);
const ref = `§${para.secPath}${para.para ? " ¶" + para.para : ""}`;

const fake = setAnchor(docId, { at: ref, side: "after", quote: "The project repository contains a YOLO-based end-to-end pipeline." });
assert("编造 quote → quoteOk:false", fake.quoteOk === false, JSON.stringify(fake.quoteOk));
assert("编造 quote → state:changed", fake.anchor.state === "changed", fake.anchor.state);

const real = setAnchor(docId, { at: ref, side: "before", quote: realQuote });
assert("真实 quote → quoteOk:true", real.quoteOk === true);
assert("真实 quote → state:ok", real.anchor.state === "ok");

const reused = setAnchor(docId, { at: ref, side: "after", quote: "Another fabricated sentence that is not in the paper at all." });
assert("复用路径对账编造 quote → changed", reused.reused === true && reused.quoteOk === false, `${reused.reused}/${reused.quoteOk}`);
assert("复用后 state:changed", reused.anchor.state === "changed", reused.anchor.state);

const list = (await imp(path.join(ROOT, "src", "anchor.mjs"))).listAnchors(docId);
const changedCount = list.filter((a) => a.state !== "ok").length;
// fake 与 reused 是同一锚点（同位置同侧 → 复用更新），故 2 锚中 1 个 changed
assert("listAnchors 暴露失效锚点", changedCount === 1 && list.length === 2, `changed=${changedCount}/${list.length}`);

const cleaned = fs.rmSync(store.projectDir(docId), { recursive: true, force: true });
console.log("（沙盒项目已删除）");

const fail = results.filter((r) => !r.ok).length;
console.log(`\n===== test-anchor-quote: ${results.length - fail}/${results.length} ${fail ? "FAIL" : "PASS"} =====`);
process.exitCode = fail ? 1 : 0;
