// workflow.mjs — 工作流状态库（2026-10-17 用户拍板"服务端只做 API，状态标记放本地"）
// 🔴 解决什么：升级/审核类工作流过去只活在技能文档里，弱模型做没做全凭自觉——
//    现在每一步必须 pf workflow done 落一条标记、审查逐维落记录，
//    status/check 随时回答"做到哪一步、哪些没做、哪些审查漏了"（硬性清单，不是文档）。
//
// 🔴 2026-10-18 第二课：状态字段是 AI 自己写的，只校验字段 = 让 AI 自证。
//    实测：产物路径指向不存在的文件、证据全写"看过了/没问题"，check 照样 exit 0。
//    现在校验对象一律是外部事实——产物文件存在性 + sha256 + 尺寸 + mtime、
//    证据里的可复查锚点、时间先后。见 artifact.mjs。
//
// 存储：~/.promptfigure/projects/<docId>/workflow.json（单活跃工作流，历史走 events.jsonl）
import fs from "node:fs";
import path from "node:path";
import { readWorkflow, writeWorkflow, projectByDocId } from "./store.mjs";
import { appendEvent } from "./events.mjs";
import { capture, verify, evidenceQuality, imageSize } from "./artifact.mjs";

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
// artifact: true = 这步必须交出磁盘上真实存在的产物文件（check 时复核哈希）
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
      { id: "produce",   title: "生成产物：写产物文件路径（check 会验文件真实存在+哈希）", artifact: true },
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

// ---- 读取 + 校验（2026-10-18 审计补）----
// 🔴 旧实现用 readJson(..., null)：workflow.json 被写坏/半截/手工改过时静默返回 null，
//    status 报「没有活跃工作流」、init 直接覆盖重建——用户的历史留痕一声不响全没了。
//    现在把"没有" / "损坏" / "旧模板" 分三态，各有各的下一步；损坏档一律先备份再报。
const WF_FILE = (docId) => path.join(projectByDocId(docId), "workflow.json");

function backupWorkflowFile(docId) {
  const file = WF_FILE(docId);
  const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try { fs.copyFileSync(file, backup); return backup; } catch { return null; }
}

export function loadState(docId) {
  const file = WF_FILE(docId);
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch (e) {
    if (e.code === "ENOENT") return { state: "none" };
    throw new Error(`读不到工作流状态文件（${e.code}）：${file}——先 pf status 确认项目目录，或 pf workflow init --kind upgrade 重建`);
  }
  let wf;
  try { wf = JSON.parse(raw); } catch (e) {
    const backup = backupWorkflowFile(docId);
    return { state: "corrupt", size: raw.length, detail: e.message, backup };
  }
  const t = wf && TEMPLATES[wf.kind];
  if (!t) return { state: "foreign", kind: wf && wf.kind };
  const have = Array.isArray(wf.steps) ? wf.steps : [];
  const miss = t.steps.map((s) => s.id).filter((id) => !have.some((s) => s && s.id === id));
  if (!Array.isArray(wf.steps) || miss.length) return { state: "stale", kind: wf.kind, miss: miss.length ? miss : ["steps 数组"] };
  const bad = have.filter((s) => !s || !["pending", "done", "skipped"].includes(s.status));
  if (bad.length) return { state: "stale", kind: wf.kind, miss: bad.map((s) => (s && s.id) || "（无名步骤）") };
  return { state: "ok", wf };
}

// 状态不可用时给宿主 AI 的报错：说清坏在哪 + 已备份到哪 + 下一步敲什么
export function stateError(st) {
  if (st.state === "corrupt") {
    return `工作流状态文件损坏（${st.size} 字节，JSON 解析失败：${st.detail}）——原文件已备份为 ${path.basename(st.backup || "（备份失败）")}。重建：pf workflow init --kind upgrade --reset（清单从空重来，旧档留在备份里可查）`;
  }
  if (st.state === "stale") {
    return `工作流状态文件与当前模板不匹配（缺/异常：${st.miss.join(", ")}）——多半是旧版插件留下或模板升级过。重建：pf workflow init --kind ${st.kind} --reset（旧档会先备份）`;
  }
  if (st.state === "foreign") {
    return `工作流状态文件里的类型 "${st.kind}" 已不存在（当前支持：${Object.keys(TEMPLATES).join(" / ")}）——重建：pf workflow init --kind upgrade --reset`;
  }
  return "工作流状态异常";
}

