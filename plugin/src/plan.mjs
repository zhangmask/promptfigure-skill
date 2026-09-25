// plan.mjs — 🔴 小白对齐器（2026-09-22 用户反馈"数模小白在 Codex/Z Code 里用不出好效果"）：
// 前几轮把"门"焊死了（质量门/溯源/QA/审批），但小白用户的另一半问题在"门"之前——
// 用户自己说不清要什么图，弱 AI 不问就闷头编：编实体（被溯源拒绝）或编完直接 render（钱白烧）。
// plan 做一件事：把插件当前状态翻译成【发给用户的大白话问题卡】+【AI 拿到答复后的执行步骤】，
// 问题卡里的选项全部来自真实文档（章节编号、候选图型），小白回个数字就能推进。
// 纯函数：CLI 与测试共用。
import { computeNext } from "./next.mjs";

// 图型中文名（给小白看的人话，CLI 与 distill 确认卡共用）
export function figureTypeBrief(ft = "") {
  const M = {
    pipeline: "流程图", flowchart: "判断流程图", architecture: "结构/架构图", mechanism: "机理/因果图",
    comparison: "对比图", dataflow: "数据流图", hierarchy: "层级/组成图", timeline: "时间线",
    teaser: "核心一图流", zoomin: "局部放大图", scene: "场景示意图", "result-style": "结果风格图",
    "multi-panel": "多面板组合图",
  };
  return M[String(ft || "").trim()] || "示意图";
}

// goal 关键词 → 图型建议（确定性路由，弱 AI 不用自己猜"画什么图"）
export function suggestFigureType(goal = "") {
  const g = String(goal || "").toLowerCase();
  if (/数据|结果|准确率|精度|提升|误差|灵敏度|收敛|对比实验|numerical|result/.test(g)) return { type: "result-style", note: "data" };
  if (/机理|因果|促进|抑制|影响|作用|为什么|mechanism/.test(g)) return { type: "mechanism" };
  if (/对比|比较|优缺点|before|after|改进|vs/.test(g)) return { type: "comparison" };
  if (/组合|多面板|panel|分图|消融/.test(g)) return { type: "multi-panel" };
  if (/组成|包含|分类|层级|体系|hierarchy/.test(g)) return { type: "hierarchy" };
  if (/发展|历史|时间|演进|timeline/.test(g)) return { type: "timeline" };
  if (/结构|架构|组成模块|architecture|framework/.test(g)) return { type: "architecture" };
  if (/流程|步骤|pipeline|过程|算法流程/.test(g)) return { type: "pipeline" };
  if (/核心|摘要|一图|teaser|概述/.test(g)) return { type: "teaser" };
  return null;
}

// 真实章节选项（heading 块 → 编号清单；小白回数字，AI 按编号映射回 §路径）
export function sectionOptions(blocks = [], { limit = 10 } = {}) {
  const heads = blocks.filter((b) => b.type === "heading" && String(b.secPath || "") !== "0");
  return heads.slice(0, limit).map((b, i) => ({ n: i + 1, at: `§${b.secPath}`, title: String(b.text || "").slice(0, 30) }));
}

