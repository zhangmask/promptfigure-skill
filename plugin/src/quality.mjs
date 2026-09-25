// quality.mjs — 🔴 craft 输入质量门（2026-09-21 用户反馈"别人的 AI 用着质量就不行"）：
// 上一轮修了"冷启动会用"，这轮修"用得好"。弱 AI 随手编实体、名词堆要点、漏实体——
// 规则层原来的 ⚠️ 走 stderr，弱模型根本无视。质量分 + blocker 拒绝让劣质输入**出不了提示词文件**。
//
// 原则（全部来自实测事故，编号可溯源；2026-09-23 用户拍板"标准太低"整体收紧；
//       2026-09-23 松绑轮：分层放行——收紧后新手 AI 被连环拒到用不了，改两档）：
//   🔴 结构性必废/编造类 = 永远 blocker（两档都拦）：
//      intent 空/纯图型名、实体空、空阶段、0 阶段主链图、对照格式残缺、全部实体对不上原文
//   🟡 质量降级类 = 宽松档(缺省)只警告不拦，--strict / PF_STRICT=1 恢复硬拦：
//      intent<6 词、实体 1-2 个、万能占位实体、阶段 1-2 个、孤标签阶段、零 show 句、
//      要点整句、实体覆盖率不足
//   理由：降级类出的是"不够好的图"，用户在 QA 层看得见、能返工；硬拦则新手 AI
//   连续 exit!=0 直接放弃（"别人用不了"实测反馈）。质量追求者开 strict。
// 纯函数：CLI 与测试共用；打分在 CLI 层调用，不动 craftPrompt 库函数。

import { parseStages } from "./craft.mjs";