export function readActive(docId) {
  const st = loadState(docId);
  if (st.state === "none") return null;
  if (st.state !== "ok") throw new Error(stateError(st));
  return st.wf;
}

export function init(docId, { kind, goal = "", reset = false } = {}) {
  const t = templateOf(kind);
  const st = loadState(docId);
  // 🔴 损坏/旧模板不许被 init 静默覆盖——重建必须显式 --reset，且旧档留备份
  if (st.state !== "none" && st.state !== "ok") {
    if (!reset) throw new Error(`${stateError(st)}\n（这次 init 没有覆盖旧档。确认重建请加 --reset）`);
    if (st.state !== "corrupt") backupWorkflowFile(docId); // corrupt 在 loadState 里已备份
  }
  const cur = st.state === "ok" ? st.wf : null;
  if (cur && !isComplete(cur)) {
    const doneN = cur.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
    throw new Error(`已有未完结工作流（${cur.kind}，${doneN}/${cur.steps.length} 步）——pf workflow status 看进度；确要重开加 --reset`);
  }
  const wf = {
    kind, goal, templateRev: 2,
    createdAt: new Date().toISOString(),
    steps: t.steps.map((s) => ({ id: s.id, status: "pending", note: "", evidence: "", at: null, artifact: null })),
    reviews: [], // {dim, verdict, evidence, at}
    acceptance: null, // {story, segmentation, alignment, enhancement, at}
    updatedAt: new Date().toISOString(),
  };
  writeWorkflow(docId, wf);
  appendEvent(docId, "workflow.init", { kind, goal });
  return wf;
}

export function reset(docId, opts) {
  const st = loadState(docId);
  if (st.state === "ok") appendEvent(docId, "workflow.reset", { kind: st.wf.kind });
  if (st.state === "stale" || st.state === "foreign") backupWorkflowFile(docId);
  // init 的"已有活跃"检查基于文件，先删再建
  writeWorkflow(docId, null);
  return init(docId, { ...opts, reset: true });
}

function stepDef(t, id) {
  return t.steps.find((s) => s.id === id);
}

// 产物路径的解析基准：当前工作目录（宿主就在用户项目里跑）+ 项目目录
function basesFor(docId) {
  const out = [process.cwd()];
  try { out.push(projectByDocId(docId)); } catch { /* 项目目录异常不影响 cwd 解析 */ }
  return out;
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
  if (def.evidence) {
    const q = evidenceQuality(evidence, { label: "evidence" });
    if (!q.ok) throw new Error(`步骤 "${stepId}" 的 evidence 不合格：${q.why}`);
  }
  const st = wf.steps.find((s) => s.id === stepId);
  if (st.status === "done") throw new Error(`步骤 "${stepId}" 已标记完成（${st.at}）——重复标记无需操作`);
  const blocker = firstIncomplete(wf, t, stepId);
  if (blocker) {
    throw new Error(`顺序被拦："${blocker.id}" 还没完成（${blocker.title}）——先做它再回来。硬性清单不允许跳步`);
  }
  // 🔴 产物步：note 里写的文件必须真的在磁盘上，当场取证（哈希+尺寸+mtime）
  let art = null;
  if (def.artifact) {
    const cap = capture(note, basesFor(docId));
    if (!cap.ok) throw new Error(`产物取证失败：${cap.reason}`);
    art = cap.record;
    const v = verify(art);
    if (!v.ok) throw new Error(`产物不合格：${v.why}`);
    const born = Date.parse(wf.createdAt || "");
    if (born && v.mtimeMs && v.mtimeMs < born - 300 * 1000) {
      throw new Error(`产物 ${path.basename(art.path)} 的修改时间（${art.mtime}）早于开工时间（${wf.createdAt}）——这是旧图，不能当本轮产物：重新生成，或检查是不是路径写错了`);
    }
  }
  st.status = "done"; st.note = note.trim(); st.evidence = evidence.trim(); st.at = new Date().toISOString();
  if (art) st.artifact = art;
  wf.updatedAt = st.at;
  writeWorkflow(docId, wf);
  appendEvent(docId, "workflow.done", { step: stepId, artifact: art ? art.sha256 : undefined });
  return wf;
}

