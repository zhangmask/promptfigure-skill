// workflow.mjs — 工作流状态库（2026-10-17 用户拍板"服务端只做 API，状态标记放本地"）
// 🔴 解决什么：升级/审核类工作流过去只活在技能文档里，弱模型做没做全凭自觉——
//    现在每一步必须 pf workflow done 落一条标记、审查逐维落记录，
//    status/check 随时回答"做到哪一步、哪些没做、哪些审查漏了"（硬性清单，不是文档）。
// 存储：~/.promptfigure/projects/<docId>/workflow.json（单活跃工作流，历史走 events.jsonl）
import { readWorkflow, writeWorkflow } from "./store.mjs";
import { appendEvent } from "./events.mjs";

export const BANNED_ENHANCE = /超分|超分辨率|去噪|去模糊|清晰度提升|提升清晰度|修复|super.?resolution|denoise|restor|sharpen/i;

// 🔴 禁词判定只扫 enhancement（已做动作声明），且豁免弃权段——"有意不做：不超分不重绘"
// 是诚实声明不是违规（2026-10-17 实测误杀）。按分隔符切段，弃权开头的段直接放过。
const NEGATION = /^(有意不做|不做|没做|未做|没|未|无|非|禁止|避免|拒绝|无需)/;
export function bannedEnhanceHits(text) {
  const t = String(text || "");
  const cut = t.indexOf("有意不做");
  const head = cut >= 0 ? t.slice(0, cut) : t;
  const hits = [];
  for (const seg of head.split(/[；;。，,\n]/)) {
    const s = seg.trim();
    if (!s || NEGATION.test(s)) continue;
    if (BANNED_ENHANCE.test(s)) hits.push(s.slice(0, 30));
  }
  return hits;
}

// ---- 工作流模板（步骤清单 = 硬性清单的定义源；改流程先改这里再改技能文档）----
export const TEMPLATES = {
  upgrade: {
    title: "图表升级（优化已有图 / 整文批量升级）",
    reviews: ["F", "G", "H"], // F=视觉对齐 G=合理分段 H=按原文思维优化
    acceptance: true,
    steps: [
      { id: "context",   title: "原文定位：图注论点 + 首尾句引用", evidence: true },
      { id: "genre",     title: "体裁判定：comparison / pipeline / original 三选一 + 理由" },
      { id: "panels",    title: "panel 清单 + 布局声明（组合图必做；单图可 skip）", skippable: true },
      { id: "materials", title: "素材就位：原图/裁片/数据文件路径落定" },
      { id: "produce",   title: "生成产物：产物文件路径写进 note" },
      { id: "selfcheck", title: "亲眼核验：打开产物逐条看（尺寸/文字/对齐）", evidence: true },
      { id: "review",    title: "审查三维 F/G/H（由 pf workflow review 逐维自动完成）", auto: "review" },
      { id: "acceptance",title: "acceptance 四项留痕（由 pf workflow acceptance 自动完成）", auto: "acceptance" },
      { id: "deliver",   title: "台账 + 交付（round-vN / figure-ledger 更新，交付前必须 pf workflow check 全绿）" },
    ],
  },
  review: {
    title: "成图审核（阶段 4）",
    reviews: ["A", "B", "C", "D", "E"],
    acceptance: false,
    steps: [
      { id: "collect", title: "收集待审图清单（pf board / review status）" },
      { id: "dims",    title: "逐维审查（由 pf workflow review 逐维自动完成）", auto: "review" },
      { id: "report",  title: "审核卡输出 + 裁决写回（pf qa / pf review resolve）" },
    ],
  },
};

const DIM_NAMES = {
  A: "结构完整", B: "文字准确", C: "风格一致", D: "信息密度", E: "母题一致",
  F: "视觉对齐", G: "合理分段", H: "按原文思维优化",
};

export function templateOf(kind) {
  const t = TEMPLATES[kind];
  if (!t) {
    throw new Error(`未知工作流类型 "${kind}"（可选：${Object.keys(TEMPLATES).join(" / ")}）`);
  }
  return t;
}

export function readActive(docId) {
  return readWorkflow(docId); // null = 没有活跃工作流
}

