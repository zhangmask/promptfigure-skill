// cdp-gui-check.mjs — CDP 打开真实 GUI，验证 PDF 渲染与 textLayer
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const d = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".promptfigure", "daemon.json"), "utf8"));
const GUI = `http://127.0.0.1:${d.port}/?doc=1b0d6cddb9a8&token=${d.guiToken}`;

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

const PORT = 9334;
const profile = path.join(os.tmpdir(), "pf-cdp-profile2");
fs.rmSync(profile, { recursive: true, force: true });
const browser = spawn(EDGE, ["--headless", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 20; i++) {
  try {
    const list = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json());
    const page = list.find((t) => t.type === "page");
    if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
  } catch {}
  await sleep(500);
}
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let msgId = 0;
const pending = new Map();
const consoleLogs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.consoleAPICalled") consoleLogs.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  if (m.method === "Runtime.exceptionThrown") consoleLogs.push("EXC: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: GUI });
await sleep(15000); // 等 PDF 全部页渲染

const res = await send("Runtime.evaluate", {
  expression: `(() => {
    const pages = document.querySelectorAll('.pdf-page');
    let withContent = 0, textSpans = 0;
    pages.forEach(p => {
      const c = p.querySelector('canvas');
      if (!c) return;
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 400) if (d[i] < 200) dark++;
      if (dark > 20) withContent++;
      textSpans += p.querySelectorAll('.textLayer span').length;
    });
    return JSON.stringify({ pages: pages.length, withContent, textSpans,
      err: document.getElementById('doc-view').textContent.slice(0, 80) });
  })()`,
  returnByValue: true,
});
console.log("GUI 状态:", res.result?.result?.value);
console.log("console:", consoleLogs.slice(0, 5));

// 顺便截一张含图页（第 4 页起是实验图）——滚动到第 4 页
await send("Runtime.evaluate", { expression: `document.querySelectorAll('.pdf-page')[3]?.scrollIntoView()` });
await sleep(1500);
const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("C:/Users/72952/AppData/Local/Temp/pf-gui-real.png", Buffer.from(shot.result.data, "base64"));
console.log("screenshot saved");

ws.close();
browser.kill();
process.exit(0);