export function skip(docId, stepId, { reason = "" } = {}) {
  const wf = readActive(docId) || throwNone();
  const t = templateOf(wf.kind);
  const def = stepDef(t, stepId) || throwStep(stepId, t);
  if (!def.skippable) throw new Error(`步骤 "${stepId}" 不允许跳过（${def.title}）`);
  if (!reason.trim()) throw new Error(`--reason 必填：为什么这步不适用。无理由跳过 = 放水`);
  const st = wf.steps.find((s) => s.id === stepId);
  // 🔴 2026-10-18 审计：旧实现无条件覆盖——宿主把 `skip panels` 敲重复一次，
  //    已 done 的记录就被改写成 skipped、note 被理由顶掉，exit 0 一声不响。
  if (st.status === "done") {
    throw new Error(`步骤 "${stepId}" 已完成（${st.at}：${st.note}）——skip 不能覆盖已完成记录；要改结论只能 pf workflow init --reset 重开`);
  }
  if (st.status === "skipped") {
    throw new Error(`步骤 "${stepId}" 已是跳过状态（${st.note}）——无需重复 skip`);
  }
  st.status = "skipped"; st.note = reason.trim(); st.at = new Date().toISOString();
  wf.updatedAt = st.at;
  writeWorkflow(docId, wf);
  appendEvent(docId, "workflow.skip", { step: stepId, reason: reason.trim() });
  return wf;
}

// 补取证：旧状态文件或产物被手工补上时，把产物重新取证一次
export function bindArtifact(docId, file) {
  const wf = readActive(docId) || throwNone();
  const t = templateOf(wf.kind);
  const def = t.steps.find((s) => s.artifact);
  if (!def) throw new Error(`工作流 ${wf.kind} 没有产物步，不需要取证`);
  const cap = capture(file, basesFor(docId));
  if (!cap.ok) throw new Error(`产物取证失败：${cap.reason}`);
  const v = verify(cap.record);
  if (!v.ok) throw new Error(`产物不合格：${v.why}`);
  const st = wf.steps.find((s) => s.id === def.id);
  st.artifact = cap.record;
  wf.updatedAt = new Date().toISOString();
  writeWorkflow(docId, wf);
  appendEvent(docId, "workflow.bind", { step: def.id, sha256: cap.record.sha256 });
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
  // 🔴 2026-10-18 审计：旧实现 review 不看前置——context 都没做就能把 F/G/H 全判 PASS，
  //    审查沦为"随便点三下"，产线顺序锁形同虚设。审查必须在产物出来之后。
  const autoDef = t.steps.find((s) => s.auto === "review");
  if (autoDef) {
    const blocker = firstIncomplete(wf, t, autoDef.id);
    if (blocker) {
      throw new Error(`审查被拦："${blocker.id}" 还没完成（${blocker.title}）——审查必须在产物出来之后做，不能空审。先 pf workflow done ${blocker.id} …`);
    }
  }
  if (!String(evidence || "").trim()) {
    throw new Error(`--evidence 必填：你在图里看到的、支撑判定的具体证据（元素个数/位置/原文引文），"看起来没问题" = 无效审查`);
  }
  const q = evidenceQuality(evidence, { label: "审查证据" });
  if (!q.ok) throw new Error(`${q.why}（维度 ${D}·${DIM_NAMES[D]}）`);
  const rec = { dim: D, verdict: V, evidence: evidence.trim(), at: new Date().toISOString() };
  const prev = wf.reviews.findIndex((r) => r.dim === D);
  if (prev >= 0) wf.reviews[prev] = rec; // 重审覆盖：改判以最新为准，历史在事件流
  else wf.reviews.push(rec);
  wf.updatedAt = rec.at;
  // auto 步骤联动：所有要求维度都有记录且无 FAIL → 对应 auto 步骤置 done
  const dims = t.reviews.join("/");
  for (const def of t.steps.filter((s) => s.auto === "review")) {
    const st = wf.steps.find((s) => s.id === def.id);
    const all = t.reviews.every((d) => wf.reviews.some((r) => r.dim === d));
    const anyFail = wf.reviews.some((r) => t.reviews.includes(r.dim) && r.verdict === "FAIL");
    if (all && !anyFail && st.status === "pending") { st.status = "done"; st.note = `${dims} 全 PASS`; st.at = rec.at; }
    if (anyFail && st.status === "done") { st.status = "pending"; st.note = ""; } // 新 FAIL 打回
  }
  writeWorkflow(docId, wf);
  appendEvent(docId, "workflow.review", { dim: D, verdict: V });
  return wf;
}