export function init(docId, { kind, goal = "" }) {
  const t = templateOf(kind);
  const cur = readWorkflow(docId);
  if (cur && !isComplete(cur)) {
    const doneN = cur.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
    throw new Error(`已有未完结工作流（${cur.kind}，${doneN}/${cur.steps.length} 步）——pf workflow status 看进度；确要重开加 --reset`);
  }
  const wf = {
    kind, goal, templateRev: 1,
    createdAt: new Date().toISOString(),
    steps: t.steps.map((s) => ({ id: s.id, status: "pending", note: "", evidence: "", at: null })),
    reviews: [], // {dim, verdict, evidence, at}
    acceptance: null, // {story, segmentation, alignment, enhancement, at}
    updatedAt: new Date().toISOString(),
  };
  writeWorkflow(docId, wf);
  appendEvent(docId, "workflow.init", { kind, goal });
  return wf;
}

export function reset(docId, opts) {
  const cur = readWorkflow(docId);
  if (cur) appendEvent(docId, "workflow.reset", { kind: cur.kind });
  // init 的"已有活跃"检查基于文件，先删再建
  writeWorkflow(docId, null);
  return init(docId, opts);
}

function stepDef(t, id) {
  return t.steps.find((s) => s.id === id);
}

export function done(docId, stepId, { note = "", evidence = "" } = {}) {
  const wf = readActive(docId) || throwNone();
  const t = templateOf(wf.kind);
  const def = stepDef(t, stepId) || throwStep(stepId, t);
  if (def.auto) {
    throw new Error(`步骤 "${stepId}" 不用手动标记——它由 ${def.auto === "review" ? "pf workflow review" : "pf workflow acceptance"} 的记录自动完成`);
  }
  if (!note.trim()) throw new Error(`--note 必填：这一步的结论/产物是什么。空标记 = 又回到凭感觉`);
  if (def.evidence && !evidence.trim()) {
    throw new Error(`步骤 "${stepId}" 需要 --evidence（${def.title}——证据留痕，防止"读过/看过"是编的）`);
  }
  const st = wf.steps.find((s) => s.id === stepId);
  if (st.status === "done") throw new Error(`步骤 "${stepId}" 已标记完成（${st.at}）——重复标记无需操作`);
  const blocker = firstIncomplete(wf, t, stepId);
  if (blocker) {
    throw new Error(`顺序被拦："${blocker.id}" 还没完成（${blocker.title}）——先做它再回来。硬性清单不允许跳步`);
  }
  st.status = "done"; st.note = note.trim(); st.evidence = evidence.trim(); st.at = new Date().toISOString();
  wf.updatedAt = st.at;
  writeWorkflow(docId, wf);
  appendEvent(docId, "workflow.done", { step: stepId });
  return wf;
}

export function skip(docId, stepId, { reason = "" } = {}) {
  const wf = readActive(docId) || throwNone();
  const t = templateOf(wf.kind);
  const def = stepDef(t, stepId) || throwStep(stepId, t);
  if (!def.skippable) throw new Error(`步骤 "${stepId}" 不允许跳过（${def.title}）`);
  if (!reason.trim()) throw new Error(`--reason 必填：为什么这步不适用。无理由跳过 = 放水`);
  const st = wf.steps.find((s) => s.id === stepId);
  st.status = "skipped"; st.note = reason.trim(); st.at = new Date().toISOString();
  wf.updatedAt = st.at;
  writeWorkflow(docId, wf);
  appendEvent(docId, "workflow.skip", { step: stepId, reason: reason.trim() });
  return wf;
}

