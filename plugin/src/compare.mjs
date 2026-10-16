// src/compare.mjs — 原图 vs 产出对比图（pf compare）
// 2026-10-15 用户定规①「原图美化美化了什么，要给一个给用户看的对比」——交付优化结果必附对照。
// 2026-10-15 用户定规②「你这只是展示结果示意图，为什么没有对应的示意」——--box 红框取材区、
// --steps 每面板操作说明、--flow 流程箭头。
// 2026-10-15 用户定规③「这么长一条你自己觉得有用吗」——--layout auto 超宽自动折行成网格。
// 2026-10-15 用户定规④「这符合学术规范吗」——白底、克制用色、细红框、深灰细箭头。
// 2026-10-15 用户定规⑤「去看看顶会顶刊优秀示例」——按 Nature 官方 figure guide 排版：
//   · 面板标签 = 粗体小写 a b c，贴每格左上角（左对齐面板、图内不居中悬挂）
//   · 间距 2–4mm 等效像素且全图严格一致；外边距近乎为零（期刊自己排）
//   · 无面板边框（avoid excessive boxing）
//   · 字体 Helvetica/Arial 无衬线，黑字；标签字号 ≈ 整图宽 1.5%（8pt/183mm 等效）
import sharp from "sharp";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// 用户习惯写「① xxx」——(a)(b)(c) 编号已带上，圈号字符 librsvg 字体覆盖不稳，剥掉防豆腐块
const stripBadge = (s) => String(s).replace(/^[\u2460-\u2473\u3251-\u325F\u32B1-\u32BF][.、\s]*/, "").trim();
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const FONT = "Helvetica, Arial, 'Microsoft YaHei', sans-serif";

