// artifact.mjs — 产物取证：把「状态文件里写的路径」变成「磁盘上可复核的事实」
//
// 🔴 为什么要有这一层（2026-10-18 实测暴露）：
//    旧版 check 只校验步骤状态和字段非空——宿主把每步 note 写成「已定位」「都在」、
//    evidence 写成「看过了」、产物路径指向一个根本不存在的文件，check 照样 exit 0 说「可以交付」。
//    根因是「AI 自己写状态、自己判合格」= 自证。校验对象必须是外部事实：
//    文件在不在、是不是图、多大、哈希是多少、mtime 比开工晚不晚。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const IMG_EXT = /\.(png|jpe?g|webp|gif|tiff?)$/i;

// 低于这个尺寸的图不可能是交付图（防占位图、防 1×1 探针）
export const MIN_SIDE = 64;
export const MIN_BYTES = 1024;

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) { off++; continue; }
    const m = buf[off + 1];
    if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) { off += 2; continue; }
    if (off + 4 > buf.length) break;
    const len = buf.readUInt16BE(off + 2);
    if (len < 2) break;
    if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb)) {
      return { h: buf.readUInt16BE(off + 5), w: buf.readUInt16BE(off + 7) };
    }
    off += 2 + len;
  }
  return null;
}

function webpSize(buf) {
  if (buf.length < 30) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const fmt = buf.toString("ascii", 12, 16);
  if (fmt === "VP8X") return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  if (fmt === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  if (fmt === "VP8L") { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }; }
  return null;
}

export function imageSize(buf) {
  return pngSize(buf) || jpegSize(buf) || webpSize(buf);
}

