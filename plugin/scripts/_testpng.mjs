// _testpng.mjs — 测试用真实 PNG 生成器（零依赖：手写 IHDR/IDAT/IEND + CRC32）
// 🔴 用途：workflow 的 produce 步现在要求产物文件真实存在并可解析尺寸，
//    测试不能再写假路径——必须现场生成一张合法 PNG。
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const T = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = T[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function makePng(file, w = 800, h = 600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const off = y * (w * 3 + 1);
    raw[off] = 0; // filter none
    for (let x = 0; x < w; x++) {
      const p = off + 1 + x * 3;
      raw[p] = (x * 7 + y * 3) & 255;
      raw[p + 1] = (y * 5) & 255;
      raw[p + 2] = 128;
    }
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  return { file, bytes: png.length, w, h };
}
