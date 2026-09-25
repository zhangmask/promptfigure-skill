// real-key-test.mjs — 真实链路验证：登录演示号 → 建 pf_ key → 插件真出一张 standard 图
// 🔴 key 明文只进 ~/.promptfigure/config.json（权限600），终端只打印脱敏前缀
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const imp = (p) => import("file:///" + path.join(ROOT, p).replace(/\\/g, "/"));

const BASE = "https://promptfigure.top";
const EMAIL = "729521972@qq.com";
const PASSWORD = "QQ8639qq";
const mask = (k) => k.slice(0, 8) + "…(" + k.length + "位)";

// 1) 登录
const login = await fetch(`${BASE}/api/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
}).then((r) => r.json());
if (!login.token) throw new Error("登录失败: " + JSON.stringify({ ...login, token: undefined }));
console.log("① 登录成功", EMAIL, "| plan:", login.plan || "-", "| membership:", login.membership || "-", "| balance:", login.balance);

// 2) 建 key（明文只出现这一次；若 key 数满会报错，那说明之前建过 → 让用户手动给）
const created = await fetch(`${BASE}/api/keys`, {
  method: "POST",
  headers: { Authorization: `Bearer ${login.token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ name: "local-plugin" }),
}).then((r) => r.json());
if (!created.key) throw new Error("建 key 失败: " + JSON.stringify(created));
console.log("② key 已创建:", mask(created.key), "（存入插件配置）");

// 3) 存进插件配置
const { saveConfig } = await imp("src/config.mjs");
saveConfig({ key: created.key, defaultModel: "standard" });
console.log("③ 已写入 ~/.promptfigure/config.json");

// 4) 真出一张 standard 图（走插件的 render 模块：polish:false + 402 自动换通道）
const { renderFigure } = await imp("src/render.mjs");
console.log("④ 出图中（standard，额度通道优先）…");
const t0 = Date.now();
const out = await renderFigure({
  docId: "46c38ad628b4",
  prompt: "A clean academic flowchart of a two-stage track defect detection framework: stage 1 image preprocessing and data augmentation, stage 2 vision transformer classification. White background, thin blue boxes, black arrows, minimal flat style, no watermark.",
  model: "standard",
  at: "§1.2 ¶1",
  side: "after",
});
console.log(`⑤ ✅ 出图成功 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log("   ", JSON.stringify({ figureId: out.figureId, version: out.version, channel: out.channel, quota: out.quota, balance: out.balance }, null, 2));