export function review(docId, { dim, verdict, evidence = "" }) {
  const wf = readActive(docId) || throwNone();
  const t = templateOf(wf.kind);
  const D = String(dim || "").toUpperCase();
  if (!t.reviews.includes(D)) {
    throw new Error(`维度 "${dim}" 不属于本工作流（${wf.kind} 要求审查：${t.reviews.join("/")}）`);
  }
  const V = String(verdict || "").toUpperCase();
  if (!["PASS", "FAIL"].includes(V)) throw new Error(`--verdict 只认 PASS / FAIL`);
  if (!evidence.trim()) {
    throw new Error(`--evidence 必填：你在图里看到的、支撑判定的具体证据（元素个数/位置/引用原文），"看起来没问题" = 无效审查`);
  }
  const rec = { dim: D, verdict: V, evidence: evidence.trim(), at: new Date().toISOString() };
  const prev = wf.reviews.findIndex((r) => r.dim === D);
  if (prev >= 0) wf.reviews[prev] = rec; // 重审覆盖：改判以最新为准，历史在事件流
  else wf.reviews.push(rec);
  wf.updatedAt = rec.at;
  // auto 步骤联动：所有要求维度都有记录且无 FAIL → 对应 auto 步骤置 done
  for (const def of t.steps.filter((s) => s.auto === "review")) {
    const st = wf.steps.find((s) => s.id === def.id);
    const all = t.reviews.every((d) => wf.reviews.some((r) => r.dim === d));
    const anyFail = wf.reviews.some((r) => t.reviews.includes(r.dim) && r.verdict === "FAIL");
    if (all && !anyFail && st.status === "pending") { st.status = "done"; st.note = `F/G/H 三维全 PASS`; st.at = rec.at; }
    if (anyFail && st.status === "done") { st.status = "pending"; st.note = ""; } // 新 FAIL 打回
  }
  writeWorkflow(docId, wf);
  appendEvent(docId, "workflow.review", { dim: D, verdict: V });
  return wf;
}

export function acceptance(docId, fields) {
  const wf = readActive(docId) || throwNone();
  const t = templateOf(wf.kind);
  if (!t.acceptance) throw new Error(`工作流 ${wf.kind} 不需要 acceptance 留痕`);
  const need = ["story", "segmentation", "alignment", "enhancement"];
  const miss = need.filter((k) => !String(fields[k] || "").trim());
  if (miss.length) throw new Error(`acceptance 缺字段：${miss.join(", ")}——四项（story/segmentation/alignment/enhancement）必填`);
  const hits = bannedEnhanceHits(fields.enhancement);
  if (hits.length) {
    throw new Error(`acceptance.enhancement 含白名单外动作（"${hits[0]}"——清晰度提升/内容重绘类措辞）——优化白名单只许显示性增强（对比度拉伸等，须声明参数）/结构编辑；没做就如实写"有意不做：…"`);
  }
  wf.acceptance = { story: fields.story.trim(), segmentation: fields.segmentation.trim(), alignment: fields.alignment.trim(), enhancement: fields.enhancement.trim(), at: new Date().toISOString() };
  wf.updatedAt = wf.acceptance.at;
  for (const def of t.steps.filter((s) => s.auto === "acceptance")) {
    const st = wf.steps.find((s) => s.id === def.id);
    if (st.status === "pending") { st.status = "done"; st.note = "四项已留痕"; st.at = wf.acceptance.at; }
  }
  writeWorkflow(docId, wf);
  appendEvent(docId, "workflow.acceptance", {});
  return wf;
}

// ---- 状态推导 ----
export function firstIncomplete(wf, t, beforeId = null) {
  const idx = beforeId ? t.steps.findIndex((s) => s.id === beforeId) : t.steps.length;
  for (let i = 0; i < idx; i++) {
    const st = wf.steps.find((s) => s.id === t.steps[i].id);
    if (st.status === "pending") return { id: st.id, title: t.steps[i].title };
  }
  return null;
}

export function pendingReviews(wf, t) {
  return t.reviews.filter((d) => !wf.reviews.some((r) => r.dim === d));
}

export function failedReviews(wf, t) {
  return wf.reviews.filter((r) => t.reviews.includes(r.dim) && r.verdict === "FAIL");
}

export function missing(wf) {
  const t = templateOf(wf.kind);
  const out = { steps: [], reviews: [], failed: [], acceptance: false };
  for (const def of t.steps) {
    const st = wf.steps.find((s) => s.id === def.id);
    if (st.status === "pending") out.steps.push({ id: def.id, title: def.title, auto: def.auto || null });
  }
  out.reviews = pendingReviews(wf, t);
  out.failed = failedReviews(wf, t).map((r) => r.dim);
  if (t.acceptance && !wf.acceptance) out.acceptance = true;
  return out;
}

export function isComplete(wf) {
  const m = missing(wf);
  return !m.steps.length && !m.reviews.length && !m.failed.length && !m.acceptance;
}

