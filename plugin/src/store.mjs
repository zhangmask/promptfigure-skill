// store.mjs — 项目磁盘布局：~/.promptfigure/projects/<docId>/
// meta.json(文档+图) / anchors.json / review.json / events.jsonl / figures/
// 🔴 插件唯一允许写文件的地方就是 ~/.promptfigure/ —— 永不触碰用户文件
import fs from "node:fs";
import path from "node:path";
import { PROJECTS_DIR, docIdOf, ensureDirs } from "./config.mjs";

export function projectDir(docId) {
  // 弱模型实测修复（weak-agent-sim 2026-09-20）：projectDir 与 projectByDocId 必须同一套
  // null 回退逻辑 —— writeAnchors/appendEvent 走 projectDir，之前 null 时照样炸 "path null"
  const dir = projectByDocId(docId);
  fs.mkdirSync(path.join(dir, "figures"), { recursive: true });
  return dir;
}

export function projectByDocId(docId) {
  // 弱模型实测（scripts/weak-agent-sim.mjs 2026-09-20）修复：
  // 之前 path.join(PROJECTS_DIR, null) 直接 TypeError "path null"——
  // 所有不带 --doc 的调用（review status / review.resolve / doc.read / events）全部炸出不可读错误。
  // 现在 null/undefined 回退最近打开的项目，没有项目时报人话。
  if (!docId) {
    const latest = latestProject();
    if (!latest) throw new Error("还没有任何项目，先 pf open <论文路径> 打开文档");
    return latest;
  }
  return path.join(PROJECTS_DIR, docId);
}

export function latestProject() {
  ensureDirs();
  // 🔴 显式 lastDocId 优先（pf open 时写入 config）：mtime 排序会被 e2e 测试等
  // 新建项目污染——测试一跑，宿主 AI 不带 --doc 的命令就全落到测试文档上（2026-09-21 实测）
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(path.dirname(PROJECTS_DIR), "config.json"), "utf8"));
    if (cfg.lastDocId) {
      const dir = path.join(PROJECTS_DIR, cfg.lastDocId);
      if (fs.existsSync(path.join(dir, "meta.json"))) return dir;
    }
  } catch {}
  const dirs = fs.readdirSync(PROJECTS_DIR)
    .map((d) => path.join(PROJECTS_DIR, d))
    .filter((d) => fs.existsSync(path.join(d, "meta.json")))
    .sort((a, b) => fs.statSync(path.join(b, "meta.json")).mtimeMs - fs.statSync(path.join(a, "meta.json")).mtimeMs);
  return dirs[0] || null;
}

// 解析 --doc 参数：缺省时取最近打开的项目
export function resolveDoc(docId) {
  if (docId) {
    // 弱模型实测（weak-agent-sim 2026-09-20）：AI 常把文件路径当 docId 传 --doc，给可行动的报错
    if (/[\\/]/.test(docId) || /\.(tex|docx|pdf|doc|wps|md)$/i.test(docId)) {
      throw new Error(`--doc 要传 docId（如 1b0d6cddb9a8），不是文件路径。先执行 pf open "${docId}" 打开文档，用返回的 docId`);
    }
    const dir = projectByDocId(docId);
    if (!fs.existsSync(path.join(dir, "meta.json"))) {
      throw new Error(`找不到项目 ${docId}（先 pf open 打开文档）`);
    }
    return dir;
  }
  const dir = latestProject();
  if (!dir) throw new Error("还没有任何项目，先 pf open <path> 打开文档");
  return dir;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file); // 原子替换，防写坏
}

// ---- 跨进程项目写锁（2026-09-25 双智能体实测修复）----
// 症状：两个宿主 AI 同时操作同一项目（多智能体同机 = 真实场景）时，
// read-modify-write 互相覆盖——一方刚出的新版图/审批记录整段消失，
// 智能体日志原话「两次覆盖 meta.json 致我的新版注册丢失」。
// 机制：项目目录内独占锁文件（wx 创建）+ 锁内重读合并；写锁只包住
// 磁盘写本身，不嵌套持有（所有调用方都是 写完即放，无重入）。
const LOCK_NAME = ".pf-write.lock";
function withLock(dir, fn, { timeoutMs = 10000, staleMs = 30000 } = {}) {
  const lockPath = path.join(dir, LOCK_NAME);
  const t0 = Date.now();
  const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx"); // 独占创建 = 拿到锁
      fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}`);
      fs.closeSync(fd);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        // 持锁进程崩了 → 锁文件超龄 → 破锁（防死等）
        if (Date.now() - fs.statSync(lockPath).mtimeMs > staleMs) { fs.unlinkSync(lockPath); continue; }
      } catch { continue; } // 锁刚好被释放：立刻重试
      if (Date.now() - t0 > timeoutMs) {
        throw new Error(`项目写锁等待超时（另一进程卡在 ${lockPath}；确认无进程占用后可手动删除该锁文件）`);
      }
      nap(20 + Math.random() * 40);
    }
  }
  try { return fn(); } finally { try { fs.unlinkSync(lockPath); } catch { /* 已被破锁删掉：无感 */ } }
}

// 合并语义：并发写入按「键」保留双方成果，而不是整文件 Last-Writer-Wins
function mergeMeta(cur, incoming) {
  if (!cur) return incoming;
  const out = { ...cur };
  for (const k of ["docId", "source", "fileName", "kind", "blocks", "outline", "styleCard"]) {
    if (incoming[k] !== undefined) out[k] = incoming[k];
  }
  if (Date.parse(incoming.parsedAt || 0) >= Date.parse(cur.parsedAt || 0)) out.parsedAt = incoming.parsedAt;
  out.figures = { ...(cur.figures || {}) };
  for (const [fid, fig] of Object.entries(incoming.figures || {})) {
    const prev = out.figures[fid];
    // 同图并发重渲：取版本多的一方（append-only 不变量），另一方事件/文件仍在账本里可查
    out.figures[fid] = !prev || (fig.versions?.length || 0) >= (prev.versions?.length || 0) ? { ...prev, ...fig } : prev;
  }
  return out;
}

export const readMeta = (docId) => readJson(path.join(projectByDocId(docId), "meta.json"), null);
export const writeMeta = (docId, meta) => withLock(projectDir(docId), () => {
  writeJson(path.join(projectDir(docId), "meta.json"), mergeMeta(readJson(path.join(projectDir(docId), "meta.json"), null), meta));
});
export const readAnchors = (docId) => readJson(path.join(projectByDocId(docId), "anchors.json"), []);
export const writeAnchors = (docId, arr) => withLock(projectDir(docId), () => {
  const cur = readJson(path.join(projectDir(docId), "anchors.json"), []) || [];
  const byId = new Map(cur.map((a) => [a.id, a]));
  for (const a of arr) byId.set(a.id, a); // 同 id 覆盖、新 id 追加——并发布点互不抹
  writeJson(path.join(projectDir(docId), "anchors.json"), [...byId.values()]);
});
export const readReview = (docId) => readJson(path.join(projectByDocId(docId), "review.json"), {});
export const writeReview = (docId, obj) => withLock(projectDir(docId), () => {
  const cur = readJson(path.join(projectDir(docId), "review.json"), {}) || {};
  writeJson(path.join(projectDir(docId), "review.json"), { ...cur, ...obj }); // 按图合并：一张图的审批不冲掉另一张
});

export function saveFigureFile(docId, figureId, fileName, buf) {
  const dir = path.join(projectDir(docId), "figures", figureId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), buf);
  return `figures/${figureId}/${fileName}`;
}
