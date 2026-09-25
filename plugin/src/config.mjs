// config.mjs — ~/.promptfigure/config.json 读写
// 🔴 该文件含 pf_ key：权限 600；任何日志禁止打印 key（只打印前 8 位脱敏）
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export const PF_DIR = path.join(os.homedir(), ".promptfigure");
export const CONFIG_PATH = path.join(PF_DIR, "config.json");
export const DAEMON_PATH = path.join(PF_DIR, "daemon.json");
export const PROJECTS_DIR = path.join(PF_DIR, "projects");
// 🔴 全链路唯一缺省端口（2026-09-21 实测）：曾出现 pf.mjs/server.mjs 缺省 7420、tray 17420
// 的分裂——daemon.json 一被删两条链路各起各的，CLI 和托盘互相找不到。改端口只改这里。
// 用户环境千奇百怪：端口被占/被防火墙拦时，设 PF_PORT 环境变量即可整体换端口。
export const DEFAULT_PORT = Number(process.env.PF_PORT) || 17420;

// 🔴 无头环境判定（2026-09-21 用户定规：插件不许写死某台机器的环境）：
// 用户的 AI 可能在 Codex Cloud/SSH 容器（无 GUI、无 pythonw、无 Edge/Chrome）里跑。
// - PF_HEADLESS 环境变量最高优先（=1 强制无头，=0 强制有头）
// - Windows 默认有头；macOS 默认有头（Aqua 不需要 DISPLAY）；Linux 无 DISPLAY/WAYLAND = 无头
export function isHeadless() {
  const forced = process.env.PF_HEADLESS;
  if (forced !== undefined) return forced !== "0";
  if (process.platform === "win32") return false;
  if (process.platform === "darwin") return !!process.env.CI;
  return !process.env.CI ? !(process.env.DISPLAY || process.env.WAYLAND_DISPLAY) : true;
}

export function ensureDirs() {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  fs.mkdirSync(path.join(PF_DIR, "logs"), { recursive: true });
}

export function maskKey(key) {
  if (!key) return "(未设置)";
  return key.slice(0, 8) + "…";
}

export function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

export function saveConfig(patch) {
  ensureDirs();
  const cfg = { ...loadConfig(), ...patch };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  try { fs.chmodSync(CONFIG_PATH, 0o600); } catch {} // Windows 上无效果，尽力而为
  return cfg;
}

export function docIdOf(absPath) {
  return crypto.createHash("sha256").update(path.resolve(absPath)).digest("hex").slice(0, 12);
}

// ---- daemon.json：本地服务运行信息（唯一由 server.mjs 写入）----
export function readDaemon() {
  try {
    return JSON.parse(fs.readFileSync(DAEMON_PATH, "utf8"));
  } catch {
    return null;
  }
}

export function writeDaemon(info) {
  fs.writeFileSync(DAEMON_PATH, JSON.stringify(info, null, 2));
  try { fs.chmodSync(DAEMON_PATH, 0o600); } catch {}
}

export function clearDaemon() {
  try { fs.unlinkSync(DAEMON_PATH); } catch {}
}
