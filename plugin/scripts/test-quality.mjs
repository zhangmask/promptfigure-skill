// test-quality.mjs — craft 输入质量门回归（2026-09-21 用户反馈"别人 AI 用着质量就不行"）
// 断言三档：好输入放行 / 弱模型典型输入被拒且 blocker 说得清怎么改 / show 画法句豁免误伤
import { scoreCraft, checkEntitySource, qaState } from "../src/quality.mjs";

let pass = 0, fail = 0;
const assert = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? " —— " + detail : ""}`); }
};

// ---- 1) 好输入（v11 定稿同源）必须放行 ----
const good = scoreCraft({
  intent: "UAPL acts as a progressive purifier of zero-shot discrepancy boxes: TTA expands hypotheses, WBF consolidates repeatable evidence, CAC-T removes context-inconsistent clutter boxes",
  entities: ["Source Image Is", "Enhanced Image Ie", "Multi-View TTA", "id", "hflip", "scale 0.9", "scale 1.1", "A1 Mean Residual", "A2 SSIM", "IoU Graph", "Weighted Box Fusion", "CAC-T", "tau ctx", "kept", "dropped", "Final Detections"],
  stages: "Input Pair | show Source Image Is and Enhanced Image Ie as two plain abstract white panels stacked vertically (NOT photographs) || Multi-View TTA | show four small plain tiles labeled id, hflip, scale 0.9, scale 1.1 || Dual Localizers | show two parallel blocks labeled A1 Mean Residual and A2 SSIM, each followed by a small plain response map panel || CC Candidate Boxes | show one plain response map panel densely covered with many small candidate boxes || IoU-Graph Consensus (WBF) | show an IoU graph whose vertices are proposals and edges connect pairs with IoU above threshold, captioned with the short label Weighted Box Fusion || CAC-T Filtering | show three uniform-size solid boxes above a horizontal threshold gate and dashed fading boxes below it, gate labeled tau ctx || Final Boxes + Status | show a small legend card with exactly two entries labeled kept and dropped; show Final Detections as solid boxes overlaid on one plain pure white source panel",
  figureType: "pipeline",
});
assert("好输入零 blocker", good.blockers.length === 0, JSON.stringify(good.blockers));
assert("好输入 ≥80 分", good.score >= 80, `score=${good.score}`);

// ---- 2) 弱模型典型输入（sim 第 1 轮实录风格）——宽松档降级放行 + strict 档全拦 ----
const weakArgs = {
  intent: "方法框架图",
  entities: ["Input Image", "Clean Boxes"],
  stages: "Input | show the input image || Output |",
  figureType: "pipeline",
};
const weak = scoreCraft(weakArgs);
assert("宽松档弱输入仍有结构性 blocker（intent-generic/空阶段）", weak.blockers.length >= 2, JSON.stringify(weak.blockers));
assert("宽松档降级类进 softCodes（intent-short/entities-few/stages-few）", ["intent-short", "entities-few", "stages-few"].every((c) => weak.softCodes.includes(c)), JSON.stringify(weak.softCodes));
assert("宽松档弱输入也出不了高分", weak.score < 70, `score=${weak.score}`);
assert("实体不足降级为警告（notes 提到）", weak.notes.some((n) => n.includes("实体只有")), JSON.stringify(weak.notes));
const weakStrict = scoreCraft({ ...weakArgs, strict: true });
assert("strict 档弱输入全拦", weakStrict.blockers.length >= 4, JSON.stringify(weakStrict.blockers));
assert("strict 档 blocker 提到实体不足", weakStrict.blockers.some((b) => b.includes("实体")));

// ---- 3) 覆盖率：一半实体没进 stages → blocker ----
const halfMiss = scoreCraft({
  intent: "Two-stage detection pipeline with dual localizers and fusion",
  entities: ["Input Image", "Localizer A1", "Localizer A2", "WBF Fusion", "Final Boxes"],
  stages: "Input | show the input image panel || Localizers | show Localizer A1 and Localizer A2 blocks with response maps || Fusion | show WBF Fusion merging boxes into Final Boxes",
  figureType: "pipeline",
});
assert("覆盖率 60% 边界放行（A1/A2 是 Localizer A1 的子串）", halfMiss.blockers.length === 0, JSON.stringify(halfMiss.blockers));

const fullMiss = scoreCraft({
  intent: "Two-stage detection pipeline with dual localizers and fusion",
  entities: ["Input Image", "Localizer A1", "Localizer A2", "WBF Fusion", "Final Boxes", "Entropy Map", "Reliability Score", "Calibration Curve"],
  stages: "Input | show the input image panel || Localizers | show two parallel blocks with response maps || Fusion | show boxes merging into final boxes",
  figureType: "pipeline",
});
assert("宽松档覆盖率 50-79% 降级为警告（softCodes）", fullMiss.softCodes.includes("entity-coverage") && fullMiss.blockers.length === 0, JSON.stringify({ b: fullMiss.blockers, s: fullMiss.softCodes }));
const fullMissStrict = scoreCraft({
  intent: "Two-stage detection pipeline with dual localizers and fusion",
  entities: ["Input Image", "Localizer A1", "Localizer A2", "WBF Fusion", "Final Boxes", "Entropy Map", "Reliability Score", "Calibration Curve"],
  stages: "Input | show the input image panel || Localizers | show two parallel blocks with response maps || Fusion | show boxes merging into final boxes",
  figureType: "pipeline",
  strict: true,
});
assert("strict 档覆盖率 <80% 被拦且列出缺席实体", fullMissStrict.blockers.some((b) => b.includes("覆盖率") && b.includes("Entropy Map")), JSON.stringify(fullMissStrict.blockers));

// ---- 4) show 长句豁免（画法指令不是要印的文字）----
const showExempt = scoreCraft({
  intent: "Progressive purification pipeline from noisy boxes to clean detections",
  entities: ["Noisy Boxes", "WBF Fusion", "Clean Boxes"],
  stages: "Input | show a plain panel covered with many small noisy candidate boxes || Fusion | show overlapping boxes being merged by WBF Fusion into fewer consolidated boxes above a small IoU graph || Output | show a few clean detection boxes overlaid on one plain pure white source panel",
  figureType: "pipeline",
});
assert("show 长画法句不算 blocker", showExempt.blockers.length === 0, JSON.stringify(showExempt.blockers));

// ---- 5) CJK intent：汉字数/2 折算词数，30 字中文 = 15 词，不再误拦（sim 第 4 轮实测）----
const zhIntent = scoreCraft({
  intent: "UAPL 方法框架：从输入图像到最终输出的四阶段流程，展示 TTA 增强、双定位器预测、WBF 融合与 CAC-T 过滤",
  entities: ["Input Image", "Noisy Boxes", "WBF Fusion", "Clean Boxes"],
  stages: "Input | show the input image panel || Localizers | show two parallel blocks with response maps producing noisy boxes || Fusion | show WBF Fusion merging boxes into clean boxes",
  figureType: "pipeline",
});
assert("中文长 intent 不误拦", !zhIntent.blockers.some((b) => b.includes("intent")), JSON.stringify(zhIntent.blockers));
const zhShort = scoreCraft({ intent: "方法框架图", entities: ["A", "B", "C"], stages: "", figureType: "pipeline" });
assert("中文 3 字 intent 仍被拦", zhShort.blockers.some((b) => b.includes("intent")));

// ---- hasAt 门（2026-09-21 "不读文章"后门封堵）----
const noAt = scoreCraft({
  hasAt: false,
  intent: "Two-stage defect detection pipeline that first discards background patches then grades candidates",
  entities: ["A", "B", "C"],
  stages: "A | show one block || B | show two blocks || C | show three blocks",
  figureType: "pipeline",
});
assert("缺 --at 被拦", noAt.blockers.some((b) => b.includes("--at")));
assert("缺 --at 的 blocker 指路 distill", noAt.blockers.some((b) => b.includes("pf distill")));
const withAt = scoreCraft({
  hasAt: true,
  intent: "Two-stage defect detection pipeline that first discards background patches then grades candidates",
  entities: ["A", "B", "C"],
  stages: "A | show one block || B | show two blocks || C | show three blocks",
  figureType: "pipeline",
});
assert("带 --at 同样输入放行", withAt.blockers.length === 0, JSON.stringify(withAt.blockers));

// ---- 6) 实体溯源 checkEntitySource（2026-09-21 第 2 层质量门：防编造实体）----
const SRC = "The UAPL framework performs multi-view TTA over the input image. Weighted Box Fusion (WBF) consolidates proposals from dual localizers, and CAC-T removes context-inconsistent boxes using a tau ctx gate.";
const srcOk = checkEntitySource({
  entities: ["UAPL", "TTA", "Weighted Box Fusion", "CAC-T", "tau ctx"],
  sourceText: SRC,
});
assert("原文出现的实体零 blocker", !srcOk.blocker && srcOk.missing.length === 0, JSON.stringify(srcOk));
const srcFab = checkEntitySource({
  entities: ["Transformer Encoder", "Diffusion Decoder", "Contrastive Head"],
  sourceText: SRC,
});
assert("全部编造实体 → blocker", !!srcFab.blocker && srcFab.missing.length === 3, JSON.stringify(srcFab));
assert("编造 blocker 提到 pf distill", srcFab.blocker.includes("distill"));
const srcPart = checkEntitySource({
  entities: ["UAPL", "TTA", "Weighted Box Fusion", "Entropy Map"],
  sourceText: SRC,
});
assert("部分实体缺席只提醒不拦截", !srcPart.blocker && !!srcPart.note && srcPart.missing.includes("Entropy Map"), JSON.stringify(srcPart));
const srcTranslated = checkEntitySource({
  entities: ["噪声框", "加权框融合", "上下文门控"],
  sourceText: SRC,
});
assert("实体已翻译（脚本不一致）跳过不拦截", !srcTranslated.blocker && srcTranslated.checked.length === 0 && !!srcTranslated.note);
const srcCJK = checkEntitySource({
  entities: ["噪声框", "加权框融合"],
  sourceText: "本方法先对噪声框做多视图测试增强，再用加权框融合合并候选框，最后用上下文门控过滤。",
});
assert("中文原文+中文实体子串匹配", !srcCJK.blocker && srcCJK.missing.length === 0);
// 混合场景：中文原文 + 部分实体已译英文 → 缺席的和跳过的都要被点名（F 报告：跳过的闭口不提）
const srcMixed = checkEntitySource({
  entities: ["噪声框", "Weighted Box Fusion", "Entropy Map"],
  sourceText: "本方法先对噪声框做多视图测试增强，再用加权框融合合并候选框。",
});
assert(
  "混合场景点名缺席+跳过实体",
  !srcMixed.blocker && srcMixed.note.includes("Entropy Map") && srcMixed.note.includes("无法自动对账"),
  JSON.stringify(srcMixed),
);

// ---- 7) qaState：审批门禁底座（最新版对账）----
const figV2 = { versions: [{}, {}], qa: { version: 2, verdict: "pass", note: "ok" } };
assert("QA 记录版本一致 = fresh pass", qaState(figV2).fresh && qaState(figV2).verdict === "pass");
assert("QA 记录过期（v1 vs v2）= 不 fresh", qaState({ versions: [{}, {}], qa: { version: 1, verdict: "pass" } }).fresh === false);
assert("无 QA 记录 = 不 fresh 且 verdict null", qaState({ versions: [{}] }).fresh === false && qaState({ versions: [{}] }).verdict === null);
assert("FAIL verdict 可读", qaState({ versions: [{}], qa: { version: 1, verdict: "fail", note: "x" } }).verdict === "fail");

// ---- 8) 2026-09-23 收紧轮：新门逐个验 ----
// 8a) intent 纯图型名（哪怕字数够也被拦）
const lazyIntent = scoreCraft({
  intent: "Method Framework Overview Diagram",
  entities: ["A", "B", "C"],
  stages: "A | show one block || B | show two blocks || C | show three blocks",
  figureType: "pipeline",
});
assert("纯图型名 intent 被拦（intent-generic）", lazyIntent.blockers.some((b) => b.includes("图型名") || b.includes("没说这张图")), JSON.stringify(lazyIntent.blockers));

// 8b) 重复实体充数：去重后 <3 —— 宽松档警告、strict 档拦
const dupArgs = {
  intent: "Two-stage defect detection pipeline that first discards background patches then grades candidates",
  entities: ["Coarse Filter", "Coarse Filter", "coarse filter"],
  stages: "Coarse Filter | show one block || B | show two blocks || C | show three blocks",
  figureType: "pipeline",
};
const dupEnts = scoreCraft(dupArgs);
assert("宽松档重复实体降级为警告（softCodes）", dupEnts.softCodes.includes("entities-few") && dupEnts.blockers.length === 0, JSON.stringify({ b: dupEnts.blockers, s: dupEnts.softCodes }));
assert("重复实体记 note", dupEnts.notes.some((n) => n.includes("重复")), JSON.stringify(dupEnts.notes));
const dupEntsStrict = scoreCraft({ ...dupArgs, strict: true });
assert("strict 档去重后 <3 仍拦", dupEntsStrict.blockers.some((b) => b.includes("实体只有 1 个")), JSON.stringify(dupEntsStrict.blockers));

// 8c) 万能占位实体
const genericEnts = scoreCraft({
  intent: "Two-stage defect detection pipeline that first discards background patches then grades candidates",
  entities: ["Model", "Data", "Result"],
  stages: "A | show one block || B | show two blocks || C | show three blocks",
  figureType: "pipeline",
});
assert("万能占位实体被拦", genericEnts.blockers.some((b) => b.includes("万能占位词") && b.includes("Model")), JSON.stringify(genericEnts.blockers));

// 8d) flowchart 一个阶段都不给 → 也拦（原来 length>0 才查的洞）
const noStages = scoreCraft({
  intent: "Two-stage defect detection pipeline that first discards background patches then grades candidates",
  entities: ["A", "B", "C"],
  stages: "",
  figureType: "flowchart",
});
assert("flowchart 零阶段被拦", noStages.blockers.some((b) => b.includes("阶段")), JSON.stringify(noStages.blockers));

// 8e) 全图零 show 画法句 —— 宽松档警告、strict 档拦
const noShowArgs = {
  intent: "Two-stage defect detection pipeline that first discards background patches then grades candidates",
  entities: ["A", "B", "C"],
  stages: "A | one block; small label || B | two blocks; arrows || C | three blocks; dashed line",
  figureType: "pipeline",
};
const noShow = scoreCraft(noShowArgs);
assert("宽松档零 show 降级为警告（softCodes）", noShow.softCodes.includes("no-show") && noShow.blockers.length === 0, JSON.stringify({ b: noShow.blockers, s: noShow.softCodes }));
const noShowStrict = scoreCraft({ ...noShowArgs, strict: true });
assert("strict 档零 show 被拦", noShowStrict.blockers.some((b) => b.includes("show 画法句")), JSON.stringify(noShowStrict.blockers));

// 8f) 孤标签盒子（1 条非画法要点）—— 宽松档警告、strict 档拦
const thinArgs = {
  intent: "Two-stage defect detection pipeline that first discards background patches then grades candidates",
  entities: ["A", "B", "C"],
  stages: "A | show one block || B | show two blocks || C | small label only",
  figureType: "pipeline",
};
const thinStage = scoreCraft(thinArgs);
assert("宽松档孤标签降级为警告（softCodes）", thinStage.softCodes.includes("stage-thin") && thinStage.blockers.length === 0, JSON.stringify({ b: thinStage.blockers, s: thinStage.softCodes }));
const thinStrict = scoreCraft({ ...thinArgs, strict: true });
assert("strict 档孤标签被拦（stage-thin）", thinStrict.blockers.some((b) => b.includes("只有 1 条短标签")), JSON.stringify(thinStrict.blockers));

// 8g) 非画法要点 >10 词 = 完整句 —— 宽松档警告（QA Q2 兜底）、strict 档拦
const longArgs = {
  intent: "Two-stage defect detection pipeline that first discards background patches then grades candidates",
  entities: ["A", "B", "C"],
  stages: "A | show one block || B | show two blocks || C | show three blocks; these candidate boxes are merged together by iterative IoU voting here",
  figureType: "pipeline",
};
const longBullet = scoreCraft(longArgs);
assert("宽松档完整句要点降级为警告（softCodes）", longBullet.softCodes.includes("bullet-sentence") && longBullet.blockers.length === 0, JSON.stringify({ b: longBullet.blockers, s: longBullet.softCodes }));
const longStrict = scoreCraft({ ...longArgs, strict: true });
assert("strict 档非画法要点 >10 词被拦", longStrict.blockers.some((b) => b.includes("完整句")), JSON.stringify(longStrict.blockers));

// 8h) 覆盖率 50-80% 区间：宽松档警告、strict 档拦（<50% 两档都拦）
const cov60Args = {
  intent: "Two-stage detection pipeline with dual localizers and fusion",
  entities: ["Input Image", "Localizer A1", "WBF Fusion", "Entropy Map", "Reliability Score"],
  stages: "Input | show the input image panel || Localizers | show Localizer A1 block with response maps || Fusion | show WBF Fusion merging boxes",
  figureType: "pipeline",
};
const cov60 = scoreCraft(cov60Args);
assert("宽松档覆盖率 60% 降级为警告（softCodes）", cov60.softCodes.includes("entity-coverage") && cov60.blockers.length === 0, JSON.stringify({ b: cov60.blockers, s: cov60.softCodes }));
const cov60Strict = scoreCraft({ ...cov60Args, strict: true });
assert("strict 档覆盖率 60%（<80%）被拦", cov60Strict.blockers.some((b) => b.includes("覆盖率") && b.includes("Reliability Score")), JSON.stringify(cov60Strict.blockers));

// 8i) 松绑轮新增：宽松档下"以前会被连环拒"的合法简单输入应零 blocker 出图
const simpleOk = scoreCraft({
  intent: "两级检测流水线：粗筛丢背景，精判打分",
  entities: ["Input Image", "Coarse Filter", "Fine Grader"],
  stages: "Input Image | raw image || Coarse Filter | filtered candidates || Fine Grader | scored boxes",
  figureType: "pipeline",
});
assert("宽松档：无 show 句的简单合法输入零 blocker", simpleOk.blockers.length === 0, JSON.stringify(simpleOk.blockers));
assert("宽松档：该输入的降级项有警告提示（不沉默）", simpleOk.softCodes.length > 0, JSON.stringify(simpleOk.softCodes));

console.log(`\n===== 质量门测试：${pass} 过 / ${fail} 挂 =====`);
process.exit(fail ? 1 : 0);
