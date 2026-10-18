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
// 🔴 2026-10-18 审计修复（宿主 AI 失误路径实测）：
// 旧实现的三个坑，任何一个都让整条链路 30 秒内全部写不进去，而报错只说"等待超时"：
//  ① 超时 throw 在 for 循环里，finally 在循环外 → 锁清理被跳过，锁残留；
//     残留锁 30s 内每个后续命令都连带失败（实测 pid=56616 持锁 31s，期间审计全挂）；
//  ② `catch { continue }` 包住 unlink 失败（Windows 杀软/索引占用）→ 不检查超时 → 死循环；
//  ③ 只看 mtime 判断"持有者死了"，进程早退但锁刚写 <30s 时一律等满 → 其实是可立即破的空锁。
// 现在：空锁 / 持有 PID 已不存在 / 超龄 三种都立即破；所有退出路径都清锁；超时报错自带下一步。
function lockOwnerAlive(pid) {
  if (!pid) return false; // 空锁 = 创建后没写进去（进程在 open 与 write 之间被杀）→ 无主
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } // EPERM = 进程在，只是没权限发信号
}
function withLock(dir, fn, { timeoutMs = 10000, staleMs = 30000 } = {}) {
  const lockPath = path.join(dir, LOCK_NAME);
  const t0 = Date.now();
  const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  let locked = false; // 只有自己拿到锁才在退出时删——绝不删别人的锁
  try {
    for (;;) {
      try {
        const fd = fs.openSync(lockPath, "wx"); // 独占创建 = 拿到锁
        try { fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}`); } finally { fs.closeSync(fd); }
        locked = true;
        break;
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
      // 判这把锁能不能破：空锁 / 持有者已死 / 超龄
      let breakable = false;
      let why = "";
      try {
        const raw = fs.readFileSync(lockPath, "utf8");
        const pid = Number(String(raw).trim().split(/\s+/)[0]) || 0;
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (!pid) { breakable = true; why = "锁内容为空（持有者未写入即退出）"; }
        else if (!lockOwnerAlive(pid)) { breakable = true; why = `持有进程 ${pid} 已不存在`; }
        else if (age > staleMs) { breakable = true; why = `已持锁 ${Math.round(age / 1000)}s（超龄）`; }
      } catch (e) {
        if (e.code === "ENOENT") continue; // 刚好被释放：立刻重试，别算超时
        breakable = true; why = `锁文件不可读（${e.code || e.message}）`;
      }
      // 🔴 破锁失败绝不能再 continue——旧实现在这里死循环到天荒地老
      if (breakable) {
        try { fs.unlinkSync(lockPath); } catch { /* 被别的进程抢先破了：下一轮重试即可 */ }
        if (Date.now() - t0 > timeoutMs) {
          throw new Error(`项目写锁${
            why ? `（${why}）` : ""
          }——破锁多次失败，锁文件：${lockPath}。没有进程该持有它时可手动删除后重试`);
        }
        nap(10);
        continue;
      }
      if (Date.now() - t0 > timeoutMs) {
        throw new Error(`项目写锁被占用超时（${
          why || "另一进程正在写"
        }）——锁文件：${lockPath}。稍等 1 秒重试同一命令即可（持有者退出后锁会自动失效）；反复出现就在项目目录删掉该 .pf-write.lock`);
      }
      nap(20 + Math.random() * 40);
    }
    return fn();
  } finally {
    // 覆盖 fn 抛错 / 破锁路径 / 正常返回——旧实现漏了前两种，锁残留正是这么来的
    if (locked) { try { fs.unlinkSync(lockPath); } catch { /* 已被破锁删掉：无感 */ } }
  }
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

// 工作流状态库（2026-10-17）：单活跃工作流整文件写入；writeWorkflow(docId, null) = 删除（reset 用）
export const readWorkflow = (docId) => readJson(path.join(projectByDocId(docId), "workflow.json"), null);
export const writeWorkflow = (docId, wf) => withLock(projectDir(docId), () => {
  const file = path.join(projectDir(docId), "workflow.json");
  if (wf === null) { try { fs.unlinkSync(file); } catch { /* 本就没有 */ } return; }
  writeJson(file, wf);
});

export function saveFigureFile(docId, figureId, fileName, buf) {
  const dir = path.join(projectDir(docId), "figures", figureId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), buf);
  return `figures/${figureId}/${fileName}`;
}
