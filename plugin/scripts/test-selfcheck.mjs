// test-selfcheck.mjs — promptSelfCheck（craft 输出侧体检）回归
// 2026-09-23 收紧轮③：输入门拦劣质输入，输出体检查门内产物。
// 体检不变量：护盾残留 / 实体回声 / 阶段标题回声 / 配色句 / 画布比回声 / 长度下限。
import { craftPrompt, promptSelfCheck } from "../src/craft.mjs";

let pass = 0, fail = 0;
const ok = (cond, name) => {
  if (cond) { pass++; console.log("  ✅", name); }
  else { fail++; console.log("  ❌", name); }
};

const GOOD_INPUT = {
  intent: "两级缺陷检测：粗筛丢背景块，精判给剩余候选打分",
  entities: ["Input Image", "Coarse Filter|粗筛模块", "Fine Grader|精判模块"],
  stages: "Input Image | show 3 thumbnails || Coarse Filter | discard background patches; keep candidates || Fine Grader | transformer scoring; per-patch score",
  figureType: "pipeline",
  preset: "double-column",
};

console.log("\n[1] 健康产物零 issue");
{
  const r = craftPrompt(GOOD_INPUT);
  const sc = promptSelfCheck({ prompt: r.prompt, entities: GOOD_INPUT.entities, stageTitles: r.stageTitles, suggestedRatio: r.suggestedRatio });
  ok(sc.issues.length === 0, `健康产物无 issue（实际: ${sc.issues.join(" | ") || "无"}）`);
}

console.log("\n[2] 内部护盾标记残留 → issue");
{
  const r = craftPrompt(GOOD_INPUT);
  const tampered = r.prompt.replace("Additional style notes:", " PF_PAL_SHIELD_0 Additional style notes:");
  const sc = promptSelfCheck({ prompt: tampered, entities: [], stageTitles: [], suggestedRatio: null });
  ok(sc.issues.some((s) => s.includes("护盾标记")), "护盾残留被查出");
}

console.log("\n[3] 实体被净化层吃掉 → issue");
{
  const r = craftPrompt(GOOD_INPUT);
  // 模拟 stripStrayCJK/组装漏拼：把 Input Image 的引号标签从提示词里删掉
  const tampered = r.prompt.replace('"Input Image", ', "").replace('"Input Image"', "");
  const sc = promptSelfCheck({ prompt: tampered, entities: GOOD_INPUT.entities, stageTitles: [], suggestedRatio: null });
  ok(sc.issues.some((s) => s.includes("Input Image")), "实体丢失被查出");
}

console.log("\n[4] 实体自带引号 → 组装时剥掉 + 警告，自检不误报");
{
  const r = craftPrompt({ ...GOOD_INPUT, entities: ['Bad "Quote" Ent', "Coarse Filter|粗筛模块", "Fine Grader|精判模块"] });
  ok(!r.prompt.includes('"Quote"'), "组装时剥掉标签双引号（引号契约不被击穿）");
  ok(r.warnings.some((w) => w.includes("双引号")), "剥引号有明确警告");
  const sc = promptSelfCheck({ prompt: r.prompt, entities: ['Bad "Quote" Ent', "Coarse Filter|粗筛模块", "Fine Grader|精判模块"], stageTitles: r.stageTitles, suggestedRatio: r.suggestedRatio });
  ok(!sc.issues.some((s) => s.includes("Bad")), "自检按剥引号后的标签对账不误报");
}

console.log("\n[5] 阶段标题静默丢失 → issue");
{
  // 用一个【不是实体】的阶段标题测——否则实体句里的同名词会掩盖标题丢失
  const inp = { ...GOOD_INPUT, stages: "Input Image | show 3 thumbnails || Fusion Gate | merge multi-scale features; gate residuals || Fine Grader | transformer scoring; per-patch score" };
  const r = craftPrompt(inp);
  // 提示词被 sanitize 折叠成单行——精确替换阶段标题的引号形态
  const tampered = r.prompt.replace('Stage 2 — "Fusion Gate"', "Stage 2 — Fusion Gate");
  ok(tampered !== r.prompt, "注入生效（标题引号被摘）");
  const sc = promptSelfCheck({ prompt: tampered, entities: [], stageTitles: r.stageTitles, suggestedRatio: null });
  ok(sc.issues.some((s) => s.includes("Fusion Gate") && s.includes("阶段标题")), "阶段标题丢失被查出");
}

console.log("\n[6] 配色句缺失 → issue");
{
  const r = craftPrompt(GOOD_INPUT);
  const tampered = r.prompt.replace(/Additional style notes:[^\n]+/, "removed");
  const sc = promptSelfCheck({ prompt: tampered, entities: [], stageTitles: [], suggestedRatio: null });
  ok(sc.issues.some((s) => s.includes("配色句")), "配色契约丢失被查出");
}

console.log("\n[7] 画布比回声脱钩 → issue");
{
  const r = craftPrompt(GOOD_INPUT);
  // 单行提示词——直接摘掉所有 16:9 出现处（模拟画布句与比例脱钩）
  const tampered = r.prompt.split("16:9").join("REDACTED");
  const sc = promptSelfCheck({ prompt: tampered, entities: [], stageTitles: [], suggestedRatio: r.suggestedRatio });
  ok(sc.issues.some((s) => s.includes("画布比")), "画布句与渲染比脱钩被查出");
  // suggestedRatio 为 null 时不查
  const sc2 = promptSelfCheck({ prompt: tampered, entities: [], stageTitles: [], suggestedRatio: null });
  ok(!sc2.issues.some((s) => s.includes("画布比")), "无比例来源时不误报");
}

console.log("\n[8] 长度下限 → issue");
{
  const sc = promptSelfCheck({ prompt: "too short", entities: [], stageTitles: [], suggestedRatio: null });
  ok(sc.issues.some((s) => s.includes("<400")), "过短产物被查出");
  const sc2 = promptSelfCheck({ prompt: "", entities: [], stageTitles: [], suggestedRatio: null });
  ok(sc2.issues.length === 1 && sc2.issues[0].includes("为空"), "空产物单条 issue");
}

console.log("\n[9] 对照实体按英文侧回声（原文侧不要求出现在提示词）");
{
  const r = craftPrompt(GOOD_INPUT);
  ok(!r.prompt.includes("粗筛模块"), "中文原文侧不进英文提示词");
  const sc = promptSelfCheck({ prompt: r.prompt, entities: GOOD_INPUT.entities, stageTitles: [], suggestedRatio: null });
  ok(!sc.issues.some((s) => s.includes("Coarse Filter")), "对照实体按英文侧对账不误报");
}

console.log(`\n===== promptSelfCheck 测试：${pass} 过 / ${fail} 挂 =====`);
process.exit(fail ? 1 : 0);
