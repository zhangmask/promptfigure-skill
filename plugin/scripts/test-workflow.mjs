// test-workflow.mjs — 工作流状态库回归（2026-10-17 用户拍板"服务端只做 API，步骤标记放本地"）
// 覆盖：init 门禁 / 乱序拦截 / 证据必填 / skip 理由 / 审查逐维记录与 FAIL 打回 /
//       acceptance 四项 + 禁词拒绝 / check 退出码语义（交付硬门）/ review 模板 A-E。
// 零成本：不碰出图、不碰 daemon —— 纯本地 store + CLI 子进程。

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0, fail = 0;
const assert = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? " —— " + detail : ""}`); }
};

function pf(args) {
  // 同 test-process-gate：spawnSync stdio EBUSY 规避，输出落临时文件
  for (let attempt = 0; ; attempt++) {
    const tmpOut = path.join(os.tmpdir(), `pf-wf-out-${process.pid}-${attempt}.txt`);
    const fd = fs.openSync(tmpOut, "w");
    const r = spawnSync(process.execPath, [path.join(ROOT, "bin", "pf.mjs"), ...args], {
      cwd: ROOT, timeout: 60000, stdio: ["ignore", fd, fd], env: { ...process.env, FORCE_COLOR: "0" },
    });
    fs.closeSync(fd);
    const out = fs.existsSync(tmpOut) ? fs.readFileSync(tmpOut, "utf8") : "";
    fs.rmSync(tmpOut, { force: true });
    if (!(r.error?.code === "EBUSY" && attempt < 4)) {
      return { code: r.status ?? 1, out: out.trim() };
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
}

// ---- 沙盒项目（真实 PROJECTS_DIR 下建临时 docId，结束清理）----
const { PF_DIR } = await import(new URL(`file://${path.join(ROOT, "src", "config.mjs").replace(/\\/g, "/")}`).href);
const docId = `wf-test-${Date.now() % 10000000}`;
const projDir = path.join(PF_DIR, "projects", docId);
fs.mkdirSync(projDir, { recursive: true });
fs.writeFileSync(path.join(projDir, "meta.json"), JSON.stringify({ docId, figures: {} }));
const W = ["workflow", "--doc", docId];
const clean = () => { try { fs.rmSync(projDir, { recursive: true, force: true }); } catch {} };
process.on("exit", clean);
process.on("SIGINT", () => { clean(); process.exit(2); });

console.log("── upgrade 模板 ──");

let r = pf([...W, "init"]);
assert("init 缺 --kind 被拒", r.code === 1 && /--kind/.test(r.out), r.out.slice(0, 120));

r = pf([...W, "status"]);
assert("无工作流时 status 报人话", r.code === 1 && /没有活跃工作流/.test(r.out), r.out.slice(0, 120));

r = pf([...W, "init", "--kind", "upgrade", "--goal", "DFDC 图升级"]);
assert("init 成功", r.code === 0 && /工作流已建立/.test(r.out), r.out.slice(0, 200));
assert("清单 9 步全 pending", (r.out.match(/⬜/g) || []).length >= 9, r.out);
assert("下一步指向 context", /done context/.test(r.out), r.out.slice(-400));

r = pf([...W, "init", "--kind", "review"]);
assert("活跃时重复 init 被拒", r.code === 1 && /已有未完结工作流/.test(r.out), r.out.slice(0, 150));

r = pf([...W, "done", "produce", "--note", "产物在 x.png"]);
assert("乱序标记被拦（顺序锁）", r.code === 1 && /顺序被拦/.test(r.out) && /context/.test(r.out), r.out.slice(0, 200));

r = pf([...W, "done", "context", "--note", "论点：X"]);
assert("context 缺 --evidence 被拒", r.code === 1 && /--evidence/.test(r.out), r.out.slice(0, 200));

r = pf([...W, "done", "context", "--note", "论点：定位图配对是核心", "--evidence", "首句：We pair faces…｜尾句：…estimation quality"]);
assert("context 带证据通过", r.code === 0, r.out.slice(0, 200));

r = pf([...W, "skip", "panels"]);
assert("skip 缺理由被拒", r.code === 1 && /--reason/.test(r.out), r.out.slice(0, 150));

r = pf([...W, "skip", "deliver", "--reason", "单图不涉及"]);
assert("不可跳过步骤被拒", r.code === 1 && /不允许跳过/.test(r.out), r.out.slice(0, 150));

r = pf([...W, "skip", "panels", "--reason", "单图无 panel 拼版"]);
assert("panels 带理由跳过", r.code === 0, r.out.slice(0, 150));