// ---- 渲染 ----
const ICON = { done: "✅", skipped: "⏭️ ", pending: "⬜" };

export function renderStatus(wf) {
  const t = templateOf(wf.kind);
  const lines = [];
  lines.push(`════ 工作流 · ${wf.kind}（${t.title}）${wf.goal ? ` · 目标：${wf.goal}` : ""} ════`);
  for (const def of t.steps) {
    const st = wf.steps.find((s) => s.id === def.id);
    const head = `${ICON[st.status]} ${def.title}`;
    const tail = st.status === "done" ? ` —— ${st.note}${st.evidence ? ` ｜ 证据：${trunc(st.evidence, 60)}` : ""}`
      : st.status === "skipped" ? ` —— 跳过：${st.note}` : "";
    lines.push(`  ${head}${tail}`);
  }
  const rev = t.reviews.map((d) => {
    const r = wf.reviews.find((x) => x.dim === d);
    return r ? `${d}(${DIM_NAMES[d]}) ${r.verdict === "PASS" ? "✅" : "❌ FAIL"}` : `${d}(${DIM_NAMES[d]}) ⬜ 未审`;
  });
  lines.push(`  审查记录：${rev.join("  ")}`);
  if (t.acceptance) {
    lines.push(`  acceptance：${wf.acceptance ? `✅ 已留痕（${trunc(wf.acceptance.story, 40)}…）` : "⬜ 未留痕（pf workflow acceptance）"}`);
  }
  const m = missing(wf);
  if (isComplete(wf)) {
    lines.push(`\n🎉 全部完成——pf workflow check 复核后交付。`);
  } else {
    const next = m.steps[0];
    lines.push(`\n→ 下一步（唯一）：`);
    if (next) {
      if (next.auto === "review") lines.push(`  pf workflow review --dim ${m.reviews[0] || "?"} --verdict PASS|FAIL --evidence "图里看到的证据"`);
      else if (next.auto === "acceptance") lines.push(`  pf workflow acceptance --story "…" --segmentation "…" --alignment "…" --enhancement "…"`);
      else lines.push(`  pf workflow done ${next.id} --note "…"${/(证据|引用)/.test(next.title) ? ' --evidence "…"' : ""}`);
      lines.push(`  （${next.title}）`);
    } else {
      lines.push(`  处理审查/acceptance 缺口：${[...m.reviews, ...m.failed.map((d) => d + "重审"), ...(m.acceptance ? ["acceptance"] : [])].join("、")}`);
    }
  }
  return lines.join("\n");
}

export function renderCheck(wf) {
  const m = missing(wf);
  const t = templateOf(wf.kind);
  if (isComplete(wf)) return { ok: true, text: `✅ 工作流 ${wf.kind} 全部完成——步骤 ${wf.steps.length}/${wf.steps.length}、审查 ${t.reviews.join("/")} 全 PASS、acceptance ${t.acceptance ? "已留痕" : "不适用"}。可以交付。` };
  const lines = [`❌ 工作流未完成，缺 ${m.steps.length} 步 / ${m.reviews.length + m.failed.length} 项审查${m.acceptance ? " / acceptance 未留痕" : ""}：`];
  for (const s of m.steps) lines.push(`  ⬜ 步骤 ${s.id}：${s.title}`);
  for (const d of m.reviews) lines.push(`  ⬜ 审查 ${d}（${DIM_NAMES[d]}）：pf workflow review --dim ${d} --verdict PASS|FAIL --evidence "…"`);
  for (const d of m.failed) lines.push(`  ❌ 审查 ${d} 判 FAIL——修缺陷后重审：pf workflow review --dim ${d} --verdict PASS --evidence "…"`);
  if (m.acceptance) lines.push(`  ⬜ acceptance 四项：pf workflow acceptance --story "…" --segmentation "…" --alignment "…" --enhancement "…"`);
  return { ok: false, text: lines.join("\n") };
}

function trunc(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + "…" : s; }
function throwNone() { throw new Error("没有活跃工作流——先 pf workflow init --kind upgrade|review"); }
function throwStep(id, t) { throw new Error(`未知步骤 "${id}"（本工作流步骤：${t.steps.map((s) => s.id).join(" → ")}）`); }
