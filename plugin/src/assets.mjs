// ---------- 资产槽位（2026-10-14）：scene 里 {{asset:名|路径}} / {{icon:名|描述}} ----------
// 背景（用户 2026-10-14 定规）：
//   ① 小图标/例图不该让整图一把渲时模型瞎画（假人脸、灰方块）——原文里的真实例图
//     （\includegraphics 捕获，meta blocks .images）应该贴进去；需要画的图标单独渲再合成。
//   ② 占位机制：scene 里写槽位 → craft 解析并把槽位改写成「纯品红 #FF00FF 矩形占位」
//     渲进大图 → compose 用 sharp 定位品红区域、把真图 cover 贴入 → 记账（asset.placed）。
//   ③ 持久化：槽位清单进 craft 伴随 JSON（sidecar），宿主 AI 通过命令回显知道全部状态，
//     不需要读内部文件。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";

// 🔴 PDF 槽位源（2026-10-14 真链路实测发现）：brief 列的原文图路径就是 \includegraphics 的
// PDF（LaTeX 论文图大多是 PDF），宿主 AI 照抄天经地义——compose 必须能吃 PDF。
// 光栅化走 python pypdfium2（WorkBuddy 内置 env），失败给人话错误不炸整个 compose。
function findPython() {
  const candidates = [
    path.join(os.homedir(), ".workbuddy", "binaries", "python", "envs", "default", "Scripts", "python.exe"),
    path.join(os.homedir(), ".workbuddy", "binaries", "python", "envs", "default", "bin", "python"),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return "python";
}

export function convertPdfToPng(pdfPath) {
  const outDir = path.join(path.dirname(pdfPath), ".pf-pdf-cache");
  fs.mkdirSync(outDir, { recursive: true });
  const mtime = fs.statSync(pdfPath).mtimeMs;
  const out = path.join(outDir, path.basename(pdfPath).replace(/\.pdf$/i, "") + `_${Math.round(mtime)}.png`);
  if (fs.existsSync(out)) return out;
  const script =
    "import sys, pypdfium2 as pdfium\n" +
    "pdf = pdfium.PdfDocument(sys.argv[1])\n" +
    "img = pdf[0].render(scale=2.0).to_pil()\n" +
    "img.save(sys.argv[2])\n";
  try {
    execFileSync(findPython(), ["-c", script, pdfPath, out], { timeout: 60000, stdio: "pipe" });
  } catch (e) {
    throw new Error(
      `槽位源是 PDF（${path.basename(pdfPath)}）且自动转图失败（${String(e.message).slice(0, 120)}）——` +
      `先把该图转成 PNG（或让宿主 AI 用其它工具导出），再更新 scene 里的槽位路径重跑 compose。`,
    );
  }
  if (!fs.existsSync(out)) throw new Error(`PDF 转图未产出文件：${out}`);
  return out;
}

// 🔴 来源标记（2026-10-14 用户定规「不是原图的要在数据库标记」）：每个槽位必须可溯源——
//   original    = 论文原文里的原图（\includegraphics 编译产物），直接贴，禁重画
//   reproduced  = 论文源代码跑出来的复现图（原图丢了时宿主 AI 复现所得）
//   drawn       = AI 画的（icon 槽位天然 drawn；asset 槽位绝不允许 drawn）
// 语法：{{asset:名|路径}}（缺省 original）| {{asset:名|路径|repro}}（复现图）
const SLOT_RE = /\{\{(asset|icon):\s*([^}|]+?)\s*\|\s*([^}|]+?)\s*(?:\|\s*([^}]+?)\s*)?\}\}/g;

const ASSET_PLACEHOLDER =
  "a solid bright magenta rectangle placeholder (pure #FF00FF fill, sharp straight edges, no border, no text inside it) placed INSIDE the card below its title, leaving the title text readable at the top of the card — this exact colour block is reserved and will be replaced by a real example image afterwards";
const ICON_PLACEHOLDER =
  "a solid bright magenta rectangle placeholder (pure #FF00FF fill, sharp straight edges, no border, no text inside it) placed INSIDE the card below its title — this exact colour block is reserved and will be replaced by a small icon afterwards";

