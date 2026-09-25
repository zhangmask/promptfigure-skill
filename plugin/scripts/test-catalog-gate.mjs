// test-catalog-gate.mjs — 图型目录示例必须过得了自己的质量门（2026-09-23 收紧轮发现：
// 13 个示例里 12 个的 cmd 连旧门都过不了（intent-short/stage-thin/entity-generic...），
// `pf examples` 一直在教宿主 AI 写会被拒的命令）。任何 scoreCraft 阈值或目录示例改动都跑这个。
// 2026-09-23 收紧轮③追加：示例产物还要过 promptSelfCheck（输出侧体检）——
// 示例教出去的命令拼出的提示词若丢实体/丢阶段/丢配色契约，等于教 AI 出废图。
import { FIGURE_CATALOG } from "../src/figure-catalog.mjs";
import { scoreCraft } from "../src/quality.mjs";
import { craftPrompt, promptSelfCheck } from "../src/craft.mjs";

let pass = 0, fail = 0;
const assert = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? " —— " + detail : ""}`); }
};

// 从 cmd 字符串里抠 --intent/--entities/--stages（和用户复制粘贴执行等价）
const pick = (s, k) => {
  const m = new RegExp(`--${k} "([^"]*)"`).exec(s);
  return m ? m[1] : "";
};

for (const t of FIGURE_CATALOG) {
  const c = t.example.cmd;
  const entArg = pick(c, "entities");
  const stageArg = pick(c, "stages");
  const q = scoreCraft({
    intent: pick(c, "intent"),
    entities: entArg,
    stages: stageArg,
    figureType: t.id,
  });
  assert(`示例 cmd 过质量门: ${t.id}`, q.blockers.length === 0, q.codes.join(",") + " | " + q.blockers[0] || "");
  // 展示字段（pf examples 打印的 intent/entities/stages）与 cmd 不能互相矛盾到过不了门
  if (t.example.stages) {
    const q2 = scoreCraft({ intent: t.example.intent, entities: t.example.entities, stages: t.example.stages, figureType: t.id });
    assert(`示例 stages 字段过质量门: ${t.id}`, q2.blockers.length === 0, q2.codes.join(","));
  }
  // 输出侧体检：cmd 拼出的提示词必须零 issue（实体回声/阶段标题/配色句/画布比/长度）
  const r = craftPrompt({
    intent: pick(c, "intent"),
    entities: entArg ? entArg.split(",").map((s) => s.trim()) : [],
    stages: stageArg,
    figureType: t.id,
    preset: pick(c, "preset"),
  });
  const sc = promptSelfCheck({ prompt: r.prompt, entities: entArg ? entArg.split(",").map((s) => s.trim()) : [], stageTitles: r.stageTitles, suggestedRatio: r.suggestedRatio });
  assert(`示例产物过输出体检: ${t.id}`, sc.issues.length === 0, sc.issues.join(" | ").slice(0, 160));
}

console.log(`\n===== 目录示例门检：${pass} 过 / ${fail} 挂 =====`);
process.exit(fail ? 1 : 0);