r = pf([...W, "done", "genre", "--note", "comparison：结果对比体裁，Cell 式列对齐"]);
assert("genre 标记", r.code === 0, r.out.slice(0, 150));
r = pf([...W, "done", "materials", "--note", "裁片 pair-face-0.png / pair-paper-trim-1.png 就位"]);
assert("materials 标记", r.code === 0, r.out.slice(0, 150));
r = pf([...W, "done", "produce", "--note", "产物 figures/derived/dfdc_v7.png"]);
assert("produce 标记", r.code === 0, r.out.slice(0, 150));
r = pf([...W, "done", "selfcheck", "--note", "文字清单逐条核过", "--evidence", "Input/Estimated 小标齐全、行标竖排无截断"]);
assert("selfcheck 带证据标记", r.code === 0, r.out.slice(0, 150));

r = pf([...W, "review", "--dim", "A", "--verdict", "PASS", "--evidence", "x"]);
assert("维度不属于本模板被拒", r.code === 1 && /不属于本工作流/.test(r.out), r.out.slice(0, 150));

r = pf([...W, "review", "--dim", "F", "--verdict", "PASS"]);
assert("review 缺证据被拒", r.code === 1 && /--evidence/.test(r.out), r.out.slice(0, 150));

r = pf([...W, "review", "--dim", "F", "--verdict", "PASS", "--evidence", "行内图块零间距、行标竖排，对齐 CXTrack Fig.5"]);
assert("F PASS 记录", r.code === 0 && /审查 F → PASS/.test(r.out), r.out.slice(0, 200));

