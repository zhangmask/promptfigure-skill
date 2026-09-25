// app.js — GUI 逻辑（只读 + 唯一可操作：审批）
// GUI 不持有独立可变状态：一切以 /api/state 为准，SSE 推送后重取
const qs = new URLSearchParams(location.search);
const DOC = qs.get("doc");
const TOKEN = qs.get("token");

let state = null;          // /api/state 结果
let rendered = false;      // 文档是否已渲染（SSE 只重画高亮与侧栏）
let currentVer = null;     // 浮层里当前看的大图

const $ = (s) => document.querySelector(s);
const docView = $("#doc-view");

// ---------- 初始化 ----------
init();

async function init() {
  if (!DOC) { docView.textContent = "缺少 doc 参数（请从 pf open 打开的窗口进入）"; return; }
  await loadState();
  await renderDocument();
  rendered = true;
  paintAll();

  const es = new EventSource(`/api/events?doc=${DOC}`);
  es.onopen = () => $("#conn").classList.add("on");
  es.onerror = () => $("#conn").classList.remove("on");
  es.onmessage = async (e) => {
    const evt = JSON.parse(e.data);
    if (evt.type === "hello") return;
    await loadState();
    paintAll();          // AI 一操作，界面自动变 —— 因为状态源只有一个
  };
}

async function loadState() {
  const resp = await fetch(`/api/state?doc=${DOC}`);
  if (!resp.ok) { docView.textContent = "加载状态失败（doc 不存在？重新 pf open 一次）"; throw new Error("state"); }
  state = await resp.json();
  // 字段兜底：老 meta / 异常状态不让 GUI 崩
  state.anchors = state.anchors || [];
  state.figures = state.figures || {};
  state.review = state.review || {};
  state.events = state.events || [];
  state.meta.blocks = state.meta.blocks || [];
  $("#doc-title").textContent = `${state.meta.fileName} · ${DOC}`;
}

// ---------- 文档渲染（只读） ----------
async function renderDocument() {
  const kind = state.meta.kind;
  try {
    if (kind === "docx") {
      const buf = await fetch(`/api/file?doc=${DOC}`).then((r) => r.arrayBuffer());
      docView.classList.remove("loading");
      docView.innerHTML = "";
      await window.docx.renderAsync(buf, docView, undefined, { inWrapper: true });
    } else if (kind === "pdf" || (kind === "tex" && state.meta.pdfReady)) {
      docView.classList.remove("loading");
      docView.innerHTML = "";
      await renderPdf(`/api/file?doc=${DOC}`);
    } else if (kind === "tex") {
      // 没编译成功（缺引擎/编译错）→ 文本模式兜底
      docView.classList.remove("loading");
      docView.innerHTML = "";
      if (state.meta.pdfFailReason === "no-engine") {
        const tip = document.createElement("div");
        tip.className = "tex-tip";
        tip.textContent = "⚠️ 本机没有 TeX 环境，当前显示文本预览。让 AI 执行 pf setup-tex（自动装便携编译器）或自装 TeX Live/MiKTeX 后，执行 pf doc compile 即可看到排版后的 PDF。";
        docView.appendChild(tip);
      }
      for (const b of state.meta.blocks || []) {
        const el = document.createElement(b.type === "heading" ? "div" : "p");
        el.className = b.type === "heading" ? `tex-h${Math.min(b.level, 3)}` : b.type === "caption" ? "tex-cap tex-p" : "tex-p";
        el.dataset.blockIdx = b.i;
        el.textContent = b.text;
        docView.appendChild(el);
      }
    } else {
      docView.textContent = `暂不支持在线预览 .${kind}`;
    }
  } catch (err) {
    docView.textContent = "文档渲染失败：" + (err.message || err);
  }
}

