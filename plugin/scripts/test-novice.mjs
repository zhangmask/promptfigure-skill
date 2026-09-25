// test-novice.mjs — 小白增强回归（2026-09-22 "数模小白用不好"）：
// 覆盖：中文分句/候选实体抽取（extract.mjs）、pf plan 状态路由（plan.mjs）、craft 拒绝改法示范（quality.fixExamples）。
import { splitSentences, candidateEntities } from "../src/extract.mjs";
import { buildPlan, sectionOptions, suggestFigureType, figureTypeBrief } from "../src/plan.mjs";
import { scoreCraft, fixExamples } from "../src/quality.mjs";
import { craftPrompt } from "../src/craft.mjs";

const results = [];
const assert = (name, cond, extra = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "✅" : "❌"} ${name}${cond ? "" : " —— " + extra}`);
};

// ---- splitSentences：中文分句（此前只认 .!?，中文论文糊成一坨）----
const zhText = "本文建立了灰色预测模型。其次引入蒙特卡洛方法进行检验；最后给出灵敏度分析！结果稳定。";
const zhSents = splitSentences(zhText);
assert("中文多句切成 4 句", zhSents.length === 4, JSON.stringify(zhSents));
assert("中文分句保留句尾标点", zhSents[0].endsWith("。"), zhSents[0]);
assert("中文分句无空段", zhSents.every((s) => s.trim().length > 0));

const enSents = splitSentences("Fusion improves recall. The PSNR gain is 0.8 dB. Training takes 50 epochs.");
assert("英文分句不受影响", enSents.length === 3, JSON.stringify(enSents));
assert("小数点不被切", enSents[1].includes("0.8 dB"), enSents[1]);
assert("缩写 vs. 不被切", splitSentences("A outperforms B vs. baseline. Second sentence.").length === 2);

// ---- candidateEntities：中文论文（此前正则只认英文大写词 → 候选为空）----
const zhPaper = `本文针对交通流量预测问题，建立了灰色预测模型与神经网络组合方法。
灰色预测模型用于短期趋势，神经网络用于修正残差。文中设计了两种对比方案，
并与时间序列方法作比较。灵敏度分析表明灰色预测模型参数对结果影响较小，
组合方法在三个测试集上均优于单一方法。`;
const zhEnts = candidateEntities(zhPaper);
assert("中文后缀术语被抽到", zhEnts.includes("灰色预测模型") && zhEnts.includes("神经网络"), JSON.stringify(zhEnts));
assert("中文候选非空且 ≤12", zhEnts.length > 0 && zhEnts.length <= 12, JSON.stringify(zhEnts));

const enEnts = candidateEntities("The WBF module merges TTA boxes. WBF fuses candidate boxes from multi-view TTA.");
assert("英文缩写术语仍被抽到", enEnts.includes("WBF") && enEnts.includes("TTA"), JSON.stringify(enEnts));

// ---- 多语言（2026-09-22 第二轮去写死：script-run 统计抽取，非中文也有候选）----
const ja = candidateEntities("本手法は二段階アーキテクチャを採用する。粒子群最適化によりパラメータを探索する。粒子群最適化は収束が速い。");
assert("日语重复术语被抽到", ja.includes("粒子群最適化"), JSON.stringify(ja));
const ko = candidateEntities("검출 기법 설계에서 데이터 증강 전략을 사용한다. 데이터 증강 전략은 랜덤 크롭을 포함한다.");
assert("韩语高频词被抽到", ko.includes("데이터") && ko.includes("증강"), JSON.stringify(ko));
const ru = candidateEntities("Предложен метод градиентного спуска. Метод градиентного спуска сходится быстро.");
assert("俄语高频词被抽到", ru.length > 0, JSON.stringify(ru));

// 分句多语言
assert("阿拉伯语终结符分句", splitSentences("النتيجة الأولى جيدة۔ النتيجة الثانية سيئة۔").length === 2);
const esSents = splitSentences("La precisión alcanza 91.3%. Supera la línea base en 2.4 puntos.");
assert("西语小数保护分句", esSents.length === 2 && esSents[0].includes("91.3%"), JSON.stringify(esSents));

// WORDS 多语言：带空格文字按词计（此前韩/俄/西语 intent 被算 0 词误拦）
const koGate = scoreCraft({
  intent: "2단계 검출 파이프라인: 전처리 후 결함 분류",
  entities: "전처리,결함 분류,데이터 증강",
  stages: "전처리 | show 이미지 증강 || 결함 분류 | show 점수 || 결과 | show 비교",
  figureType: "pipeline", hasAt: true,
});
assert("韩语 intent 不被误拦", !koGate.blockers.some((b) => b.includes("intent")), JSON.stringify(koGate.blockers));
const jaGate = scoreCraft({
  intent: "粒子群最適化による二段階検出パイプラインの全体像",
  entities: "粒子群最適化,前処理,分類",
  stages: "前処理 | show 画像強化 || 最適化 | show 収束 || 分類 | show スコア",
  figureType: "pipeline", hasAt: true,
});
assert("日语 intent 不被误拦", !jaGate.blockers.some((b) => b.includes("intent")), JSON.stringify(jaGate.blockers));

// 整句要点门多语言化：韩语整句（<14 词但句末带标点）——宽松档警告、strict 档拦（子智能体 B 渗透实测发现的漏检）
const koSentArgs = {
  intent: "2단계 검출 파이프라인: 전처리 후 결함 분류",
  entities: "전처리,결함 분류,데이터 증강",
  stages: "전처리 | show 이미지 증강 || 분류 | 첫 단계에서 이미지 전처리와 증강을 수행합니다. || 결과 | show 비교",
  figureType: "pipeline", hasAt: true,
};
const koSentGate = scoreCraft(koSentArgs);
assert("宽松档韩语整句要点降级为警告（softCodes）", koSentGate.softCodes.includes("bullet-sentence"), JSON.stringify(koSentGate.softCodes));
const koSentStrict = scoreCraft({ ...koSentArgs, strict: true });
assert("strict 档韩语整句要点被拦（句末标点判据）", koSentStrict.codes.includes("bullet-sentence"), JSON.stringify(koSentStrict.codes));
const enLabelGate = scoreCraft({
  intent: "Two-stage defect detection pipeline: coarse filter discards background, fine grader scores candidates",
  entities: "Input Image,Coarse Filter,Fine Grader",
  stages: "Input Image | show 3 thumbnails; no border || Coarse Filter | discard background; keep candidates || Fine Grader | show per-patch scoring grid; score map",
  figureType: "pipeline", hasAt: true,
});
assert("英文短标签（无句号）不误拦", !enLabelGate.codes.includes("bullet-sentence"), JSON.stringify(enLabelGate.codes));

// 高频 n-gram 兜底 + 停用词过滤
const stopText = "我们通过分析可以发现，通过计算可以得到结果。我们通过分析还可以发现规律。";
const stopEnts = candidateEntities(stopText);
assert("功能词不进候选", !stopEnts.some((w) => ["我们", "通过", "可以", "发现", "结果"].includes(w)), JSON.stringify(stopEnts));

// ---- sectionOptions / suggestFigureType / figureTypeBrief ----
const blocks = [
  { type: "heading", secPath: "1", text: "问题重述" },
  { type: "para", secPath: "1", para: 1, text: "…" },
  { type: "heading", secPath: "4", text: "模型建立与求解" },
  { type: "heading", secPath: "0", text: "摘要" },
];
const opts = sectionOptions(blocks);
assert("章节选项来自真实 heading", opts.length === 2 && opts[0].at === "§1" && opts[1].title === "模型建立与求解", JSON.stringify(opts));
assert("摘要 §0 不进选项", opts.every((o) => o.at !== "§0"));

assert("goal=数据结果 → result-style", suggestFigureType("展示准确率对比结果")?.type === "result-style");
assert("goal=流程 → pipeline", suggestFigureType("画一下方法的流程")?.type === "pipeline");
assert("goal=机理 → mechanism", suggestFigureType("温度如何影响反应速率的机理")?.type === "mechanism");
assert("goal=空 → null", suggestFigureType("") === null);
assert("figureTypeBrief 中文", figureTypeBrief("pipeline") === "流程图" && figureTypeBrief("unknown") === "示意图");

// ---- buildPlan：四种状态路由 ----
const p1 = buildPlan({}, {});
assert("无 key → login 引导", p1.stage === "login" && p1.steps[0].cmd.startsWith("pf login"), JSON.stringify(p1.steps));
assert("无 key 用户话术提到 key", p1.userLines.some((l) => l.includes("key")));

const p2 = buildPlan({ cfg: { key: "pf_x" } }, {});
assert("无文档 → open 引导", p2.stage === "open" && /pf open/.test(p2.steps[0].cmd));
assert("无文档话术通俗（提到 Word/PDF）", p2.userLines.some((l) => l.includes("Word") || l.includes("PDF")));

const meta = {
  blocks: [
    { type: "heading", secPath: "1", text: "问题重述" },
    { type: "heading", secPath: "4", text: "模型建立与求解" },
    { type: "para", secPath: "4", para: 1, text: "对 x 的论述。" },
  ],
  figures: {},
};
const p3 = buildPlan({ docId: "d1", meta, cfg: { key: "pf_x" } }, {});
assert("无图 → interview 三问", p3.stage === "interview", p3.stage);
assert("问题卡带真实章节编号", p3.userLines.some((l) => l.includes("1=问题重述")), JSON.stringify(p3.userLines));
assert("问题卡问图意/要素", p3.userLines.some((l) => l.includes("②")) && p3.userLines.some((l) => l.includes("③")));
assert("步骤从 distill 开始", p3.steps[0].cmd.includes("pf distill"));
assert("步骤含确认卡环节", p3.steps.some((s) => s.cmd.includes("确认")));
assert("步骤含 render standard", p3.steps.some((s) => s.cmd.includes("--model standard")));
assert("问题卡带 0=说不清/全文选项", p3.userLines.some((l) => l.includes("0=说不清")), JSON.stringify(p3.userLines));
assert("distill 步骤说明用户回 0 的走法", p3.steps[0].why.includes("回 0"));

const p3g = buildPlan({ docId: "d1", meta, cfg: { key: "pf_x" }, goal: "展示各方案准确率对比结果" }, {});
assert("goal=数据 → 话术含精确数值图警告", p3g.userLines.some((l) => l.includes("精确数值")), JSON.stringify(p3g.userLines));
assert("goal=数据 → 图型建议标注为可推翻的猜测", p3g.userLines.some((l) => l.includes("结果风格图") && l.includes("推翻")), JSON.stringify(p3g.userLines));

const metaFig = {
  blocks: meta.blocks,
  figures: {
    f1: { figureId: "f1", at: "§4 ¶1", versions: [{ model: "standard", at: "2026-09-22T00:00:00Z" }], activeFixes: [] },
  },
};
const p4 = buildPlan({ docId: "d1", meta: metaFig, cfg: { key: "pf_x" } }, { readReview: () => ({}) });
assert("有图 → 路由到 next 阶段", p4.stage === "review", p4.stage);
assert("有图话术报进度", p4.userLines.some((l) => l.includes("1 张") && l.includes("定稿")), JSON.stringify(p4.userLines));
assert("有图步骤是可执行命令", p4.steps[0].cmd.startsWith("pf "), p4.steps[0].cmd);

// ---- scoreCraft codes + fixExamples（松绑轮：宽松档降级 / strict 档全拦）----
const badArgs = { intent: "流程图", entities: "A,B", stages: "X |  || Y | ", figureType: "pipeline", hasAt: false };
const bad = scoreCraft(badArgs);
assert("codes 与 blocker 一一对应", bad.codes.length === bad.blockers.length && bad.codes.length >= 4, JSON.stringify(bad.codes));
assert("宽松档结构性项硬拦（no-at/intent-generic/stage-empty/coverage<50%）", ["no-at", "intent-generic", "stage-empty", "entity-coverage"].every((c) => bad.codes.includes(c)), JSON.stringify(bad.codes));
assert("宽松档 intent-short/entities-few 降级 softCodes", ["intent-short", "entities-few"].every((c) => bad.softCodes.includes(c)), JSON.stringify(bad.softCodes));
const badStrict = scoreCraft({ ...badArgs, strict: true });
assert("strict 档 codes 含 no-at/intent-short/entities-few", ["no-at", "intent-short", "entities-few"].every((c) => badStrict.codes.includes(c)), JSON.stringify(badStrict.codes));

const ex = fixExamples(badStrict.codes);
assert("fixExamples 按 code 出示范", ex.length >= 4 && ex.every((l) => l.startsWith("🧭")));
assert("示范含可复制素材（stages 示范有 || 分隔）", ex.some((l) => l.includes("||")));
assert("未知 code 不炸", fixExamples(["nope"]).length === 0);

const good = scoreCraft({
  intent: "Two-stage defect detection pipeline: coarse filter discards background, fine grader scores candidates",
  entities: "Input Image,Coarse Filter,Fine Grader",
  stages: "Input Image | show 3 thumbnails || Coarse Filter | discard background; keep candidates || Fine Grader | show per-patch scoring grid; score map",
  figureType: "pipeline",
  hasAt: true,
});
assert("合格输入零 blocker", good.blockers.length === 0 && good.score >= 90, JSON.stringify(good));

// ---- 实体双语对照（2026-09-22 用户拍板补差距②：英文卡面 + 原文溯源两不误）----
const { splitEntityPair, checkEntitySource } = await import("../src/quality.mjs");
const ep1 = splitEntityPair("Weighted Box Fusion|加权框融合");
assert("对照格式解析出英文侧/原文侧", ep1.label === "Weighted Box Fusion" && ep1.src === "加权框融合", JSON.stringify(ep1));
const ep2 = splitEntityPair("Plain Entity");
assert("普通实体不受影响", ep2.label === "Plain Entity" && ep2.src === null, JSON.stringify(ep2));
const pairGate = scoreCraft({
  intent: "Weighted box fusion pipeline for multi-view detection with clear data flow",
  entities: "WBF|加权框融合,Input Image,Score Map",
  stages: "Input Image | show thumbnails || WBF | merge boxes; keep verbatim || Score Map | heatmap overlay",
  figureType: "pipeline",
  hasAt: true,
});
assert("对照实体按英文侧查覆盖率（零 blocker）", !pairGate.blockers.some((b) => b.includes("覆盖率")), JSON.stringify(pairGate));
const zhPaperText = "本文采用加权框融合策略整合多视角检测框，输入图像先经过预处理。";
const pairSrc = checkEntitySource({ entities: ["WBF|加权框融合", "Ghost|幽灵模块"], sourceText: zhPaperText });
assert("对照格式：原文侧命中 → 计入 checked 而非 skipped", pairSrc.checked.length === 2 && pairSrc.skipped.length === 0, JSON.stringify(pairSrc));
assert("对照格式：原文侧没命中 → missing 点名", pairSrc.missing.length === 1 && pairSrc.missing[0].includes("幽灵模块"), JSON.stringify(pairSrc));
const craftPair = craftPrompt({ intent: "Weighted box fusion pipeline for multi-view detection flow", entities: ["WBF|加权框融合", "Input Image", "Score Map"], figureType: "pipeline", lang: "en" });
assert("craft 提示词用英文侧标签", craftPair.prompt.includes('"WBF"') && !craftPair.prompt.includes("加权框融合"), craftPair.prompt.slice(0, 200));
assert("对照实体不触发中文乱码警告", !craftPair.warnings.some((w) => w.includes("实体含中文")), JSON.stringify(craftPair.warnings));

// ---- 字号物理核验（journal.fontCheck，2026-09-22 用户拍板补差距③）----
const { fontCheck } = await import("../src/journal.mjs");
const fc1 = fontCheck({ journal: "nature", preset: "double-column", pngW: 2560 });
assert("nature 双栏 5pt@183mm/2560px → 最小文字 25px", fc1 && fc1.minTextPx === 25 && fc1.minPt === 5, JSON.stringify(fc1));
const fc2 = fontCheck({ journal: "ieee", preset: "single-column", pngW: 1024 });
assert("ieee 单栏 8pt@88mm/1024px → 最小文字 33px", fc2 && fc2.minTextPx === 33, JSON.stringify(fc2));
assert("未知期刊/缺像素宽 → null（不核验）", fontCheck({ journal: "x", pngW: 100 }) === null && fontCheck({ journal: "nature" }) === null);

// ---- 对照格式门禁收紧（2026-09-22 渗透实测：蹭真词/空侧/伪造原文侧）----
const badPairGate = scoreCraft({
  intent: "Bilingual pair malformed side test for the quality gate",
  entities: "Label|,Input Image,Score Map",
  stages: "Input Image | show thumbnails || Label | show things || Score Map | heatmap",
  figureType: "pipeline",
  hasAt: true,
});
assert("空侧残缺对照 → entity-pair-bad blocker", badPairGate.codes.includes("entity-pair-bad"), JSON.stringify(badPairGate.codes));
const fakePair = checkEntitySource({ entities: ["Universe|阶段", "Ghost|幽灵模块"], sourceText: zhPaperText });
assert("伪造对照（原文侧没命中）→ blocker 硬拦", !!fakePair.blocker && fakePair.blocker.includes("Universe|阶段"), JSON.stringify(fakePair));
const realPair = checkEntitySource({ entities: ["WBF|加权框融合"], sourceText: zhPaperText });
assert("真实对照不误伤", !realPair.blocker && realPair.checked.length === 1, JSON.stringify(realPair));

// ---- 期刊画幅规范（journal.mjs，2026-09-22 竞品差距①：academic-figure-skill 的期刊先验）----
const { journalSentence, journalPresetHint } = await import("../src/journal.mjs");
const jn = journalSentence("nature");
assert("nature 期刊句带 89/183mm 印刷宽度", !!jn && jn.includes("89 mm") && jn.includes("183 mm"), jn || "null");
assert("未知期刊返回 null（不注入）", journalSentence("not-a-journal") === null);
const jp = journalPresetHint("nature", "single-column");
assert("期刊×预设联动提示带单栏宽", !!jp && jp.includes("89 mm"), jp || "null");

// ---- multi-panel 图型（竞品差距②：期刊主图最常见的 (a)(b)(c) 组合形态此前缺失）----
const { FIGURE_CATALOG } = await import("../src/figure-catalog.mjs");
const mp = FIGURE_CATALOG.find((t) => t.id === "multi-panel");
assert("multi-panel 已入目录且带布局契约", !!mp && mp.guide.includes("(a), (b), (c)") && mp.guide.includes("shared legend"), mp ? mp.guide.slice(0, 80) : "missing");
const mpGate = scoreCraft({
  intent: "Composite figure: overview of the two-stage method plus a zoom of the fine grader",
  entities: ["Full Pipeline", "Coarse Filter", "Fine Grader", "Score Map"],
  stages: "Panel (a) Full Pipeline | show the two-stage chain end to end with Coarse Filter and Fine Grader || Panel (b) Fine Grader | zoom into grader internals; attention blocks || Panel (c) Score Map | show a small heat-map thumbnail",
  figureType: "multi-panel",
});
assert("multi-panel 示例过质量门", mpGate.blockers.length === 0, JSON.stringify(mpGate.blockers));

// ---- craftPrompt 注入期刊契约（差距①落地验证）----
const jr = craftPrompt({
  intent: "Two-stage defect detection pipeline overview for journal submission",
  entities: "Input Image, Coarse Filter, Fine Grader, Defect Map",
  stages: "Input Image | show a strip of thumbnails || Coarse Filter | discard background patches || Fine Grader | score candidates || Defect Map | small heat-map thumbnail",
  figureType: "pipeline", preset: "double-column", journal: "nature",
});
assert("craftPrompt 注入 nature 印刷宽度契约", jr.prompt.includes("89 mm"), jr.prompt.slice(0, 200));

const fail = results.filter((r) => !r.ok).length;
console.log(`\n===== test-novice: ${results.length - fail}/${results.length} ${fail ? "FAIL" : "PASS"} =====`);
process.exitCode = fail ? 1 : 0;
