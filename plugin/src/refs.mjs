// ---------- refs.mjs：本地参考图检索（2026-10-14 参考库链路 P0 核心） ----------
// 对标 PaperBanana Retriever（6.8k★ 核心差异化）：从顶会真实论文图库检索同模块画法，
// 宿主 AI 多模态看图提炼规范画法写进 show 句。纯 Node BM25，零依赖、零 API 成本。
//
// 检索设计（对应 2026-10-14 计划讨论的四个补丁）：
//   ① 字段加权：方法正文 > 图注 > 标题/摘要——模块名（TTA、IoU-Graph）活在正文里，
//      图注往往只有 "Overview of our framework"
//   ② 正文分块索引：长方法正文按段落切块，整图得分 = 最佳块得分（避免长文稀释）
//   ③ 查询包机制：宿主 AI 扩写查询（本名+同义词+类别族+操作动词），本引擎只做
//      确定性排序——语义扩写是宿主 AI 的活，检索是插件的活
//   ④ 相关性闸：低于 minScore 宁可不注入——错误参考比没参考更糟（vague specs 同款风险）
//
// 判断原则：不预审整个库，只审检索结果（top-k 由宿主 AI 终审看图）。

import fs from "node:fs";
import path from "node:path";

// —— 英文停用词（检索专用，短表够用）——
const STOP = new Set(("a an the of in on at to for with by from as is are was were be been " +
  "and or not we our us their its this that these those it he she they them his her " +
  "which what who whom whose where when how why all any each other more most some such no nor " +
  "can could will would shall should may might must do does did done have has had " +
  "figure fig table section eq equation ref vs etc").split(/\s+/));

const tokenize = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));

// 带相邻 bigram 的分词：短语信号（"test_time_augmentation"）IDF 远高于
// 拆开的 "test"+"augmentation"，是区分主题相关性的关键（2026-10-14 实测：
// 纯 unigram 时高频词 image/grid 把气象 GNN 论文顶到 TTA 查询的第一名）。
const tokenizeBi = (text) => {
  const uni = tokenize(text);
  const bi = [];
  for (let i = 0; i < uni.length - 1; i++) bi.push(uni[i] + "_" + uni[i + 1]);
  return [...uni, ...bi];
};

// —— 条目归一化：PaperBananaBench diagram 实测字段（2026-10-14 下载钉死）——
// { id, content(方法正文 markdown ~13.6KB), visual_intent(图注 "Figure N: ..."),
//   path_to_gt_image, category, additional_info{method_section_title,width,height,...}, split }
// 仍保留通用字段名容错，防止上游结构变化直接炸。
function normalizeEntry(raw) {
  const pick = (obj, keys) => {
    for (const k of keys) {
      if (obj[k] != null && String(obj[k]).trim()) return String(obj[k]).trim();
    }
    return "";
  };
  const caption = pick(raw, ["visual_intent", "caption", "caption_text", "fig_caption", "figure_caption"]);
  const method = pick(raw, ["content", "method", "method_text", "paper_text", "context", "section_text", "text"]);
  const info = raw.additional_info && typeof raw.additional_info === "object" ? raw.additional_info : {};
  const title = pick(info, ["method_section_title", "file_name"]) || pick(raw, ["title", "paper_title"]);
  const image = pick(raw, ["path_to_gt_image", "image", "image_path", "file", "file_name", "filename", "path"]);
  const id = pick(raw, ["id", "figure_id", "name", "key"]) || image || Math.random().toString(36).slice(2, 10);
  const figType = pick(raw, ["category", "figure_type", "type"]);
  return { id, caption, method, title, image, figType };
}

// 正文按段落切块（≥40 字符才算块），块内保留原文用于摘录回显
function chunkMethod(method) {
  const paras = String(method || "").split(/\n{1,}|(?<=\.)\s{2,}/).map((p) => p.trim()).filter((p) => p.length >= 40);
  return paras.length ? paras : (method ? [method] : []);
}

// —— BM25 索引 ——
export class RefsIndex {
  constructor() {
    this.docs = []; // { id, fields: {method:[chunkTok...], caption:tok, title:tok}, raw }
    this.df = new Map(); // term -> doc(块) 频率
    this.nChunks = 0;
    this.avgLen = 0;
  }

  addFigure(entryRaw, imgBaseDir) {
    const e = normalizeEntry(entryRaw);
    if (!e.image && !e.caption && !e.method) return;
    const chunks = chunkMethod(e.method);
    const fig = {
      id: e.id, caption: e.caption, title: e.title, figType: e.figType,
      image: e.image, imageAbs: imgBaseDir ? path.join(imgBaseDir, e.image) : e.image,
      chunks,
    };
    this.docs.push(fig);
  }