// ---------- PDF 渲染（canvas + textLayer：textLayer 里的文本参与高亮定位） ----------
async function renderPdf(url) {
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.js";
  const pdf = await pdfjs.getDocument(url).promise;
  const scale = 1.5;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale });
    const wrap = document.createElement("div");
    wrap.className = "pdf-page";
    wrap.style.width = vp.width + "px";
    wrap.style.height = vp.height + "px";
    wrap.style.setProperty("--scale-factor", scale);
    const canvas = document.createElement("canvas");
    canvas.width = vp.width; canvas.height = vp.height;
    wrap.appendChild(canvas);
    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    wrap.appendChild(textLayer);
    docView.appendChild(wrap);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    // 文本层失败不致命：只是这页没法高亮
    try {
      const src = page.streamTextContent ? page.streamTextContent() : await page.getTextContent();
      await pdfjs.renderTextLayer({ textContentSource: src, container: textLayer, viewport: vp }).promise;
    } catch (e) { console.warn("[pf] 第" + i + "页文本层失败", e); }
  }
}

// ---------- 高亮（用户要求的核心体验） ----------
// 设计：
//   · 荧光笔色号（5 色循环）= 「这是哪张图的上下文」
//   · 同一段被多张图的上下文覆盖（重叠）→ 背景色加深纹理 + 底部每图一条色带 + title 列出全部
//   · 审批状态（待审/通过/驳回/原文改动/丢失）→ 顶部细色条，与色号解耦
//   · 文本模式下（tex 未编译成 PDF），锚点 --at 指向的整段也打淡荧光（段落级上下文）
const HL_COLORS = [
  { bg: "#fff3c2", line: "#e6b800" }, // 0 黄
  { bg: "#d9f2e0", line: "#2e9e5b" }, // 1 绿
  { bg: "#d8e7ff", line: "#3b74d1" }, // 2 蓝
  { bg: "#ecdfff", line: "#7a5bc9" }, // 3 紫
  { bg: "#ffe7d1", line: "#e07b1f" }, // 4 橙
];
const STATE_BAR = { ok: "#e6b800", approved: "#2e9e5b", rejected: "#d64545", changed: "#e07b1f", lost: "#b3b3b3" };
const STATE_LABEL = { ok: "待审批", approved: "已通过", rejected: "已驳回", changed: "原文已改动", lost: "位置丢失" };

function norm(s) { return (s || "").replace(/\s+/g, " "); }

function unwrapHighlights() {
  docView.querySelectorAll("span.pf-hl").forEach((sp) => {
    const parent = sp.parentNode;
    while (sp.firstChild) parent.insertBefore(sp.firstChild, sp);
    parent.removeChild(sp);
    parent.normalize();
  });
}