// 🔴 槽位角色分类（2026-10-15 用户定规「有些是操作，应该画示意图而不是结果」）：
// grid6 实锤的巨大漏洞——槽位系统只管贴不贴、贴哪张，不管这张卡在讲什么。操作/方法步的卡
// （Denoise / Segment / Augment…）贴上论文里的结果例图，机制上畅通无阻。角色分类基于槽位
// 所在卡的标题与归属句词面：
//   operation → 这卡讲一个操作/方法步骤，素材应该是**示意图**（{{icon}} 槽位画流程示意），
//               贴结果图 = 图不对题；确要贴原图只允许贴方法结构图部分（crop= 裁模块）
//   result    → 展示结果/示例/对比的卡，才适合贴原图例图（{{asset}}）
// 词面分类不完美，但足以在 craft 阶段把明显错配拦下来让宿主 AI 显式定夺——而不是默默贴错。
const OPERATION_RE = new RegExp(
  "\\b(appl(?:y|ies|ied|ying)|perform(?:s|ed|ing)?|denois\\w*|segment\\w*|extract\\w*|augment\\w*|comput\\w*|process(?:es|ed|ing)?|transform\\w*|updat\\w*|iterat\\w*|optimi[sz]\\w*|train(?:s|ed|ing)?|refin\\w*|fus(?:e|es|ed|ing)|aggregat\\w*|encod\\w*|decod\\w*|reconstruct\\w*|pipeline|procedure|method|step|stage|module|framework|operation)" +
  "|(去噪|分割|提取|增强|计算|处理|变换|迭代|优化|训练|融合|编码|解码|重建|操作|方法|流程|步骤|模块)", "i");
const RESULT_RE = new RegExp(
  "\\b(results?|output images?|qualitative|examples?|samples?|generated (?:images?|samples?)|predictions?|comparisons?|visualizations?)" +
  "|(结果|示例|样例|效果图|对比)", "i");

// 解析 scene 里的槽位标记，返回 { slots, modelScene }；modelScene = 给图模型看的改写文本。
// 无槽位时 slots 为空数组、modelScene 原样返回（零行为变化）。
// 标签段（第 4 段）逗号分隔：来源（original/repro/reproduced/drawn，asset 缺省 original）
// + 可选 crop=l,t,w,h —— 原图按模块裁贴（2026-10-15 审查条款：用原图的哪个模块就裁哪个，
// 坐标必须先 Read 原图按真实像素定，不许目测猜）。
export function parseSlots(sceneText) {
  const slots = [];
  const raw = String(sceneText || "");
  const modelScene = raw.replace(SLOT_RE, (_m, kind, name, value, tag, offset) => {
    let source = kind === "icon" ? "drawn" : "original";
    let crop = null;
    // crop 几何先整段抓（坐标本身逗号分隔，不能先按逗号 split tag——实测 crop=0,2570,5366,850
    // 会被拆成 crop=0|2570|... 只剩一个数，crop 静默变 null）
    const cropM = String(tag || "").match(/crop\s*=\s*(\d+(?:\.\d+)?)[,x](\d+(?:\.\d+)?)[,x](\d+(?:\.\d+)?)[,x](\d+(?:\.\d+)?)/i);
    if (cropM) crop = { left: Math.round(+cropM[1]), top: Math.round(+cropM[2]), width: Math.round(+cropM[3]), height: Math.round(+cropM[4]) };
    for (const t of String(tag || "").split(",")) {
      const s = t.trim();
      if (s === "repro" || s === "reproduced") source = "reproduced";
      else if (s === "drawn") source = "drawn";
      else if (s === "original") source = "original";
    }
    const before = raw.slice(Math.max(0, offset - 220), offset);
    // 🔴 窗口跨界 bug（2026-10-15 实锤）：before 窗口会跨过上一个槽位标记，把前一张卡的
    // 句子算进本卡归属句（grid6 复现：Denoise 卡的 "steps" 污染了下一张 Output 卡的判定）。
    // 先截断到上一个槽位标记结束（}}），再取句。
    const prevEnd = before.lastIndexOf("}}");
    const scope = prevEnd >= 0 ? before.slice(prevEnd + 2) : before;
    // 🔴 空 about bug（2026-10-15 实锤）：句子以 ". " 结尾紧跟槽位时，split 最后一段是空串，
    // pop() 拿到 "" —— about 语义归属/角色分类一直在用空串匹配。过滤空段再取最后一段。
    const about = (scope.split(/\n+|(?<=[.!?;])\s+/).filter((seg) => seg.trim()).pop() || "").replace(/\s+/g, " ").trim();
    // 硬归属：标记前最近的 "Card N"（scene 按「Card N, titled ...」分句写的宿主措辞）——
    // 比 about 词面匹配可靠得多，assemble 优先用它。titled 后面的卡标题也抓出来做角色分类。
    const cardHint = [...raw.slice(0, offset).matchAll(/\bcard\s+(\d+)(?:\s*,\s*titled\s+([^.;|\n]{0,80}))?/gi)].pop();
    const card = cardHint ? parseInt(cardHint[1], 10) : null;
    const cardTitle = cardHint?.[2] ? cardHint[2].trim() : "";
    // 角色分类：卡标题 + 归属句一起看。两种词面都在时按 operation 算（错配风险更高的一侧）。
    const roleCtx = cardTitle + " " + about;
    const role = OPERATION_RE.test(roleCtx) ? "operation" : RESULT_RE.test(about) ? "result" : null;
    slots.push({ kind: kind === "asset" ? "asset" : "icon", name: String(name).trim(), value: String(value).trim(), source, crop, about, card, role });
    return kind === "asset" ? ASSET_PLACEHOLDER : ICON_PLACEHOLDER;
  });
  return { slots, modelScene };
}

