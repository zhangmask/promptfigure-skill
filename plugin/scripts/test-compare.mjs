// test-compare.mjs — pf compare 回归（2026-10-15 四轮定规实装）
// 定规链：①对比是交付义务 ②必须是操作示意（红框/步骤/箭头）③超宽自动折行
// ④学术图样式——白底、(a)(b)(c) 编号图注、克制用色、字号随画布自适应。
// 合成夹具已知几何：红框中心像素必须真是红色（缩放换算实测，不是只看命令退出码）。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name}`); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-compare-"));
try {
  // 夹具：before = 800×600 白底 + 灰块(100,200,300,150)；mid = 500×400；after = 400×300
  // 等高 900 后面板宽：1200 / 1125 / 1200
  const src = path.join(tmp, "src.png");
  await sharp({ create: { width: 800, height: 600, channels: 3, background: "#FFFFFF" } })
    .composite([{ input: await sharp({ create: { width: 300, height: 150, channels: 3, background: "#666666" } }).png().toBuffer(), left: 100, top: 200 }])
    .png().toFile(src);
  const mid = path.join(tmp, "mid.png");
  await sharp({ create: { width: 500, height: 400, channels: 3, background: "#EEEEEE" } }).png().toFile(mid);
  const aft = path.join(tmp, "aft.png");
  await sharp({ create: { width: 400, height: 300, channels: 3, background: "#333333" } }).png().toFile(aft);

  const pf = (args) => {
    // 🔴 本机 spawnSync 管道 stdio EBUSY/ENOENT flake——fd 落临时文件再读 + 重试（同 test-montage）
    for (let attempt = 0; ; attempt++) {
      const outF = path.join(tmp, "out.txt");
      const fd = fs.openSync(outF, "w");
      const r = spawnSync(process.execPath, [path.join(ROOT, "bin", "pf.mjs"), ...args],
        { cwd: ROOT, timeout: 90000, stdio: ["ignore", fd, fd], env: { ...process.env, FORCE_COLOR: "0" } });
      fs.closeSync(fd);
      if ((r.error?.code === "EBUSY" || r.error?.code === "ENOENT") && attempt < 4) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
        continue;
      }
      return { code: r.status ?? 1, out: fs.readFileSync(outF, "utf8") };
    }
  };

  // 1. 三件套全开：steps/box/flow，红框描边像素必须真是红色
  //    单行宽 = 8(margin×2) + 64*2(flowGap) + 1200+1125+1200 = 3669 ≤ 4800 → 单行
  //    labelFs = clamp(3669/66→55.6) = 56；labelH = 73；stepFs = 42；capH = 73+75 = 148
  //    H = 8(margin×2) + 148 + 900 = 1056+8 = 1064
  const cmp = path.join(tmp, "cmp.png");
  let r = pf(["compare", "--before", src, "--mid", mid, "--after", aft, "--out", cmp,
    "--labels", "原文;中间;成图", "--steps", "① 定位取材区;② 白隙切分重排;③ 贴入成图",
    "--box", "0:100,200,300,150:取材区", "--flow"]);
  if (r.code !== 0) console.log("  [debug]", JSON.stringify(r.out.slice(0, 400)));
  ok(r.code === 0, "compare 退出 0（steps+box+flow 全开）");
  ok(fs.existsSync(cmp), "输出落盘");
  {
    const m = await sharp(cmp).metadata();
    ok(Math.abs(m.width - 3669) < 4 && Math.abs(m.height - 1064) < 4, `画布尺寸含图注高与 flow 加宽 gap（实际 ${m.width}×${m.height}，期望 3669×1064）`);
    // 红框只有描边是红的：取样框上边中点 x = 8 + 250*1.5，y = 8+148 + 200*1.5（描边 4px）
    const cx = Math.round(8 + 250 * 1.5), cy = Math.round(8 + 148 + 200 * 1.5);
    const raw = await sharp(cmp).extract({ left: cx - 5, top: cy - 5, width: 11, height: 11 }).raw().toBuffer({ resolveWithObject: true });
    let red = 0;
    for (let i = 0; i < raw.data.length; i += raw.info.channels) if (raw.data[i] > 170 && raw.data[i + 1] < 110 && raw.data[i + 2] < 110) red++;
    ok(red > 0, `红框画在缩放换算后的位置（上边中点 ${cx},${cy} 命中红色 ${red}/121 像素）`);
  }

  // 2. 默认无标题解释（六轮定规）：只留 (a)(b) 角标行 capH=40，H = 80 + 40+900 = 1020
  const cmp2 = path.join(tmp, "cmp2.png");
  r = pf(["compare", "--before", src, "--after", aft, "--out", cmp2]);
  ok(r.code === 0 && fs.existsSync(cmp2), "无 labels/steps 默认不画标题解释（旧用法不炸）");
  const m2 = await sharp(cmp2).metadata();
  ok(Math.abs(m2.height - 964) < 4, `默认只有角标行（高度 ${m2.height}）`);

  // 3. steps 数量不匹配 → 可行动报错
  r = pf(["compare", "--before", src, "--after", aft, "--out", path.join(tmp, "x.png"), "--steps", "只有一句"]);
  ok(r.code !== 0 && /数量（1）和面板数（2）/.test(r.out), "steps 数量不符给可行动报错");

  // 4. box 非法条目 → 可行动报错
  r = pf(["compare", "--before", src, "--after", aft, "--out", path.join(tmp, "x.png"), "--box", "abc"]);
  ok(r.code !== 0 && /无法解析/.test(r.out), "box 条目非法给可行动报错");

  // 5. box 面板序号越界 → 可行动报错
  r = pf(["compare", "--before", src, "--after", aft, "--out", path.join(tmp, "x.png"), "--box", "5:0,0,10,10"]);
  ok(r.code !== 0 && /超出范围/.test(r.out), "box 面板序号越界给可行动报错");

  // 6. 越界红框 clamp 不 crash（与 montage crop 同语义）
  r = pf(["compare", "--before", src, "--after", aft, "--out", path.join(tmp, "cmp6.png"), "--box", "0:700,500,500,400"]);
  ok(r.code === 0 && /clamp/.test(r.out), "越界红框 clamp+告警不 crash");

  // 7. 超宽自动折行（用户定规「这么长一条有用吗」）：单行超 --maxw 3100 → 折 2 行
  //    flowGap 64：row1 = 1200+64+1125 = 2389（16+2389=2405≤3100），row2 = 1200
  //    无 labels/steps → labelFs = clamp(2405/66)=36，capH = 47：H = 16 + (47+900) + 28(gap) + (47+900) = 1938
  //    （拐弯箭头已删：折行后不画跨行箭头，行距回归统一 gap）
  const cmp7 = path.join(tmp, "cmp7.png");
  r = pf(["compare", "--before", src, "--mid", mid, "--after", aft, "--out", cmp7, "--flow", "--maxw", "3100"]);
  ok(r.code === 0 && /自动折成 2 行/.test(r.out), "超宽自动折行并在回显里说明（2 行）");
  const m7 = await sharp(cmp7).metadata();
  ok(Math.abs(m7.width - 2405) < 4 && Math.abs(m7.height - 1938) < 4, `折行画布尺寸正确（实际 ${m7.width}×${m7.height}，期望 2405×1938）`);
  ok(m7.width < 3765 && m7.height > 1087, "折行后更方正（宽变窄、高变高），不再是看不清的细长条");

  // 8. --layout strip 强制旧行为：同样超宽也保持单行
  const cmp8 = path.join(tmp, "cmp8.png");
  r = pf(["compare", "--before", src, "--mid", mid, "--after", aft, "--out", cmp8, "--flow", "--maxw", "3100", "--layout", "strip"]);
  ok(r.code === 0 && !/自动折成/.test(r.out), "--layout strip 保持单行不折");
  const m8 = await sharp(cmp8).metadata();
  ok(Math.abs(m8.width - 3669) < 4, `strip 单行宽度 = 横条原值（实际 ${m8.width}）`);

  // 9. 矮面板（行内垂直居中）标签必须跟面板顶边走，不许挂在行顶脱钩
  //    宽短夹具 1600×300 → w=2800, h=525；面板 b top = 8+73+187 = 268，letterY = 258
  const wide = path.join(tmp, "wide.png");
  await sharp({ create: { width: 1600, height: 300, channels: 3, background: "#EEEEEE" } }).png().toFile(wide);
  const cmp9 = path.join(tmp, "cmp9.png");
  r = pf(["compare", "--before", src, "--mid", wide, "--after", aft, "--out", cmp9]);
  ok(r.code === 0, "矮面板对比图生成");
  {
    // 面板 b 左上角上方 40px 窗口内必须有黑色字形（标签贴着面板顶）
    const win = await sharp(cmp9).extract({ left: 1240, top: 216, width: 120, height: 44 }).raw().toBuffer({ resolveWithObject: true });
    let dark = 0;
    for (let i = 0; i < win.data.length; i += win.info.channels) if (win.data[i] < 80) dark++;
    ok(dark > 20, `矮面板标签跟随面板顶（面板顶上方窗口命中黑字 ${dark} 像素）`);
    // 行顶标签区（原 bug 位置）必须是白的——标签不许留在行顶
    const topZone = await sharp(cmp9).extract({ left: 1240, top: 16, width: 120, height: 50 }).raw().toBuffer({ resolveWithObject: true });
    let stray = 0;
    for (let i = 0; i < topZone.data.length; i += topZone.info.channels) if (topZone.data[i] < 80) stray++;
    ok(stray === 0, `行顶无残留标签（原 bug 位置黑字 ${stray} 像素）`);
  }

  // 10. comparison 体裁（CXTrack Fig.5 几何）：胶片条行（图块零间距）、竖排行标、列对齐
  const t1 = path.join(tmp, "t1.png"), t2 = path.join(tmp, "t2.png"), t3 = path.join(tmp, "t3.png");
  await sharp({ create: { width: 300, height: 200, channels: 3, background: "#AAAAAA" } }).png().toFile(t1);
  await sharp({ create: { width: 300, height: 200, channels: 3, background: "#BBBBBB" } }).png().toFile(t2);
  await sharp({ create: { width: 300, height: 200, channels: 3, background: "#CCCCCC" } }).png().toFile(t3);
  const cmp10 = path.join(tmp, "cmp10.png");
  r = pf(["compare", "--style", "comparison",
    "--row", "Paper:" + t1 + "," + t2 + "," + t3,
    "--row", "promptFigure:" + t1 + "," + t2 + "," + t3,
    "--out", cmp10, "--highlight", "2"]);
  ok(r.code === 0 && /2 行 × 3 列/.test(r.out), "comparison 体裁生成（2 行 × 3 列）");
  {
    const m10 = await sharp(cmp10).metadata();
    // tileH 420 → labelFs 44 → labelW 66；tiles 300×200 → w 630 = cellW
    // rowGap = round(420*0.06) = 25：W = 16+66+3*630 = 1972，H = 16+840+25 = 881
    ok(Math.abs(m10.width - 1972) < 4 && Math.abs(m10.height - 881) < 4, `胶片条画布尺寸正确（${m10.width}×${m10.height}，期望 1972×881）`);
    // 竖排行标：左缘标签区在行中心附近应有黑字
    const lab = await sharp(cmp10).extract({ left: 10, top: 168, width: 60, height: 100 }).raw().toBuffer({ resolveWithObject: true });
    let dark = 0;
    for (let i = 0; i < lab.data.length; i += lab.info.channels) if (lab.data[i] < 80) dark++;
    ok(dark > 20, `竖排行标存在（标签区黑字 ${dark} 像素）`);
    // 行内零间距：col1/col2 交界（x = 74+630）两侧应是图块灰不是白隙
    const b1 = await sharp(cmp10).extract({ left: 74 + 628, top: 208, width: 5, height: 4 }).raw().toBuffer({ resolveWithObject: true });
    let nonWhite = 0;
    for (let i = 0; i < b1.data.length; i += b1.info.channels) if (b1.data[i] < 240) nonWhite++;
    ok(nonWhite === 20, `行内图块零间距对接（交界 20/20 非白，实际 ${nonWhite}）`);
    // 列对齐：同一列在两行取同位置，灰度一致（fixture 上下都是 #AAAAAA=170）
    const c1 = await sharp(cmp10).extract({ left: 174, top: 108, width: 4, height: 4 }).raw().toBuffer({ resolveWithObject: true });
    const c2 = await sharp(cmp10).extract({ left: 174, top: 553, width: 4, height: 4 }).raw().toBuffer({ resolveWithObject: true });
    ok(Math.abs(c1.data[0] - c2.data[0]) < 6, `列对齐（同列两行取样 ${c1.data[0]} vs ${c2.data[0]}）`);
  }
  // 各行列数不一致 → 可行动报错
  r = pf(["compare", "--style", "comparison", "--row", "A:" + t1, "--row", "B:" + t1 + "," + t2, "--out", path.join(tmp, "x2.png")]);
  ok(r.code !== 0 && /列数不一致/.test(r.out), "行间列数不一致给可行动报错");

  // 11. 非法 --layout 给可行动报错
  r = pf(["compare", "--before", src, "--after", aft, "--out", path.join(tmp, "x.png"), "--layout", "diagonal"]);
  ok(r.code !== 0 && /只认 auto/.test(r.out), "非法 --layout 报错");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n==== compare: ${pass} 过 ${fail} 挂 ====`);
process.exit(fail ? 1 : 0);