function buildTextIndex() {
  const walker = document.createTreeWalker(docView, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes = [];
  let combined = "";
  let n;
  while ((n = walker.nextNode())) {
    const t = norm(n.data);
    nodes.push({ node: n, start: combined.length, end: combined.length + t.length });
    combined += t;
  }
  return { nodes, combined };
}

// 解析 "§3.2 ¶2" → { sec: "3.2", para: 2 }；解析失败返回 null
function parseAt(at) {
  const m = /§?\s*([\d.]+)\s*¶\s*(\d+)/.exec(at || "");
  return m ? { sec: m[1].replace(/\.$/, ""), para: Number(m[2]) } : null;
}

// 文本模式：--at 指向的整段打淡荧光（段落级上下文，与 quote 精确高亮叠加）
function paintCtxParagraphs() {
  docView.querySelectorAll(".pf-ctx").forEach((el) => {
    el.classList.remove("pf-ctx");
    el.style.removeProperty("--pf-ctx-bg");
    el.style.removeProperty("--pf-ctx-line");
    el.removeAttribute("data-ctx-figs");
    el.removeAttribute("title");
  });
  if (!(state.meta.kind === "tex" && !state.meta.pdfReady)) return; // PDF/docx 模式定位不到段落元素
  for (const a of state.anchors) {
    const ref = parseAt(a.placement.at);
    if (!ref) continue;
    const b = (state.meta.blocks || []).find((x) => x.type !== "heading" && x.secPath === ref.sec && x.para === ref.para);
    if (!b) continue;
    const el = docView.querySelector(`[data-block-idx="${b.i}"]`);
    if (!el) continue;
    const ci = state.anchors.indexOf(a) % HL_COLORS.length;
    el.classList.add("pf-ctx");
    el.style.setProperty("--pf-ctx-bg", HL_COLORS[ci].bg);
    el.style.setProperty("--pf-ctx-line", HL_COLORS[ci].line);
    const fid = a.figure || a.id;
    el.dataset.ctxFigs = (el.dataset.ctxFigs ? el.dataset.ctxFigs + " " : "") + fid;
    // 记录锚点 id：点图看源文段 → 跳原文时精确/兜底定位都要用
    el.dataset.ctxAnchors = (el.dataset.ctxAnchors ? el.dataset.ctxAnchors + " " : "") + a.id;
    const label = a.figure ? `图的上下文：${a.figure}` : `锚点 ${a.id} 的上下文`;
    el.title = el.dataset.ctxFigs.split(" ").length > 1 ? `多张图的上下文重叠：${el.dataset.ctxFigs.split(" ").join(" + ")}` : label;
  }
}

// quote 在 PDF 文本层的降级匹配：quote 存的是 LaTeX 源文本（含 \cite/\ref 等命令），
// 编译后的 PDF 文本层里这些命令消失了，整句必然匹配不上 —— 逐级缩短前缀直到命中。
// 部分命中也远好于不亮（用户要的是"上下文有荧光"）。
function findQuoteRange(combined, q) {
  let idx = combined.indexOf(q);
  if (idx > -1) return { start: idx, end: idx + q.length, partial: false };
  for (const L of [96, 64, 40, 24]) {
    if (q.length <= L) continue; // 完整 quote 已试过，跳过更长的前缀；更短的继续试
    let prefix = q.slice(0, L);
    const cut = prefix.lastIndexOf(" ");
    if (cut > 12) prefix = prefix.slice(0, cut); // 别切半个词
    prefix = prefix.trim();
    if (prefix.length < 12) continue;
    idx = combined.indexOf(prefix);
    if (idx > -1) return { start: idx, end: idx + prefix.length, partial: true };
  }
  return null;
}

// 区间切分渲染：所有 quote 匹配区间求交，每个原子区间一次渲染（重叠天然合并）
function paintHighlights() {
  if (!rendered) return;
  unwrapHighlights();
  paintCtxParagraphs();
  const { nodes, combined } = buildTextIndex();
  const figState = (figureId) => {
    const r = state.review[figureId];
    if (!r) return "ok";
    return r.status === "approved" ? "approved" : r.status === "rejected" ? "rejected" : "ok";
  };
  const spans = [];
  state.anchors.forEach((a, i) => {
    const q = norm(a.placement.quote || "").trim();
    if (q.length < 4) return;
    const hit = findQuoteRange(combined, q);
    if (!hit) return; // 找不到就如实不高亮（changed 的由 CLI 侧标记，等 AI 重新声明）
    spans.push({ start: hit.start, end: hit.end, a, ci: i % HL_COLORS.length, partial: hit.partial });
  });
  if (!spans.length) {
    if (state.anchors.length) console.warn("[pf] 有锚点但未能定位原文（可能文档已改动）");
    return;
  }
  const cuts = [...new Set(spans.flatMap((s) => [s.start, s.end]))].sort((x, y) => x - y);
  for (let k = 0; k < cuts.length - 1; k++) {
    const s = cuts[k], e = cuts[k + 1];
    const cover = spans.filter((sp) => sp.start <= s && sp.end >= e);
    if (!cover.length) continue;
    wrapRange(s, e, cover, figState); // 🔴 每个区间内部重建文本索引：前面的 splitText 会改变节点结构
  }
}

function wrapRange(idx, end, cover, figState) {
  // combined 的文本内容不受 wrap 影响（splitText 只切节点不改文本），cut 索引仍然有效
  const { nodes } = buildTextIndex();
  for (const { node, start, end: nodeEnd } of nodes) {
    if (nodeEnd <= idx || start >= end) continue;
    const s = Math.max(0, idx - start);
    const e = Math.min(node.data.length, end - start);
    let target = node;
    if (s > 0) target = target.splitText(s);
    if (e - s < target.data.length) target.splitText(e - s);
    const span = document.createElement("span");
    const main = cover[0];
    // 重叠区间的状态 = 覆盖锚点里最需要关注的状态（驳回 > 原文改动 > 丢失 > 待审 > 通过）
    const PRIO = { rejected: 4, changed: 3, lost: 2, ok: 1, approved: 0 };
    const effState = (c) => (c.a.state === "ok" && c.a.figure ? figState(c.a.figure) : c.a.state);
    const stateName = cover.map(effState).sort((x, y) => (PRIO[y] || 0) - (PRIO[x] || 0))[0] || "ok";
    span.className = "pf-hl";
    // 🔴 记录全部覆盖锚点（不只第一个）：两条锚点 quote 相同时会合并成同一区间，
    // 只记 main 的话"点图跳原文"对第二个锚点就落空（2026-09-21 浏览器实测抓到）
    span.dataset.anchor = main.a.id;
    span.dataset.anchors = cover.map((c) => c.a.id).join(" ");
    span.dataset.state = stateName;
    span.dataset.figure = main.a.figure || "";
    span.dataset.figures = cover.map((c) => c.a.figure || c.a.id).join(" ");
    span.style.background = HL_COLORS[main.ci].bg;
    if (cover.length > 1) span.classList.add("depth" + Math.min(cover.length, 4)); // 重叠加深纹理
    // 顶部细条 = 审批状态；底部色带 = 重叠的每张图（深浅/多色区分）
    const shadows = [`inset 0 2px 0 ${STATE_BAR[stateName] || STATE_BAR.ok}`];
    cover.slice(1).forEach((c, i) => {
      shadows.push(`inset 0 -${4 * (i + 1)}px 0 ${HL_COLORS[c.ci].line}`);
    });
    span.style.boxShadow = shadows.join(", ");
    const parts = cover.map((c) => `${c.a.figure || "锚点" + c.a.id}（${STATE_LABEL[effState(c)] || effState(c)}）`);
    span.title = (cover.length > 1 ? "多图上下文重叠：" : "图的上下文：") + parts.join(" + ")
      + (cover.some((c) => c.partial) ? " · 部分匹配（原文可能已改动）" : "") + " · 点击审批";
    target.parentNode.insertBefore(span, target);
    span.appendChild(target);
  }
}

// ---------- 侧栏 ----------
function paintAll() {
  paintTabs();
  paintReview();
  paintFigures();
  paintTimeline();
  paintHighlights();
  paintInlineFigs(); // 图卡片内联到原文锚点位置（用户要求：图要定位到原文的位置）
}

// ---------- 内联图（图挂在锚点指向的原文位置，不再只躺在侧栏） ----------
// 定位规则：优先精确 quote 高亮块，退段落上下文；找到含它的 docView 直接子块
// （PDF=页块 / 文本模式=段落 / docx=渲染块），图卡片插在子块之后 = "这一段的下面"。
// 🔴 展示逻辑按审批状态区分（用户反馈：被驳回的图还挂在原文里很乱）：
//   待审/通过 → 内联最新版大图 + 状态徽标；已驳回 → 不再挂图，只留一条占位条
//   （驳回意见 + 点击查看历史版本）—— 文章保持干净，历史在浮层里永远可查。
function paintInlineFigs() {
  docView.querySelectorAll(".pf-inline-fig").forEach((el) => el.remove());
  if (!rendered) return;
  const done = new Set();
  for (const a of state.anchors || []) {
    const fid = a.figure;
    if (!fid || done.has(fid) || !state.figures[fid]) continue;
    let host = docView.querySelector(`.pf-hl[data-figures~="${fid}"]`)
      || docView.querySelector(`.pf-ctx[data-ctx-figs~="${fid}"]`);
    if (!host) continue; // 原文里定位不到就不硬插（如实缺失，别乱放）
    done.add(fid);
    while (host.parentElement && host.parentElement !== docView) host = host.parentElement;
    const f = state.figures[fid];
    const rev = state.review[fid] || { status: "pending" };
    const card = document.createElement("div");
    card.className = "pf-inline-fig";
    if (rev.status === "rejected") {
      // 已驳回：不挂图（文章里不放被判不合格的图），占位条保留入口
      card.classList.add("rejected-strip");
      card.innerHTML = `<div class="cap">🚫 <b>${escapeHtml(fid)}</b> 最新版已被驳回${rev.note ? ` · 意见：${escapeHtml(rev.note)}` : ""}
        · <span class="link">点击查看历史版本 / 等 AI 按意见重出</span></div>`;
      card.querySelector(".link").onclick = () => openFigure(fid);
      card.onclick = (e) => { if (e.target === card) openFigure(fid); };
    } else {
      const v = displayVer(f, rev);
      card.innerHTML = `<img src="${escapeHtml(figSrc(v.file))}" alt="${escapeHtml(fid)}">
        <div class="cap">${badgeOf(rev.status)} <b>${escapeHtml(fid)}</b> · v${f.versions.indexOf(v) + 1}/${f.versions.length} · 上下文 @${escapeHtml(a.placement?.at || "")} · 点击看大图与源文段</div>`;
      card.querySelector("img").onclick = () => openFigure(fid);
    }
    host.after(card);
  }
}

// ---------- 点图看源文段（浮层里列出这张图锚定/引用了哪些文段） ----------
function anchorsOfFigure(fid) {
  return (state.anchors || []).filter((a) => (a.figure || "") === fid);
}

function contextListOfFigure(fid) {
  const list = anchorsOfFigure(fid);
  if (!list.length) return null;
  const box = document.createElement("div");
  box.className = "fig-ctx";
  box.innerHTML = `<div class="fig-ctx-title">锚定原文 — 这张图取材的文段</div>`;
  for (const a of list) {
    const q = String(a.placement?.quote || "").trim();
    const st = a.state || "ok";
    const item = document.createElement("div");
    item.className = "fig-ctx-item";
    item.innerHTML = `<div class="meta">@${escapeHtml(a.placement?.at || "?")} · ${STATE_LABEL[st] || st}</div>
      <div class="quote">${q ? "「" + escapeHtml(q) + "」" : "<i>（该锚点没给引用原句——建议锚点声明时带上 quote）</i>"}</div>
      <div class="btn-row"><button class="btn ghost">跳到原文位置</button></div>`;
    item.querySelector("button").onclick = () => locateAnchor(a.id);
    box.appendChild(item);
  }
  return box;
}

// 跳到某个锚点在原文里的位置：优先精确 quote 高亮，退段落上下文
function locateAnchor(aid) {
  $("#overlay").classList.add("hidden");
  let el = docView.querySelector(`.pf-hl[data-anchor="${aid}"]`)
    || docView.querySelector(`.pf-hl[data-anchors~="${aid}"]`) // 重叠合并区间记的是全部锚点
    || docView.querySelector(`.pf-ctx[data-ctx-anchors~="${aid}"]`);
  if (!el) { toast("原文里没定位到这条锚点（可能文档已改动，pf anchor list --changed 看）"); return; }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1800);
}

