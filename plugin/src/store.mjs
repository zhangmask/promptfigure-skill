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

export const readMeta = (docId) => readJson(path.join(projectByDocId(docId), "meta.json"), null);
export const writeMeta = (docId, meta) => writeJson(path.join(projectDir(docId), "meta.json"), meta);
export const readAnchors = (docId) => readJson(path.join(projectByDocId(docId), "anchors.json"), []);
export const writeAnchors = (docId, arr) => writeJson(path.join(projectDir(docId), "anchors.json"), arr);
export const readReview = (docId) => readJson(path.join(projectByDocId(docId), "review.json"), {});
export const writeReview = (docId, obj) => writeJson(path.join(projectDir(docId), "review.json"), obj);

export function saveFigureFile(docId, figureId, fileName, buf) {
  const dir = path.join(projectDir(docId), "figures", figureId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), buf);
  return `figures/${figureId}/${fileName}`;
}
