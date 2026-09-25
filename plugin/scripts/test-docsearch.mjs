// test-docsearch.mjs — pf doc search / pf doc data 回归（2026-09-21 "找不到结果数据"）
// 断言：检索命中排序正确、片段含关键词、无命中返回空；定量句抽 %/小数/×/指标名、不抽纯整数句。
import { searchBlocks, dataSentences, dataBySection } from "../src/docsearch.mjs";

const results = [];
const assert = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "✅" : "❌"} ${name}${cond ? "" : " —— " + extra}`);
};

const blocks = [
  { type: "title", secPath: "1", text: "Introduction" },
  { type: "para", secPath: "1", para: 1, text: "We propose a fusion framework for rail defect detection. Related work abounds." },
  { type: "para", secPath: "3.2", para: 2, text: "The weighted box fusion module merges candidate boxes from multi-view TTA. Fusion improves recall notably." },
  { type: "para", secPath: "4", para: 1, text: "Our method achieves 91.3% accuracy on the hard split, outperforming baselines by 2.4%. The PSNR gain is 0.8 dB." },
  { type: "para", secPath: "4", para: 2, text: "Training takes 50 epochs on a single GPU." },
  { type: "caption", secPath: "4", para: 3, text: "Table 1: comparison with state-of-the-art fusion methods." },
];
const flat = dataSentences(blocks);

// ---- searchBlocks ----
const h1 = searchBlocks(blocks, ["fusion"]);
assert("search 单关键词命中 3 块", h1.length === 3, `got ${h1.length}`);
assert("search 多次命中排前", h1[0].secPath === "3.2", h1[0].secPath);
assert("search 片段含关键词", h1[0].snippet.toLowerCase().includes("fusion"), h1[0].snippet);
assert("search 带段落引用", h1[0].ref === "§3.2 ¶2", h1[0].ref);

const h2 = searchBlocks(blocks, ["fusion", "91.3"]);
// OR 语义：fusion 命中 3 块（intro/3.2/caption），91.3 命中 1 块（4¶1）
assert("search 多关键词分别命中", h2.length === 4, `got ${h2.length}`);
assert("search 数字关键词可命中", h2.some((h) => h.ref === "§4 ¶1"));
assert("search 大小写不敏感", searchBlocks(blocks, ["FUSION"]).length === 3);

const h3 = searchBlocks(blocks, ["quantum"]);
assert("search 无命中返回空", h3.length === 0);

const h4 = searchBlocks(blocks, ["table"]);
assert("search 能命中 caption", h4.some((h) => h.type === "caption"));

// ---- dataSentences ----
assert("data 抽到百分比+小数句", flat.some((d) => d.sentence.includes("91.3%")), JSON.stringify(flat));
assert("data 抽到指标名句", flat.some((d) => d.sentence.includes("PSNR")));
assert("data 不抽纯整数训练句", !flat.some((d) => d.sentence.includes("50 epochs")), JSON.stringify(flat));
assert("data 带 §引用", flat.every((d) => /^§/.test(d.ref)));

const groups = dataBySection(blocks);
assert("data 按章节聚合", groups.length >= 1 && groups.every((g) => g.items.length > 0));
assert("data 章节引用去掉段落号", groups.every((g) => !g.secPath.includes("¶")));

// ---- 中文 ----
const zh = dataSentences([{ type: "para", secPath: "3", para: 1, text: "本方法准确率达到91.3%，较基线提升2.4个百分点。" }]);
assert("中文定量句可抽", zh.length === 1, JSON.stringify(zh));

// ---- 中文多句分段（2026-09-22 小白增强：分句此前只认 .!?，中文定量句糊成一坨）----
const zhMulti = dataSentences([{
  type: "para", secPath: "4", para: 2,
  text: "方案一在测试集A上准确率为88.5%。方案二准确率达到91.3%。训练耗时约50分钟。方案三的提升幅度为2.4个百分点。",
}]);
assert("中文多句逐句切分（4 句）", zhMulti.length === 3, JSON.stringify(zhMulti));
assert("中文每句单独带引用", zhMulti.every((d) => d.ref === "§4 ¶2"), JSON.stringify(zhMulti.map((d) => d.ref)));
assert("中文无定量句的句子被排除", zhMulti.every((d) => !d.sentence.includes("50分钟")), JSON.stringify(zhMulti));

// ---- 引用闭环（2026-09-21 死路修复）：search/data 给的引用必须能被 resolveRef 消费 ----
const { resolveRef } = await import("../src/doc/para.mjs");
const noHeadingBlocks = [
  // 摘要/前言：有段落但无 heading（tex 抽出 §0 的真实形态）
  { type: "para", secPath: "0", para: 1, text: "Abstract of the paper with 91.3% results." },
  { type: "para", secPath: "0", para: 2, text: "More abstract text." },
  { type: "heading", secPath: "1", text: "Introduction" },
  { type: "para", secPath: "1", para: 1, text: "Intro paragraph." },
];
const dataRefs = dataSentences(noHeadingBlocks).map((d) => d.ref);
assert("无标题章节的引用可抽", dataRefs.length === 1, JSON.stringify(dataRefs));
let resolved = null;
try { resolved = resolveRef(noHeadingBlocks, dataRefs[0]); } catch (e) { resolved = { err: e.message }; }
assert("无标题章节引用 resolveRef 不再拒绝", !resolved.err, resolved.err || "");
assert("resolveRef 落到正确段落", resolved?.para === 1, JSON.stringify(resolved));
let fallErr = null;
try { resolveRef(noHeadingBlocks, "§9.9 ¶1"); } catch (e) { fallErr = e.message; }
assert("真不存在的章节仍被拒", !!fallErr && fallErr.includes("不存在"), fallErr || "");

const fail = results.filter((r) => !r.ok).length;
console.log(`\n===== test-docsearch: ${results.length - fail}/${results.length} ${fail ? "FAIL" : "PASS"} =====`);
process.exitCode = fail ? 1 : 0;
