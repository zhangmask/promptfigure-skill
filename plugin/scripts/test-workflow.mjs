// test-workflow.mjs — 工作流状态库回归（2026-10-17 用户拍板"服务端只做 API，步骤标记放本地"）
// 覆盖：init 门禁 / 乱序拦截 / 证据必填 / skip 理由 / 审查逐维记录与 FAIL 打回 /
//       acceptance 四项 + 禁词拒绝 / check 退出码语义（交付硬门）/ review 模板 A-E /
//       🔴 外部事实校验（2026-10-18）：产物必须真实存在+哈希可复核、空话证据被拒、
//          旧图冒充被拒、产物被替换被拒 —— 状态字段是 AI 自己写的，不能当证据。
// 零成本：不碰出图、不碰 daemon —— 纯本地 store + CLI 子进程。

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makePng } from "./_testpng.mjs";

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
fs.mkdirSync(path.join(projDir, "figures"), { recursive: true });
fs.writeFileSync(path.join(projDir, "meta.json"), JSON.stringify({ docId, figures: {} }));
const ART = path.join(projDir, "figures", "dfdc_v7.png");
makePng(ART, 800, 600); // 真产物：produce 步现在要求磁盘上真有这个文件
const W = ["workflow", "--doc", docId];
const clean = () => { try { fs.rmSync(projDir, { recursive: true, force: true }); } catch {} };
process.on("exit", clean);
process.on("SIGINT", () => { clean(); process.exit(2); });

const EV_CONTEXT = "首句：We pair each face crop with its localization map｜尾句：quality degrades under occlusion";
const EV_SELF = "800×600，Input/Estimated 小标齐全，行标竖排无截断，第二行 5 个图块间距 0";
const EV_DIM = "行内图块零间距、列基线统一 96px，对齐 CXTrack Fig.5";

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

r = pf([...W, "done", "produce", "--note", "产物 figures/x.png"]);
assert("乱序标记被拦（顺序锁）", r.code === 1 && /顺序被拦/.test(r.out) && /context/.test(r.out), r.out.slice(0, 200));

r = pf([...W, "done", "context", "--note", "论点：X"]);
assert("context 缺 --evidence 被拒", r.code === 1 && /--evidence/.test(r.out), r.out.slice(0, 200));

r = pf([...W, "done", "context", "--note", "论点：定位图配对是核心", "--evidence", EV_CONTEXT]);
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

// 🔴 产物步：note 里的文件必须真实存在
r = pf([...W, "done", "produce", "--note", "产物 figures/derived/nope.png"]);
assert("产物不存在 → produce 当场拒（不再只看字段）", r.code === 1 && /不存在/.test(r.out), r.out.slice(0, 220));

r = pf([...W, "done", "produce", "--note", "产物 figures/dfdc_v7.png"]);
assert("真产物 produce 通过并取证", r.code === 0 && /produce 已标记/.test(r.out), r.out.slice(0, 300));

r = pf([...W, "done", "selfcheck", "--note", "文字清单逐条核过", "--evidence", "没问题"]);
assert("空话证据被拒（'没问题'不算证据）", r.code === 1 && /空话/.test(r.out), r.out.slice(0, 220));

r = pf([...W, "done", "selfcheck", "--note", "文字清单逐条核过", "--evidence", EV_SELF]);
assert("selfcheck 带真实证据标记", r.code === 0, r.out.slice(0, 150));

r = pf([...W, "review", "--dim", "A", "--verdict", "PASS", "--evidence", EV_DIM]);
assert("维度不属于本模板被拒", r.code === 1 && /不属于本工作流/.test(r.out), r.out.slice(0, 150));

r = pf([...W, "review", "--dim", "F", "--verdict", "PASS"]);
assert("review 缺证据被拒", r.code === 1 && /--evidence/.test(r.out), r.out.slice(0, 150));

r = pf([...W, "review", "--dim", "F", "--verdict", "PASS", "--evidence", "看起来很好"]);
assert("空话审查证据被拒", r.code === 1 && /空话|锚点/.test(r.out), r.out.slice(0, 220));