// 硬锚点：acceptance 的量化项（alignment/enhancement）里必须有数字/路径/英文，才证明真做过
const HARD_ANCHOR = (s) => /\d/.test(s) || /[\\/]/.test(s) || /\.[a-z0-9]{2,5}\b/i.test(s) || /[A-Za-z]{3,}/.test(s);

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
  // 🔴 四项不许是空话：story/segmentation 要求具体；alignment/enhancement 天然量化，必须有数字/路径/英文
  for (const k of ["story", "segmentation"]) {
    const q = evidenceQuality(fields[k], { min: 8, label: `acceptance.${k}`, anchor: false });
    if (!q.ok) throw new Error(`${q.why}——这一项要写清"原文论点是什么"/"按什么逻辑分段"，不是评价`);
  }
  for (const k of ["alignment", "enhancement"]) {
    const v = String(fields[k]).trim();
    const q = evidenceQuality(v, { min: 8, label: `acceptance.${k}` });
    if (!q.ok) throw new Error(`${q.why}——这一项要写清"具体对到什么位置、用什么参数"`);
    if (!HARD_ANCHOR(v)) {
      throw new Error(`acceptance.${k} 没有量化内容（"${v.slice(0, 16)}"）——对齐要写 px/行/列/基线，增强要写参数（如对比度拉伸 1-99.5 百分位）；写不出具体数字 = 没真做`);
    }
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
    if (!st || st.status === "pending") return { id: t.steps[i].id, title: t.steps[i].title };
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
    if (!st || st.status === "pending") out.steps.push({ id: def.id, title: def.title, auto: def.auto || null });
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

// ---- 复核（check 的真身）：不看 AI 说了什么，看磁盘上有没有 / 是不是同一个 / 时间对不对 ----
export function audit(wf) {
  const issues = [];
  const t = templateOf(wf.kind);
  const m = missing(wf);

  for (const s of m.steps) issues.push(`步骤 ${s.id} 未完成（${s.title}）`);
  for (const d of m.reviews) issues.push(`审查 ${d}（${DIM_NAMES[d]}）未做`);
  for (const d of m.failed) issues.push(`审查 ${d} 判 FAIL 还没修好重审`);
  if (m.acceptance) issues.push("acceptance 四项未留痕");

  // ① 产物：存在性 / 哈希 / 尺寸 / mtime
  const pdef = t.steps.find((s) => s.artifact);
  let prodAt = null;
  if (pdef) {
    const pst = wf.steps.find((s) => s.id === pdef.id);
    if (pst && pst.status === "done") {
      prodAt = pst.at;
      if (!pst.artifact) {
        issues.push(`产物未取证（${pdef.id} 是旧版/手工写入的记录）——补一次：pf workflow bind --file "<产物路径>"`);
      } else {
        const v = verify(pst.artifact);
        if (!v.ok) issues.push(v.why);
        else {
          const art = pst.artifact;
          if (art.kind === "image" && (!art.w || !art.h)) {
            issues.push(`产物读不出尺寸（可能不是有效图片）：${art.path}`);
          }
          // ② 产物不能早于开工——防"拿旧图当新交付"（用磁盘当前 mtime，不用标记时的快照）
          const born = Date.parse(wf.createdAt || "");
          if (born && v.mtimeMs && v.mtimeMs < born - 300 * 1000) {
            issues.push(`产物 ${path.basename(art.path)} 的最后修改时间（${new Date(v.mtimeMs).toISOString()}）早于开工时间（${wf.createdAt}）——这是旧图，不是本轮产物`);
          }
        }
      }
    }
  }

  // ③ 时间线：审查/acceptance 必须在产物之后
  if (prodAt) {
    for (const r of wf.reviews) {
      if (r.at && Date.parse(r.at) < Date.parse(prodAt)) issues.push(`审查 ${r.dim} 的时间（${r.at}）早于产物时间（${prodAt}）——产物没出就审 = 假审`);
    }
    if (wf.acceptance && wf.acceptance.at && Date.parse(wf.acceptance.at) < Date.parse(prodAt)) {
      issues.push(`acceptance 时间（${wf.acceptance.at}）早于产物时间（${prodAt}）`);
    }
  }

  // ④ 证据质量：空话不算证据（字段非空 ≠ 有事实）
  for (const def of t.steps.filter((s) => s.evidence)) {
    const st = wf.steps.find((s) => s.id === def.id);
    if (!st || st.status !== "done") continue;
    const q = evidenceQuality(st.evidence, { label: `${def.id} 的证据` });
    if (!q.ok) issues.push(`${def.id}：${q.why}`);
  }
  for (const r of wf.reviews) {
    const q = evidenceQuality(r.evidence, { label: `审查 ${r.dim} 的证据` });
    if (!q.ok) issues.push(`${q.why}`);
  }

  // ⑤ acceptance 空话
  if (t.acceptance && wf.acceptance) {
    for (const k of ["story", "segmentation"]) {
      const q = evidenceQuality(wf.acceptance[k], { label: `acceptance.${k}`, anchor: false });
      if (!q.ok) issues.push(q.why);
    }
    for (const k of ["alignment", "enhancement"]) {
      const q = evidenceQuality(wf.acceptance[k], { label: `acceptance.${k}` });
      if (!q.ok) issues.push(q.why);
    }
    for (const k of ["alignment", "enhancement"]) {
      const v = String(wf.acceptance[k] || "");
      if (v && !HARD_ANCHOR(v)) issues.push(`acceptance.${k} 没有量化内容（写不出 px/百分位/参数 = 没真做）`);
    }
  }

  return { ok: issues.length === 0, issues };
}

// ---- 渲染 ----
const ICON = { done: "✅", skipped: "⏭️ ", pending: "⬜" };

export function renderStatus(wf) {
  const t = templateOf(wf.kind);
  const lines = [];
  lines.push(`════ 工作流 · ${wf.kind}（${t.title}）${wf.goal ? ` · 目标：${wf.goal}` : ""} ════`);
  for (const def of t.steps) {
    const st = wf.steps.find((s) => s.id === def.id) || { status: "pending", note: "", evidence: "" };
    const head = `${ICON[st.status]} ${def.title}`;
    const art = st.artifact ? ` ｜ 产物 ${path.basename(st.artifact.path)} ${st.artifact.w ? `${st.artifact.w}×${st.artifact.h} ` : ""}${st.artifact.sha256.slice(0, 8)}` : "";
    const tail = st.status === "done" ? ` —— ${st.note}${art}${st.evidence ? ` ｜ 证据：${trunc(st.evidence, 60)}` : ""}`
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
    lines.push(`\n🎉 步骤齐全——还要 pf workflow check 复核产物与证据，check 才是交付门。`);
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
  const t = templateOf(wf.kind);
  const r = audit(wf);
  if (r.ok) {
    const pdef = t.steps.find((s) => s.artifact);
    const art = pdef ? wf.steps.find((s) => s.id === pdef.id)?.artifact : null;
    const artLine = art ? `产物 ${path.basename(art.path)}（${art.w ? `${art.w}×${art.h}，` : ""}sha256 ${art.sha256.slice(0, 8)}）已复核` : "无产物步";
    return { ok: true, text: `✅ 工作流 ${wf.kind} 通过复核——步骤 ${wf.steps.length}/${wf.steps.length}、审查 ${t.reviews.join("/")} 全 PASS、证据均有可复查锚点、${artLine}、acceptance ${t.acceptance ? "四项合格" : "不适用"}。可以交付。` };
  }
  const lines = [`❌ 复核没过（${r.issues.length} 项），不许交付：`];
  r.issues.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  lines.push(`\n逐条补齐后重跑：pf workflow check`);
  return { ok: false, text: lines.join("\n") };
}

// 交付凭据：一行可贴进汇报的摘要，用户一眼能看出"有没有走完、产物是不是这个"
// 用法写在技能里：交付消息必须带这一行，没有 = 未交付（防宿主嘴上说做完）
export function receipt(wf) {
  const t = templateOf(wf.kind);
  const a = audit(wf);
  const pdef = t.steps.find((s) => s.artifact);
  const art = pdef ? wf.steps.find((s) => s.id === pdef.id)?.artifact : null;
  const artPart = art ? `产物 ${path.basename(art.path)} ${art.w || "?"}×${art.h || "?"} sha256:${art.sha256.slice(0, 12)}` : "无产物";
  const doneN = wf.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const rev = t.reviews.map((d) => {
    const r = wf.reviews.find((x) => x.dim === d);
    return `${d}:${r ? r.verdict : "未审"}`;
  }).join(" ");
  return `[pf-workflow] ${wf.kind} ${doneN}/${wf.steps.length} ｜ ${rev} ｜ ${artPart} ｜ check ${a.ok ? "通过" : `未过(${a.issues.length}项)`} ｜ ${new Date().toISOString()}`;
}

function trunc(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + "…" : s; }
function throwNone() { throw new Error("没有活跃工作流——先 pf workflow init --kind upgrade|review"); }
function throwStep(id, t) { throw new Error(`未知步骤 "${id}"（本工作流步骤：${t.steps.map((s) => s.id).join(" → ")}）`); }
