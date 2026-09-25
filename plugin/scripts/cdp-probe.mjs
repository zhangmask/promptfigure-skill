// cdp-probe.mjs — 用 CDP 真实等待探针结果（Node 22 内置 WebSocket）
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));
if (!EDGE) { console.error("no edge"); process.exit(1); }

const PORT = 9333;
const profile = path.join(os.tmpdir(), "pf-cdp-profile");
fs.rmSync(profile, { recursive: true, force: true });

const browser = spawn(EDGE, [
  "--headless", "--disable-gpu", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, "--no-first-run", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 20; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json());
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error("CDP 未就绪");
}

const ws = new WebSocket(await getWsUrl());
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let msgId = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send("Page.enable");
await send("Runtime.enable");
// 收集 console 与异常
const consoleLogs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.consoleAPICalled") {
    consoleLogs.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  }
  if (m.method === "Runtime.exceptionThrown") {
    consoleLogs.push("EXC: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  }
};

await send("Page.navigate", { url: "http://127.0.0.1:17420/probe.html" });
await sleep(25000); // 真实等待

const res = await send("Runtime.evaluate", { expression: "document.getElementById('out').textContent", returnByValue: true });
console.log("=== probe 输出 ===");
console.log(res.result?.result?.value || "(空)");
console.log("=== console/异常 ===");
consoleLogs.forEach((l) => console.log(l));

ws.close();
browser.kill();
process.exit(0);