r = pf([...W, "status"]);
assert("审查记录可视化：G/H 未审", /G\(合理分段\) ⬜/.test(r.out) && /H\(/.test(r.out), r.out);

r = pf([...W, "review", "--dim", "G", "--verdict", "FAIL", "--evidence", "第二列与第三列间距不齐"]);
assert("G FAIL 记录", r.code === 0 && /FAIL/.test(r.out), r.out.slice(0, 200));

r = pf([...W, "review", "--dim", "H", "--verdict", "PASS", "--evidence", "补了输入人脸对照列，符合原文配对逻辑"]);
r = pf([...W, "check"]);
assert("有 FAIL 时 check 拒绝交付（exit 1）", r.code === 1 && /G 判 FAIL/.test(r.out), r.out.slice(0, 300));

r = pf([...W, "review", "--dim", "G", "--verdict", "PASS", "--evidence", "重拼后列间距统一 12px"]);
r = pf([...W, "status"]);
assert("三维全 PASS 后 review 步自动 done", /review.*done|✅.*审查三维/.test(r.out), r.out.slice(0, 400));

r = pf([...W, "acceptance", "--story", "s", "--segmentation", "g", "--alignment", "a"]);
assert("acceptance 缺字段被拒", r.code === 1 && /enhancement/.test(r.out), r.out.slice(0, 150));

r = pf([...W, "acceptance", "--story", "s", "--segmentation", "g", "--alignment", "a", "--enhancement", "做了超分辨率提升清晰度"]);
assert("acceptance 禁词被拒", r.code === 1 && /白名单外/.test(r.out), r.out.slice(0, 200));

r = pf([...W, "acceptance", "--story", "定位配对论点成立", "--segmentation", "按 4 行方法分段", "--alignment", "列基线对齐", "--enhancement", "对比度拉伸 1-99.5 百分位；有意不做：不超分不重绘"]);
assert("acceptance 合规通过", r.code === 0, r.out.slice(0, 200));

r = pf([...W, "check"]);
assert("只差 deliver 时 check 列明缺步", r.code === 1 && /⬜ 步骤 deliver/.test(r.out) && !/genre/.test(r.out), r.out.slice(0, 300));

r = pf([...W, "done", "deliver", "--note", "round-v2.md 已写、ledger 已更"]);
r = pf([...W, "check"]);
assert("全绿 check exit 0", r.code === 0 && /全部完成/.test(r.out), r.out.slice(0, 300));

console.log("── review 模板（阶段4 A-E）──");

r = pf([...W, "init", "--kind", "review"]);
assert("review 模板建立", r.code === 0 && /阶段 4/.test(r.out), r.out.slice(0, 200));
r = pf([...W, "done", "collect", "--note", "2 张待审"]);
for (const d of ["A", "B", "C", "D", "E"]) {
  r = pf([...W, "review", "--dim", d, "--verdict", "PASS", "--evidence", `维度${d}证据：量化描述`]);
  if (r.code !== 0) break;
}
r = pf([...W, "status"]);
assert("A-E 全审后 dims 步自动 done", /✅\s*逐维审查.*全 PASS/.test(r.out), r.out.slice(0, 400));
r = pf([...W, "review", "--dim", "F", "--verdict", "PASS", "--evidence", "x"]);
assert("review 模板不接受 F 维", r.code === 1 && /不属于本工作流/.test(r.out), r.out.slice(0, 150));
r = pf([...W, "done", "report", "--note", "审核卡已出、qa 已写回"]);
r = pf([...W, "check"]);
assert("review 模板全绿 exit 0", r.code === 0, r.out.slice(0, 300));

r = pf([...W, "init", "--kind", "upgrade", "--goal", "重开第二轮", ]);
assert("完结后可再 init（新工作流）", r.code === 0 && /工作流已建立/.test(r.out), r.out.slice(0, 150));

console.log("── 错误路径（宿主失误 / 坏档 / 锁残留）──");
const wfFile = path.join(projDir, "workflow.json");
const lockPath = path.join(projDir, ".pf-write.lock");

// 坏档：不能伪装成"没有工作流"，更不能被 init 静默覆盖（2026-10-18 审计）
pf([...W, "init", "--kind", "upgrade"]);
fs.writeFileSync(wfFile, '{"kind":"upgrade","steps":[{"id":"context","sta');
r = pf([...W, "status"]);
assert("坏档 status 报损坏+备份，不冒充'没有工作流'", r.code === 1 && /损坏/.test(r.out) && !/没有活跃工作流/.test(r.out), r.out.slice(0, 200));
const backups = fs.readdirSync(projDir).filter((f) => f.startsWith("workflow.json.bak-"));
assert("坏档已自动备份", backups.length >= 1, String(backups));
r = pf([...W, "init", "--kind", "upgrade"]);
assert("坏档 init 拒绝静默覆盖并指路 --reset", r.code === 1 && /--reset/.test(r.out), r.out.slice(0, 220));
assert("坏档 init 被拒后文件仍在（没被清空）", fs.existsSync(wfFile));
r = pf([...W, "check"]);
assert("坏档 check 不静默放行", r.code === 1 && /损坏/.test(r.out), r.out.slice(0, 150));

// 旧模板：不崩栈，报"与当前模板不匹配"
fs.writeFileSync(wfFile, JSON.stringify({ kind: "upgrade", reviews: [], acceptance: null }));
r = pf([...W, "status"]);
assert("旧模板 status 报不匹配且无 TypeError", r.code === 1 && /模板不匹配/.test(r.out) && !/Cannot read propert/.test(r.out), r.out.slice(0, 250));
r = pf([...W, "status"]); // 二次调用：确认旧的坏档已被处理，不会连环崩
assert("旧模板二次调用仍给同一人话报错", r.code === 1 && /模板不匹配/.test(r.out), r.out.slice(0, 150));
r = pf([...W, "init", "--kind", "upgrade", "--reset"]);
assert("旧模板 --reset 可重建且 exit 0", r.code === 0 && /已重置/.test(r.out), r.out.slice(0, 200));

// init --reset 在正常活跃工作流上必须 exit 0（旧版重置成功却报失败）
pf([...W, "done", "context", "--note", "旧论点", "--evidence", "a|b"]);
r = pf([...W, "init", "--kind", "upgrade", "--reset"]);
assert("活跃工作流 --reset 成功且 exit 0（不再双 init）", r.code === 0 && !/未完结/.test(r.out), r.out.slice(0, 200));
r = pf([...W, "status"]);
assert("--reset 后步骤归零", /⬜\s*原文定位/.test(r.out), r.out.slice(0, 200));

// skip 不许覆盖已完成记录（旧版静默把 done 改成 skipped）
pf([...W, "done", "context", "--note", "论点", "--evidence", "首句x|尾句y"]);
pf([...W, "done", "genre", "--note", "comparison"]);
pf([...W, "done", "panels", "--note", "2x2 布局"]);
r = pf([...W, "skip", "panels", "--reason", "单图"]);
assert("skip 拒绝覆盖已 done 步骤", r.code === 1 && /已完成/.test(r.out), r.out.slice(0, 200));
r = pf([...W, "status"]);
assert("被拒后 panels 仍是 done", /✅\s*panel 清单/.test(r.out), r.out.slice(0, 300));

// 审查不许空审（产物出来之前）
r = pf([...W, "review", "--dim", "F", "--verdict", "PASS", "--evidence", "看起来对齐"]);
assert("产物前的审查被拦", r.code === 1 && /审查被拦/.test(r.out), r.out.slice(0, 220));

// 锁残留：空锁 / 死 PID 锁都必须自动破，不能让宿主干等 10s 后失败（2026-10-18 实测 pid 持锁 31s 连带全挂）
fs.writeFileSync(lockPath, "");
let t0 = Date.now();
r = pf([...W, "done", "materials", "--note", "素材就位"]);
assert("空锁自动破、写入成功", r.code === 0 && Date.now() - t0 < 8000, `${Date.now() - t0}ms ${r.out.slice(0, 120)}`);
fs.writeFileSync(lockPath, `999999 ${new Date().toISOString()}`);
t0 = Date.now();
r = pf([...W, "done", "produce", "--note", "产物 figures/x.png"]);
assert("死 PID 锁自动破、写入成功", r.code === 0 && Date.now() - t0 < 8000, `${Date.now() - t0}ms ${r.out.slice(0, 120)}`);
assert("写入后锁文件已清", !fs.existsSync(lockPath));

console.log(`\n结果：${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
