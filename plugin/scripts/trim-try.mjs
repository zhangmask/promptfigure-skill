// 离线验证 png-trim：对指定 PNG 做白边裁剪，输出到目标路径（不动图库）
// 用法：node scripts/trim-try.mjs <src.png> <out.png>
import fs from "node:fs";
import { trimWhitespace } from "../src/png-trim.mjs";

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error("用法：node scripts/trim-try.mjs <src.png> <out.png>");
  process.exit(1);
}
const r = trimWhitespace(fs.readFileSync(src));
if (!r) {
  console.log("无需裁剪（留白未超阈值）或解析失败");
  process.exit(0);
}
fs.writeFileSync(out, r.buf);
console.log(`from ${r.from.w}x${r.from.h} -> ${r.to.w}x${r.to.h}  省 ${r.savedPct}% 面积`);
