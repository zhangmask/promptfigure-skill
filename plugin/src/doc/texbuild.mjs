// texbuild.mjs — LaTeX 本地编译（零侵入：输出只进 ~/.promptfigure，绝不写用户目录）
// 策略：找本机 TeX 引擎 → 编译成 PDF 给 GUI 渲染（保真）；没有引擎时 CLI 给明确指引
// 引擎优先级：tectonic（自动拉宏包、自动跑 bib）> latexmk > pdflatex（两遍，引用可能为 ?）
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";

const PF_BIN = path.join(os.homedir(), ".promptfigure", "bin");

// ---- 引擎探测 ----
function existsExec(p) {
  try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; }
}

function findInPath(name) {
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (existsExec(p)) return p;
    }
  }
  return null;
}

function findTexLivePdflatex() {
  const roots = ["C:/texlive"];
  for (const root of roots) {
    try {
      const years = fs.readdirSync(root).filter((d) => /^\d{4}/.test(d)).sort().reverse();
      for (const y of years) {
        for (const bin of ["bin/windows", "bin/win32"]) {
          const p = path.join(root, y, bin, "pdflatex.exe");
          if (fs.existsSync(p)) return p;
        }
      }
    } catch {}
  }
  return null;
}

function findMikTeX() {
  const candidates = [
    path.join(process.env.APPDATA || "", "MiKTeX", "miktex", "bin", "x64", "pdflatex.exe"),
    "C:/Program Files/MiKTeX/miktex/bin/x64/pdflatex.exe",
    "C:/Users/" + os.userInfo().username + "/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdflatex.exe",
  ];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

export function detectTexEngine() {
  // ① 插件自带的（~/.promptfigure/bin，pf setup-tex 下载到这里）
  const local = path.join(PF_BIN, process.platform === "win32" ? "tectonic.exe" : "tectonic");
  if (fs.existsSync(local)) return { engine: "tectonic", cmd: local, origin: "plugin" };
  // ② PATH 与常见安装位置
  const tectonic = findInPath("tectonic");
  if (tectonic) return { engine: "tectonic", cmd: tectonic, origin: "system" };
  const latexmk = findInPath("latexmk");
  if (latexmk) return { engine: "latexmk", cmd: latexmk, origin: "system" };
  const pdflatex = findInPath("pdflatex") || findTexLivePdflatex() || findMikTeX();
  if (pdflatex) return { engine: "pdflatex", cmd: pdflatex, origin: "system" };
  return null;
}

// ---- 编译 ----
export function compileTex(docPath, { timeoutMs = 300000, outDir } = {}) {
  const eng = detectTexEngine();
  if (!eng) {
    return {
      ok: false,
      reason: "no-engine",
      message: "本机没有 TeX 编译环境。两条路：① 执行 pf setup-tex（自动下载便携版 tectonic 到插件目录）② 自装 TeX Live 或 MiKTeX 后重开",
    };
  }
  if (!outDir) throw new Error("compileTex 需要 outDir（编译产物只允许写进插件目录）");
  fs.mkdirSync(outDir, { recursive: true });

  const srcDir = path.dirname(docPath);
  let args, opts;
  if (eng.engine === "tectonic") {
    args = ["--outdir", outDir, docPath];
    opts = {};
  } else if (eng.engine === "latexmk") {
    args = ["-pdf", "-interaction=nonstopmode", "-halt-on-error", `-outdir=${outDir}`, docPath];
    opts = {};
  } else {
    // pdflatex 跑两遍解决交叉引用；output-directory 模式下允许在源目录找输入
    const pass = () => spawnSync(eng.cmd, [
      "-interaction=nonstopmode", "-halt-on-error", `-output-directory=${outDir}`, docPath,
    ], { cwd: srcDir, timeout: timeoutMs / 2, encoding: "buffer" });
    const r1 = pass();
    if (r1.status !== 0) return fail(eng, r1, docPath);
    const r2 = pass();
    return collect(eng, r2, docPath, outDir, timeoutMs);
  }

  const run = spawnSync(eng.cmd, args, { cwd: srcDir, timeout: timeoutMs, encoding: "buffer", ...opts });
  return collect(eng, run, docPath, outDir, timeoutMs);
}

function fail(eng, run, docPath) {
  const log = run.stdout?.toString() + (run.stderr?.toString() || "");
  return {
    ok: false,
    engine: eng.engine,
    reason: "compile-error",
    logTail: log.slice(-1500),
    message: `TeX 编译失败（${eng.engine}）。常见原因：宏包缺失（tectonic 需要联网拉包，走代理时先设 HTTPS_PROXY）/ 文档本身有错。可用用户目录下的 .log 复核。`,
  };
}

function collect(eng, run, docPath, outDir, timeoutMs) {
  if (run.error?.killed || run.error?.code === "ETIMEDOUT") {
    return { ok: false, engine: eng.engine, reason: "timeout", message: `编译超时（>${Math.round(timeoutMs / 1000)}s）。首次编译 tectonic 要在线拉宏包，可能较慢，重跑一次通常快很多。` };
  }
  if (run.status !== 0) return fail(eng, run, docPath);
  const pdfPath = path.join(outDir, path.basename(docPath).replace(/\.tex$/i, "") + ".pdf");
  if (!fs.existsSync(pdfPath)) {
    return { ok: false, engine: eng.engine, reason: "no-pdf", logTail: (run.stdout?.toString() || "").slice(-1500), message: "编译命令成功但没产出 PDF（检查文档是否有 \\documentclass）" };
  }
  return { ok: true, engine: eng.engine, pdfPath };
}

// ---- pf setup-tex：下载便携 tectonic 到插件目录（国内镜像优先，逐个回退）----
const MIRRORS = [
  "https://ghfast.top/https://github.com",
  "https://gh-proxy.com/https://github.com",
  "https://ghproxy.net/https://github.com",
  "https://github.com",
];
const TECTONIC_VER = "0.15.0";
const TECTONIC_URL = `/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VER}/tectonic-${TECTONIC_VER}-x86_64-pc-windows-msvc.zip`;

export async function setupTex({ onLog = console.log } = {}) {
  const target = path.join(PF_BIN, "tectonic.exe");
  if (fs.existsSync(target)) { onLog(`✅ 已有 ${target}`); return { ok: true, already: true }; }
  fs.mkdirSync(PF_BIN, { recursive: true });
  const { execFileSync } = await import("node:child_process");
  const zip = path.join(PF_BIN, "tectonic.zip");
  for (const m of MIRRORS) {
    try {
      onLog(`↓ 尝试 ${m.split("/")[2]} ...`);
      execFileSync("curl", ["-sL", "--max-time", "180", "-o", zip, m + TECTONIC_URL], { stdio: "ignore" });
      if (fs.existsSync(zip) && fs.statSync(zip).size > 1000000) break;
    } catch {}
  }
  if (!fs.existsSync(zip) || fs.statSync(zip).size < 1000000) {
    return { ok: false, message: "下载失败（所有镜像都不通）。手动方案：开代理后重试，或自装 TeX Live / MiKTeX" };
  }
  // 解压（用 powershell Expand-Archive，零依赖）
  execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -Force '${zip}' '${PF_BIN}'`], { stdio: "ignore" });
  fs.rmSync(zip, { force: true });
  if (!fs.existsSync(target)) return { ok: false, message: "解压后没找到 tectonic.exe" };
  onLog(`✅ tectonic ${TECTONIC_VER} → ${target}`);
  return { ok: true, path: target };
}