function paintTabs() {
  const pend = Object.values(state.figures).filter((f) => (state.review[f.figureId]?.status || "pending") === "pending").length;
  $("#cnt-review").textContent = pend || "";
  $("#cnt-figures").textContent = Object.keys(state.figures).length || "";
  $("#cnt-queue").textContent = pend || "";
}

const badgeOf = (s) => `<span class="badge ${s}">${{ pending: "待审批", approved: "已通过", rejected: "已驳回" }[s] || s}</span>`;

function latestVer(f) { return f.versions[f.versions.length - 1]; }

// 内联/卡片该展示哪一版：通过 → 最新版（=获批准的定稿）；待审 → 最新版；
// 已驳回 → 最新版也不该当门面（它就是被判不合格的那张），上层用占位条代替。
function displayVer(f, rev) { return latestVer(f); }

// v.file 形如 "figures/<fid>/v1.png"，服务端静态路由是 /fig/<fid>/<file>
// 🔴 必须带 ?doc=：服务端按 doc 定位项目目录（缺省回退"最近项目"，多文档时会 404）
const figSrc = (file) => "/" + String(file).replace(/^figures\//, "fig/") + `?doc=${DOC}`;

function paintReview() {
  const box = $("#tab-review");
  const pend = Object.values(state.figures)
    .filter((f) => (state.review[f.figureId]?.status || "pending") === "pending");
  if (!pend.length) { box.innerHTML = '<p class="empty">暂无待审批的图</p>'; return; }
  box.innerHTML = "";
  for (const f of pend) box.appendChild(figCard(f, true));
}

function paintFigures() {
  const box = $("#tab-figures");
  const figs = Object.values(state.figures);
  if (!figs.length) { box.innerHTML = '<p class="empty">还没有图</p>'; return; }
  box.innerHTML = "";
  for (const f of figs.slice().reverse()) box.appendChild(figCard(f, false));
}

// ---------- 审批控件（侧栏卡片与浮层共用 —— 审批永远针对具体的图） ----------
function reviewControls(f) {
  const rev = state.review[f.figureId] || { status: "pending", note: "" };
  const box = document.createElement("div");
  box.className = "review-ctl";
  box.innerHTML = `
    <div class="meta">${badgeOf(rev.status)} <b>${escapeHtml(f.figureId)}</b> @${escapeHtml(f.at)} · ${escapeHtml(latestVer(f).model)}${f.versions.length > 1 ? ` · ${f.versions.length} 版` : ""}</div>
    ${rev.note ? `<div class="meta">意见：${escapeHtml(rev.note)}</div>` : ""}
    <textarea class="note-box" placeholder="哪里不对？（可选，AI 会读到）"></textarea>
    <div class="btn-row">
      <button class="btn ok" data-act="approve">通过</button>
      <button class="btn no" data-act="reject">驳回</button>
    </div>
    <div class="btn-row"><button class="btn ghost" data-act="feedback">提交反馈给 AI</button></div>`;
  box.querySelectorAll("[data-act]").forEach((btn) => {
    btn.onclick = async () => {
      const note = box.querySelector(".note-box").value.trim();
      const act = btn.dataset.act;
      const status = act === "approve" ? "approved" : act === "feedback" ? "pending" : "rejected";
      const resp = await fetch(`/api/review?doc=${DOC}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: TOKEN, figureId: f.figureId, status, note }),
      });
      const data = await resp.json();
      if (!resp.ok) return toast("提交失败：" + (data.error || resp.status));
      toast(act === "approve" ? "已通过，AI 可以出定稿了" : act === "feedback" ? "反馈已提交，AI 会读到" : "已驳回");
      await loadState(); paintAll();
      // 审批队列开着 → 这张已离开队列，原位自动落到下一张
      if (!$("#queue").classList.contains("hidden")) renderQueue();
      if (!$("#overlay").classList.contains("hidden") && currentFigureId === f.figureId) openFigure(f.figureId);
    };
  });
  return box;
}

function figCard(f, actionable) {
  const v = latestVer(f);
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<img class="thumb" src="${escapeHtml(figSrc(v.file))}" data-figure="${escapeHtml(f.figureId)}" alt="${escapeHtml(f.figureId)}">`;
  const body = document.createElement("div");
  body.className = "body";
  body.appendChild(reviewControls(f)); // 审批控件（含状态与意见）
  card.appendChild(body);
  card.querySelector(".thumb").onclick = () => openFigure(f.figureId);
  return card;
}

function paintTimeline() {
  const box = $("#tab-timeline");
  const evts = (state.events || []).slice().reverse();
  if (!evts.length) { box.innerHTML = '<p class="empty">暂无事件</p>'; return; }
  box.innerHTML = evts.map((e) => {
    const t = (e.t || "").slice(5, 19).replace("T", " ");
    const label = {
      "figure.created": "🖼 出图", "anchor.set": "📍 建锚", "billing.fallback": "💰 额度→余额",
      "review.approved": "✅ 通过", "review.rejected": "❌ 驳回", "review.reset": "↩ 重置",
    }[e.type] || e.type;
    return `<div class="evt"><b>${t}</b> ${escapeHtml(label)}${e.figure ? " " + escapeHtml(e.figure) : ""}${e.model ? ` · ${escapeHtml(e.model)}` : ""}${e.note ? ` — ${escapeHtml(e.note)}` : ""}</div>`;
  }).join("");
}

// ---------- 浮层（版本对比 / 全屏 / 就地审批） ----------
let currentFigureId = null;

function openFigure(figureId) {
  const f = state.figures[figureId];
  if (!f) return;
  currentFigureId = figureId;
  const rev = state.review[figureId] || { status: "pending" };
  $("#overlay-title").textContent = `${figureId} @${f.at}`;
  const body = $("#overlay-body");
  body.classList.remove("full");
  body.innerHTML = "";
  for (const v of f.versions) {
    const ver = document.createElement("div");
    ver.className = "ver";
    ver.innerHTML = `<img src="${escapeHtml(figSrc(v.file))}" data-figure="${escapeHtml(figureId)}" alt="${escapeHtml(v.file)}">
      <div class="meta">v${f.versions.indexOf(v) + 1} · ${escapeHtml(v.model)} · ${v.status === "final" ? "定稿" : "草稿"} · 计费 ${escapeHtml(v.channel)}</div>`;
    ver.querySelector("img").onclick = () => fullscreen(ver.querySelector("img").src);
    body.appendChild(ver);
  }
  // 右栏 = 锚定原文（这张图取材的文段，可跳回原文）+ 审批面板
  $("#overlay-review").innerHTML = "";
  const ctxBox = contextListOfFigure(figureId);
  if (ctxBox) $("#overlay-review").appendChild(ctxBox);
  $("#overlay-review").appendChild(reviewControls(f));
  $("#overlay").classList.remove("hidden");
  $("#btn-fs").onclick = () => fullscreen(figSrc(latestVer(f).file));
  $("#btn-locate").onclick = () => locateFigure(figureId);
}

// 在文档里定位这张图的上下文高亮（多图重叠时优先精确 quote 高亮，再退段落上下文）
function locateFigure(figureId) {
  $("#overlay").classList.add("hidden");
  let el = docView.querySelector(`.pf-hl[data-figures~="${figureId}"]`);
  if (!el) el = docView.querySelector(`.pf-ctx[data-ctx-figs~="${figureId}"]`);
  if (!el) { toast("文档里没有这张图的上下文高亮"); return; }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1800);
}

function fullscreen(src) {
  const body = $("#overlay-body");
  body.classList.add("full");
  body.innerHTML = "";
  // 🔴 不用 innerHTML 拼 <img onclick="...">：内联 handler 里再拼 JS 字符串
  //     转义链条太长，改用 DOM API 彻底消掉这个注入面（Mimosa 高危根因）
  const img = document.createElement("img");
  img.src = src;
  img.onclick = () => { body.classList.remove("full"); openFigure(currentFigureIdOf(src)); };
  body.appendChild(img);
}

function currentFigureIdOf(src) {
  const m = /figures\/([\w-]+)\//.exec(src);
  return m ? m[1] : "";
}

$("#btn-close").onclick = () => $("#overlay").classList.add("hidden");
$("#overlay").addEventListener("click", (e) => { if (e.target.id === "overlay") $("#overlay").classList.add("hidden"); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#overlay").classList.add("hidden"); });

// 点击高亮 / 段落上下文 → 打开对应图的审批面板（重叠区间优先打开有图的那个）
docView.addEventListener("click", (e) => {
  const hl = e.target.closest(".pf-hl");
  const fids = hl
    ? [hl.dataset.figure, ...(hl.dataset.figures || "").split(" ")]
    : [...((e.target.closest(".pf-ctx")?.dataset.ctxFigs) || "").split(" ")];
  const fid = fids.map((x) => x.trim()).filter(Boolean).find((x) => state.figures[x]);
  if (fid) return openFigure(fid);
  toast("这个锚点还没有图（等 AI 出图后再点）");
});

// ---------- 审批队列（看图直批：大图逐张过，不用回原文） ----------
// 用户要求：审批要有一个列表，看图就能直接通过/驳回，不必读原文。
// 队列只收 pending 的图；批准/驳回后自动落到下一张，清空时收尾。
let queueIdx = 0;
const pendingFigures = () => Object.values(state.figures)
  .filter((f) => (state.review[f.figureId]?.status || "pending") === "pending")
  .sort((a, b) => (a.at || "").localeCompare(b.at || "")); // 按出图顺序过，老的先批

function openQueue() {
  if (!pendingFigures().length) { toast("暂无待审批的图 —— 队列是空的"); return; }
  queueIdx = 0;
  $("#queue").classList.remove("hidden");
  renderQueue();
}

function renderQueue() {
  const list = pendingFigures();
  if (!list.length) {
    $("#queue").classList.add("hidden");
    toast("审批队列已清空 ✅");
    return;
  }
  if (queueIdx >= list.length) queueIdx = list.length - 1;
  if (queueIdx < 0) queueIdx = 0;
  const f = list[queueIdx];
  $("#queue-pos").textContent = `第 ${queueIdx + 1} / ${list.length} 张 · 全文共 ${Object.keys(state.figures).length} 张图`;
  const img = $("#queue-img-el");
  img.src = figSrc(latestVer(f).file);
  img.onclick = () => fullscreen(figSrc(latestVer(f).file));
  const side = $("#queue-side");
  side.innerHTML = "";
  side.appendChild(reviewControls(f)); // 自带状态徽标/意见框/通过驳回/反馈按钮
  const hint = document.createElement("p");
  hint.className = "meta";
  hint.style.marginTop = "10px";
  hint.textContent = "快捷键：← 上一张 · → 下一张。批完自动跳下一张；点大图看细节，浮层里可「定位上下文」回原文。";
  side.appendChild(hint);
}

$("#btn-queue").onclick = openQueue;
$("#queue-close").onclick = () => $("#queue").classList.add("hidden");
$("#queue-prev").onclick = () => { queueIdx -= 1; renderQueue(); };
$("#queue-next").onclick = () => { queueIdx += 1; renderQueue(); };
document.addEventListener("keydown", (e) => {
  if ($("#queue").classList.contains("hidden")) return;
  if (e.target.tagName === "TEXTAREA") return; // 意见框里打字不抢按键
  if (e.key === "ArrowLeft") $("#queue-prev").click();
  if (e.key === "ArrowRight") $("#queue-next").click();
});

// ---------- 杂项 ----------
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add("hidden"), 2600);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// tab 切换
document.querySelectorAll("#tabs button").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("#tabs button").forEach((x) => x.classList.remove("on"));
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    $("#tab-" + b.dataset.tab).classList.add("on");
  };
});