  finalize() {
    // 每图 = 一个"文档"，权重按字段：方法块×2.0、图注×1.0、标题×0.5（拼接为加虚拟重复实现加权）
    this.chunks = []; // { fig, tokens, len, base }
    let totalLen = 0;
    for (const fig of this.docs) {
      for (const ch of fig.chunks) {
        const base = tokenize(ch);
        const tokens = [...tokenizeBi(ch), ...tokenizeBi(fig.caption), ...tokenize(fig.title).slice(0, 20)];
        if (!tokens.length) continue;
        this.chunks.push({ fig, tokens, len: tokens.length, base });
        totalLen += tokens.length;
        for (const t of new Set(tokens)) this.df.set(t, (this.df.get(t) || 0) + 1);
      }
      // 无正文块时图注单独成块（短图注也是合法检索单元）
      if (!fig.chunks.length && fig.caption) {
        const tokens = [...tokenizeBi(fig.caption), ...tokenize(fig.title).slice(0, 20)];
        if (tokens.length) {
          this.chunks.push({ fig, tokens, len: tokens.length });
          totalLen += tokens.length;
          for (const t of new Set(tokens)) this.df.set(t, (this.df.get(t) || 0) + 1);
        }
      }
    }
    this.nChunks = this.chunks.length;
    this.avgLen = this.nChunks ? totalLen / this.nChunks : 0;
  }

  // 单查询 BM25（k1=1.5 b=0.75），返回 Map(figId -> {score, bestChunk})
  bm25(query) {
    const qTokens = [...new Set(tokenizeBi(query))];
    const K1 = 1.5, B = 0.75;
    const hits = new Map();
    for (const q of qTokens) {
      const df = this.df.get(q);
      if (!df) continue;
      const idf = Math.log(1 + (this.nChunks - df + 0.5) / (df + 0.5));
      for (const ch of this.chunks) {
        const tf = ch.tokens.reduce((n, t) => (t === q ? n + 1 : n), 0);
        if (!tf) continue;
        const norm = tf * (K1 + 1) / (tf + K1 * (1 - B + B * ch.len / this.avgLen));
        const s = idf * norm;
        const cur = hits.get(ch.fig.id) || { score: 0, bestScore: 0, bestChunk: "", fig: ch.fig };
        cur.score += s;
        // bestChunk 记【最高贡献块】而非首个命中块（修正 2026-10-14 实测的摘录错位）
        if (s > cur.bestScore) { cur.bestScore = s; cur.bestChunk = (ch.base || []).join(" ").slice(0, 400) || ch.fig.caption.slice(0, 400); }
        hits.set(ch.fig.id, cur);
      }
    }
    return hits;
  }

  // 多查询检索：每图取跨查询最高分 + 命中查询数加成（查询包内多查询同中 = 更强证据）
  // minScore 是相对阈值（占 top 分比例，默认 0.15）——BM25 绝对分随查询包长度/领域漂移，
  // 只有相对值跨查询可比；低于阈值的宁可不注入（错误参考比没参考更糟）。
  search(queries, { k = 5, minScore = 0.15 } = {}) {
    const merged = new Map();
    for (const q of queries.filter(Boolean)) {
      for (const [id, h] of this.bm25(q)) {
        const cur = merged.get(id) || { id, score: 0, qHits: new Set(), fig: h.fig, bestChunk: h.bestChunk };
        cur.qHits.add(q);
        if (h.score > cur.score) { cur.score = h.score; cur.bestChunk = h.bestChunk; }
        merged.set(id, cur);
      }
    }
    const scored = [...merged.values()]
      .map((r) => ({ ...r, score: r.score * (1 + 0.15 * (r.qHits.size - 1)), nQueries: r.qHits.size }))
      .sort((a, b) => b.score - a.score);
    const top = scored[0]?.score || 0;
    const results = scored.filter((r) => top > 0 && r.score >= top * minScore).slice(0, k);
    return { results, total: merged.size, topScore: top };
  }
}

// —— 加载库（支持 zip 已解压目录；ref.json 字段钉死后走 normalizeEntry 容错）——
export function loadRefsIndex(refsDir) {
  const refJson = path.join(refsDir, "ref.json");
  if (!fs.existsSync(refJson)) {
    // 容错：refsDir 下找深层 ref.json（bench 解压后是 references/paperbanana/PaperBananaBench/diagram/ref.json）
    const found = findRefJson(refsDir, 4);
    if (!found) return null;
    return loadFrom(found.dir, found.jsonPath);
  }
  return loadFrom(refsDir, refJson);
}

function findRefJson(dir, depth) {
  if (depth < 0 || !fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile() && e.name === "ref.json") return { dir, jsonPath: path.join(dir, e.name) };
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const r = findRefJson(path.join(dir, e.name), depth - 1);
      if (r) return r;
    }
  }
  return null;
}

function loadFrom(dir, jsonPath) {
  const idx = new RefsIndex();
  const lists = [];
  const loadList = (p) => {
    if (!fs.existsSync(p)) return;
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    let list = null;
    if (Array.isArray(raw)) list = raw;
    else if (Array.isArray(raw.diagrams)) list = raw.diagrams;
    else if (Array.isArray(raw.plots)) list = raw.plots;
    else if (raw.data && Array.isArray(raw.data)) list = raw.data;
    else if (typeof raw === "object") {
      const vals = Object.values(raw).filter((v) => v && typeof v === "object");
      if (vals.length) list = vals;
    }
    if (list) lists.push(...list);
  };
  loadList(jsonPath);
  // 同目录 test.json 是同格式的另一半 split（ref 298 + test 292 ≈ 590 张图），一并入索引
  const twin = path.join(path.dirname(jsonPath), "test.json");
  if (twin !== jsonPath) loadList(twin);
  if (!lists.length) return null;
  for (const entry of lists) idx.addFigure(entry, dir);
  idx.finalize();
  return idx;
}
