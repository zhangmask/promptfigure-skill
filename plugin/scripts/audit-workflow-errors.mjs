// 审计：宿主 AI 失误时，workflow 状态库怎么反应（不改代码，只观测）
// 关注：静默通过 / 静默覆盖 / 崩栈（TypeError 栈而非人话）/ 数据丢失
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const NODE = process.execPath;
const PF = path.resolve("bin/pf.mjs");
const DOC = "wf-audit-01";
const P = path.join(os.homedir(), ".promptfigure", "projects", DOC);
const WF = path.join(P, "workflow.json");
const EV = path.join(P, "events.jsonl");

const run = (args) => {
  try {
    const out = execFileSync(NODE, [PF, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? -1, out: String(e.stdout || "") + String(e.stderr || "") };
  }
};
const WFargs = (...a) => ["workflow", "--doc", DOC, ...a];
const clean = () => { for (const f of [WF, EV]) { try { fs.unlinkSync(f); } catch {} } };
const readWF = () => { try { return JSON.parse(fs.readFileSync(WF, "utf8")); } catch { return null; } };
const st = (id) => (readWF()?.steps || []).find((s) => s.id === id)?.status || "?";
const firstLine = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean)[0] || "";
const isStack = (s) => /^\s*at .*\(|TypeError|Cannot read propert|undefined is not/.test(s);

const rows = [];
function scenario(name, cmd, prep, after) {
  clean();
  if (prep) prep();
  const r = run(cmd);
  rows.push({ name, code: r.code, first: firstLine(r.out), stack: isStack(r.out), after: after ? after(r) : "" });
}

// —— 基线：正常 init ——
scenario("基线 init upgrade", WFargs("init", "--kind", "upgrade"));

// —— S1 错 docId ——
scenario("S1 --doc 拼错（不存在）", ["workflow", "--doc", "wf-audit-9x", "init", "--kind", "upgrade"]);
// —— S2 --doc 传路径 ——
scenario("S2 --doc 传 .tex 路径", ["workflow", "--doc", "./paper.tex", "init", "--kind", "upgrade"]);

// —— S3 缺 evidence ——
scenario("S3 done context 不带 evidence", WFargs("done", "context", "--note", "论点"),
  () => run(WFargs("init", "--kind", "upgrade")));

// —— S4 步骤名拼错/大小写 ——
scenario("S4 done ProduCe（拼错大小写）", WFargs("done", "ProduCe", "--note", "x"),
  () => run(WFargs("init", "--kind", "upgrade")));

// —— S5 kind 大写 ——
scenario("S5 init --kind Upgrade（大写）", WFargs("init", "--kind", "Upgrade"));

// —— S6 未知审查维度 ——
scenario("S6 review --dim Z", WFargs("review", "--dim", "Z", "--verdict", "PASS", "--evidence", "x"),
  () => run(WFargs("init", "--kind", "upgrade")));

// —— S7 verdict 小写 ——
scenario("S7 review --verdict pass（小写）", WFargs("review", "--dim", "F", "--verdict", "pass", "--evidence", "行内零间距"),
  () => run(WFargs("init", "--kind", "upgrade")), () => `F=${readWF()?.reviews?.[0]?.verdict}`);

// —— S8 review 缺 evidence ——
scenario("S8 review 缺 evidence", WFargs("review", "--dim", "F", "--verdict", "PASS"),
  () => run(WFargs("init", "--kind", "upgrade")));

// —— S9 重复 skip 已 done 的步骤（数据是否被改写）——
scenario("S9 skip 一个已 done 的步骤", WFargs("skip", "panels", "--reason", "单图"),
  () => {
    run(WFargs("init", "--kind", "upgrade"));
    run(WFargs("done", "context", "--note", "论点", "--evidence", "首句 a|尾句 b"));
    run(WFargs("done", "genre", "--note", "comparison"));
    run(WFargs("done", "panels", "--note", "2x2 布局"));
  }, () => `panels 状态=${st("panels")}`);

// —— S10 done 一个已 skip 的步骤 ——
scenario("S10 done 一个已 skip 的步骤", WFargs("done", "panels", "--note", "补做"),
  () => {
    run(WFargs("init", "--kind", "upgrade"));
    run(WFargs("done", "context", "--note", "论点", "--evidence", "a|b"));
    run(WFargs("done", "genre", "--note", "comparison"));
    run(WFargs("skip", "panels", "--reason", "单图"));
  }, () => `panels 状态=${st("panels")}`);

// —— S11 workflow.json 损坏（半截 JSON）——
scenario("S11 workflow.json 损坏 → status", WFargs("status"),
  () => { fs.writeFileSync(WF, '{"kind":"upgrade","steps":[{"id":"context","sta'); }, () => `文件仍在=${fs.existsSync(WF)}`);
scenario("S11b workflow.json 损坏 → check", WFargs("check"),
  () => { fs.writeFileSync(WF, '{"kind":"upgrade","steps":[{"id":"context","sta'); });
scenario("S11c workflow.json 损坏 → init（是否静默重建）", WFargs("init", "--kind", "upgrade"),
  () => { fs.writeFileSync(WF, '{"kind":"upgrade","steps":[{"id":"context","sta'); }, () => `重建后 steps=${readWF()?.steps?.length}`);

// —— S12 旧模板（缺 steps 字段 / 步骤被改名）——
scenario("S12a 旧模板缺 steps → status", WFargs("status"),
  () => fs.writeFileSync(WF, JSON.stringify({ kind: "upgrade", reviews: [], acceptance: null }, null, 2)));
scenario("S12b 旧模板旧步骤名（无 genre）→ status", WFargs("status"),
  () => fs.writeFileSync(WF, JSON.stringify({
    kind: "upgrade",
    steps: [{ id: "context", status: "done", note: "x" }, { id: "oldstep", status: "done", note: "y" }],
    reviews: [], acceptance: null,
  }, null, 2)));
scenario("S12c 旧模板缺 steps → check", WFargs("check"),
  () => fs.writeFileSync(WF, JSON.stringify({ kind: "upgrade", reviews: [], acceptance: null }, null, 2)));

// —— S14 acceptance 重复提交 ——
scenario("S14 acceptance 提交两次（第二次不改状态）", WFargs("acceptance",
  "--story", "a", "--segmentation", "b", "--alignment", "c", "--enhancement", "d"),
  () => run(WFargs("init", "--kind", "upgrade")), () => `acc.at 变了=${!!readWF()?.acceptance?.at}`);

// —— S15 check 无工作流 ——
scenario("S15 无工作流时 check", WFargs("check"));

// —— S16 未知子命令 ——
scenario("S16 子命令敲错 statsu", WFargs("statsu"));
scenario("S17 空子命令", WFargs());
scenario("S18 done 无 stepId", WFargs("done"));

// —— S18b init --reset 全链 ——
scenario("S18b init --reset（已有活跃工作流）", WFargs("init", "--kind", "upgrade", "--reset"),
  () => { run(WFargs("init", "--kind", "upgrade")); run(WFargs("done", "context", "--note", "旧", "--evidence", "a|b")); },
  () => `重建后 context=${st("context")}（应为 pending）`);

console.log("\n场景 | exit | 首行 | 崩栈? | 事后状态");
console.log("=".repeat(110));
for (const r of rows) {
  console.log(`${r.name} | ${r.code} | ${r.stack ? "⚠️ " + r.stack : ""}${r.first.slice(0, 72)} | ${r.stack ? "YES" : "-"} | ${r.after}`);
}
clean();
