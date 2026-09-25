// tex.mjs — 解析 .tex：\section 层级 + 段落（一期只读预览，不编译）
// 支持 \input/\include 递归展开（CVPR 等模板 main.tex 只是壳，正文在 sec/*.tex）
// 🔴 多文件共享同一个章节计数器 —— 否则每个 input 文件里的 § 都从 1 重新数
// 图/表环境整体跳过，但 \caption{...} 单独抽成 caption 段（锚点定位高频目标）
import fs from "node:fs";
import path from "node:path";

const SKIP_ENVS = /(figure|table|algorithm|wraptable|wrapfigure)\*?/;
const SKIP_CMDS = /^\\(documentclass|usepackage|title|author|affiliations|email|maketitle|bibliographystyle|bibliography|input|includegraphics|graphicspath|label|ref|cite|pagestyle|thispagestyle|setlength|newcommand|renewcommand|def|let|providecommand|DeclareMathOperator|hypersetup|nocite|balance|printacmref|settopmatter|ccsdesc|keywords|terms|acmConference|acmBooktitle|acmPrice|acmISBN|acmDOI|fancyhead|fancyfoot|newenvironment|renewenvironment|vspace|hspace|quad|qquad|bibliographyplot|onecolumn|twocolumn|clearpage|newpage|tableofcontents|appendix|part|centering|raggedright|raggedleft|parbox|color|textcolor|definecolor|usebox|savebox|resizebox|scalebox|rotatebox|adjustbox|toprule|midrule|bottomrule|cmidrule|multicolumn|multirow|hline|cline|rowcolor|columncolor|arraystretch|tabcolsep|specialrule|addlinespace|makeatletter|makeatother|newlength|setcounter|addtocounter|value|numberwithin|allowdisplaybreaks|displaybreak|allowbreak|newline|linebreak|noindent|indent|parskip|par|smallskip|medskip|bigskip|vfill|cleardoublepage|cleardoublepage|frontmatter|mainmatter|backmatter|maketitle|printbibliography|endinput|includeonly|externaldocument|subfile|import|subimport|graphicspath)\b/;

function readTexFile(baseDir, rel, visited) {
  let p = path.resolve(baseDir, rel);
  if (!/\.tex$/i.test(p)) p += ".tex";
  if (visited.has(p) || !fs.existsSync(p)) return null;
  visited.add(p);
  return fs.readFileSync(p, "utf8");
}

export function parseTex(text, baseDir = ".") {
  const state = { blocks: [], counters: [0, 0, 0], paraIdx: 0 };
  parseInto(text, path.resolve(baseDir), state, new Set());
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
    blocks.push(b);
  };

  const handleLine = (rawLine) => {
    const line = rawLine.replace(/(?<!\\)%.*$/, "").trim();
    if (!line) { if (!env) flush(); return; }

    // ---- \input / \include 递归展开（共享计数器与 blocks）----
    const inc = /^\\(?:input|include)\{([^}]+)\}/.exec(line);
    if (inc) {
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
          blocks.push({
            i: blocks.length, type: "caption", level: 0, secPath: curSecPath(), para: paraIdx,
            text: "(figure without caption)", images: env.images,
          });
        }
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
