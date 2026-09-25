// vectorize.mjs — 🔴 SVG 矢量导出（2026-09-22 用户拍板：导出矢量必须做，方案用用户早期点名的
// GitHub 高星项目 visioncortex/vtracer——本机 vectorize-probe 已跑过全量对比，结论见
// skill pf-vectorize-eval：16 色量化 + polygon/cutout + optimize 是体积×保真甜点）。
//
// 设计约束：
//   - 可选增强：vtracer 是 optional 依赖（没装不崩，给出跨平台安装指路）——用户环境千奇百怪，
//     核心链路不能被一个增强依赖卡死
//   - 转出来的是**描摹路径**：文字全部变路径，不可编辑不可搜索——输出必须带这条红线说明
//     （skill 红线："否则是投诉源"）
//   - 不依赖 sharp：出图管线产物本来就是 PNG，vtracer 1.0 自带 PNG 解码
//     （probe 里转 webp 才需要 sharp 预解码）
//
// 两档质量（probe 实测，1280×720 AI 生成图基线）：
//   draft: polygon/cutout，29-31KB，PSNR 22.1-22.7dB，明显偏色 5.5-6.1%（交付甜点）
//   high : spline，~185KB，PSNR 22.8dB（渐变/细线更多时用；大 6 倍换 0.6dB，默认不给）

const BASE_CFG = {
  clustering: "color-cluster",
  hierarchical: "cutout",
  filterSpeckle: 8,
  maxColors: 16,      // vtracer 内置自动量化，不用外接 image-q
  optimize: 2,        // 量化+简化+shorthand+分组，平均再省 ~47.5%
  pathPrecision: 3,
};

const QUALITY_CFG = {
  draft: { ...BASE_CFG, mode: "polygon", layerDifference: 24 },
  high: { ...BASE_CFG, mode: "spline", layerDifference: 16 },
};

// 返回 { svg, paths } 或 { error: "not-installed" }。不 throw：调用方决定怎么报。
export async function pngToSvg(pngBuf, { quality = "draft" } = {}) {
  let vt;
  try {
    vt = await import("@visioncortex/vtracer");
  } catch {
    return { error: "not-installed" };
  }
  const cfg = QUALITY_CFG[quality] || QUALITY_CFG.draft;
  // convertBuffer 是同步的（probe 实测）；退化输入（1x1 之类）会让 WASM 崩出 undefined ——
  // 渗透实测后包一层，把崩溃转成可读错误而不是半截异常
  try {
    const svg = vt.convertBuffer(Buffer.from(pngBuf), cfg);
    const s = String(svg);
    return { svg: s, paths: (s.match(/<path/g) || []).length, bytes: Buffer.byteLength(s, "utf8") };
  } catch (e) {
    return { error: "convert-failed", detail: String(e?.message || e || "unknown") };
  }
}

// 安装指路：在插件所在目录跑（全局装了也行，import 走 node 解析链）
export const INSTALL_HINT =
  'npm i @visioncortex/vtracer@1.0.0-alpha.4（在本插件目录或你的项目目录执行；' +
  '纯 WASM 无原生编译，MIT/Apache-2.0 双许可可商用）';
