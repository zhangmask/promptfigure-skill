// docx.mjs — 服务端解析 .docx：段落文本 + 章节路径推断（§3.2 ¶2）
// 只读 word/document.xml，不依赖样式文件；标题识别 pStyle Heading1-6 / 标题1-6
import JSZip from "jszip";

function decodeXml(s) {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function headingLevel(style) {
  if (!style) return 0;
  const m = /^(?:Heading|heading|标题)\s*(\d)$/.exec(style.trim());
  return m ? Math.min(parseInt(m[1], 10), 6) : 0;
}

export async function parseDocx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const entry = zip.file("word/document.xml");
  if (!entry) throw new Error("不是有效的 .docx（缺 word/document.xml）");
  const xml = await entry.async("string");

  const blocks = []; // { i, type:'heading'|'para', level, secPath, para, text }
  const counters = [0, 0, 0, 0, 0, 0];
  let paraIdx = 0;

  const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>|<w:p\b[^>]*\/>/g;
  let m;
  while ((m = pRe.exec(xml))) {
    const inner = m[1] || "";
    const styleM = /<w:pStyle w:val="([^"]+)"/.exec(inner);
    const level = headingLevel(styleM && styleM[1]);
    let text = "";
    const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let t;
    while ((t = tRe.exec(inner))) text += t[1];
    text = decodeXml(text).replace(/\s+/g, " ").trim();
    if (!text && level === 0) continue;

    if (level > 0) {
      counters[level - 1] += 1;
      for (let i = level; i < 6; i++) counters[i] = 0;
      paraIdx = 0;
    } else {
      paraIdx += 1;
    }

    // 当前生效章节路径 = 计数器从第一个 0 处截断（全非 0 则取全部 6 级）
    const firstZero = counters.indexOf(0);
    const curSec = counters.slice(0, firstZero === -1 ? 6 : firstZero).join(".");

    blocks.push({
      i: blocks.length,
      type: level > 0 ? "heading" : "para",
      level,
      secPath: level > 0 ? counters.slice(0, level).join(".") : curSec,
      para: level > 0 ? 0 : paraIdx,
      text,
    });
  }

  // outline：树形章节
  const outline = [];
  for (const b of blocks) {
    if (b.type !== "heading") continue;
    outline.push({ path: b.secPath, level: b.level, title: b.text, blockIdx: b.i });
  }
  return { blocks, outline };
}