r = pf([...W, "review", "--dim", "F", "--verdict", "PASS", "--evidence", EV_DIM]);
assert("F PASS 记录", r.code === 0 && /审查 F → PASS/.test(r.out), r.out.slice(0, 200));

r = pf([...W, "status"]);
assert("审查记录可视化：G/H 未审", /G\(合理分段\) ⬜/.test(r.out) && /H\(/.test(r.out), r.out);

r = pf([...W, "review", "--dim", "G", "--verdict", "FAIL", "--evidence", "第二列与第三列间距不齐"]);
assert("G FAIL 记录", r.code === 0 && /FAIL/.test(r.out), r.out.slice(0, 200));

r = pf([...W, "review", "--dim", "H", "--verdict", "PASS", "--evidence", "补了输入人脸对照列，符合原文配对逻辑"]);
r = pf([...W, "check"]);
assert("有 FAIL 时 check 拒绝交付（exit 1）", r.code === 1 && /审查 G 判 FAIL/.test(r.out), r.out.slice(0, 300));

r = pf([...W, "review", "--dim", "G", "--verdict", "PASS", "--evidence", "重拼后列间距统一 12px"]);
r = pf([...W, "status"]);
assert("三维全 PASS 后 review 步自动 done", /✅\s*审.*全 PASS/.test(r.out), r.out.slice(0, 400));

r = pf([...W, "acceptance", "--story", "s", "--segmentation", "g", "--alignment", "a"]);
assert("acceptance 缺字段被拒", r.code === 1 && /enhancement/.test(r.out), r.out.slice(0, 150));

r = pf([...W, "acceptance", "--story", "s", "--segmentation", "g", "--alignment", "a", "--enhancement", "做了超分辨率提升清晰度"]);
assert("acceptance 禁词被拒", r.code === 1 && /白名单外/.test(r.out), r.out.slice(0, 200));

r = pf([...W, "acceptance", "--story", "定位配对论点成立", "--segmentation", "完了", "--alignment", "对齐了", "--enhancement", "优化了排版，整体更美观"]);
assert("acceptance 空话/无量化被拒", r.code === 1 && /空话|太短|量化/.test(r.out), r.out.slice(0, 220));

r = pf([...W, "acceptance", "--story", "定位配对论点成立", "--segmentation", "按 4 行方法分段，行内零间距", "--alignment", "列宽统一 96px，基线对齐", "--enhancement", "对比度拉伸 1-99.5 百分位；有意不做：不超分不重绘"]);
assert("acceptance 合规通过", r.code === 0, r.out.slice(0, 200));

r = pf([...W, "check"]);
assert("只差 deliver 时 check 列明缺步", r.code === 1 && /步骤 deliver 未完成/.test(r.out), r.out.slice(0, 300));

r = pf([...W, "done", "deliver", "--note", "round-v2.md 已写、ledger 已更"]);
r = pf([...W, "check"]);
assert("全绿 check exit 0", r.code === 0 && /通过复核/.test(r.out), r.out.slice(0, 300));

r = pf([...W, "receipt"]);
assert("交付凭据含进度/审查/产物哈希/check 结论", /\[pf-workflow\] upgrade 9\/9/.test(r.out) && /check 通过/.test(r.out) && /sha256:/.test(r.out), r.out.slice(0, 220));

console.log("── 外部事实校验（改产物 / 换旧图 / 伪造状态）──");

// 产物被替换：sha256 必须对不上
makePng(ART, 640, 480);
r = pf([...W, "check"]);
assert("产物被替换 → check 报 sha256 不符", r.code === 1 && /sha256|替换/.test(r.out), r.out.slice(0, 300));

// 换回原图（同内容同哈希）但把 mtime 改到开工前 = 用旧图冒充本轮产物
makePng(ART, 800, 600);
const old = new Date("2026-01-01T00:00:00Z");
fs.utimesSync(ART, old, old);
r = pf([...W, "check"]);
assert("旧图冒充（mtime 早于开工）→ check 拒", r.code === 1 && /旧图/.test(r.out), r.out.slice(0, 300));

// 产物文件被删
const keep = fs.readFileSync(ART);
fs.rmSync(ART);
r = pf([...W, "check"]);
assert("产物被删 → check 报文件不存在", r.code === 1 && /不存在/.test(r.out), r.out.slice(0, 300));
fs.writeFileSync(ART, keep);
const now = new Date();
fs.utimesSync(ART, now, now);

// 伪造状态：全部 done + 空话证据 + 无产物取证（旧版会 exit 0 放行）
const forged = JSON.parse(fs.readFileSync(path.join(projDir, "workflow.json"), "utf8"));
for (const s of forged.steps) { s.status = "done"; s.note = "已做"; s.evidence = "看过了"; s.artifact = null; s.at = new Date().toISOString(); }
forged.reviews = ["F", "G", "H"].map((d) => ({ dim: d, verdict: "PASS", evidence: "看起来很好", at: new Date().toISOString() }));
forged.acceptance = { story: "讲得通", segmentation: "分了段", alignment: "对齐了", enhancement: "更美观", at: new Date().toISOString() };
fs.writeFileSync(path.join(projDir, "workflow.json"), JSON.stringify(forged, null, 2));
r = pf([...W, "check"]);
assert("全 done + 空话 + 无产物 → check 拒（旧版会放行）", r.code === 1 && /产物未取证|空话|量化/.test(r.out), r.out.slice(0, 400));

console.log("── review 模板（阶段4 A-E）──");

r = pf([...W, "init", "--kind", "review", "--reset"]);
assert("review 模板建立", r.code === 0 && /阶段 4/.test(r.out), r.out.slice(0, 200));
r = pf([...W, "done", "collect", "--note", "2 张待审"]);
for (const d of ["A", "B", "C", "D", "E"]) {
  r = pf([...W, "review", "--dim", d, "--verdict", "PASS", "--evidence", `维度 ${d}：4 个方框顺序 X→Y 正确，字号 8pt`]);
  if (r.code !== 0) break;
}
r = pf([...W, "status"]);
assert("A-E 全审后 dims 步自动 done", /✅\s*逐维审查.*全 PASS/.test(r.out), r.out.slice(0, 400));
r = pf([...W, "review", "--dim", "F", "--verdict", "PASS", "--evidence", "列间距 12px"]);
assert("review 模板不接受 F 维", r.code === 1 && /不属于本工作流/.test(r.out), r.out.slice(0, 150));
r = pf([...W, "done", "report", "--note", "审核卡已出、qa 已写回"]);
r = pf([...W, "check"]);
assert("review 模板全绿 exit 0", r.code === 0, r.out.slice(0, 300));

r = pf([...W, "init", "--kind", "upgrade", "--goal", "重开第二轮"]);
assert("完结后可再 init（新工作流）", r.code === 0 && /工作流已建立/.test(r.out), r.out.slice(0, 150));

console.log("── 错误路径（宿主失误 / 坏档 / 锁残留）──");
const wfFile = path.join(projDir, "workflow.json");
const lockPath = path.join(projDir, ".pf-write.lock");

// 坏档：不能伪装成"没有工作流"，更不能被 init 静默覆盖（2026-10-18 审计）
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
pf([...W, "done", "context", "--note", "旧论点", "--evidence", EV_CONTEXT]);
r = pf([...W, "init", "--kind", "upgrade", "--reset"]);
assert("活跃工作流 --reset 成功且 exit 0（不再双 init）", r.code === 0 && !/未完结/.test(r.out), r.out.slice(0, 200));
r = pf([...W, "status"]);
assert("--reset 后步骤归零", /⬜\s*原文定位/.test(r.out), r.out.slice(0, 200));

// skip 不许覆盖已完成记录（旧版静默把 done 改成 skipped）
pf([...W, "done", "context", "--note", "论点", "--evidence", EV_CONTEXT]);
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
r = pf([...W, "done", "produce", "--note", "产物 figures/dfdc_v7.png"]);
assert("死 PID 锁自动破、写入成功", r.code === 0 && Date.now() - t0 < 8000, `${Date.now() - t0}ms ${r.out.slice(0, 120)}`);
assert("写入后锁文件已清", !fs.existsSync(lockPath));

console.log(`\n结果：${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
