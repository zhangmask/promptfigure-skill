// test-mutation.mjs — 变异测试（测试的测试，2026-09-23 用户拍板"你没有严格测试"）
// 原理：对核心模块故意注入一处坏改动（变异体），然后跑守卫测试套件。
//   任一守卫套件挂 = 测试真的在测这段逻辑 = ✅ killed
//   全部守卫套件绿 = 该逻辑没有任何测试保护 = ❌ SURVIVED（测试盲区，补断言）
// 金标准：每个变异体都必须被杀掉。本脚本自身也曾有语义 bug（把 killed 判反）——
// 工具也是被测对象，这就是为什么要跑两遍确认。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import url from "node:url";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const TARGETS = [
  {
    file: "src/quality.mjs",
    guards: ["test-quality", "test-novice", "test-catalog-gate"],
    mutations: [
      ["intent 词数阈值 6→60（阈值失效）", "WORDS(intent) < 6", "WORDS(intent) < 60"],
      ["占位实体黑名单检查整体跳过", "GENERIC_ENTS.has", "!GENERIC_ENTS.has"],
      ["主链图 0 阶段也放行", "chainTypes.has(figureType) && stageList.length === 0", "false && stageList.length === 0"],
      ["覆盖率 50%→5%（硬门形同虚设）", "if (coverage < 0.5) {", "if (coverage < 0.05) {"],
      ["show 句判据失效（show 豁免反转为全拦）", "/^(show|draw|画|示意|绘制)/i.test(b.trim())", "false && /^(show|draw|画|示意|绘制)/i.test(b.trim())"],
      ["孤标签判定反转", "s.bullets.length === 1 && !isShowBullet(s.bullets[0])", "s.bullets.length === 1 && isShowBullet(s.bullets[0])"],
      ["整句判据失效（bullet-sentence 废）", "if (longSentence || punctuated) sentencey.push(b);", "if (false) sentencey.push(b);"],
      ["溯源对账 substring 反转（全误报）", "if (sCJK) { if (!src.includes(s)) missing.push(e); continue; }", "if (sCJK) { if (src.includes(s)) missing.push(e); continue; }"],
    ],
  },
  {
    file: "src/ledger.mjs",
    guards: ["test-process-gate"],
    mutations: [
      ["留证窗口 24h→0h（证据全部过期）", "export const EVIDENCE_WINDOW_MS = 24 * 3600 * 1000", "export const EVIDENCE_WINDOW_MS = 0"],
      ["hasEvidence 永真（三门全开）", "return evs.some((e) => {", "return true || evs.some((e) => {"],
      ["窗口过滤失效（老事件也算证据）", "if (t < since) return false;", "if (false) return false;"],
    ],
  },
  {
    file: "src/entity-pair.mjs",
    guards: ["test-novice", "test-quality"],
    mutations: [
      ["对照分割失效（双语溯源断链）", 'raw.split("|")', 'raw.split("__NEVER__")'],
    ],
  },
];

const BACKUPS = new Map();

function runSuite(name) {
  try {
    const out = execFileSync("node", [path.join(ROOT, "scripts", `${name}.mjs`)], {
      cwd: ROOT, encoding: "utf8", timeout: 240000, stdio: ["ignore", "pipe", "pipe"],
    });
    return /❌|FAIL|fail=[1-9]/.test(out) ? false : true;
  } catch {
    return false; // 非 0 退出 = 测试挂了 = 变异被杀
  }
}

let survived = 0, killed = 0;
for (const t of TARGETS) {
  const abs = path.join(ROOT, t.file);
  const orig = fs.readFileSync(abs, "utf8");
  BACKUPS.set(abs, orig);
  for (const [desc, from, to] of t.mutations) {
    if (!orig.includes(from)) {
      console.log(`  ⚠️ SKIP（原串不在，mutation 过期）: ${t.file} :: ${desc}`);
      continue;
    }
    fs.writeFileSync(abs, orig.replace(from, to), "utf8");
    const green = [];
    for (const s of t.guards) {
      if (runSuite(s)) green.push(s);
    }
    if (green.length === t.guards.length) {
      survived++;
      console.log(`  ❌ SURVIVED: [${t.file}] ${desc} —— 守卫全绿，没测试保护`);
    } else {
      killed++;
      console.log(`  ✅ killed: [${t.file}] ${desc}（挂: ${t.guards.filter((g) => !green.includes(g)).join(",")}）`);
    }
    fs.writeFileSync(abs, orig, "utf8"); // 还原
  }
}
// 兜底校验：所有目标文件必须与变异前一致
for (const [abs, orig] of BACKUPS) {
  if (fs.readFileSync(abs, "utf8") !== orig) {
    console.log(`🚨 FATAL: ${abs} 未还原！`); process.exit(1);
  }
}
console.log(`\n===== 变异测试：${killed} 杀 / ${survived} 幸存 =====`);
process.exit(survived > 0 ? 1 : 0);