// —— 品红连通域检测：返回按「行带优先（上→下）、行带内左→右」排序的 bbox 列表 ——
function findMagentaRegions(raw, width, height, channels) {
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < mask.length; i++, p += channels) {
    const r = raw[p], g = raw[p + 1], b = raw[p + 2];
    if (r > 185 && b > 185 && g < 120) mask[i] = 1;
  }
  const seen = new Uint8Array(width * height);
  const regions = [];
  const minArea = Math.max(64, Math.floor(width * height * 0.002));
  const stack = new Int32Array(width * height);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let minX = width, maxX = -1, minY = height, maxY = -1, area = 0;
    while (sp > 0) {
      const idx = stack[--sp];
      const x = idx % width, y = (idx / width) | 0;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[idx - 1] && !seen[idx - 1]) { seen[idx - 1] = 1; stack[sp++] = idx - 1; }
      if (x < width - 1 && mask[idx + 1] && !seen[idx + 1]) { seen[idx + 1] = 1; stack[sp++] = idx + 1; }
      if (y > 0 && mask[idx - width] && !seen[idx - width]) { seen[idx - width] = 1; stack[sp++] = idx - width; }
      if (y < height - 1 && mask[idx + width] && !seen[idx + width]) { seen[idx + width] = 1; stack[sp++] = idx + width; }
    }
    if (area >= minArea) regions.push({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1, area });
  }
  // 排序：行带 = top 按卡高 1/3 分带（同一行带的槽位才按左右排）
  const band = (r) => Math.min(2, Math.floor((r.top + r.height / 2) / (height / 3)));
  regions.sort((a, b) => band(a) - band(b) || a.left - b.left);
  return regions;
}

