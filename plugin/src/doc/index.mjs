// doc/index.mjs — 按扩展名分发解析
import fs from "node:fs";
import path from "node:path";
import { parseDocx } from "./docx.mjs";
import { parseTex } from "./tex.mjs";

export function docKind(filePath) {
  const base = filePath.split(/[\\/]/).pop();
  const dot = base.lastIndexOf(".");
  // 🔴 红队实测（2026-09-23 fuzz）：无扩展名路径（如目录）会整串当 ext 报出来（拼接损坏）
  if (dot <= 0) throw new Error(`无法识别文件类型（没有扩展名）：${filePath}——pf open 需要指向 .docx / .tex / .pdf 文件`);
  const ext = base.slice(dot + 1).toLowerCase();
  if (ext === "docx") return "docx";
  if (ext === "tex") return "tex";
  if (ext === "pdf") return "pdf";
  if (ext === "wps" || ext === "wpt") {
    throw new Error(".wps/.wpt 是私有格式，本插件不支持。请在 WPS 里另存为 .docx 后再打开");
  }
  throw new Error(`不支持的格式 .${ext}（一期支持 .docx / .tex / .pdf）`);
}

export async function parseDocument(filePath) {
  const kind = docKind(filePath);
  if (kind === "docx") {
    return { kind, ...(await parseDocx(fs.readFileSync(filePath))) };
  }
  if (kind === "tex") {
    return { kind, ...parseTex(fs.readFileSync(filePath, "utf8"), path.dirname(filePath)) };
  }
  // pdf：服务端不做段落解析（段落级高亮走浏览器 textLayer），outline 留空
  if (kind === "pdf") {
    return { kind, blocks: [], outline: [] };
  }
  throw new Error("unreachable");
}
