# 随包附带的本地插件（plugin/）

一份技能包 = 两样东西。按宿主环境二选一，也可以都用：

| | 根目录 SKILL.md（promptfigure-api） | plugin/ 本地插件（promptfigure-local） |
|---|---|---|
| 形态 | 纯文档 skill | Node CLI（`pf` 命令）+ 自带 skill + 托盘常驻 |
| 依赖 | 能跑 curl 的宿主即可 | Node ≥20；LaTeX 本地编译用插件自带的 tectonic |
| 能力 | REST 出图（standard 草稿 / premium 定稿）+ 四阶段审核协议 | 文档只读预览、锚点定位（图放哪一段）、GUI 审批、本地规则层 craft、润色迭代、`pf export svg` 矢量导出 |
| 适合 | 任何 AI 宿主，尤其是没有本机插件环境的 | 有本机文件访问的宿主（Claude Code / Codex 等） |

## 什么时候装插件

- 要给论文/报告配图、图要放在原文位置、要等人审批再定稿 → **装插件**：`pf open` 开文档，AI 出图，你在独立 GUI 窗口里看高亮、点通过/驳回。
- 只要一次性出一张图、或脚本化批量出图 → 根目录 skill 就够了，不用装任何东西。

## 安装插件（约 30 秒）

```bash
cd plugin            # 本技能包解压后的 plugin/ 目录
npm install
npm link             # 之后 pf 命令全局可用（也可以不 link：node bin/pf.mjs …）
pf login pf_你的key  # 官网控制台创建 key（默认扣额度，按次扣余额）
```

## 插件的 Agent Skill 也随包发行

`plugin/skill/promptfigure-local/` 是插件的配套 skill（唯一源），按需装进宿主：

- **Claude Code**：`node plugin/adapters/claude-code/install.mjs`
- **Codex**：把 `plugin/adapters/codex/promptfigure/` 整个目录拷进 Codex 的 plugins 目录

## 两个 skill 的关系

同一个 promptFigure 服务的两个入口：**promptfigure-api 走 REST，promptfigure-local 走 pf CLI**。
按宿主环境装一个就够；都装也不冲突（触发条件不同：一个面向 REST 调用，一个面向 `pf` 命令）。
插件相关的本地红线（零侵入、premium 门禁、数值图不许 AI 重画等）见 `plugin/README.md` 与
`plugin/skill/promptfigure-local/SKILL.md`。
