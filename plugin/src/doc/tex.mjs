// tex.mjs — 解析 .tex：\section 层级 + 段落（一期只读预览，不编译）
// 支持 \input/\include 递归展开（CVPR 等模板 main.tex 只是壳，正文在 sec/*.tex）
// 🔴 多文件共享同一个章节计数器 —— 否则每个 input 文件里的 § 都从 1 重新数
// 图/表环境整体跳过，但 \caption{...} 单独抽成 caption 段（锚点定位高频目标）
// 🔴 provenance（2026-10-13）：figure 环境捕获 label（引用反查）、\addplot table{}/\input{}
// 数据源、原图/数据文件落 materials（绝对路径+sha1，Sumatra 式校验）；正文 \ref 反查引用段落。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SKIP_ENVS = /(figure|table|algorithm|wraptable|wrapfigure)\*?/;
const SKIP_CMDS = /^\\(documentclass|usepackage|title|author|affiliations|email|maketitle|bibliographystyle|bibliography|input|includegraphics|graphicspath|label|ref|cite|pagestyle|thispagestyle|setlength|newcommand|renewcommand|def|let|providecommand|DeclareMathOperator|hypersetup|nocite|balance|printacmref|settopmatter|ccsdesc|keywords|terms|acmConference|acmBooktitle|acmPrice|acmISBN|acmDOI|fancyhead|fancyfoot|newenvironment|renewenvironment|vspace|hspace|quad|qquad|bibliographyplot|onecolumn|twocolumn|clearpage|newpage|tableofcontents|appendix|part|centering|raggedright|raggedleft|parbox|color|textcolor|definecolor|usebox|savebox|resizebox|scalebox|rotatebox|adjustbox|toprule|midrule|bottomrule|cmidrule|multicolumn|multirow|hline|cline|rowcolor|columncolor|arraystretch|tabcolsep|specialrule|addlinespace|makeatletter|makeatother|newlength|setcounter|addtocounter|value|numberwithin|allowdisplaybreaks|displaybreak|allowbreak|newline|linebreak|noindent|indent|parskip|par|smallskip|medskip|bigskip|vfill|cleardoublepage|cleardoublepage|frontmatter|mainmatter|backmatter|maketitle|printbibliography|endinput|includeonly|externaldocument|subfile|import|subimport|graphicspath)\b/;

function readTexFile(baseDir, rel, visited) {
  let p = path.resolve(baseDir, rel);
  if (!/\.tex$/i.test(p)) p += ".tex";
  if (visited.has(p) || !fs.existsSync(p)) return null;
  visited.add(p);
  return fs.readFileSync(p, "utf8");
}

// ---------- provenance 资产解析（2026-10-13）----------
// includegraphics 惯例省扩展名（graphicx 按 .pdf>.png>.jpg 顺序试），这里同样逐个试；
// 找到就算 sha1（Sumatra 式 digest：防文件被换），找不到也记录原始引用（sha1 置 null）。
const ASSET_EXTS = ["", ".pdf", ".png", ".jpg", ".jpeg", ".eps", ".svg"];
function resolveAsset(baseDir, rel) {
  const clean = String(rel || "").trim().replace(/\\/g, "/");
  for (const ext of ASSET_EXTS) {
    const p = path.resolve(baseDir, clean + ext);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      let sha1 = null;
      try { sha1 = crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex"); } catch { /* 读不了不阻断 */ }
      return { path: p, sha1 };
    }
  }
  return { path: path.resolve(baseDir, clean), sha1: null };
}

function buildMaterials(baseDir, images = [], dataFiles = []) {
  const mats = [];
  for (const img of images) {
    const r = resolveAsset(baseDir, img);
    mats.push({ path: r.path, role: "figure", sha1: r.sha1, ref: img });
  }
  for (const d of dataFiles) {
    const r = resolveAsset(baseDir, d);
    mats.push({ path: r.path, role: "data", sha1: r.sha1, ref: d });
  }
  return mats;
}

