// weak-model-eval.mjs — 用弱模型（agnes-2.5-flash）实测三条件提示词质量对比
//
// 条件：
//   A bare        —— 只给文档上下文，裸写（模拟没装我们 skill 的用户 AI）
//   B skill       —— 给 SKILL.md 蒸馏出的提示词要求（模拟装了 skill、AI 手写）
//   C skill+craft —— agnes 产出结构化意图 → 本地 craftPrompt() 确定性组装
//
// 指标（确定性）+ agnes 评委打分（1-10）。零出图成本（纯文本）。
// 用法：node scripts/weak-model-eval.mjs [--cases 4] [--out <path>]

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const agnesKey = (() => {
  const vars = fs.readFileSync(path.join(ROOT, "..", "EasyDraw-main", ".dev.vars"), "utf8");
  return vars.match(/AGNES_API_KEYS=(\S+)/)?.[1];
})();
if (!agnesKey) { console.error("没找到 AGNES_API_KEYS"); process.exit(1); }

const API = "https://apihub.agnes-ai.com/v1/chat/completions";
const MODEL = "agnes-2.5-flash";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chat(messages, { maxTokens = 1400, temperature = 0.4 } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(API, {
        method: "POST",
        headers: { Authorization: `Bearer ${agnesKey}`, "Content-Type": "application/json", "User-Agent": "pf-weak-model-eval/0.1" },
        body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature }),
      });
      if (resp.status === 429) { await sleep(36000); continue; }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 120)}`);
      const data = await resp.json();
      const msg = data.choices?.[0]?.message;
      // 推理模型（agnes-2.5 带 reasoning_content）在小 maxTokens 下会把预算全花在推理上，
      // content 为空 —— 此时回落用推理文本（答案通常也在里面），否则 judge 恒为空串
      const content = (msg?.content || "").trim();
      if (content) return content;
      return String(msg?.reasoning_content || "").trim();
    } catch (e) {
      if (attempt === 2) throw e;
      await sleep(5000);
    }
  }
}

// ---------- 测试用例（ground truth 实体来自"用户论文上下文"）----------
// entitiesEn：实体英文基准（skill/craft 条件按我们 skill 的建议会把中文实体译成英文再出图，
// 检查器按「原文 OR 英文基准」匹配，否则正确行为被误判 0/5）
const CASES = [
  {
    name: "flowchart",
    figureType: "flowchart",
    docContext: "论文 §3.2 提出两级轨道病害检测框架：第一级是图像预处理与数据增强（含随机裁剪、亮度扰动），第二级是视觉 Transformer 分类器。框架先对输入图像预处理，再送入分类器输出病害类别。请为本节画一张方法流程图。",
    entities: ["图像预处理", "数据增强", "视觉 Transformer 分类器", "病害类别"],
    entitiesEn: ["Image Preprocessing", "Data Augmentation", "Vision Transformer Classifier", "Disease Category"],
    intent: "两级轨道病害检测框架流程图",
    structure: "两阶段串行：预处理 → 分类器 → 类别输出",
  },
  {
    name: "mechanism",
    figureType: "mechanism",
    docContext: "论文 §4.1 描述药物作用机理：化合物 X 与受体蛋白结合后抑制磷酸化通路，从而减少炎症因子释放；同时该化合物还通过第二条旁路激活抗氧化酶。请画机理插图。",
    entities: ["化合物 X", "受体蛋白", "磷酸化通路", "炎症因子", "抗氧化酶"],
    entitiesEn: ["Compound X", "Receptor Protein", "Phosphorylation Pathway", "Inflammatory Factors", "Antioxidant Enzymes"],
    intent: "化合物 X 双通路抑炎机理图",
    structure: "主通路：化合物 X → 受体蛋白 → 抑制磷酸化 → 炎症因子减少；旁路：化合物 X → 激活抗氧化酶",
  },
  {
    name: "concept",
    figureType: "concept",
    docContext: "论文 §1 引言需要一张概念图：城市轨道交通运营安全受四个方面影响——设备状态、人员操作、环境因素、管理制度，四者共同作用于运营安全这一中心。请画引言概念图。",
    entities: ["设备状态", "人员操作", "环境因素", "管理制度", "运营安全"],
    entitiesEn: ["Equipment Status", "Personnel Operations", "Environmental Factors", "Management Systems", "Operational Safety"],
    intent: "轨道运营安全四因素概念图",
    structure: "四个因素环绕中心汇聚",
  },
  {
    name: "result-style",
    figureType: "result-style",
    docContext: "论文 §5.2 实验结果：对比本文方法与三个基线（Baseline-A、Baseline-B、Ours）在三个数据集上的准确率，本文方法全面领先。用户没有提供具体数值。请画结果对比图。",
    entities: ["Baseline-A", "Baseline-B", "Ours", "Dataset-1", "Dataset-2", "Dataset-3"],
    entitiesEn: ["Baseline-A", "Baseline-B", "Ours", "Dataset-1", "Dataset-2", "Dataset-3"],
    intent: "三方法三数据集准确率对比图",
    structure: "分组柱状图，每组三个柱",
  },
];

// ---------- B 条件的 skill 蒸馏（模拟 SKILL.md 给宿主 AI 的提示词要求）----------
const SKILL_DISTILLED = `提示词要求（来自 promptFigure skill）：
- 英文提示词；科研风格：白底、扁平无阴影无渐变、克制色板 2-4 色加中性灰、留白至少四分之一
- 每个用户给的实体必须逐字出现（verbatim），不得改名、不得增删模块
- 用户没有给数字就绝不编造数字/百分比/指标；量级用视觉大小表达（画大/画小）
- 只用一种布局朝向；图内文字标签少而准（<15 个短标签）
- 避免水印、阴影、光晕、3D 装饰、照片纹理
- 输出只有提示词本身`;

// ---------- 确定性指标 ----------
const SELF_NARRATION = [
  /(?:no|without|zero)\s+(?:invented|fabricated|made[- ]?up|fake|unsupported|hallucinated)\s+(?:\w+\s+){0,2}(?:numbers?|data|values?|statistics|figures?|metrics?|results?|counts?)/i,
  /(?:never|do\s+not|don't|avoid)\s+(?:inventing|invent|fabricating|fabricate|making\s+up|make\s+up)/i,
  /(?:I\s+will\s+not|will\s+not|do\s+not|don't|never|avoid)\s+(?:invent|fabricate|make\s+up|hallucinate|forge)/i,
  /values?\s+(?:are\s+|were\s+)?(?:omitted|withheld|not\s+(?:shown|specified|provided))/i,
];
const META_WRITER_LINES = /Output only the prompt|silently check off|emit the field headers|no commentary|no notes about these constraints/i;
const FIELD_HEADERS = /Style anchor|Overall layout, Content blocks|Content blocks/i;

// 实体基准项：string → {zh, en}（双语任一命中即算覆盖）
function entityPairs(groundEntities) {
  return groundEntities.map((e) => {
    const i = CASES.findIndex((c) => c.entities.includes(e) || (c.entitiesEn || []).includes(e));
    if (i === -1) return { zh: e, en: e };
    const c = CASES[i];
    const zh = c.entities[c.entities.indexOf(e)] ?? e;
    const en = (c.entitiesEn || [])[c.entities.indexOf(e)] ?? e;
    return { zh, en };
  });
}

function analyze(prompt, groundEntities, inputText) {
  const p = prompt || "";
  const pairs = entityPairs(groundEntities);
  const hit = (pr) => p.toLowerCase().includes(pr.zh.toLowerCase()) || p.toLowerCase().includes(pr.en.toLowerCase());
  const entHit = pairs.filter(hit);
  const entMiss = pairs.filter((pr) => !hit(pr)).map((pr) => (p.toLowerCase().includes(pr.en.toLowerCase()) ? pr.en : pr.zh));
  // 编造数字启发式：提示词里的数字 token，若不在（实体+上下文+守卫样板）里出现过
  const whitelist = new Set([...(inputText.match(/\d+/g) || []), "15", "1", "2", "3", "4", "1-2", "2-4"]);
  const digits = [...new Set(p.match(/\d+(?:\.\d+)?%?/g) || [])];
  const invented = digits.filter((d) => !inputText.includes(d) && !whitelist.has(d));
  return {
    entityCoverage: `${entHit.length}/${groundEntities.length}`,
    entityMissed: entMiss,
    selfNarrationHits: SELF_NARRATION.filter((re) => re.test(p)).length,
    selfNarrationSnippets: SELF_NARRATION.filter((re) => re.test(p)).map((re) => (p.match(re) || [""])[0].slice(0, 50)),
    hexCodes: (p.match(/#[0-9a-fA-F]{6}\b/g) || []).length,
    cjkOutsideQuotes: (() => { const q = p.replace(/"[^"]*"/g, ""); return (q.match(/[\u4e00-\u9fff]/g) || []).length; })(),
    styleKeywords: ["white background", "flat", "shadow", "whitespace", "palette"].filter((k) => p.toLowerCase().includes(k)),
    metaWriterLines: META_WRITER_LINES.test(p),
    fieldHeaderDemand: FIELD_HEADERS.test(p),
    inventedNumbers: invented,
    chars: p.length,
  };
}

// ---------- 跑三条件 ----------
const results = [];
const nCases = Math.min(Number(process.argv[2]?.match(/--cases (\d+)/)?.[1] || 4), CASES.length);

for (let ci = 0; ci < nCases; ci++) {
  const c = CASES[ci];
  console.error(`\n==== case ${ci + 1}/${nCases}: ${c.name} ====`);
  const row = { name: c.name, conditions: {} };

  // —— A bare ——
  {
    const out = await chat([
      { role: "system", content: "You are an AI assistant helping a researcher illustrate their academic paper. Write ONE English image-generation prompt for the figure described. Output only the prompt text." },
      { role: "user", content: c.docContext },
    ]);
    row.conditions.bare = { prompt: out, ...analyze(out, c.entities, c.docContext) };
    console.error(`  A bare  done (${out.length} chars)`);
    await sleep(1500);
  }

  // —— B skill ——
  {
    const out = await chat([
      { role: "system", content: "You are an AI assistant helping a researcher illustrate their academic paper. You have read the promptFigure skill guidelines. Write ONE English image-generation prompt. Output only the prompt text.\n\n" + SKILL_DISTILLED },
      { role: "user", content: c.docContext },
    ]);
    row.conditions.skill = { prompt: out, ...analyze(out, c.entities, c.docContext + " " + SKILL_DISTILLED) };
    console.error(`  B skill done (${out.length} chars)`);
    await sleep(1500);
  }

  // —— C craft：agnes 出结构化意图 → 本地规则层组装 ——
  {
    const structured = await chat([
      { role: "system", content: "从论文片段中提取绘图意图。只输出 JSON（不要 markdown 代码块）：{\"intent\": \"一句话英文图主题\", \"entities\": [\"实体英文名，逐字保留术语\"], \"structure\": \"一句话英文描述布局结构\", \"figureType\": \"pipeline|architecture|flowchart|mechanism|teaser|comparison|dataflow|hierarchy|zoomin|scene|result-style\"}。硬性要求：entities 必须覆盖原文提到的全部实体，不增、不删、不改名（中文实体译成英文但保持一一对应，数量与原文一致）。" },
      { role: "user", content: c.docContext },
    ], { maxTokens: 900, temperature: 0.2 });
    let input;
    try { input = JSON.parse(structured.replace(/^```json\s*|```$/g, "").trim()); }
    catch { input = { intent: c.intent, entities: c.entities, structure: c.structure, figureType: c.figureType }; row.conditions.craft = { structuredParseFail: structured.slice(0, 200) }; }
    row.agnesExtract = input;
    const { promptcraftPath } = { promptcraftPath: path.join(ROOT, "src", "craft.mjs") };
    const { craftPrompt } = await import("file:///" + promptcraftPath.replace(/\\/g, "/"));
    const crafted = craftPrompt({
      intent: input.intent || c.intent,
      entities: (input.entities || c.entities).map((e) => String(e)),
      structure: input.structure || c.structure,
      figureType: input.figureType || c.figureType,
      lang: "en",
    });
    row.agnesExtract.warnings = crafted.warnings;
    // 实体覆盖按「实际喂给 craft 的实体」评——craft 的契约是逐字呈现输入实体；
    // 提取丢没丢实体（c.entities → input.entities 数量差）单独记 extractionCountMismatch 暴露弱模型提取质量
    const fedEntities = (input.entities || c.entities).map((e) => String(e));
    const extraction = {
      groundCount: c.entities.length,
      fedCount: fedEntities.length,
      countMismatch: fedEntities.length !== c.entities.length,
      fedEntities,
    };
    row.conditions.craft = { ...(row.conditions.craft || {}), extraction, prompt: crafted.prompt, ...analyze(crafted.prompt, fedEntities, c.docContext) };
    console.error(`  C craft done (${crafted.prompt.length} chars, warnings=${crafted.warnings.length})`);
    await sleep(1500);
  }

  results.push(row);
}

// ---------- agnes 评委（带 ground truth 评分；同模型三条件横向可比）----------
console.error("\n==== judge round ====");
const RUBRIC = `你是科研配图提示词评审。对下面这条"将发给图模型的英文提示词"按 5 维打分（每维 0-2，总分 10）：
1 结构忠实（要求的实体/结构是否覆盖、有无编造模块——对照给出的基准实体清单与结构要求）
2 学术风格（白底扁平、克制色板、留白）
3 无编造（没有用户没给的数字/指标/命名）
4 标签经济（图内文字少而准，无标签爆炸）
5 图模型可用性（提示词是给图模型的画面描述——若混入"只输出提示词/检查清单/字段头要求"等写手指令则此维 0 分）
只输出：总分/10 + 每维分数 + 一行判词。`;

for (const row of results) {
  const c = CASES.find((x) => x.name === row.name);
  const groundNote = `判定依据（唯一标准）——原文：${c.docContext}\n基准实体（中/英对照，出现其中一种表述即算覆盖）：${c.entities.map((z, i) => `${z} / ${(c.entitiesEn || [])[i] || z}`).join("；")}。\n基准结构：${c.structure}\n注意：原文中明确提到的更细粒度实体（子步骤、输入等）出现在提示词里是忠实还原，不算编造；基准清单只用于判断"有没有漏"。`;
  for (const [cond, obj] of Object.entries(row.conditions)) {
    if (!obj.prompt) continue;
    try {
      const verdict = await chat([
        { role: "system", content: RUBRIC },
        { role: "user", content: groundNote + "\n\n待评提示词：\n" + obj.prompt.slice(0, 3000) },
      ], { maxTokens: 1600, temperature: 0.1 });
      obj.judge = verdict.slice(0, 300);
      row.conditions[cond] = obj;
    } catch (e) { obj.judge = "judge-fail: " + e.message.slice(0, 80); }
    await sleep(1500);
  }
  console.error(`  judged ${row.name}`);
}

// ---------- 汇总 ----------
const outPath = process.argv[2]?.match(/--out (\S+)/)?.[1] || path.join(ROOT, "..", "temp", `weak-model-eval-${Date.now()}.json`);
fs.writeFileSync(outPath, JSON.stringify({ model: MODEL, cases: results }, null, 2));

console.log("\n========== 汇总 ==========");
console.log("case        cond   实体覆盖  自省句  hex  CJK  写手指令  七字段头  疑似编造数字  评委");
for (const r of results) {
  for (const [cond, o] of Object.entries(r.conditions)) {
    if (!o.prompt) { console.log(`${r.name.padEnd(11)} ${cond.padEnd(6)} (无产物)`); continue; }
    const score = (o.judge?.match(/(\d+)\s*\/\s*10/) || [])[1] || "?";
    const flag = o.extraction?.countMismatch ? " ⚠️提取丢实体" : "";
    console.log(
      `${r.name.padEnd(11)} ${cond.padEnd(6)} ${o.entityCoverage.padEnd(8)} ${String(o.selfNarrationHits).padEnd(6)} ${String(o.hexCodes).padEnd(4)} ${String(o.cjkOutsideQuotes).padEnd(4)} ${String(o.metaWriterLines).padEnd(8)} ${String(o.fieldHeaderDemand).padEnd(8)} ${o.inventedNumbers.join("|").padEnd(12)} ${score}${flag}`
    );
  }
}
console.log(`\n明细: ${outPath}`);