// 从一段话里挑出「像文件路径」的 token（含扩展名，或含路径分隔符）
export function extractCandidates(text) {
  const toks = String(text || "")
    .split(/[\s"'“”‘’，。；、,;()（）\[\]<>《》|]+/)
    .filter(Boolean);
  const out = [];
  for (const t of toks) {
    const s = t.replace(/^[.:：]+|[,.:：]+$/g, "");
    if (!s) continue;
    if (/[\\/]/.test(s) || /\.[a-z0-9]{2,5}$/i.test(s)) out.push(s);
  }
  return [...new Set(out)];
}

// 读文件 → 取证记录（哈希 + 尺寸 + mtime），这是「事实」而不是「声明」
export function probe(absPath) {
  const st = fs.statSync(absPath);
  const buf = fs.readFileSync(absPath);
  const ext = path.extname(absPath).toLowerCase();
  let w = 0, h = 0, kind = "file";
  if (IMG_EXT.test(ext)) {
    kind = "image";
    const s = imageSize(buf);
    if (s) { w = s.w; h = s.h; }
  } else if (ext === ".svg") {
    kind = "vector";
    const txt = buf.toString("utf8").slice(0, 4000);
    const mw = txt.match(/\bwidth\s*=\s*["']?\s*([\d.]+)/i);
    const mh = txt.match(/\bheight\s*=\s*["']?\s*([\d.]+)/i);
    if (mw && mh) { w = Math.round(+mw[1]); h = Math.round(+mh[1]); }
  } else if (ext === ".pdf" || ext === ".pptx" || ext === ".eps") {
    kind = "vector";
  }
  return {
    path: absPath,
    ext, kind,
    bytes: st.size,
    w, h,
    sha256: sha256(buf),
    mtime: new Date(Math.round(st.mtimeMs)).toISOString(),
  };
}

// 在 note 里写的路径中，找到第一个真实存在的文件并取证
export function capture(note, bases) {
  const cands = extractCandidates(note);
  if (!cands.length) {
    return { ok: false, reason: "note 里没有产物文件路径（要带扩展名，如 figures/fig3.png / figs/v7.png）" };
  }
  const tried = [];
  for (const c of cands) {
    for (const b of bases.filter(Boolean)) {
      const abs = path.isAbsolute(c) ? path.normalize(c) : path.resolve(b, c);
      tried.push(abs);
      try {
        if (!fs.existsSync(abs)) continue;
        if (!fs.statSync(abs).isFile()) continue;
        return { ok: true, record: probe(abs) };
      } catch { /* 权限/瞬时错误：继续试下一个 */ }
    }
  }
  const uniq = [...new Set(tried)];
  return {
    ok: false,
    reason: `note 里的产物路径在磁盘上不存在：${cands.slice(0, 3).join(" / ")}（试过 ${uniq.length} 个位置，如 ${uniq.slice(0, 2).join(" / ")}）——先把文件真生成出来，再标记这一步`,
  };
}

// check 时复核：文件还在吗？还是同一个文件吗？
export function verify(rec) {
  if (!rec || !rec.path) return { ok: false, why: "产物没有取证记录（旧版状态文件或手工写进去的），无法复核" };
  let st;
  try { st = fs.statSync(rec.path); } catch { return { ok: false, why: `产物文件已不存在：${rec.path}（被删/被移走？）` }; }
  if (!st.isFile()) return { ok: false, why: `产物路径不是文件：${rec.path}` };
  let sha;
  try { sha = sha256(fs.readFileSync(rec.path)); } catch (e) { return { ok: false, why: `产物读不出来（${e.code}）：${rec.path}` }; }
  if (rec.sha256 && sha !== rec.sha256) {
    return { ok: false, why: `产物在标记之后被改动或替换了（sha256 标记=${rec.sha256.slice(0, 8)} 实际=${sha.slice(0, 8)}）：${rec.path}` };
  }
  if (rec.kind === "image") {
    if (rec.bytes < MIN_BYTES) return { ok: false, why: `产物只有 ${rec.bytes} 字节，不可能是交付图：${rec.path}` };
    if (rec.w && rec.h && (rec.w < MIN_SIDE || rec.h < MIN_SIDE)) {
      return { ok: false, why: `产物尺寸 ${rec.w}×${rec.h} 小于 ${MIN_SIDE}px，是占位图/探针图：${rec.path}` };
    }
  }
  // 回传磁盘上的真实 mtime：audit 拿它跟开工时间比，防"旧图冒充本轮产物"
  return { ok: true, mtimeMs: st.mtimeMs };
}

// ---- 证据质量：区分「可以复查的事实」与「听起来没问题的空话」 ----
const FILLER = /^(看过了?|看过|检查过了?|检查过|核对过了?|核对过|确认过了?|确认过|没问题|没有问题|无异常|很正常|正常|很好|都不错|不错|可以|ok|okay|fine|done|同上|已处理|处理完毕|符合要求|看起来很好|看起来没问题|看起来不错)$/i;

// 位置/度量实词：中文描述性证据（"第二列与第三列间距不齐"）也该算有效
const LOCUS = /(行|列|排|间距|间隙|基线|边缘|字号|字重|像素|px|毫米|厘米|百分比|位置|左上|右上|左下|右下|居中|对齐|截断|重叠|遮挡|留白|边距|宽度|高度|图块|标签|坐标|色值|色带|箭头|边框)/i;

export function evidenceQuality(text, { min = 8, label = "证据", anchor = true } = {}) {
  const t = String(text || "").trim();
  if (!t) return { ok: false, why: `${label}为空` };
  const bare = t.replace(/[。.!！~～\s"'“”‘’]/g, "");
  if (FILLER.test(bare)) return { ok: false, why: `${label}是空话（"${t.slice(0, 12)}"）——要写能复查的事实，不是评价` };
  if (t.length < min) return { ok: false, why: `${label}太短（${t.length} 字）——写清图上/文里具体是什么` };
  const anchors = [];
  if (/\d/.test(t)) anchors.push("数字");
  if (/[\\/]/.test(t) || /\.[a-z0-9]{2,5}\b/i.test(t)) anchors.push("文件路径");
  if (/["“'‘][^"”]{2,}["”'’]/.test(t)) anchors.push("原文引文");
  if (/[A-Za-z]{3,}/.test(t)) anchors.push("英文术语");
  if (LOCUS.test(t)) anchors.push("位置/度量");
  if (anchor && !anchors.length) {
    return { ok: false, why: `${label}没有可复查的锚点——至少要有一项：数字（4 行/3 列/12px）、文件路径、原文引号片段、英文术语、位置度量词。现在这句（"${t.slice(0, 16)}"）读不出你看过什么` };
  }
  return { ok: true, anchors };
}