export function buildPlan({ docId = null, meta = null, cfg = {}, goal = "" } = {}, io = {}) {
  const userLines = [];
  const steps = [];

  // ---- 0) 没配 key ----
  if (!cfg.key) {
    userLines.push("开始出图前需要配置一次 promptFigure 的 API key（控制台 promptfigure.top 注册后创建，pf_ 开头）。");
    userLines.push("把 key 发给我，或者自己去控制台建好告诉我一声。");
    steps.push({ cmd: "pf login <pf_ 开头的 key>", why: "配置 key——之后所有出图计费都走它" });
    steps.push({ cmd: "pf plan", why: "配好后重新跑计划，进入下一步" });
    return { stage: "login", userLines, steps };
  }

  // ---- 1) 没打开文档 ----
  if (!docId || !meta) {
    userLines.push("请把论文文件发给我（支持 Word .docx / PDF / LaTeX .tex）。");
    userLines.push("如果你手上是 .doc/.wps 老格式，先在 Word/WPS 里另存为 .docx。");
    steps.push({ cmd: "pf open <论文文件路径>", why: "打开论文并打印 docId，之后的操作都自动作用于它" });
    steps.push({ cmd: "pf plan", why: "打开后重新跑计划：我会列出真实章节让你挑配图位置" });
    return { stage: "open", userLines, steps };
  }

  const blocks = meta.blocks || [];
  const figures = Object.values(meta.figures || {});

  // ---- 2) 已有图：报进度 + 路由下一步 ----
  if (figures.length > 0) {
    const r = computeNext({ docId, meta, cfg }, io);
    const doneN = figures.filter((f) => {
      const st = ((io.readReview?.(docId) || {})[f.figureId] || {}).status;
      return st === "approved" && f.versions?.at(-1)?.model === "premium";
    }).length;
    userLines.push(`你的论文我正在配图：目前共 ${figures.length} 张，定稿 ${doneN} 张。`);
    if (goal) {
      const s = suggestFigureType(goal);
      userLines.push(`你说的"${goal}"我记下了，会按${s ? figureTypeBrief(s.type) : "示意图"}来处理。`);
    }
    userLines.push("接下来这一步不需要你操作，我处理完会把图给你看。");
    steps.push({ cmd: r.cmd, why: r.why });
    steps.push({ cmd: "pf plan", why: "每做完一步重新跑计划，进度和下一步会跟着更新" });
    return { stage: r.stage, userLines, steps };
  }

  // ---- 3) 还没图：真实章节选项 + 需求三问 ----
  // 🔴 判断层归 AI（2026-09-22 去写死）：下面的问题卡与图型建议只是底稿——
  // 关键词路由覆盖不到的语言/说法，AI 必须自己用 pf types 的选型决策来判断图型；
  // 问题卡要用用户的语言转述（多语言用户的用户卡不是中文）。
  const opts = sectionOptions(blocks);
  const s = suggestFigureType(goal);
  userLines.push("[向用户转述时用用户的语言，下面只是底稿]");
  userLines.push("给论文配图前，先确认三件事（直接回复，不用专业术语）：");
  userLines.push("① 图配在哪个部分？回复编号即可（0=说不清/整篇都行，我读全文后挑最值得画的部分给你确认）：" + (opts.length
    ? opts.map((o) => `${o.n}=${o.title}`).join("；") + "。"
    : "（没读到章节标题——把大概位置告诉我，比如\"第三章那一段\"）"));
  userLines.push("② 这张图最想让读者记住什么？一句话就行。");
  userLines.push("③ 图里必须出现的名字/术语有哪些？说不清就跳过，我会从原文里提取给你确认。");
  if (s) {
    userLines.push(`（插件按关键词猜了「${figureTypeBrief(s.type)}」——只是参考，你读原文后用 pf types 的选型决策自己定图型，猜测可以推翻）`);
  }
  if (s?.note === "data") {
    userLines.push("⚠️ 你要的是数据结果图：精确数值的柱/线/热图我不会用 AI 重画（数字必错），我会先看你的绘图脚本，引导改样式；纯示意图才走 AI 出图。");
  }
  // 价格口径唯一来源（2026-09-22 子智能体实测：AI 自己报价报错——草稿说成 0.15）：
  // 问题卡直接带上真实价格，AI 照抄即可
  userLines.push("费用参考：草稿约 $0.02/张（可反复调），定稿约 $0.15/张（确认满意后才出）；先出草稿给你看。");
  steps.push({ cmd: `pf distill --at "<用户选中的章节 §路径>"`, why: "从原文抽候选实体/阶段句/数据句（任何语言都支持），产出用户确认卡；候选是统计性的，逐个核对原文出处；用户回 0 = 你用 pf doc outline + pf doc data 自己挑最值得画的章节，挑完仍要走确认卡" });
  steps.push({ cmd: "（把确认卡发给用户，等确认）", why: "渲染要花钱，先让用户确认要素和顺序" });
  steps.push({ cmd: `pf craft --at "<章节>" --figure-type <你定的图型，pf types 查选型> … --out <名字>.txt`, why: "按确认过的素材拼合规提示词；质量门会挡空泛输入" });
  steps.push({ cmd: `pf render --at "<章节>" --model standard --prompt-file <名字>.txt`, why: "standard 草稿先出图（~$0.02），premium 定稿要等审批通过" });
  steps.push({ cmd: "pf plan", why: "图出来后计划会路由到核验（pf qa）环节" });
  return { stage: "interview", userLines, steps };
}
