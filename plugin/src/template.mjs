// ─── 模板装配（2026-10-14 二轮返工：弃手写 SVG 坐标，改 HTML/CSS 排版 + headless Chromium 光栅化）───
// 高星项目做法：mermaid/D2 用 dagre/ELK 布局引擎；AutoFigure/open-plot-agent 用真实渲染器。
// 卡+图+箭头结构的成熟答案是浏览器排版引擎：flexbox 拉平等宽、align-items:stretch 拉平等高、
// 文字/换行/间距全由 Chromium 处理——手写坐标必出留白和错位（一轮 SVG 版实锤）。
// 本模块只负责：量图片宽高比（定每行卡高）→ 发 HTML → pf assemble 用本机 Chrome 截图成 PNG。
import { STAGE_COLOR_CYCLE } from "./figure-catalog.mjs";

// "Input | facial image; show a real example face || Diffusion | DSSIM; ..." → [{title, motif}]
export function parseStages(stagesStr) {
  return String(stagesStr || "")
    .split("||")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((seg) => {
      const [head] = seg.split(";");
      const [title, motif] = head.split("|").map((x) => x.trim());
      return { title: title || "", motif: motif || "" };
    });
}

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Okabe-Ito hex 提取："deep blue #0072B2" → "#0072B2"
const hexOf = (c) => (String(c.name).match(/#[0-9a-fA-F]{6}/) || ["#0072B2"])[0];

// ── 确定性网格：≤4 单行；5-6 两行三列；7-8 两行四列；更多拒装（SKILL.md ⑤ 实测守则）──
export function gridFor(n) {
  if (n <= 4) return { rows: 1, cols: n };
  if (n <= 6) return { rows: 2, cols: 3 };
  if (n <= 8) return { rows: 2, cols: 4 };
  throw new Error(`${n} 张卡超出模板网格上限（8）——拆成两张图或减少阶段。`);
}

// 画布宽度由网格形状定；高度装配后按内容实测推出
export function canvasFor(_ratio, rows, cols) {
  if ((rows || 1) <= 1) return { width: 2240, height: 0 };
  if ((cols || 4) <= 3) return { width: 1800, height: 0 };
  return { width: 2240, height: 0 };
}

// 嵌图：PNG/JPG 转 base64 data URI；PDF 先光栅化
async function embedImage(src) {
  let p = String(src);
  if (/\.pdf$/i.test(p)) {
    const { convertPdfToPng } = await import("./assets.mjs");
    p = convertPdfToPng(p);
  }
  const fs = await import("node:fs");
  const buf = fs.readFileSync(p);
  const mime = /\.jpg|\.jpeg/i.test(p) ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function imageSize(p) {
  const sharp = (await import("sharp")).default;
  const m = await sharp(/\.pdf$/i.test(p) ? (await import("./assets.mjs")).convertPdfToPng(p) : p).metadata();
  return { w: m.width, h: m.height };
}

// ── 模板装配主函数：发 HTML（排版交给浏览器引擎）──
// opts: { stages|stagesStr, slots, iconPaths, assetPaths, palette, ratio, arrows=true, map }
export async function buildTemplateSvg(opts = {}) {
  const stages = opts.stages || parseStages(opts.stagesStr);
  if (!stages.length) throw new Error("模板装配需要 stages（--stages \"A | t || B | t\"）");
  const n = stages.length;
  const { rows, cols } = gridFor(n);
  const W = canvasFor(opts.ratio, rows, cols).width;
  const palette = opts.palette || { cycle: STAGE_COLOR_CYCLE, custom: false };
  const slots = opts.slots || [];
  const iconPaths = opts.iconPaths || {};

  // 槽位→卡片归属（2026-10-14 审查机制，grid6 教训：结果图塞进方法卡无人拦）：
  // ① --map "name=idx" 显式 > ② scene 硬归属（槽位标记前最近的 "Card N" 句）
  //    > ③ 词面匹配（slot.name/about vs 阶段标题/母题，词级全等 len≥4，"noise"≠"denoise"）
  //    > ④ 声明顺序兜底。③④ 没过词面校验的装配后必须人审。
  // refOnly 槽位（craft 检出「仅作画法参考」措辞）一律不贴。同卡多槽位 = 争位，只留第一个。
  const toks = (str) => String(str || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  const stageToks = stages.map((st) => new Set([...toks(st.title), ...toks(st.motif || "")]));
  const matchStage = (s) => {
    const set = new Set([...toks(s.name), ...toks(s.about)]);
    let best = -1, hits = 0;
    stageToks.forEach((st, i) => {
      let h = 0; for (const t of set) if (st.has(t)) h++;
      if (h > hits) { hits = h; best = i; }
    });
    return hits ? { idx: best, hits } : null;
  };
  const assetByCard = {};
  const iconByCard = {};
  const assignMeta = {}; // name -> { idx, how, hits }
  const skipped = [];    // refOnly 拒贴
  const clashes = [];    // 同卡争位丢弃
  const mapPairs = (opts.map || "").split(",").map((s) => s.split("=").map((x) => x.trim())).filter((p) => p.length === 2);
  const fillOrder = slots.map((_, i) => i);
  for (const s of slots) {
    if (s.refOnly && s.kind === "asset") { skipped.push(s.name); continue; }
    const kindIsIcon = s.kind === "icon";
    const src = kindIsIcon ? iconPaths[s.name] : (opts.assetPaths || {})[s.name] || s.value;
    if (!src) continue;
    const sceneHit = matchStage(s);
    const explicit = mapPairs.find(([nm]) => nm === s.name);
    let idx, how;
    if (explicit) { idx = parseInt(explicit[1], 10) - 1; how = "map"; }
    else if (Number.isInteger(s.card) && s.card >= 1 && s.card <= n) { idx = s.card - 1; how = "scene"; }
    else if (sceneHit) { idx = sceneHit.idx; how = "scene"; }
    else { idx = fillOrder.shift(); how = "order"; }
    if (idx == null || idx < 0 || idx >= n) continue;
    const bucket = kindIsIcon ? iconByCard : assetByCard;
    if (bucket[idx]) { clashes.push(`${s.name} 与 ${bucket[idx].split(/[\\/]/).pop()} 争卡${idx + 1}（每卡一个图区，后者丢弃）`); continue; }
    fillOrder.splice(fillOrder.indexOf(idx), 1);
    assignMeta[s.name] = { idx, how, hits: sceneHit ? sceneHit.hits : 0 };
    bucket[idx] = src;
  }

  // 量内容：每卡图宽高比 → 行内最大者定该行卡高（同排等高），浏览器 flexbox 拉平等宽
  // 🔴 视觉对齐三轮（2026-10-15 用户再批 mod-v2「你自己看符合标准吗」）：
  //   ① 图区高度定死 = 行内图带高（.art 不再随内容收缩）——caption 紧跟图区下缘，
  //      同行 caption 基线对齐，不再钉卡底和图脱节；
  //   ② 占位卡 = 同高虚线框 + 中心「待绘制：<motif>」——纯灰块像渲染坏了；
  //   ③ 行内宽高比差距 > 2.2 → aspects 落进返回值，pf assemble 点名告警（换 crop/拆子图），
  //      无图卡也点名——内容失衡不许默默装完。
  const ASPECT_CAP = 0.85;
  const GAP = 56, MARGIN = Math.round(W * 0.034), PAD = 14;
  const cw = Math.floor((W - MARGIN * 2 - GAP * (cols - 1)) / cols);
  const titleFont = Math.max(20, Math.min(28, Math.round(cw * 0.046)));
  const noteFont = Math.max(14, Math.round(titleFont * 0.72));
  const EMPTY_ASPECT = 0.58;
  const aspects = [];
  for (let i = 0; i < n; i++) {
    const src = assetByCard[i] || iconByCard[i];
    if (!src) { aspects.push(EMPTY_ASPECT); continue; }
    try { const { w, h } = await imageSize(src); aspects.push(h / w); }
    catch { aspects.push(EMPTY_ASPECT); }
  }
  const artW = cw - PAD * 2;
  // 🔴 小注高度按行内最长 motif 估算行数（2026-10-15 自查：固定两行预留，3+ 行小注溢出定高卡）。
  // 混排宽度按 CJK 加权（CJK ≈ 0.85em，拉丁 ≈ 0.5em → 折算系数），行数封顶 5。
  const effLen = (s) => [...String(s)].reduce((acc, ch) => acc + (/[\u2E80-\u9FFF\uF900-\uFAFF\u3000-\u303F]/.test(ch) ? 1.7 : 1), 0);
  const charsPerLine = Math.max(8, Math.floor(artW / (noteFont * 0.58)));
  const rowNoteH = Array.from({ length: rows }, (_, r) => {
    const seg = stages.slice(r * cols, r * cols + cols).filter((st) => st.motif);
    if (!seg.length) return 0;
    const lines = Math.min(5, Math.max(...seg.map((st) => Math.ceil(effLen(st.motif) / charsPerLine))));
    return Math.round(noteFont * 1.35 * lines + 10);
  });
  const rowArtH = Array.from({ length: rows }, (_, r) =>
    Math.round(artW * Math.min(Math.max(...aspects.slice(r * cols, r * cols + cols)), ASPECT_CAP)));
  const rowCardH = rowArtH.map((ah, r) =>
    Math.round(titleFont * 1.55 + 12 + ah + PAD + rowNoteH[r]));
  const rowTop = [];
  { let y = MARGIN; for (let r = 0; r < rows; r++) { rowTop[r] = y; y += rowCardH[r] + GAP; } }
  const H = rowTop[rows - 1] + rowCardH[rows - 1] + MARGIN;

  // 发 HTML：卡=flex column（标题/色条/图区），行=flex row（卡 + CSS 连接箭头）
  const hueOf = (i) => hexOf(palette.cycle[i % palette.cycle.length]);
  const html = [];
  html.push(`<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#FFFFFF;font-family:Helvetica,Arial,"Segoe UI",sans-serif;}
#canvas{position:relative;width:${W}px;height:${H}px;background:#FFFFFF;}
#wrap{position:absolute;left:${MARGIN}px;top:${MARGIN}px;width:${W - MARGIN * 2}px;}
.row{display:flex;align-items:flex-start;margin-bottom:${GAP}px;}
.row:last-child{margin-bottom:0;}
.card{box-sizing:border-box;flex:1 1 0;border:1.25px solid #BDBDBD;border-radius:6px;background:#FFFFFF;padding:${PAD}px;display:flex;flex-direction:column;position:relative;}
.title{font-size:${titleFont}px;font-weight:600;color:#1A1A1A;letter-spacing:0.2px;line-height:1.2;}
.accent{width:30px;height:3.5px;border-radius:2px;margin:7px 0 10px;}
.art{flex:0 0 auto;display:flex;align-items:flex-start;justify-content:center;}
.art img{max-width:100%;max-height:100%;object-fit:contain;display:block;}
.note{margin-top:9px;padding-top:0;font-size:${noteFont}px;color:#5A5A5A;line-height:1.35;letter-spacing:0.2px;}
.placeholder{border:1px dashed #C9C9C9;border-radius:4px;background:#FAFAFA;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-align:center;}
.placeholder .ph-label{font-size:${noteFont}px;color:#9E9E9E;letter-spacing:0.4px;}
.placeholder .ph-motif{font-size:${Math.round(noteFont * 0.95)}px;color:#6B6B6B;max-width:88%;line-height:1.4;}
.arrow{flex:0 0 ${GAP}px;display:flex;align-items:center;align-self:stretch;padding-top:${Math.round(titleFont * 1.55 + 12) / 2}px;box-sizing:border-box;}
.arrow .line{flex:1 1 auto;height:2px;background:#4A4A4A;}
.arrow .head{width:0;height:0;border-top:4.5px solid transparent;border-bottom:4.5px solid transparent;border-left:7px solid #4A4A4A;}
</style></head><body><div id="canvas"><div id="wrap">`);
  // 🔴 wrap 开标签缺失事故（2026-10-15 用户批「上下左右间距有问题」实锤）：CSS 声明了 #wrap
  // （left/top=MARGIN）但 body 从没发出过这个 div——行 div 直接挂 #canvas 下，卡片贴死画布
  // 四边、边距全丢。此前多轮「对齐验证」都是在无边距渲染上做的，Read 看缩略图没发现。
  // 教训：几何声明必须和 DOM 结构互验，像素扫描（边框色带定位）才是真凭据。

  // 换行 U 形箭头：坐标全已知（卡高已实测定死），SVG overlay 精确画。
  // 注意：overlay 必须是 #canvas 的直接孩子（坐标含 MARGIN，画布坐标系）——
  // 放进 wrap 会二次偏移。所以 wrap 先关标签，overlay 垫在行后发出（见循环后）。

  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols), col = i % cols;
    const hue = hueOf(i);
    const firstInRow = col === 0;
    if (firstInRow) html.push(`<div class="row">`);
    // 行首卡前不留空（卡从左缘开始）；上一行末卡到本行首卡的箭头由 overlay 画
    html.push(`<div class="card" style="height:${rowCardH[row]}px;background:${hue}14;">`);
    const st = stages[i];
    if (st.title) {
      html.push(`<div class="title" id="title-${i + 1}">${esc(st.title)}</div>`);
      html.push(`<div class="accent" style="background:${hue};"></div>`);
    }
    const src = assetByCard[i] || iconByCard[i];
    if (src) {
      const href = await embedImage(src);
      // 图区定高（行内一致）+ 图顶部锚定：caption 紧跟图区下缘，同行基线对齐
      html.push(`<div class="art" style="height:${rowArtH[row]}px"><img id="${assetByCard[i] ? "asset" : "icon"}-${i + 1}" src="${href}" alt=""/></div>`);
    } else {
      // 占位卡：同高虚线框 + 中心标注——空卡必须自我说明，不许像渲染坏了
      const motif = st.motif ? esc(st.motif) : "由图像模型绘制此部分";
      html.push(`<div class="placeholder" id="art-${i + 1}" style="height:${rowArtH[row]}px"><div class="ph-label">待绘制</div><div class="ph-motif">${motif}</div></div>`);
    }
    // 模块小注（stage motif）：钉在卡底，同行基线对齐——空位被内容填掉而不是裸露
    if (st.motif) html.push(`<div class="note" id="note-${i + 1}">${esc(st.motif)}</div>`);
    html.push(`</div>`);
    // 行内箭头：卡间连接器（最后一张卡后不加）
    if (col + 1 < cols && i + 1 < n) html.push(`<div class="arrow"><div class="line"></div><div class="head"></div></div>`);
    if (col + 1 >= cols || i + 1 >= n) html.push(`</div>`);
  }
  html.push(`</div>`); // 关 #wrap（行都收在里面）

  // 换行 U 形箭头 overlay：#canvas 坐标系（坐标已含 MARGIN），盖在 wrap 上层
  if (opts.arrows !== false && n >= 2 && rows > 1) {
    const lastCol = cols - 1;
    const xStart = MARGIN + lastCol * (cw + GAP) + cw + 6;
    const xr = MARGIN + lastCol * (cw + GAP) + cw + GAP / 2;
    const y1 = rowTop[0] + Math.round(rowCardH[0] / 2);
    const yb = rowTop[0] + rowCardH[0] + GAP / 2;
    const xl = MARGIN - GAP / 2 + 6;
    const y2 = rowTop[1] + Math.round(rowCardH[1] / 2);
    html.push(`<svg style="position:absolute;inset:0;pointer-events:none" width="${W}" height="${H}">
<defs><marker id="ah" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#4A4A4A"/></marker></defs>
<path d="M${xStart},${y1} L${xr},${y1} L${xr},${yb} L${xl},${yb} L${xl},${y2} L${MARGIN - 6},${y2}" stroke="#4A4A4A" stroke-width="2" marker-end="url(#ah)" fill="none"/></svg>`);
  }
  html.push(`</div></body></html>`);

  // 无图卡点名（assemble 端升级为告警）：没有 asset 也没有 icon 的卡 = 占位或漏配
  const emptyCards = [];
  for (let i = 0; i < n; i++) if (!assetByCard[i] && !iconByCard[i]) emptyCards.push(i + 1);
  // 真实图宽高比（占位卡 = null）——失衡告警只比真实图，别把「待绘制」占位当待重裁内容
  const imgAspects = aspects.map((a, i) => ((assetByCard[i] || iconByCard[i]) ? a : null));

  const out = html.join("\n");
  return { html: out, placed: Object.keys(assetByCard).concat(Object.keys(iconByCard)).map((k) => ({ card: Number(k) + 1, kind: assetByCard[k] ? "asset" : "icon", src: assetByCard[k] || iconByCard[k] })), assignMeta, skipped, clashes, emptyCards, geometry: { width: W, height: H, rows, cols, cardW: cw, cardH: rowCardH[0], margin: MARGIN, gap: GAP, aspects, imgAspects, rowArtH } };
}