// 🔴 排版收敛（2026-10-14，学 AutoFigure-Edit「逻辑布局与美学渲染解耦」ICLR 2026）：
// 模型画的品红块高低宽窄不齐，原样贴进去整张图就歪。同一行带内（中心 y 聚类）把
// top/height/width 收敛到行内中位数、水平居中——对齐由插件确定性保证，不赌模型手稳。
// 收敛幅度限制在原始几何的 ±30% 内：超限说明模型画的是有意的大小差异（如大主图+小inset），不硬拉。
function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function alignRegions(regions) {
  if (regions.length < 2) return regions;
  // 行带聚类：中心 y 差 < 两区域平均高 × 0.6 视为同行（从上到下扫）
  const rows = [];
  for (const r of [...regions].sort((a, b) => a.top + a.height / 2 - (b.top + b.height / 2))) {
    const cy = r.top + r.height / 2;
    const row = rows.find((b) => Math.abs(b.cy - cy) < ((r.height + b.h) / 2) * 0.6);
    if (row) { row.items.push(r); row.cy = row.items.reduce((s, x) => s + x.top + x.height / 2, 0) / row.items.length; }
    else rows.push({ cy, h: r.height, items: [r] });
  }
  for (const row of rows) {
    if (row.items.length < 2) continue;
    const mTop = median(row.items.map((r) => r.top));
    const mH = median(row.items.map((r) => r.height));
    const mW = median(row.items.map((r) => r.width));
    const clamp = (want, orig, key) => Math.max(Math.round(orig[key] * 0.7), Math.min(Math.round(want), Math.round(orig[key] * 1.3)));
    for (const r of row.items) {
      const cx = r.left + r.width / 2;
      r.top = Math.round(mTop); // top 直接取中位数（同一行卡的标题区等高，基线偏差本来就该归零）
      r.height = clamp(mH, r, "height");
      r.width = clamp(mW, r, "width");
      r.left = Math.round(cx - r.width / 2); // 水平居中不漂移
    }
  }
  return regions;
}

// 合成：把 slots[].value 指向的真图 cover-fit 贴进渲染图里的品红槽位。
// 返回报告 { placed: [{name, path, source, ...}], missing: [原因] }；失败抛错。
export async function composeSlots(pngPath, slots, outPath, { iconPaths = {} } = {}) {
  const sharp = (await import("sharp")).default;
  const img = sharp(pngPath);
  const meta = await img.metadata();
  const width = meta.width, height = meta.height;
  // 🔴 flatten 固定 3 通道（实测 ensureAlpha().removeAlpha() 仍输出 4 通道，步长错位=全图扫不出）；
  // 步长再按实际 buffer 长度校验一次，防 sharp 版本行为差异
  const raw = await sharp(pngPath).flatten({ background: "#ffffff" }).raw().toBuffer();
  const ch = Math.round(raw.length / (width * height));
  if (ch < 3) throw new Error(`渲染图像素通道数异常（${ch}）——compose 只支持 RGB/A 图`);
  const detected = findMagentaRegions(raw, width, height, ch);
  // 🔴 行带对齐收敛后再匹配槽位（top/height/width 向行内中位数收敛，见 alignRegions 注释）；
  // alignRegions 原地改对象，统计收敛数要先拍快照
  const before = detected.map((r) => ({ ...r }));
  const regions = alignRegions(detected);
  const report = { placed: [], missing: [], aligned: before.filter((b, i) => b.top !== regions[i].top || b.height !== regions[i].height || b.width !== regions[i].width).length };
  if (regions.length < slots.length) {
    report.missing.push(`品红槽位检出 ${regions.length} 个、scene 声明 ${slots.length} 个——图模型漏画或画成了别的颜色。重渲或减少槽位；确认渲染图里确有纯品红色块（#FF00FF）。`);
  }
  const use = Math.min(regions.length, slots.length);
  const composites = [];
  for (let i = 0; i < use; i++) {
    const slot = slots[i], region = regions[i];
    // 🔴 来源护栏：asset 槽位 = 原图/复现图直贴；标 drawn = AI 重画冒充原图（造假数据），拒贴
    if (slot.kind === "asset" && slot.source === "drawn") {
      report.missing.push(`槽位 "${slot.name}" 标记了 |drawn——asset 槽位只收原图（original）或源码复现图（repro），AI 重画的原样例图等于造假数据。要画的东西改用 {{icon:名|描述}} 槽位。`);
      continue;
    }
    let src = slot.value;
    if (slot.kind === "icon") {
      // 🔴 分部分出图（2026-10-14 用户定规「一张图要多图层多部分区分开」）：icon 槽位的
      // value 是描述不是路径——贴图素材来自 render-icon 单独渲的小图（伴随 JSON icons 段登记）。
      // 没渲过就报可行动错误，而不是拿描述文本当路径瞎试。
      const iconFile = iconPaths[slot.name];
      if (!iconFile || !fs.existsSync(iconFile)) {
        report.missing.push(`icon 槽位 "${slot.name}" 还没渲小图——先跑 pf render-icon --prompt-file <本提示词> --name ${slot.name}（或 --all 一次渲完），再重跑 compose。`);
        continue;
      }
      src = iconFile;
    } else {
      if (!path.isAbsolute(src)) src = path.resolve(src);
      if (!fs.existsSync(src)) {
        report.missing.push(`槽位 "${slot.name}" 的源文件不存在：${src}`);
        continue;
      }
      // 🔴 PDF 源自动光栅化（真链路实测：LaTeX 论文图都是 PDF，宿主 AI 照 brief 原样引用）
      if (/\.pdf$/i.test(src)) {
        try {
          src = convertPdfToPng(src);
        } catch (e) {
          report.missing.push(`槽位 "${slot.name}"：${e.message}`);
          continue;
        }
      }
    }
    // 🔴 asset 槽位用 contain（不裁内容——真实例图裁掉 = 造假数据）；icon 槽位用 cover（图标允许裁边填满）
    // 唯一例外：slot.crop 显式声明的模块裁剪（宿主 AI 看图定的真实像素坐标）——extract 先裁再 fit
    const fit = slot.kind === "asset" ? { fit: "contain", background: "#ffffff" } : { fit: "cover" };
    let piped = sharp(src);
    if (slot.crop) {
      // 边界 clamp（目测坐标越界=extract_area 硬炸，收到图内并提示）
      const meta2 = await sharp(src).metadata();
      const L = Math.max(0, Math.min(slot.crop.left, meta2.width - 1));
      const T = Math.max(0, Math.min(slot.crop.top, meta2.height - 1));
      const W = Math.max(1, Math.min(slot.crop.width, meta2.width - L));
      const H = Math.max(1, Math.min(slot.crop.height, meta2.height - T));
      if (L !== slot.crop.left || T !== slot.crop.top || W !== slot.crop.width || H !== slot.crop.height) {
        report.missing.push(`槽位 "${slot.name}" 的 crop (${slot.crop.left},${slot.crop.top},${slot.crop.width},${slot.crop.height}) 超出源图 ${meta2.width}×${meta2.height}，已按 (${L},${T},${W},${H}) clamp——坐标请按真实像素重定（Read 原图）。`);
      }
      piped = piped.extract({ left: L, top: T, width: W, height: H });
    }
    const buf = await piped.resize(region.width, region.height, fit).png().toBuffer();
    composites.push({ input: buf, left: region.left, top: region.top });
    report.placed.push({ name: slot.name, path: src, source: slot.source, crop: slot.crop || undefined, ...(({ left, top, width, height }) => ({ left, top, width, height }))(region) });
  }
  if (composites.length) {
    await sharp(pngPath).composite(composites).png().toFile(outPath);
  } else if (outPath !== pngPath) {
    fs.copyFileSync(pngPath, outPath);
  }
  return report;
}

