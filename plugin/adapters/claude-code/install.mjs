// 安装到 ~/.claude/skills/（promptfigure-local + promptfigure-api 两个都装）
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const here = (p) => new URL(p, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
for (const name of ["promptfigure-local", "promptfigure-api"]) {
  const dest = path.join(os.homedir(), ".claude", "skills", name);
  fs.cpSync(here("./" + name), dest, { recursive: true });
  console.log("✅ 已安装到 " + dest);
}