const WORDS = (s) => {
  const t = String(s || "").trim();
  if (!t) return 0;
  // 🔴 多语言感知（2026-09-22 第二轮）：原版只数拉丁词 + 汉字/2 —— 韩语/俄语/西语等
  // 带空格文字全被算 0 词，intent 被 <6 门槛误拦。改为：按空白 token 数，
  // 其中汉字/假名密集 token 按 ceil(字数/2) 折算（无空格文字），其余 token 算 1 词。
  let w = 0;
  for (const tok of t.split(/\s+/).filter(Boolean)) {
    const cjkish = (tok.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
    if (cjkish > 0) w += Math.ceil(cjkish / 2);
    else if (/\p{L}|\p{N}/u.test(tok)) w += 1;
  }
  return w;
};

// ---------- splitEntityPair：实体双语对照（2026-09-22 用户拍板补差距②） ----------
// 实测痛点：中文用户把实体译成英文喂 craft（standard 乱码率低），但译完溯源就断——
// checkEntitySource 只能对"脚本一致"的实体对账，译文侧全部落 skipped（fail open）。
// 解法：实体支持「英文标签|原文词」对照格式（如 "Weighted Box Fusion|加权框融合"）——
//   - 溯源对账查 **原文侧**（确定性，不再是 skipped）
//   - 卡面/提示词用 **英文侧**（standard 不乱码）
// 实现放叶子模块 entity-pair.mjs（craft.mjs 也要用，放这里会成环），这里 re-export。
export { splitEntityPair } from "./entity-pair.mjs";
import { splitEntityPair } from "./entity-pair.mjs";

export function scoreCraft({ intent = "", entities = [], stages = "", figureType = "", hasAt = true, strict = false } = {}) {
  const blockers = [];
  const codes = [];        // 🔴 机器可读的拒绝原因码（硬拦的）
  const softCodes = [];    // 松绑轮：降级为警告的原因码（宽松档）
  const notes = [];
  const block = (code, msg) => { codes.push(code); blockers.push(msg); };
  // 🟡 质量降级类：宽松档（缺省）进 notes 不拦；strict 档硬拦。softCode 仍记录供测试/诊断。
  const soft = (code, msg) => {
    if (strict) { codes.push(code); blockers.push(msg); }
    else { softCodes.push(code); notes.push(msg); }
  };

  // ---- 原文锚点（2026-09-21 "不读文章"后门封堵）----
  // 不带 --at 时实体溯源整段被跳过 = "没读原文也能出图"的后门。CLI 传 hasAt: !!--at。
  if (!hasAt) {
    block(
      "no-at",
      '缺 --at 原文锚点——实体溯源无法进行（不读原文出图 = 编造，V4-V8 事故根源）。' +
      '先 pf doc outline 看章节树（或 pf doc search "<关键词>" / pf doc data 找结果数据），再 pf distill --at "<章节 段号>" 抽素材。'
    );
  }

  // ---- intent ----
  if (!String(intent).trim()) {
    block("intent-empty", "intent 为空——图意说不清，模型必编造。用一句话写清：这张图要让读者记住什么。");
  } else {
    if (WORDS(intent) < 6) {
      soft("intent-short", `intent 只有 ${WORDS(intent)} 个词（<6）——写清"什么方法/什么流程/给读者什么结论"，别只丢一个名词短语。`);
    }
    // 🔴 2026-09-23 收紧：intent 只是一串图型名词（"方法框架图"/"pipeline diagram"）= 没说图意，
    // 模型只能靠编。剥掉图型词后剩不到 2 个实义词就拦。
    const stripped = String(intent)
      // 拉丁图型词/万能词：按词边界剥（pipeline 在 "TTA pipeline" 里也会被剥——剩余词够就不拦）
      .replace(/\b(flow ?chart|diagram|schematic|framework diagram|architecture diagram|pipeline diagram|overview|figure|fig\.?|chart|plot|graph|illustration|pipeline|framework|architecture|workflow|method|approach|scheme)\b/gi, " ")
      // 中文图型词/万能词：直接子串剥
      .replace(/(流程图|框架图|架构图|结构图|示意图|原理图|机制图|模型图|流程图示|数据流图|对比图|结果图|总览图|概念图|时序图|思维导图|工作流|网络结构|流程|框架|架构|示意|图示|结构|方法)/g, " ");
    if (WORDS(stripped) < 2) {
      block("intent-generic", `intent「${intent}」只是图型名/名词堆砌——没说这张图具体要表达什么，模型必编造。写清：什么方法、什么流程、给读者什么结论。`);
    } else if (WORDS(stripped) < 4) {
      notes.push(`intent 里图型词/泛词占比过高（剥掉后剩 "${stripped.trim().replace(/\s+/g, " ")}"）——再补一句"这张图要让读者记住什么"，模型才知道怎么画。`);
    }
  }

  // ---- 实体清单检查（含残缺对照 / 重复充数 / 万能占位词）----
  const rawEnts = (Array.isArray(entities) ? entities : String(entities).split(","))
    .map((s) => s.trim()).filter(Boolean);
  // 🔴 2026-09-23 收紧：重复实体按同一实体计数（"A,A,A" 冒充 3 个实体的绕门封掉），重复本身记 note
  const entKey = (e) => { const p = splitEntityPair(e); return (p.src || p.label).toLowerCase().replace(/\s+/g, " "); };
  const seenKeys = new Map();
  const ents = [];
  for (const e of rawEnts) {
    const k = entKey(e);
    if (seenKeys.has(k)) continue;
    seenKeys.set(k, e);
    ents.push(e);
  }
  const dupCount = rawEnts.length - ents.length;
  if (dupCount > 0) notes.push(`实体清单有 ${dupCount} 个重复项（已按去重后 ${ents.length} 个计）——同一个名词写两遍不会让图更完整。`);
  if (ents.length === 0) {
    block("entities-empty", "entities 为空——图上无命名实体，将大量依赖占位符（Gene 1 / Step 1）。回原文逐个核对名词模块。");
  } else if (ents.length < 3) {
    soft("entities-few", `实体只有 ${ents.length} 个（<3）——回原文逐个核对名词模块再定稿；分组结构（多数据集/类别/基线）整组丢失是最常见漏法。`);
  }
  // 🔴 2026-09-23 收紧：万能占位实体（弱 AI 拿"Model/Data/Result"凑数）——这种词画进图里就是占位符图
  const GENERIC_ENTS = new Set([
    "model", "method", "approach", "framework", "result", "results", "data", "experiment", "experiments",
    "analysis", "system", "input", "output", "module", "figure", "fig 1", "figure 1", "step 1", "step 2",
    "模型", "方法", "结果", "数据", "实验", "系统", "分析", "输入", "输出", "模块", "图1", "图 1", "步骤1", "步骤 1",
  ]);
  const genericEnts = ents.filter((e) => GENERIC_ENTS.has(splitEntityPair(e).label.toLowerCase().trim()) || GENERIC_ENTS.has(splitEntityPair(e).src || ""));
  if (genericEnts.length === ents.length && ents.length > 0) {
    // 全部实体都是万能占位词 = 明显没读原文，两档都拦
    block("entity-generic", `这些实体是万能占位词（${genericEnts.join("、")}）——"Model/Data/Result"这类词哪个论文都能用，说明没回原文抽真名词。用 pf distill 输出里的真实名词模块替换（如 "Weighted Box Fusion|加权框融合"）。若论文里的模块真就叫这个名（极少数），加 --force 放行，理由落审计。`);
  } else if (genericEnts.length) {
    // 混用（部分真词 + 部分占位词）：宽松档警告（图能出，质量打折），strict 档拦
    soft("entity-generic", `这些实体是万能占位词（${genericEnts.join("、")}）——图能出，但占位词标签会让读者觉得是模板图。建议用 pf distill 的真实名词模块替换。`);
  }
  // 🔴 残缺对照（渗透实测："Label|" 一侧为空 → 英文侧连 "|" 印进卡面、原文侧静默丢）
  const badPairs = ents.filter((e) => e.includes("|") && splitEntityPair(e).invalid);
  if (badPairs.length) {
    block("entity-pair-bad", `这些实体对照格式残缺（${badPairs.join("、")}）——对照格式必须两侧都有：「英文标签|原文词」。一侧写不出来就别用对照（但纯英文实体会无法自动对账）。`);
  }

  // ---- stages ----
  const stageList = parseStages(stages);
  // 🔴 2026-09-23 收紧：flowchart 也是主链图（CLI 缺省图型就是它）——和 pipeline/architecture/
  // dataflow/mechanism 一样要求 ≥3 阶段；原来是 length>0 才查，"一个阶段都不给"反而漏过。
  const chainTypes = new Set(["pipeline", "architecture", "dataflow", "mechanism", "flowchart"]);
  if (chainTypes.has(figureType) && stageList.length === 0) {
    block("stages-none", `${figureType} 类图一个阶段都没给——图模型只能按图型惯例摆空架子，每个区域画什么全靠编。给主链至少 3 步（--stages "标题 | show 画法句 || …"）。`);
  } else if (chainTypes.has(figureType) && stageList.length < 3) {
    soft("stages-few", `${figureType} 类图只有 ${stageList.length} 个阶段（<3）——主链建议至少 3 步（输入→核心变换→输出），碎成两块读者看不懂流程。`);
  }
  const isShowBullet = (b) => /^(show|draw|画|示意|绘制)/i.test(b.trim());
  const empty = stageList.filter((s) => !s.bullets.length);
  if (stageList.length > 0 && empty.length) {
    block("stage-empty", `阶段「${empty.map((s) => s.title).join("、")}」没有内容要点——空标题盒子必出。每阶段给 2-4 条：1-2 条 show 画法 + 0-2 条 ≤5 词短标签。`);
  }
  // 🔴 单条非画法要点 = 孤标签盒子（松绑轮：降级为警告——盒子有内容，只是可能缺细节）
  const thin = stageList.filter((s) => s.bullets.length === 1 && !isShowBullet(s.bullets[0]));
  if (stageList.length > 0 && thin.length) {
    soft("stage-thin", `阶段「${thin.map((s) => s.title).join("、")}」只有 1 条短标签、没有画法句——补一条 show 画法句细节会好很多（模型现在只能按标签猜着画）。`);
  }
  // 全图没有一条 show 画法句 → 模型只能拿到标签自己摆布局（松绑轮：降级为警告——内容还在，布局质量打折）
  if (chainTypes.has(figureType) && stageList.length > 0) {
    const showTotal = stageList.reduce((n, s) => n + s.bullets.filter(isShowBullet).length, 0);
    if (showTotal === 0) {
      soft("no-show", `全部阶段都没有 show 画法句——模型会按标签自己发明布局。每个阶段写 1 条 show 开头的画法句（画什么、摆在哪、怎么连）细节会好很多。`);
    }
  }

  // ---- 要点是完整句（V11 事故；2026-09-22 多语言化；2026-09-23 阈值 14→10 收紧）----
  // 语言无关的两条判据：① 非画法句超 10 词；② 带空格文字（韩/俄/西…）整句通常 <14 词 ——
  // 补"句末标点结尾且 >5 词"判据（标签不该带句号）。韩语"다"结尾无标点的场景交给 Q2 + AI 判断层。
  const sentencey = [];
  for (const s of stageList) {
    for (const b of s.bullets) {
      // show/draw 开头的画法句豁免（那是给模型的画法指令，不是要印的文字）
      if (isShowBullet(b)) continue;
      const longSentence = WORDS(b) > 10;
      const punctuated = /[.。．！？!?…؛۔]$/.test(b.trim()) && WORDS(b) > 5;
      if (longSentence || punctuated) sentencey.push(b);
    }
  }
  if (sentencey.length) {
    soft("bullet-sentence", `这些框内要点是完整句（${sentencey.map((b) => `「${b.slice(0, 40)}…」`).join("；")}）——图模型可能把它们原样印进卡面（V11 事故）。要点改 ≤5 词短标签；说明挪进 show 句。QA 核验 Q2 会再抓一次。`);
  }

  // ---- 实体覆盖率（对照格式按英文侧查 stages——卡面印的是英文标签）----
  if (ents.length > 0 && stageList.length > 0) {
    const hay = stages.toLowerCase();
    // 命中 = 整串子串，或实体的全部词元都出现（容忍词序变化："Noisy Boxes" ≈ "noisy candidate boxes"）
    const covered = (e) => {
      const el = splitEntityPair(e).label.toLowerCase();
      if (hay.includes(el)) return true;
      const toks = el.split(/\s+/).filter((t) => t.length >= 3);
      return toks.length > 0 && toks.every((t) => hay.includes(t));
    };
    const missing = ents.filter((e) => !covered(e));
    // 🔴 红队实测（2026-09-23 fuzz）：10KB 实体整串打印刷屏——统一截断展示
    const show = (list) => list.map((e) => (e.length > 40 ? e.slice(0, 40) + "…" : e)).slice(0, 5).join("、");
    const coverage = 1 - missing.length / ents.length;
    // 松绑轮分层：≥50% 列了却没画的降级为警告（图能出、缺元素 QA 层可见）；<50% = 一半内容没画，两档都拦
    if (coverage < 0.5) {
      block("entity-coverage", `实体覆盖率 ${(coverage * 100) | 0}%（<50%）——这些实体列了却没画进任何阶段：${show(missing)}${missing.length > 5 ? " 等" : ""}。要么在 stages 里给它们位置，要么从清单删掉。`);
    } else if (coverage < 0.8) {
      soft("entity-coverage", `实体覆盖率 ${(coverage * 100) | 0}%——这些实体列了却没画进任何阶段：${show(missing)}。要么在 stages 里给它们位置，要么从清单删掉（缺元素 QA 层 Q4 会抓）。`);
    } else if (missing.length > 0) {
      notes.push(`实体未出现在 stages（确认是否有意省略）：${show(missing)}`);
    }
  }

  // ---- 软性提醒 ----
  if (stageList.length > 8) notes.push(`阶段 ${stageList.length} 个（>8）——双栏横幅塞不下，读者扫不完；考虑合并或拆两张。`);
  for (const s of stageList) {
    if (s.bullets.length > 6) notes.push(`阶段「${s.title}」要点 ${s.bullets.length} 条（>6）——卡面会挤爆，砍到 2-4 条。`);
  }

  const score = Math.max(0, 100 - blockers.length * 15 - notes.length * 5);
  return { score, blockers, codes, softCodes, notes, stageCount: stageList.length, entityCount: ents.length };
}

// ---------- fixExamples：拒绝原因 → 改法示范（2026-09-22 小白增强） ----------
// 实测弱 AI 看"规则描述"不会改，看"❌/✅ 对照示范"才会改。按 code 出对照示例，
// 纯函数，CLI 在 craft 拒绝路径打印。
export function fixExamples(codes = []) {
  const E = {
    "no-at": '🧭 示范: 先跑 pf distill --at "§3.2 ¶2"（位置从 pf doc outline 选）——之后 craft 把同一个 --at 原样带上，实体从 distill 输出里挑',
    "intent-empty": '🧭 intent 示范 ✅ "Two-stage defect detection pipeline: coarse filter discards background, fine grader scores candidates"（说清结构+给读者的结论）',
    "intent-short": '🧭 intent 示范 ❌ "检测流程图" ✅ "两级检测流程：粗筛先丢背景块，精判给剩余候选打分"（写清方法/流程/结论，别只给名词短语）',
    "intent-generic": '🧭 intent 示范 ❌ "方法框架图" / "pipeline diagram"（纯图型名=没说图意）✅ "UAPL 纯化框架：TTA 扩展假设、WBF 合并证据、CAC-T 剔除上下文不一致框"（图型词之外至少说出方法名+要表达的结构/结论）',
    "entities-empty": '🧭 entities 示范: 回 pf distill 的候选实体里挑真实名词模块，如 ✅ --entities "Input Image,Coarse Filter,Fine Grader"（禁止自己编；想用英文标签但原文是中文 → 对照格式 "Coarse Filter|粗筛模块"）',
    "entities-few": '🧭 entities 示范: ❌ --entities "Model,Input" ✅ --entities "Input Image,Coarse Filter|粗筛模块,Fine Grader|精判模块"（回原文逐个数名词模块；多数据集/多基线是整组出现的，漏一组图就不完整）',
    "entity-generic": '🧭 实体示范 ❌ --entities "Model,Data,Result"（万能占位词，哪篇论文都能用=没读原文）✅ --entities "Input Image,Weighted Box Fusion|加权框融合,CAC-T"（从 pf distill 输出里挑论文里真实存在的名词模块）',
    "entity-pair-bad": '🧭 对照格式示范 ❌ "Label|"（一侧为空）✅ "Coarse Filter|粗筛模块"（英文标签|原文词，两侧都必须有；没有对应原文词的标签直接删掉）',
    "stages-few": '🧭 stages 示范（≥3 阶段）: ✅ "Input Image | show 3 rail-surface thumbnails || Coarse Filter | discard background patches; keep candidates || Fine Grader | transformer scoring; per-patch score"',
    "stage-empty": '🧭 每阶段给 2-4 条要点: ✅ "标题 | show 画法句(1-2条); 短标签; 短标签" —— 只有标题的空盒子必出废图',
    "stage-thin": '🧭 孤标签盒子示范 ❌ "粗筛 | keep candidates"（只有 1 条标签，模型不知道怎么画）✅ "粗筛 | show background patches falling through a sieve-like gate; keep candidates"（补 1 条 show 画法句）',
    "no-show": '🧭 画法句示范: 每个阶段至少 1 条 show 开头的句子，❌ "编码器 | 64 通道; 残差连接" ✅ "编码器 | show a stack of 3 blocks labeled with channel numbers, arrows flowing left to right; 残差连接"',
    "bullet-sentence": '🧭 要点示范 ❌ "connected components merge by IoU voting" ✅ "show merge arrows; IoU voting"（≤5 词短标签；说明挪进 show 开头的画法句）',
    "entity-coverage": '🧭 列了就要画: 把点名缺失的实体写进对应阶段的要点/标题里；确实不画的从 --entities 删掉',
  };
  return [...new Set(codes)].map((c) => E[c]).filter(Boolean);
}

// ---------- isQuantifiedNote：QA PASS 依据必须量化（2026-09-23 收紧轮） ----------
// "看起来没问题"/"全项通过"这类无数字 note = 凭印象核验 = 无效核验（V11 放水教训）。
// PASS 写回与审批门禁共用本判定：note 必须含至少一个数字（元素个数/色相数/留白占比/字号 px…）。
export function isQuantifiedNote(note) {
  return /\d/.test(String(note || ""));
}

// ---------- qaState：QA 记录是否对最新版有效 ----------
// 🔴 审批门禁的底座（2026-09-21 "别放水"定规）：approve 必须有**最新版本**的 QA 记录。
// 出新版本后旧 QA 自动作废（render.mjs 会清 fig.qa），没有新核验就不许通过。
export function qaState(fig) {
  const vCount = fig?.versions?.length || 0;
  const qa = fig?.qa || null;
  const fresh = !!qa && Number(qa.version) === vCount;
  return { qa, fresh, version: vCount, verdict: fresh ? qa.verdict : null };
}

// ---------- checkEntitySource：实体溯源核对（craft --at 时可用） ----------
// 🔴 2026-09-21 "别人 AI 用着质量不行"第 2 层：quality 门只查「实体进了 stages」，
// 查不了「实体是不是编的」。--at 给了锚点时，把实体拿回原文对账——
// 全部实体（可核对子集中）都不在原文出现 = 疑似编造，blocker 拒绝出提示词。
// 纯函数：CLI 与测试共用。语言规则（实测弱模型会把中文实体译成英文再喂 craft）：
//   - 实体是「英文标签|原文词」对照格式 → 查**原文侧**（确定性对账，这格式就是为此设计）
//   - 实体含 CJK 且原文含 CJK → 子串匹配
//   - 实体纯拉丁且原文纯拉丁 → 整串大小写不敏感子串，或全部 ≥3 字符词元命中（容忍词序）
//   - 脚本不一致（实体已翻译且没给对照）→ 无法确定性核对，跳过不算违规（只提示 AI 自行确认）
export function checkEntitySource({ entities = [], sourceText = "" } = {}) {
  const src = String(sourceText || "");
  const srcLower = src.toLowerCase();
  const srcHasCJK = /[\u4e00-\u9fff]/.test(src);
  const checked = [];
  const skipped = [];
  const missing = [];
  for (const raw of Array.isArray(entities) ? entities : String(entities).split(/[,，]/)) {
    let e = String(raw).trim();
    if (!e) continue;
    // 🔴 红队实测（2026-09-23 审计 B）：带引号实体会被这里用原始串对账直接判"编造"，
    // 永远到不了 craft 的剥引号层——对账前先剥引号（与 craftPrompt 归一行为一致）
    const quoteStripped = /^".*"$/.test(e) || /^“.*”$/.test(e);
    if (quoteStripped) e = e.slice(1, -1).trim();
    const pair = splitEntityPair(e);
    // 对照格式：溯源对账查原文侧（显示名用 英文标签|原文 方便人看）
    if (pair.src) {
      const s = pair.src;
      const sCJK = /[\u4e00-\u9fff]/.test(s);
      if (sCJK !== srcHasCJK) { skipped.push(e); continue; }   // 对照侧连语言都对不上 = 填错了
      checked.push(e);
      if (sCJK) { if (!src.includes(s)) missing.push(e); continue; }
      const sl = s.toLowerCase();
      if (srcLower.includes(sl)) continue;
      const stoks = sl.split(/\s+/).filter((t) => t.length >= 3);
      if (!(stoks.length > 0 && stoks.every((t) => srcLower.includes(t)))) missing.push(e);
      continue;
    }
    const eCJK = /[\u4e00-\u9fff]/.test(e);
    if (eCJK !== srcHasCJK) { skipped.push(e); continue; }
    checked.push(e);
    if (eCJK) {
      if (!src.includes(e)) missing.push(e);
      continue;
    }
    const el = e.toLowerCase();
    if (srcLower.includes(el)) continue;
    const toks = el.split(/\s+/).filter((t) => t.length >= 3);
    if (!(toks.length > 0 && toks.every((t) => srcLower.includes(t)))) missing.push(e);
  }
  const result = { checked, skipped, missing, blocker: null, note: null };
  // 🔴 渗透实测（2026-09-22 子智能体 B）：对照格式是**确定性声明**——原文侧没对上 = 伪造出处
  // （"Universe|阶段"蹭一个无关真词当保护伞）。逐条硬拦，不许降级成提示。
  const pairMissing = missing.filter((e) => splitEntityPair(e).src);
  if (pairMissing.length > 0) {
    result.blocker =
      `这些双语对照实体的原文侧没有在原文出现（${pairMissing.join("、")}）——对照格式 = 确定性声明，对不上就是伪造出处。` +
      `回 pf distill --at "<章节 段号>" 核对真实原文词再填；没有对应原文词的标签删掉。`;
    return result;
  }
  if (checked.length >= 2 && missing.length === checked.length) {
    result.blocker =
      `全部实体（${checked.join("、")}）都没有在原文出现——疑似编造实体（V4-V8 事故：没读原文直接编内容）。` +
      `回 pf distill --at "<章节 段号>" 从原文抽候选实体，逐个核对后再 craft。`;
  } else   if (checked.length > 0 && missing.length > 0) {
    result.note = `这些实体没在原文对上（确认拼写/是否真的来自原文）：${missing.join("、")}`;
  }
  // 🔴 2026-09-21 子智能体 F 实测：混合场景（部分实体已译英文）只提示 missing 的、
  // 跳过的闭口不提——AI 以为全部对过账。跳过的也要点名，把确认责任说清。
  if (checked.length > 0 && skipped.length > 0) {
    result.note = (result.note ? result.note + " " : "") +
      `另有 ${skipped.length} 个实体语言与原文不同、插件无法自动对账（${skipped.join("、")}）——改用对照格式「英文标签|原文词」即可自动对账，或每个都说得出原文出处（§¶）。`;
  }
  if (checked.length === 0 && skipped.length > 0) {
    // 🔴 红队实测：这条软提示是"fail open"——翻译合法但编造也长这样。措辞必须压实：
    result.note =
      `实体与原文语言不同（${skipped.join("、")}，疑似已译成英文标签），插件无法自动对账。` +
      `出路：改用对照格式 --entities "Weighted Box Fusion|加权框融合,…"（英文标签|原文词）即可自动对账；` +
      `坚持不给对照就每个实体说得出原文出处（§¶），说不出来的删掉——qa 核验 Q4 会按原文再抓一次编造。`;
  }
  return result;
}