export function parseTex(text, baseDir = ".") {
  const state = { blocks: [], counters: [0, 0, 0], paraIdx: 0 };
  parseInto(text, path.resolve(baseDir), state, new Set());
  // 🔴 provenance \ref 反查（2026-10-13）：正文 `\ref{fig:xxx}` 出现的段落回挂到
  // 对应图注块的 refParagraphs —— "这张图对应文章哪些上下文"的精确答案（比 ±1 段更准）
  const labelOwner = new Map();
  for (const b of state.blocks) {
    if (b.type === "caption" && b.labels?.length) for (const l of b.labels) labelOwner.set(l, b);
  }
  for (const b of state.blocks) {
    if (b.type !== "para" || !b.text.includes("\\ref{")) continue;
    for (const m of b.text.matchAll(/\\(?:auto|autoref|cref|Cref|ref)\{([^}]+)\}/g)) {
      const owner = labelOwner.get(m[1]);
      if (owner) (owner.refParagraphs ||= []).push({ secPath: b.secPath, para: b.para, snippet: b.text.slice(0, 120) });
    }
  }
  const outline = state.blocks.filter((b) => b.type === "heading")
    .map((b) => ({ path: b.secPath, level: b.level, title: b.text, blockIdx: b.i }));
  return { blocks: state.blocks, outline };
}

