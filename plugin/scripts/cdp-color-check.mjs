// cdp-color-check.mjs — 逐页统计彩色像素，确认原始图真的画出来了
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const d = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".promptfigure", "daemon.json"), "utf8"));
const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));
const PORT = 9335;
const profile = path.join(os.tmpdir(), "pf-cdp-profile3");
fs.rmSync(profile, { recursive: true, force: true });
const b = spawn(EDGE, ["--headless", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 20; i++) {
  try {
    const l = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json());
    const p = l.find((t) => t.type === "page");
    if (p) { wsUrl = p.webSocketDebuggerUrl; break; }
  } catch {}
  await sleep(500);
}
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i2 = ++id; pend.set(i2, res); ws.send(JSON.stringify({ id: i2, method, params })); });

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: `http://127.0.0.1:${d.port}/?doc=1b0d6cddb9a8&token=${d.guiToken}` });
await sleep(14000);

const expr = `(() => {
  const out = [];
  document.querySelectorAll('.pdf-page').forEach((p, idx) => {
    const c = p.querySelector('canvas'); if (!c) return;
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let colored = 0;
    for (let i = 0; i < d.length; i += 400) {
      const r0 = d[i], g0 = d[i+1], b0 = d[i+2];
      if (Math.abs(r0-g0) > 25 || Math.abs(g0-b0) > 25 || Math.abs(r0-b0) > 25) colored++;
    }
    out.push('p' + (idx+1) + ' colored=' + colored);
  });
  return out.join(' | ');
})()`;
const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
console.log(r.result?.result?.value || "(无结果)");
ws.close();
b.kill();
process.exit(0);
