// src/montage.mjs — 宽条图重排成网格（pf montage）
// 2026-10-15 用户定规「什么效果好用什么，只有实测效果好才行」：mod 排版迭代里
// 条图（宽高比 0.16）在同排等高排版本注定留巨大空位，重排成 2×3 网格后宽高比
// 0.68 正好对上邻卡 0.69——当时是手工 sharp 步骤，收编成命令。
// 关键实测教训（mod-v4→v6）：目测均分裁切带出黑边（子图间隔不均匀），列亮度扫描
// 找白色间隔才裁得准——所以边界检测是默认行为，不提供"目测均分"模式。
import sharp from "sharp";

// 在整宽上按列平均亮度找「白色间隔」，返回内容段 [[l,r],...]（像素坐标，闭区间）
async function detectSegments(src, { threshold = 235, minFrac = 0.03, scaleY = 64 }) {
  const meta = await sharp(src).metadata();
  const W = meta.width;
  const H = Math.max(1, Math.min(meta.height, scaleY * 8));
  const { data, info } = await sharp(src)
    .extract({ left: 0, top: 0, width: W, height: H })
    .flatten({ background: "#ffffff" })
    .greyscale()
    .raw().toBuffer({ resolveWithObject: true });
  const colMean = new Array(W).fill(0);
  for (let y = 0; y < info.height; y++) {
    const row = y * info.width;
    for (let x = 0; x < W; x++) colMean[x] += data[row + x];
  }
  for (let x = 0; x < W; x++) colMean[x] /= info.height;
  const minW = Math.max(8, Math.round(W * minFrac)); // 内容段最小宽度（标签字/噪点不算子图）
  const segs = [];
  let s = null;
  for (let x = 0; x < W; x++) {
    const content = colMean[x] <= threshold; // 暗 = 有内容
    if (content && s == null) s = x;
    if (!content && s != null) { if (x - s >= minW) segs.push([s, x - 1]); s = null; }
  }
  if (s != null && W - s >= minW) segs.push([s, W - 1]);
  return segs;
}

// 选列数：在 1..N 里挑让网格宽高比最接近 target 的（rows=ceil(N/cols)）
function chooseCols(n, cellAspect, target) {
  let best = 1, bestErr = Infinity;
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c);
    const aspect = (r * cellAspect) / c; // H/W
    const err = Math.abs(aspect - target);
    if (err < bestErr - 1e-9) { bestErr = err; best = c; }
  }
  return best;
}

export async function montageStrip({
  src, crop, out,
  cols, rows, target = 0.7,
  gap = 24, inset = 4, bg = "#FFFFFF",
  threshold = 235, minFrac = 0.03, segments,
}) {
  const sharpFn = sharp(src).flatten({ background: "#ffffff" });
  if (crop) {
    let [l, t, w, h] = crop.split(",").map((v) => parseInt(v.trim(), 10));
    if ([l, t, w, h].some((v) => !Number.isFinite(v) || v < 0) || w < 1 || h < 1) {
      throw new Error(`crop 参数非法：${crop}（应为 左,上,宽,高 像素）`);
    }
    // 🔴 越界 clamp+告警（与 assets.mjs prepareAssetImage 同语义）：目测坐标经常多算几像素，
    // 硬报错挡住整条流程没必要，但静默 clamp 会让宿主以为坐标是对的——必须回显。
    const meta0 = await sharp(src).metadata();
    const cl = {};
    if (l + w > meta0.width) { cl.w = meta0.width - l; w = cl.w; }
    if (t + h > meta0.height) { cl.h = meta0.height - t; h = cl.h; }
    if (Object.keys(cl).length) {
      console.error(`⚠️ montage: crop 越界已 clamp（原 ${crop} → 宽${cl.w ?? w}×高${cl.h ?? h}）——坐标是目测的吧？按真实像素重定`);
    }
    sharpFn.extract({ left: l, top: t, width: w, height: h });
  }
  const strip = await sharpFn.png().toBuffer();
  const stripMeta = await sharp(strip).metadata();
  const W = stripMeta.width, H = stripMeta.height;

  // 边界：显式 segments > 自动检测
  let bounds = segments
    ? segments.split(";").map((p) => p.split(",").map((v) => parseInt(v.trim(), 10)))
        .filter((p) => p.length === 2 && p.every(Number.isFinite))
    : await detectSegments(strip, { threshold, minFrac });
  if (!bounds.length) throw new Error(`没检测到内容段（整行都是白/阈值 ${threshold} 太松？）——可用 --segments "左,右;左,右" 手工指定`);
  bounds = bounds.sort((a, b) => a[0] - b[0]);

  const n = bounds.length;
  const cellAspect = H / (bounds[0][1] - bounds[0][0] + 1); // 用第一格估子图宽高比
  let C = cols || (rows ? Math.ceil(n / rows) : chooseCols(n, cellAspect, target));
  let R = rows || Math.ceil(n / C);
  while (R * C < n) C++; // 保底

  const cellWs = bounds.map(([l, r]) => r - l + 1 - inset * 2);
  const cellH = H - inset * 2;
  const colW = Math.max(...cellWs); // 统一格宽（居中放），网格才齐
  const outW = colW * C + gap * (C - 1);
  const outH = cellH * R + gap * (R - 1);
  const comps = [];
  for (let i = 0; i < bounds.length; i++) {
    const [l, r] = bounds[i];
    comps.push({
      input: await sharp(strip)
        .extract({ left: l + inset, top: inset, width: r - l + 1 - inset * 2, height: cellH })
        .png().toBuffer(),
      left: (i % C) * (colW + gap) + Math.round((colW - cellWs[i]) / 2),
      top: Math.floor(i / C) * (cellH + gap),
    });
  }
  await sharp({ create: { width: outW, height: outH, channels: 3, background: bg } })
    .composite(comps).png().toFile(out);
  return { n, cols: C, rows: R, width: outW, height: outH, aspect: outH / outW, bounds };
}
