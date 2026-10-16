// test-montage.mjs — pf montage 回归（2026-10-15 实装）
// 实测定规「什么效果好用什么，只有实测效果好才行」：合成夹具已知边界可精确断言，
// 越界 crop 必须 clamp 不 crash（与 assets.mjs 同语义）。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name}`); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-montage-"));
try {
  // 夹具：4 个灰盒子（宽 300/260/310/280，30px 白隙，左侧 80px 标签区）
  const W = 80 + 300 + 30 + 260 + 30 + 310 + 30 + 280 + 40, H = 200;
  const boxes = [[80, 300], [410, 260], [700, 310], [1040, 280]];
  const strip = path.join(tmp, "strip.png");
  {
    const comps = [];
    for (const [l, w] of boxes) comps.push({ input: await sharp({ create: { width: w - 20, height: 160, channels: 3, background: "#555555" } }).png().toBuffer(), left: l + 10, top: 20 });
    await sharp({ create: { width: W, height: H, channels: 3, background: "#FFFFFF" } }).composite(comps).png().toFile(strip);
  }

  const pf = (args) => {
    // 🔴 本机 spawnSync 管道 stdio 间歇/持续 EBUSY（2026-10-15 实锤）——fd 落临时文件再读 + 重试
    for (let attempt = 0; ; attempt++) {
      const outF = path.join(tmp, "out.txt");
      const fd = fs.openSync(outF, "w");
      const r = spawnSync(process.execPath, [path.join(ROOT, "bin", "pf.mjs"), ...args],
        { cwd: ROOT, timeout: 90000, stdio: ["ignore", fd, fd], env: { ...process.env, FORCE_COLOR: "0" } });
      fs.closeSync(fd);
      // ENOENT 也是本机 spawnSync flake 的一种（exe 明明存在，debug 直跑同一 execPath 成功）
      if ((r.error?.code === "EBUSY" || r.error?.code === "ENOENT") && attempt < 4) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
        continue;
      }
      return { code: r.status ?? 1, out: fs.readFileSync(outF, "utf8"), pfError: r.error?.code || r.error?.message || null };
    }
  };

  // 1. 自动检测 + 自动选列
  const grid = path.join(tmp, "grid.png");
  let r = pf(["montage", "--in", strip, "--out", grid]);
  if (r.code !== 0) console.log("  [debug] montage out:", JSON.stringify(r.out.slice(0, 400)), "strip exists:", fs.existsSync(strip), "pfError:", (r.pfError || "n/a"));
  ok(r.code === 0, `montage 退出 0（实际 ${r.code}）`);
  ok(/4 个子图 → 2×2/.test(r.out), "4 段全检出、自动选 2×2（宽高比最贴 target）");
  ok(/90-369 \/ 420-659 \/ 710-999 \/ 1050-1309/.test(r.out), "边界逐像素精确（inset 4 修边）");
  ok(fs.existsSync(grid), "输出 PNG 落盘");
  const gm = await sharp(grid).metadata();
  ok(Math.abs(gm.height / gm.width - 0.7) < 0.05, `网格宽高比贴 target 0.7（实际 ${(gm.height / gm.width).toFixed(2)}）`);

  // 2. 显式 cols
  r = pf(["montage", "--in", strip, "--out", path.join(tmp, "g1.png"), "--cols", "1"]);
  ok(/4 个子图 → 4×1/.test(r.out), "--cols 1 生效（输出 rows×cols = 4×1）");

  // 3. 越界 crop → clamp 不 crash
  r = pf(["montage", "--in", strip, "--out", path.join(tmp, "g2.png"), "--crop", "0,0,99999,99999"]);
  ok(r.code === 0 && /clamp/.test(r.out), "越界 crop clamp+告警，不 crash");

  // 4. 非法 crop → 可行动报错
  r = pf(["montage", "--in", strip, "--out", path.join(tmp, "g3.png"), "--crop", "abc"]);
  ok(r.code !== 0 && /非法/.test(r.out), "非法 crop 报错退出");

  // 5. 纯白图 → 检测不到内容段，报错可行动
  const blank = path.join(tmp, "blank.png");
  await sharp({ create: { width: 400, height: 100, channels: 3, background: "#FFFFFF" } }).png().toFile(blank);
  r = pf(["montage", "--in", blank, "--out", path.join(tmp, "g4.png")]);
  ok(r.code !== 0 && /没检测到内容段/.test(r.out), "纯白图给可行动报错");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n==== montage: ${pass} 过 ${fail} 挂 ====`);
process.exit(fail ? 1 : 0);
