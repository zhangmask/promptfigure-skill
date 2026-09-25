// test-ratio.mjs — 画布比单一来源机制的断言测试（2026-09-21 V10 事故回归）
// 跑法: node scripts/test-ratio.mjs
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  parseRatio, defaultRatioForPreset, canvasSentence,
  craftSidecarPath, readCraftSidecar, pngDims, ratioMismatch,
} from "../src/ratio.mjs";
import { craftPrompt } from "../src/craft.mjs";

let n = 0;
const ok = (name) => { n += 1; console.log(`  ✅ ${name}`); };

// ---- parseRatio ----
assert.deepEqual(parseRatio("16:9"), { w: 16, h: 9, text: "16:9" });
assert.deepEqual(parseRatio("3/4"), { w: 3, h: 4, text: "3:4" });
assert.equal(parseRatio("16:0"), null);
assert.equal(parseRatio("abc"), null);
assert.equal(parseRatio(""), null);
assert.equal(parseRatio("16"), null);
ok("parseRatio 合法/非法边界");

// ---- defaultRatioForPreset ----
assert.equal(defaultRatioForPreset("double-column"), "16:9");
assert.equal(defaultRatioForPreset("slide"), "16:9");
assert.equal(defaultRatioForPreset("single-column"), "3:4");
assert.equal(defaultRatioForPreset(""), null);
assert.equal(defaultRatioForPreset("whatever"), null);
ok("版式预设缺省画布比");

// ---- canvasSentence：拼接而非写死 ----
const w16x9 = canvasSentence({ ratio: "16:9", stageCount: 7 });
assert.ok(w16x9.includes("strict 16:9 width-to-height"), "含 16:9");
assert.ok(w16x9.includes("wide horizontal banner"), "16:9 判向宽幅");
assert.ok(w16x9.includes("7 stages share the full canvas width"), "阶段数拼进句子");
const p34 = canvasSentence({ ratio: "3:4", stageCount: 2 });
assert.ok(p34.includes("strict 3:4"), "含 3:4");
assert.ok(p34.includes("portrait canvas"), "3:4 判向竖版");
const sq = canvasSentence({ ratio: "1:1", stageCount: 0 });
assert.ok(sq.includes("strict 1:1") && sq.includes("square-ish canvas"), "1:1 判向方形");
assert.equal(canvasSentence({ ratio: "bad" }), null);
ok("canvasSentence 按比例+阶段数拼接、自动判向");

// ---- craftPrompt：画布句与 ratio 同源 ----
const base = {
  intent: "two-stage pipeline test",
  entities: ["Alpha", "Beta", "Gamma"],
  stages: "Stage A | b1; b2 || Stage B | b3",
  figureType: "pipeline",
  preset: "double-column",
};
const r169 = craftPrompt({ ...base, ratio: "16:9" });
assert.ok(r169.prompt.includes("strict 16:9 width-to-height"));
assert.ok(!r169.prompt.includes("16:5"), "写死的 16:5 必须绝迹");
assert.equal(r169.suggestedRatio, "16:9");
const r45 = craftPrompt({ ...base, ratio: "4:5" });
assert.ok(r45.prompt.includes("strict 4:5"), "用户给竖比就拼竖比");
assert.equal(r45.suggestedRatio, "4:5");
ok("craft 画布句随 --ratio 整体替换（可换，不写死）");

// 预设缺省：double-column 不给 ratio → 自动 16:9 且带提示
const rDef = craftPrompt(base);
assert.equal(rDef.suggestedRatio, "16:9");
assert.ok(rDef.prompt.includes("strict 16:9"));
assert.ok(rDef.warnings.some((w) => w.includes("缺省 16:9")), "缺省来源要有提示");
// single-column → 3:4 竖版句
const rSingle = craftPrompt({ ...base, preset: "single-column" });
assert.equal(rSingle.suggestedRatio, "3:4");
assert.ok(rSingle.prompt.includes("portrait canvas"));
// 无预设无 ratio → 全局缺省 16:9（2026-09-23 审计 B：suggestedRatio=null 会让画布句
// 静默缺席 + render 无从继承，"画布比永远由 craft 拼"的声称落空 —— 改为全局兜底）
const rNone = craftPrompt({ ...base, preset: "" });
assert.equal(rNone.suggestedRatio, "16:9");
assert.ok(rNone.warnings.some((w) => w.includes("16:9")), "兜底来源要有提示");
assert.ok(rNone.prompt.includes("Canvas shape:"), "画布句必须存在（画布比契约不缺席）");
ok("craft 预设缺省/无比例全局兜底路径");

// ---- pngDims / ratioMismatch（用真实图片验证解析器）----
const figDir = path.join(os.homedir(), ".promptfigure", "projects", "1b0d6cddb9a8");
const v10 = path.join(figDir, "figures", "fig_20260921043253_c23j", "v10.png");
const dims = pngDims(fs.readFileSync(v10));
assert.deepEqual(dims, { w: 2560, h: 1440 });
assert.equal(ratioMismatch("16:9", dims), null, "2560x1440 就是 16:9，不该报不符");
const bad = ratioMismatch("16:9", { w: 1024, h: 1024 });
assert.ok(bad && bad.dev > 40, "方形画布配 16:9 请求要报大偏差");
ok(`pngDims/ratioMismatch（V10 实图 2560x1440 = 16:9 无偏差；V1-V3 那种 1:1 会报 ${bad ? bad.dev + "%" : "?"} 偏差）`);

// ---- sidecar 路径 + 读回 ----
assert.equal(craftSidecarPath("p.txt"), "p.craft.json");
assert.equal(craftSidecarPath("a/b/craft-v11.txt"), "a/b/craft-v11.craft.json");
const tmp = path.join(os.tmpdir(), `pf-sidecar-test-${Date.now()}.txt`);
fs.writeFileSync(tmp, "x");
fs.writeFileSync(craftSidecarPath(tmp), JSON.stringify({ suggestedRatio: "16:9" }));
assert.equal(readCraftSidecar(tmp).suggestedRatio, "16:9");
fs.unlinkSync(tmp);
fs.unlinkSync(craftSidecarPath(tmp));
assert.equal(readCraftSidecar(tmp), null, "不存在的伴随文件返回 null 不炸");
ok("sidecar 路径/读回/容错");

console.log(`\n全部通过（${n} 组断言）`);
