// cdp-approval-check.mjs — CDP 实测审批流改造：队列浮层 + 驳回占位条（2026-09-21）
// 跑法: node scripts/cdp-approval-check.mjs
// 前置: daemon 运行中；测试会真实点一次「通过」（跑完用 writeReview 还原原状态）
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

const PORT = 9335;
const profile = path.join(os.tmpdir(), "pf-cdp-profile-approval");
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
const evalJson = async (expression) => {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true });
  return JSON.parse(res.result?.result?.value || "{}");
};

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: GUI });
await sleep(12000);

// ---- 断言 1：内联图状态化 ----
const s1 = await evalJson(`(() => {
  const strips = [...document.querySelectorAll('.pf-inline-fig.rejected-strip')].map(el => el.textContent.trim().slice(0, 60));
  const imgs = [...document.querySelectorAll('.pf-inline-fig img')].map(el => (el.src.match(/fig%2F|fig\\//) ? el.src : el.src).split('/').pop());
  return JSON.stringify({
    btnQueue: !!document.querySelector('#btn-queue'),
    btnQueueCnt: document.querySelector('#cnt-queue')?.textContent || '',
    rejectedStrips: strips, inlineImgs: imgs,
  });
})()`);
console.log("断言1 内联状态化:", JSON.stringify(s1, null, 1));

// ---- 断言 2：打开审批队列 ----
await send("Runtime.evaluate", { expression: `document.querySelector('#btn-queue').click()` });
await sleep(800);
const s2 = await evalJson(`(() => {
  const q = document.querySelector('#queue');
  return JSON.stringify({
    visible: q && !q.classList.contains('hidden'),
    pos: document.querySelector('#queue-pos')?.textContent || '',
    imgLoaded: !!document.querySelector('#queue-img-el')?.src,
    hasApprove: !!document.querySelector('#queue-side [data-act="approve"]'),
    hasReject: !!document.querySelector('#queue-side [data-act="reject"]'),
  });
})()`);
console.log("断言2 队列浮层:", JSON.stringify(s2));

// 截图留档
const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(path.join(os.tmpdir(), "pf-queue-open.png"), Buffer.from(shot.result.data, "base64"));

// ---- 断言 3：点「通过」→ 队列清空自动关 ----
await send("Runtime.evaluate", { expression: `document.querySelector('#queue-side [data-act="approve"]').click()` });
await sleep(1500);
const s3 = await evalJson(`(() => {
  const q = document.querySelector('#queue');
  const toast = document.querySelector('#toast');
  return JSON.stringify({
    queueClosed: q.classList.contains('hidden'),
    toast: toast.classList.contains('hidden') ? '' : toast.textContent,
    cntQueue: document.querySelector('#cnt-queue')?.textContent || '',
  });
})()`);
console.log("断言3 通过后自动收尾:", JSON.stringify(s3));
console.log("console:", consoleLogs.filter((l) => l.startsWith("EXC")).slice(0, 3));

ws.close();
browser.kill();
process.exit(0);