// assemble 用：crop 槽位预裁剪，产出缓存 PNG 路径（模板装配的量高比/内嵌都吃这个文件）。
// 缓存键 = 源路径 + mtime + crop 几何，源图一变自动失效。
export async function prepareAssetImage(src, crop) {
  const sharp = (await import("sharp")).default;
  if (!path.isAbsolute(src)) src = path.resolve(src);
  if (/\.pdf$/i.test(src)) src = convertPdfToPng(src);
  // 边界 clamp：目测坐标难免越界（实测 2570+850=3420 > 3410 直接 extract_area 炸），收到图内
  const meta = await sharp(src).metadata();
  const L = Math.max(0, Math.min(crop.left, meta.width - 1));
  const T = Math.max(0, Math.min(crop.top, meta.height - 1));
  const W = Math.max(1, Math.min(crop.width, meta.width - L));
  const H = Math.max(1, Math.min(crop.height, meta.height - T));
  const cacheDir = path.join(path.dirname(src), ".pf-crop-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const key = path.basename(src).replace(/\.\w+$/, "") + "_" + Math.round(fs.statSync(src).mtimeMs) + "_c" + L + "_" + T + "_" + W + "_" + H + ".png";
  const out = path.join(cacheDir, key);
  if (!fs.existsSync(out)) {
    await sharp(src).extract({ left: L, top: T, width: W, height: H }).png().toFile(out);
  }
  return out;
}
