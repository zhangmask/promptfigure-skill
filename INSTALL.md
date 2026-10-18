# 安装这个技能（AI Agent Skill）

> **版本 1.8.2**（2026-09-24）。下载页：https://promptfigure.top/skill 。查最新版：`curl -s https://promptfigure.top/downloads/promptfigure-api.version.json`；本地已装版本看 `SKILL.md` frontmatter 的 `version`。版本语义：主版本=接口不兼容改动（需重读 SKILL.md），次版本=新增能力，修订号=勘误。

把 `promptfigure-api/` 整个文件夹放进你的 AI 工具的技能目录即可：

| 工具 | 技能目录（复制到此处） |
|---|---|
| Claude Code | `~/.claude/skills/promptfigure-api/` |
| Claude Desktop（Agent Skills） | 设置 → Skills → 导入本 zip，或放 `~/.claude/skills/` |
| WorkBuddy / OpenClaw | `~/.workbuddy/skills/promptfigure-api/` |
| Codex / Cursor / Cline 等任意 Agent | 无技能目录的，把 `SKILL.md` 内容追加到 `AGENTS.md` / `CLAUDE.md` / 规则文件末尾 |

安装后对 AI 说「帮我用 promptFigure 画一张 XXX 图」，它会自动读取 `SKILL.md` 并按流程执行：
注册/登录 → 拿 key（或复用你已有的 `PROMPTFIGURE_KEY`）→ 调 API 出图。

## 让 AI 每次都想起这个技能（推荐，30 秒）

技能靠 description 匹配触发——宿主可能"自己动手画"而根本不读技能。2026-10-18 实测：claude CLI 收到「接着工作流继续」后，全程没读技能、没碰状态库，自己写 matplotlib 脚本出了张柱状图并宣布完成，而原文要的是 crop + localization map 配对图。

在**项目根目录**的 `CLAUDE.md` / `AGENTS.md` / `.cursorrules`（按你的工具选一个）里加下面这段，把入口钉死：

```text
做论文配图 / 改图 / 升级图之前，先读 promptfigure-api 技能（SKILL.md，路径按你的安装位置改）。
所有图任务必须走 pf workflow：status → init → done/review → check，交付消息必须带 pf workflow receipt 的一行凭据。
没有交付凭据的"已完成"不算完成。
```

## 本包还附带本地插件（plugin/）

一个 zip 两样东西：根目录的 `SKILL.md` 是纯 REST 技能（上面的装法即用）；
`plugin/` 是本地插件（`pf` CLI + promptfigure-local skill + 托盘）。想要「文档只读预览 /
锚点定位 / GUI 审批 / 本地规则层 / 矢量导出」这些本机能力时再装它：

```bash
cd plugin && npm install && npm link   # 之后 pf 命令全局可用
```

详见 [PLUGIN.md](PLUGIN.md)；纯 REST 用户完全不用碰 plugin/。

## 需要准备

- 一个账号：https://promptfigure.top 注册（邮箱 + 密码 ≥8 位，无需邮箱验证）
- 余额：控制台充值（$1 起整数，每满 $50 赠 $1）；API 按次计费 standard $0.02 / premium $0.15
- API key：控制台「API 密钥」创建，`pf_` 开头明文只显示一次

## 保持最新

技能会过期。程序化查最新版本（不用下载整个包）：

```bash
curl -s https://promptfigure.top/downloads/promptfigure-api.version.json
```

本地 `version` 低于线上 `version` → 到下载页取最新包：https://promptfigure.top/skill
（直链：https://promptfigure.top/downloads/promptfigure-api.zip ，或 GitHub Release 资产 promptfigure-api-1.8.2.zip）
安装说明与 API 文档：https://promptfigure.top/docs/zh-CN/api
