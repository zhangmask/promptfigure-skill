// png-trim.mjs — 白边自动裁剪（零依赖，Node 内置 zlib）
//
// 🔴 2026-09-21 V14 复盘：画布句命令"内容带撑满画布高度"premium 也不听（惯性构图，
// 内容带仍只占 ~46% 高度，上下空白 >50%）。措辞路线到头了 —— 留白改由**确定性后处理保证**：
// 解码 PNG → 扫描非白像素求内容包围盒 → 留白面积超阈值就裁到 bbox+窄边距 → 重编码回写。
// 任何一步异常都保留原图跳过（宁可多留白，不可损坏图）。
//
// 适用：color type 2 (RGB) / 6 (RGBA)，bit depth 8，非隔行 —— premium/standard 产出均如此。

import zlib from "node:zlib";

const CHUNK_TYPE = (buf, off) => buf.toString("ascii", off, off + 4);

// ---------- 解码（8-bit RGB/RGBA 非隔行）----------
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = CHUNK_TYPE(buf, off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    throw new Error(`unsupported PNG: depth=${bitDepth} color=${colorType} interlace=${interlace}`);
  }
  const ch = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(width * height * ch);
  // 反滤波（None/Sub/Up/Average/Paeth）
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  return { width, height, ch, pixels: out };
}

// ---------- 内容包围盒（非白 = 任一色通道 <250；透明也算内容外？不——全白背景不透明）----------
export function contentBbox({ width, height, ch, pixels }) {
  let top = height, bottom = -1, left = width, right = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * ch;
      const nonWhite = pixels[i] < 250 || pixels[i + 1] < 250 || pixels[i + 2] < 250;
      if (nonWhite) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (bottom < 0) return null;
  return { top, bottom, left, right };
}

// ---------- 编码（filter 0 每行，RGB 输出）----------
export function encodePng({ width, height, ch, pixels }) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter None
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * ch;
      const di = y * (stride + 1) + 1 + x * 3;
      raw[di] = pixels[si];
      raw[di + 1] = pixels[si + 1];
      raw[di + 2] = pixels[si + 2];
    }
  }
  const crcTable = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc32 = (b) => {
    let c = 0xffffffff;
    for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- 量化体检（2026-09-21 定规：核验数字由插件算，AI 只做语义判断）----------
// 留白占比 / 边缘带白度（纸张斑纹高发区）/ 彩色像素占比（黑白线稿风回归检测）
export function pngStats(buf, { step = 4 } = {}) {
  try {
    const img = decodePng(buf);
    const bbox = contentBbox(img);
    if (!bbox) return null;
    const cw = bbox.right - bbox.left + 1;
    const chh = bbox.bottom - bbox.top + 1;
    const wastePct = Number((100 * (1 - (cw * chh) / (img.width * img.height))).toFixed(1));

    // 边缘带（外圈 1.5%）白度：背景不是纯白（纸张纹理/斑驳底）在这里最明显
    const band = Math.max(4, Math.round(Math.min(img.width, img.height) * 0.015));
    let edgeTotal = 0, edgeWhite = 0;
    const isWhite = (i) => img.pixels[i] >= 248 && img.pixels[i + 1] >= 248 && img.pixels[i + 2] >= 248;
    for (let y = 0; y < img.height; y += 2) {
      for (let x = 0; x < img.width; x += 2) {
        const inBand = x < band || x >= img.width - band || y < band || y >= img.height - band;
        if (!inBand) continue;
        edgeTotal++;
        if (isWhite((y * img.width + x) * img.ch)) edgeWhite++;
      }
    }

    // 彩色像素占比（下采样）：饱和度 max-min>32 视为彩色。黑白线稿风的图显著偏低
    let total = 0, sat = 0;
    for (let y = 0; y < img.height; y += step) {
      for (let x = 0; x < img.width; x += step) {
        const i = (y * img.width + x) * img.ch;
        total++;
        const mx = Math.max(img.pixels[i], img.pixels[i + 1], img.pixels[i + 2]);
        const mn = Math.min(img.pixels[i], img.pixels[i + 1], img.pixels[i + 2]);
        if (mx - mn > 32) sat++;
      }
    }
    return {
      w: img.width, h: img.height,
      wastePct,
      edgeWhitePct: Number((100 * edgeWhite / Math.max(1, edgeTotal)).toFixed(1)),
      satPct: Number((100 * sat / Math.max(1, total)).toFixed(1)),
    };
  } catch {
    return null;
  }
}
// ---------- 裁剪主入口：留白面积占比 >maxWaste 才裁，边距留 ratio（占裁后短边比）----------
// 返回 { buf, from:{w,h}, to:{w,h}, savedPct } 或 null（不值得裁/出错）
export function trimWhitespace(pngBuf, { maxWaste = 0.3, marginRatio = 0.03 } = {}) {
  try {
    const img = decodePng(pngBuf);
    const bbox = contentBbox(img);
    if (!bbox) return null;
    const cw = bbox.right - bbox.left + 1;
    const chh = bbox.bottom - bbox.top + 1;
    const waste = 1 - (cw * chh) / (img.width * img.height);
    if (waste <= maxWaste) return null;
    const margin = Math.max(8, Math.round(Math.min(cw, chh) * marginRatio));
    const left = Math.max(0, bbox.left - margin);
    const top = Math.max(0, bbox.top - margin);
    const right = Math.min(img.width - 1, bbox.right + margin);
    const bottom = Math.min(img.height - 1, bbox.bottom + margin);
    const w2 = right - left + 1;
    const h2 = bottom - top + 1;
    const cropped = Buffer.alloc(w2 * h2 * img.ch);
    for (let y = 0; y < h2; y++) {
      img.pixels.copy(
        cropped,
        y * w2 * img.ch,
        ((top + y) * img.width + left) * img.ch,
        ((top + y) * img.width + right + 1) * img.ch
      );
    }
    return {
      buf: encodePng({ width: w2, height: h2, ch: img.ch, pixels: cropped }),
      from: { w: img.width, h: img.height },
      to: { w: w2, h: h2 },
      savedPct: Number((100 * (1 - (w2 * h2) / (img.width * img.height))).toFixed(1)),
    };
  } catch {
    return null; // 任何异常：保留原图
  }
}
