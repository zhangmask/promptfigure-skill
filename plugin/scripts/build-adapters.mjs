// build-adapters.mjs — skill 源 → 各 AI 宿主包装产物
// 🔴 adapters/ 下全部由本脚本生成，勿手改
// 🔴 skill 源在 skill/ 下，一份内容两个 skill：
//    promptfigure-local（依赖 pf CLI 的本地工作流）/ promptfigure-api（纯 REST）
//    两者随插件一起发行（zip 与 npm 包同此结构）：装插件 = 同时拿到两个 skill。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SKILLS = path.join(ROOT, "skill");
const ADAPTERS = path.join(ROOT, "adapters");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const VERSION = PKG.version;

// 复制整个 skill 目录（SKILL.md + references/），目标不存在时建
function copySkillDir(name, destDir) {
  fs.cpSync(path.join(SKILLS, name), destDir, { recursive: true });
}

const fs_rmSync = fs.rmSync;
fs_rmSync(ADAPTERS, { recursive: true, force: true });

// ---- Codex：plugin 目录（.codex-plugin/plugin.json + skills/ + marketplace.json）----
const codex = path.join(ADAPTERS, "codex", "promptfigure");
fs.mkdirSync(path.join(codex, ".codex-plugin"), { recursive: true });
for (const name of ["promptfigure-local", "promptfigure-api"]) {
  copySkillDir(name, path.join(codex, "skills", name));
}

fs.writeFileSync(
  path.join(codex, ".codex-plugin", "plugin.json"),
  JSON.stringify(
    {
      name: "promptfigure",
      version: VERSION,
      description: "promptFigure 本地插件：为论文配科研图（锚点定位 + 出图 + 审批闭环），随包附带 promptfigure-api / promptfigure-local 两个 skill",
      skills: "./skills/",
    },
    null,
    2,
  ),
);

// marketplace.json（本地安装用）
fs.writeFileSync(
  path.join(ADAPTERS, "codex", "marketplace.json"),
  JSON.stringify(
    {
      plugins: [
        {
          name: "promptfigure",
          source: { source: "local", path: "./promptfigure" },
          policy: { installation: "trusted" },
        },
      ],
    },
    null,
    2,
  ),
);

// ---- Claude Code：skill 目录拷贝脚本（两个 skill 都装）----
const claude = path.join(ADAPTERS, "claude-code");
fs.mkdirSync(claude, { recursive: true });
for (const name of ["promptfigure-local", "promptfigure-api"]) {
  copySkillDir(name, path.join(claude, name));
}
fs.writeFileSync(
  path.join(claude, "install.mjs"),
  `// 安装到 ~/.claude/skills/（promptfigure-local + promptfigure-api 两个都装）
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const here = (p) => new URL(p, import.meta.url).pathname.replace(/^\\/([A-Za-z]:)/, "$1");
for (const name of ["promptfigure-local", "promptfigure-api"]) {
  const dest = path.join(os.homedir(), ".claude", "skills", name);
  fs.cpSync(here("./" + name), dest, { recursive: true });
  console.log("✅ 已安装到 " + dest);
}
`,
);

console.log("✅ adapters/ 已生成（v" + VERSION + "，两个 skill）：");
for (const p of walk(ADAPTERS)) console.log("   " + path.relative(ROOT, p));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const f = path.join(dir, d.name);
    return d.isDirectory() ? walk(f) : [f];
  });
}