export async function comparePanels({ imgs, labels, steps, boxes, flow, out, imgH = 900, maxW = 2800, gap = 28, flowGap = 64, margin = 8, bg = "#FFFFFF", layout = "auto", maxTotalW = 4800 }) {
  if (imgs.length < 2) throw new Error("对比至少要两张图（--before / --after）");
  if (steps && steps.length !== imgs.length) throw new Error(`steps 数量（${steps.length}）和面板数（${imgs.length}）不一致`);
  const effGap = flow ? flowGap : gap;

  const panels = [];
  for (const p of imgs) {
    const buf = await sharp(p).flatten({ background: "#ffffff" }).png().toBuffer();
    const m = await sharp(buf).metadata();
    // 统一高 imgH；超宽条图（宽高比>maxW/imgH，如论文整行条图）按宽缩放封顶——
    // 否则一条 5366×840 的条图会把其他面板挤成细条
    let w, h;
    if (m.width / m.height > maxW / imgH) { w = maxW; h = Math.round(m.height * maxW / m.width); }
    else { h = imgH; w = Math.max(1, Math.round(m.width * imgH / m.height)); }
    panels.push({ buf: await sharp(buf).resize({ width: w, height: h }).png().toBuffer(), w, h, ow: m.width, oh: m.height });
  }

  // ---- 布局：auto 下单行超宽就贪心折行（保持操作链顺序：从左到右、从上到下）----
  const stripW = margin * 2 + effGap * (panels.length - 1) + panels.reduce((s, p) => s + p.w, 0);
  let rows; // 每行 = 面板数组
  if (layout === "strip" || stripW <= maxTotalW) {
    rows = [panels];
  } else {
    rows = [];
    let cur = [], curW = 0;
    for (const p of panels) {
      const add = cur.length ? effGap + p.w : p.w;
      if (cur.length && margin * 2 + curW + add > maxTotalW) { rows.push(cur); cur = [p]; curW = p.w; }
      else { cur.push(p); curW += add; }
    }
    if (cur.length) rows.push(cur);
  }

  const rowWs = rows.map((r) => r.reduce((s, p) => s + p.w, 0) + effGap * (r.length - 1));
  const rowHs = rows.map((r) => Math.max(...r.map((p) => p.h)));
  const W = margin * 2 + Math.max(...rowWs);
  // 标签字号 ≈ 整图宽 1.5%（Nature 8pt/183mm 等效），随画布自适应
  const labelFs = Math.round(clamp(W / 66, 32, 56));
  const stepFs = Math.round(labelFs * 0.75);
  // 标签条高：粗体字母一行（常驻）；steps 可选时加一行小注（都锚定面板顶边，见下）
  const capH = Math.round(labelFs * 1.3) + (steps ? Math.round(stepFs * 1.6 + 8) : 0);
  // 间距全图一致（Nature：panel 间距 2–4mm 严格统一）
  // 🔴 拐弯箭头已删（2026-10-16 用户定规「顶会顶刊几乎不会做拐弯箭头」——CVPR 方法图全是
  // 单向直线流）：折行后不画跨行箭头，顺序由 a/b/c 字母承担，行距和列距一致
  const H = margin * 2 + rowHs.reduce((s, h) => s + capH + h, 0) + gap * (rows.length - 1);

  const comps = [];
  const svg = [];
  let y = margin;
  let idx = 0;
  for (let r = 0; r < rows.length; r++) {
    const rowTop = y;
    let x = margin;
    const midY = rowTop + capH + Math.floor(rowHs[r] / 2);
    for (let i = 0; i < rows[r].length; i++, idx++) {
      const p = rows[r][i];
      const top = rowTop + capH + Math.floor((rowHs[r] - p.h) / 2); // 行内垂直居中（行内图高低不齐时）
      comps.push({ input: p.buf, left: x, top });
      // 面板标签：粗体小写字母，锚定**该面板自己的顶边**（面板行内居中时标签跟着走，
      // 不许挂在行顶和面板脱钩）；steps 在字母和面板之间
      const stepH = steps ? Math.round(stepFs * 1.5 + 6) : 0;
      const letterY = top - 10 - stepH;
      svg.push(`<text x="${x}" y="${letterY}" font-family="${FONT}" font-size="${labelFs}" font-weight="bold" fill="#000000">${LETTERS[idx]}</text>`);
      if (labels?.[idx]) {
        svg.push(`<text x="${x + Math.round(labelFs * 1.1)}" y="${letterY}" font-family="${FONT}" font-size="${labelFs}" fill="#000000">${esc(labels[idx])}</text>`);
      }
      if (steps?.[idx]) {
        svg.push(`<text x="${x}" y="${top - 10}" font-family="${FONT}" font-size="${stepFs}" fill="#374151">${esc(stripBadge(steps[idx]))}</text>`);
      }
      // 红框取材区：调用方给的是该面板原图像素坐标，按显示缩放换算 + 越界 clamp
      for (const b of boxes?.[idx] || []) {
        const sx = p.w / p.ow, sy = p.h / p.oh;
        if (b.x + b.w > p.ow || b.y + b.h > p.oh || b.x < 0 || b.y < 0) {
          console.error(`⚠️ 面板 (${LETTERS[idx]}) 红框 (${b.x},${b.y},${b.w},${b.h}) 超出原图 ${p.ow}×${p.oh}，已 clamp——坐标应是原图像素坐标`);
        }
        const bx = x + clamp(b.x * sx, 0, p.w - 2);
        const by = top + clamp(b.y * sy, 0, p.h - 2);
        const bw = clamp(b.w * sx, 2, x + p.w - bx);
        const bh = clamp(b.h * sy, 2, top + p.h - by);
        svg.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="none" stroke="#DC2626" stroke-width="4"/>`);
        if (b.label) {
          // 标签贴框：白底细红边红字，框顶离面板顶够远就悬在框上方
          const tagH = Math.round(stepFs * 1.5), tagW = Math.min(bw - 4, 24 + b.label.length * stepFs * 0.9);
          const tx = clamp(bx + 2, x + 2, x + p.w - tagW - 2);
          const ty = by - top > tagH + 8 ? by - tagH - 4 : by + 4;
          svg.push(`<rect x="${tx}" y="${ty}" width="${tagW}" height="${tagH}" fill="#FFFFFF" stroke="#DC2626" stroke-width="2"/>`);
          svg.push(`<text x="${tx + tagW / 2}" y="${ty + tagH / 2 + stepFs * 0.36}" font-family="${FONT}" font-size="${Math.round(stepFs * 0.85)}" fill="#DC2626" text-anchor="middle">${esc(b.label)}</text>`);
        }
      }
      // 行内流程箭头（深灰细箭头）
      if (flow && i < rows[r].length - 1) {
        const ax0 = x + p.w + 8, ax1 = x + p.w + effGap - 8;
        svg.push(`<line x1="${ax0}" y1="${midY}" x2="${ax1 - 12}" y2="${midY}" stroke="#111111" stroke-width="4"/>`);
        svg.push(`<polygon points="${ax1},${midY} ${ax1 - 14},${midY - 9} ${ax1 - 14},${midY + 9}" fill="#111111"/>`);
      }
      // 跨行不画箭头（顶会方法图无拐弯箭头）：顺序由 a/b/c 字母承担
      x += p.w + effGap;
    }
    y += capH + rowHs[r] + gap;
  }
  const svgBuf = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${svg.join("")}</svg>`);
  await sharp({ create: { width: W, height: H, channels: 3, background: bg } })
    .composite([...comps, { input: svgBuf, left: 0, top: 0 }]).png().toFile(out);
  return { width: W, height: H, panels: panels.length, rows: rows.length };
}

// compareRows — 结果对比图。几何 1:1 抄 CXTrack Fig.5（CVPR 2023，2026-10-16 从 CVF 原页
// 150DPI 渲染逐像素量出来的，用户定规「图不符合规范，完全不美观」后不再自创样式）：
//   · 行 = 胶片条：行内图块**零间距对接**，行间细白隙（~6% tileH）——不是散块网格
//   · 行标：**竖排**（rotate -90）黑字紧贴图条左缘（Car/Pedestrian 式），ours 行加粗
//   · 列 = 同身份内容对齐：列宽取各行最大，行内窄图白底 letterbox（不裁剪不失真）
//   · 无描边、无底带、无色块 chip、无箭头——参考图里全都没有，加了就是错的
export async function compareRows({ rows, highlight = -1, out, tileH = 420, margin = 8, bg = "#FFFFFF" }) {
  if (!rows || rows.length < 2) throw new Error("对比至少要两行（两个对比对象）");
  const n = rows[0].imgs.length;
  if (rows.some((r) => r.imgs.length !== n)) throw new Error("各行列数不一致——对比图的列必须按同一身份对齐");

  const rowGap = Math.round(tileH * 0.06);
  // 每格统一高 tileH；列宽 = 同列各行最大（列对齐是「同列=同内容」的读图前提）
  const grid = [];
  for (const row of rows) {
    const tiles = [];
    for (const p of row.imgs) {
      const buf = await sharp(p).flatten({ background: "#ffffff" }).png().toBuffer();
      const m = await sharp(buf).metadata();
      const w = Math.max(1, Math.round(m.width * tileH / m.height));
      tiles.push({ buf: await sharp(buf).resize({ height: tileH }).png().toBuffer(), w });
    }
    grid.push(tiles);
  }
  const cellWs = Array.from({ length: n }, (_, j) => Math.max(...grid.map((t) => t[j].w)));
  // letterbox 底色 = 图块自身角像素色：黑底图块（DSSIM/误差图）补黑、白底图块补白——
  // 补白色会把黑胶片条切成散块，补图块同色则行内视觉连续且内容零改动
  for (let r = 0; r < rows.length; r++) {
    for (let j = 0; j < n; j++) {
      const t = grid[r][j];
      if (t.w < cellWs[j]) {
        const c = await sharp(t.buf).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
        t.cell = await sharp({ create: { width: cellWs[j], height: tileH, channels: 3, background: { r: c[0], g: c[1], b: c[2] } } })
          .composite([{ input: t.buf, left: Math.floor((cellWs[j] - t.w) / 2), top: 0 }]).png().toBuffer();
      } else t.cell = t.buf;
    }
  }
  const labelFs = Math.round(clamp(tileH * 0.11, 28, 44));
  const labelW = Math.round(labelFs * 1.5); // 竖排标签：只装得下字高 + 描边余量
  const stripX = margin + labelW;
  const W = margin * 2 + labelW + cellWs.reduce((s, w) => s + w, 0);
  const H = margin * 2 + tileH * rows.length + rowGap * (rows.length - 1);

  const comps = [];
  const svg = [];
  let y = margin;
  for (let r = 0; r < rows.length; r++) {
    // 行标：竖排黑字，紧贴图条左缘；ours 行加粗、baseline 常规（CXTrack 无底带无色块）
    const midY = y + Math.round(tileH / 2);
    svg.push(`<text transform="translate(${stripX - Math.round(labelFs * 0.3)} ${midY}) rotate(-90)" text-anchor="middle" font-family="${FONT}" font-size="${labelFs}"${r === highlight ? ' font-weight="bold"' : ""} fill="#000000">${esc(rows[r].label)}</text>`);
    let x = stripX;
    for (let j = 0; j < n; j++) {
      comps.push({ input: grid[r][j].cell, left: x, top: y });
      x += cellWs[j];
    }
    y += tileH + rowGap;
  }
  const svgBuf = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${svg.join("")}</svg>`);
  await sharp({ create: { width: W, height: H, channels: 3, background: bg } })
    .composite([...comps, { input: svgBuf, left: 0, top: 0 }]).png().toFile(out);
  return { width: W, height: H, rows: rows.length, cols: n };
}