function parseInto(text, baseDir, state, visited) {
  const blocks = state.blocks;
  const counters = state.counters;
  let paraIdx = state.paraIdx;
  let buf = [];
  let env = null;

  const curSecPath = () => {
    const k = counters.findIndex((c) => c === 0);
    return counters.slice(0, k === -1 ? 3 : Math.max(k, 1)).join(".");
  };

  const flush = () => {
    const t = buf.join(" ").replace(/\s+/g, " ").trim();
    buf = [];
    if (!t) return;
    paraIdx += 1;
    state.paraIdx = paraIdx;
    blocks.push({ i: blocks.length, type: "para", level: 0, secPath: curSecPath(), para: paraIdx, text: t });
  };

  const pushHeading = (level, title) => {
    flush();
    counters[level - 1] += 1;
    for (let i = level; i < 3; i++) counters[i] = 0;
    paraIdx = 0;
    state.paraIdx = 0;
    blocks.push({ i: blocks.length, type: "heading", level, secPath: counters.slice(0, level).join("."), para: 0, text: title });
  };

  const pushCaption = (cap, images) => {
    flush();
    const t = cap.replace(/\s+/g, " ").trim();
    if (!t && !images?.length) return;
    paraIdx += 1;
    state.paraIdx = paraIdx;
    const b = { i: blocks.length, type: "caption", level: 0, secPath: curSecPath(), para: paraIdx, text: t };
    // 原图清单：figure 环境里捕获的 \includegraphics 路径挂到图注块上（pf doc figures 用）
    if (images?.length) b.images = images;
    // 🔴 provenance（2026-10-13）：label（\ref 反查）+ materials（原图/数据文件，绝对路径+sha1）
    // label 常写在 caption 之后（LaTeX 惯例），此处先挂已有的；行内后到的由 env 结束时回填（env.b）
    if (env?.labels?.length) b.labels = env.labels;
    const mats = buildMaterials(baseDir, images || [], env?.dataFiles || []);
    if (mats.length) b.materials = mats;
    env.b = b;
    blocks.push(b);
  };

  const handleLine = (rawLine) => {
    const line = rawLine.replace(/(?<!\\)%.*$/, "").trim();
    if (!line) { if (!env) flush(); return; }

    // ---- \input / \include 递归展开（共享计数器与 blocks）----
    const inc = /^\\(?:input|include)\{([^}]+)\}/.exec(line);
    if (inc) {
      // 🔴 provenance：figure 环境内的 \input 不是章节展开，是数据文件（如 \input{data.tsv}）
      if (env) {
        (env.dataFiles ||= []).push(inc[1]);
        return;
      }
      flush();
      const sub = readTexFile(baseDir, inc[1], visited);
      if (sub) parseInto(sub, baseDir, state, visited);
      const rest = line.slice(inc[0].length).trim();
      if (rest) handleLine(rest);
      return;
    }

    // ---- 图/表环境：跳过内容，抓 caption ----
    const beginEnv = /\\begin\{([^}]+)\}/.exec(line);
    if (beginEnv && SKIP_ENVS.test(beginEnv[1])) {
      flush();
      env = { name: beginEnv[1] };
    }
    if (env) {
      // 捕获 figure 环境内的原图引用（\includegraphics[opts]{path}，subfigure 多图全收）
      const ig = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g;
      let igm;
      while ((igm = ig.exec(line))) (env.images ||= []).push(igm[1]);
      // 🔴 provenance：label（\ref 反查锚点）+ 数据源（\addplot…{path} / \verbatiminput{path}）
      const lb = /\\label\{([^}]+)\}/g;
      let lbm;
      while ((lbm = lb.exec(line))) (env.labels ||= []).push(lbm[1]);
      const df = /\\(?:addplot|addplot\+|plot)\s*(?:\[[^\]]*\])?\s*(?:table\s*(?:\[[^\]]*\])?\s*)?\{([^}]+)\}/g;
      let dfm;
      while ((dfm = df.exec(line))) (env.dataFiles ||= []).push(dfm[1]);
      const vi = /\\verbatiminput\*?(?:\[[^\]]*\])?\{([^}]+)\}/g;
      let vim;
      while ((vim = vi.exec(line))) (env.dataFiles ||= []).push(vim[1]);
      const capM = /\\caption\*?(?:\[([^\]]*)\])?\{/.exec(line);
      if (capM) {
        const start = line.indexOf("{", capM.index) + 1;
        let d = 1, cap = "";
        for (let i = start; i < line.length && d > 0; i++) {
          const ch = line[i];
          if (ch === "{") d++;
          else if (ch === "}") d--;
          if (d > 0) cap += ch;
        }
        pushCaption(cap, env.images);
        env.images = null;
        env.captioned = true;
      }
      if (/\\end\{([^}]+)\}/.test(line) && RegExp.$1 === env.name) {
        // 有原图引用但没写 caption 的环境（少见）：落一个 caption 块兜底，别让原图清单漏图
        if (env.images?.length && !env.captioned) {
          paraIdx += 1;
          state.paraIdx = paraIdx;
          const nb = {
            i: blocks.length, type: "caption", level: 0, secPath: curSecPath(), para: paraIdx,
            text: "(figure without caption)", images: env.images,
          };
          // provenance 同样挂 label/materials（无 caption 的图也要能溯源）
          if (env.labels?.length) nb.labels = env.labels;
          const mats2 = buildMaterials(baseDir, env.images || [], env.dataFiles || []);
          if (mats2.length) nb.materials = mats2;
          env.b = nb;
          blocks.push(nb);
        }
        // 🔴 provenance 回填：label/dataFiles 写在 caption 之后的（LaTeX 惯例），
        // 此时才捕获齐——补挂 label；materials 增量合并（caption 行已把 env.images 置 null，
        // 重算会冲掉图片条目，所以只补数据文件新增项）
        if (env.b) {
          if (env.labels?.length) env.b.labels = env.labels;
          if (env.dataFiles?.length) {
            const extra = buildMaterials(baseDir, [], env.dataFiles)
              .filter((e) => !(env.b.materials || []).some((m) => m.ref === e.ref));
            if (extra.length) env.b.materials = [...(env.b.materials || []), ...extra];
          }
        }
        env = null;
        env = null;
      }
      return;
    }

    // ---- 章节标题（括号配平，支持嵌套花括号）----
    if (/^\\(?:sub){0,2}section\*?\s*\{/.test(line)) {
      const level = line.startsWith("\\subsubsection") ? 3 : line.startsWith("\\subsection") ? 2 : 1;
      const start = line.indexOf("{") + 1;
      let d = 1, title = "";
      for (let i = start; i < line.length && d > 0; i++) {
        const ch = line[i];
        if (ch === "{") d++;
        else if (ch === "}") d--;
        if (d > 0) title += ch;
      }
      title = title.replace(/\\[a-zA-Z]+\{([^}]*)\}/g, "$1").replace(/[{}]/g, "").trim();
      pushHeading(level, title);
      return;
    }

    // ---- 顺序敏感：\end{document} 之后的行全忽略（常有注释草稿）----
    if (/^\\end\{document\}/.test(line)) { flush(); state.stop = true; return; }
    if (state.stop) return;

    if (SKIP_CMDS.test(line)) { flush(); return; }

    if (/^\\begin\{(center|enumerate|itemize|quote|abstract|spacing|list|description)\}/.test(line)) { flush(); return; }

    if (/^\\item\b/.test(line)) {
      flush();
      buf.push(line.replace(/^\\item\s*/, "").replace(/\[[^\]]*\]/, "").trim());
      return;
    }
    buf.push(line);
  };

  for (const raw of text.split(/\r?\n/)) {
    if (state.stop) break;
    handleLine(raw);
  }
  flush();
}
