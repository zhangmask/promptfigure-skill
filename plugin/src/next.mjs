// next.mjs — 🔴 状态路由器（2026-09-21 用户反馈"别人的 AI 根本不会用"）：
// 冷启动 AI 面对几十条命令不知道下一步。本模块只做一件事：
//   读项目当前状态 → 输出**唯一**一条可直接复制执行的下一步命令 + 为什么。
// 所有歧义在这里消解：AI 不需要理解工作流，只要反复 `pf next` → 执行 → 再 `pf next`。
//
// 设计原则：
//   - 命令必须是完整可执行的（占位符用 <尖括号> 明确标出要 AI 自己填的内容）
//   - 优先级：精修 > 待审批 > 驳回 > 定稿缺失 > 新图 > 读文选位
//   - 纯函数：CLI 与 cold-start-sim 共用同一份判断，插件改状态这里必须跟着改

import fs from "node:fs";

// 审批状态取本地图（daemon 挂了导航也不能挂）
function reviewMap(docId, readReview) {
  try { return readReview(docId) || {}; } catch { return {}; }
}

// 🔴 活跃修正 vs 最新 sidecar 对账（2026-09-21 子智能体实测发现的死路出口）：
// AI 按 refine 重拼命令跑过 craft --fixes 后，若在等授权/沙盒（没有真渲染推进状态），
// pf next 必须认出"修正已全部进入最新提示词"，指去 render 而不是永远卡在 refine。
function sidecarCoversFixes(fig, fixes = []) {
  try {
    const scPath = fig?.versions?.at(-1)?.sidecar;
    if (!scPath || !fs.existsSync(scPath)) return false;
    const sc = JSON.parse(fs.readFileSync(scPath, "utf8"));
    const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const scSet = String(sc.fixes || "").split(/[;；]/).map(norm).filter(Boolean);
    if (!scSet.length) return false;
    return (fixes || []).every((f) => {
      const n = norm(f);
      return scSet.includes(n) || scSet.some((s) => s && (s.includes(n) || n.includes(s)));
    });
  } catch { return false; }
}

// 单图阶段判定（2026-09-21 多图路由重构）：返回 {stage,cmd,why} 或 null（已定稿）。
// 顺序：精修 > ready（对账出口）> 待核验 > 驳回 > 定稿缺失。
export function figureNext(fig, rev = {}) {
  const fid = fig.figureId;
  const st = (rev[fid] || {}).status || "pending";

  if ((fig.activeFixes || []).length > 0) {
    if (sidecarCoversFixes(fig, fig.activeFixes)) {
      return {
        stage: "ready",
        cmd: `pf render --at "${fig.at || "<原文位置>"}" --model standard --prompt-file <刚 craft --out 的文件名>.txt`,
        why: `修正已全部写进最新提示词（对账 ${fig.activeFixes.length} 条 ✓）——直接渲染；真实渲染后新版本会自动清核验记录并重置审批（沙盒/排练用 --dry-run，但闭环要真图才能走完）`,
      };
    }
    return {
      stage: "refine",
      cmd: `pf refine ${fid}`,
      why: `图 ${fid} 有 ${fig.activeFixes.length} 条未消化修正——refine 会列出它们并自动重拼下一轮 craft 命令`,
    };
  }
  if (st === "pending") {
    return {
      stage: "review",
      cmd: `pf qa ${fid}`,
      why: `图 ${fid} 等待核验——pf qa 输出任务包（体检数字+实体清单+核验清单），亲眼读图逐条核验后写回：pf qa ${fid} --pass --note "依据"（通过并写回审批）或 pf qa ${fid} --fail --note "缺陷1; 缺陷2"（驳回+缺陷自动进精修状态机）`,
    };
  }
  if (st === "rejected") {
    return {
      stage: "fix",
      cmd: `pf inspect ${fid} && pf qa-list ${fid}`,
      why: `图 ${fid} 被驳回——先看自动体检数字（留白/白度/彩色占比），再用你的看图能力过核验清单；发现的缺陷用 pf refine ${fid} --fix "缺陷" 记入状态机`,
    };
  }
  const last = fig.versions?.at(-1);
  if (st === "approved" && last && last.model !== "premium") {
    return {
      stage: "finalize",
      cmd: `pf prompt ${fid} --out <名字>.txt`,
      why: `图 ${fid} 已通过还是草稿——pf prompt 把定稿提示词导出成文件，然后 pf render --at "<原文位置>" --model premium --prompt-file <名字>.txt 出定稿`,
    };
  }
  return null; // approved + premium = 完工
}

export function computeNext({ docId = null, meta = null, cfg = {} } = {}, io = {}) {
  const readReview = io.readReview;
  const rev = docId && readReview ? reviewMap(docId, readReview) : {};

  // ---- 0) 没配 key：一切免谈 ----
  if (!cfg.key) {
    return { stage: "login", cmd: "pf login", why: "还没配置 API key——先去控制台创建 pf_ 开头的 key，再跑 pf login <key>" };
  }
  // ---- 1) 没打开文档 ----
  if (!docId || !meta) {
    return { stage: "open", cmd: "pf open <论文路径.docx|.tex|.pdf>", why: "还没打开论文。open 会打印 docId 并自动打开预览窗口，之后的命令都要用到 docId" };
  }

  const figures = Object.values(meta.figures || {});
  // 🔴 多图路由（2026-09-21 子智能体 E 实测：批量配图时 next 只盯"最新一张"，其他图做完
  // craft/dry-run 它毫无感知）。改为按创建序轮询：第一张没完工的图就是下一步。
  const ordered = figures.slice().sort((a, b) => (a.versions?.[0]?.at || "").localeCompare(b.versions?.[0]?.at || ""));

  for (const fig of ordered) {
    const r = figureNext(fig, rev);
    if (r) return r;
  }
  if (ordered.length > 0) {
    return {
      stage: "done",
      cmd: `pf doc figures`,
      why: `全部 ${ordered.length} 张图已定稿 ✅——对照论文原图清单挑下一张要重画的；全部完成则收工`,
    };
  }

  // ---- 3) 没图：读文 → 选位 → craft ----
  const anchors = io.readAnchors ? (io.readAnchors(docId) || []) : [];
  if (anchors.length === 0) {
    return {
      stage: "context",
      cmd: `pf doc outline ${docId}  →  pf distill --at "<章节 段号>"`,
      why: "还没选定配图位置——先 outline 看章节树（找特定内容用 pf doc search <关键词>；找数值用 pf doc data），再 distill 从原文抽实体/阶段素材（禁止跳过读原文直接编内容）",
    };
  }
  return {
    stage: "craft",
    cmd: `pf craft --at "<章节 段号>" --intent "<图意，来自刚才读的原文>" --entities "<实体逗号分隔>" --stages "<标题 | show 画法 || …>" --figure-type <类型> --out <名字>.txt`,
    why: "位置已定——craft 必带 --at（实体溯源会拿回原文对账，缺了直接拒绝）；质量分 <60 也会被拒绝；--out 会写伴随 JSON，render 自动继承画布比",
  };
}
