// test-e2e.mjs — 构造测试 docx 并走通：解析 → daemon → anchor → state
// 🔴 只写 ~/.promptfigure/ 与本目录 test fixtures，不碰任何用户文件
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---- 1) 构造最小 docx（三个章节若干段落）----
const P = (text, style) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const paras = [
  P("基于深度学习的轨道病害检测研究", "Heading1"),
  P("近年来轨道交通发展迅速，轨道病害检测需求日益增长。"),
  P("本文提出一种结合视觉Transformer的检测框架。"),
  P("研究背景与意义", "Heading2"),
  P("轨道结构长期承受列车荷载，病害形式多样，包括波磨、扣件松动与钢轨裂纹。", ),
  P("传统人工巡检成本高、效率低，亟需自动化检测手段。"),
  P("检测方法设计", "Heading2"),
  P("本方法采用两阶段架构：第一阶段进行图像预处理与增强，第二阶段执行病害分类。"),
  P("数据增强策略包括随机裁剪、色彩抖动与弹性形变，可显著提升小样本场景下的鲁棒性。"),
  P("实验与结果分析", "Heading2"),
  P("在自建数据集上，本方法准确率达到先进水平，误检率明显下降。"),
  P("消融实验表明，数据增强模块贡献了主要性能增益。"),
];
const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${paras.join("")}</w:body></w:document>`;

const zip = new JSZip();
zip.file("word/document.xml", documentXml);
zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`);
const fixture = path.join(__dirname, "fixtures");
fs.mkdirSync(fixture, { recursive: true });
const docxPath = path.join(fixture, "test-paper.docx");
fs.writeFileSync(docxPath, await zip.generateAsync({ type: "nodebuffer" }));
console.log("① 测试 docx 已生成:", docxPath);

// ---- 2) 解析验证 ----
const imp = (p) => import("file:///" + path.join(ROOT, p).replace(/\\/g, "/"));
const { parseDocument } = await imp("src/doc/index.mjs");
const parsed = await parseDocument(docxPath);
console.log("② 章节树:", JSON.stringify(parsed.outline));
console.log("   段落数:", parsed.blocks.filter((b) => b.type === "para").length);
const ref = parsed.blocks.find((b) => b.secPath === "1.1" && b.para === 2);
if (!ref) throw new Error("解析失败：找不到 §1.1 ¶2");
console.log("③ §1.1 ¶2 =", ref.text);

// ---- 3) 起 daemon + CLI 通道验证 ----
const { startServer } = await imp("src/server.mjs");
const { docIdOf } = await imp("src/config.mjs");
const { writeMeta, readMeta } = await imp("src/store.mjs");
const docId = docIdOf(docxPath);
writeMeta(docId, {
  docId, source: docxPath, fileName: "test-paper.docx", kind: "docx",
  blocks: parsed.blocks, outline: parsed.outline, figures: {},
});
// 🔴 registerDaemon:false + 端口回退（2026-09-21 实测）：测试 daemon 不注册进 daemon.json
// （曾把真实托盘守护的服务记录顶掉），上轮残留占 17520 也不至于崩
let started = null;
for (const p of [17520, 17521, 17522, 17523]) {
  try { started = await startServer({ port: p, registerDaemon: false }); break; } catch {}
}
if (!started) throw new Error("17520-17523 全被占用，无法起测试 daemon");
const { port, guiToken, cliToken } = started;
console.log(`④ daemon on 127.0.0.1:${port}（未注册 daemon.json）`);

async function cli(action, params) {
  const http = await import("node:http");
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ action, params, doc: docId });
    const req = http.request({ host: "127.0.0.1", port, path: "/api/cli", method: "POST", headers: { "Content-Type": "application/json", "x-pf-cli-token": cliToken } }, (res) => {
      let raw = ""; res.on("data", (c) => (raw += c));
      res.on("end", () => { const j = JSON.parse(raw); res.statusCode >= 400 ? reject(new Error(j.error)) : resolve(j.result); });
    });
    req.on("error", reject); req.end(body);
  });
}

const anchor = await cli("anchor.set", { at: "§1.1 ¶2", side: "after" });
console.log("⑤ 建锚:", anchor.id, anchor.placement.at, anchor.placement.side);

// 修改段落文字 → changed 检测
const meta = readMeta(docId);
const b = meta.blocks.find((x) => x.secPath === "1.1" && x.para === 2);
b.text = "这段文字被大改过了，原文快照不再匹配。";
fs.writeFileSync(path.join(process.env.USERPROFILE, ".promptfigure", "projects", docId, "meta.json"), JSON.stringify(meta));
const listed = await cli("anchor.list", { changed: true });
console.log("⑥ changed 锚点:", listed.map((a) => `${a.id}:${a.state}`).join(", ") || "(无)");

// state API
const state = await fetch(`http://127.0.0.1:${port}/api/state?doc=${docId}`).then((r) => r.json());
console.log("⑦ state API: anchors =", state.anchors.length, "figures =", Object.keys(state.figures).length);

// review 流转（premium 门禁的负测试：无审批时 premium 应被拒）
// 先塞一个假 key，绕过 key 缺失检查，专测门禁
// ⚠️ 弱模型实测教训（weak-agent-sim 2026-09-20）：之前直接 saveConfig 把用户的真 key 覆盖掉了，
//    导致后续真实出图全部 invalid_api_key。必须备份并在 finally 恢复。
const { loadConfig, saveConfig } = await imp("src/config.mjs");
const savedConfig = loadConfig();
let gateRejected = false;
try {
  saveConfig({ key: "pf_test_fake_key_for_gate_check" });
  try { await cli("render", { prompt: "x", model: "premium", at: "§1.1 ¶2" }); } catch (e) { gateRejected = /门禁/.test(e.message); }
} finally {
  saveConfig({ key: savedConfig?.key || "", lastDocId: savedConfig?.lastDocId || "" });
}
console.log("⑧ premium 门禁（未审批应拒）:", gateRejected ? "✅ 正确拒绝" : "❌ 没拦住！");
console.log("⑧b config.json 已恢复 key/lastDocId:", savedConfig?.key ? savedConfig.key.slice(0, 6) + "…" : "(原本无 key)", "/", savedConfig?.lastDocId || "(原本无 lastDocId)");
// daemon.json 全程未被测试触碰（registerDaemon:false），真实托盘守护的服务记录不受影响

// 测试结束即收掉测试 daemon：不留"供人工查看"的后台进程（每次残留都会变成下轮的端口冲突源）
try { started.server.close(); } catch {}
console.log(`\n✅ 链路全通。测试 daemon 已关闭（要人工看 GUI 就注释掉 server.close 那行）`);
process.exit(0);
