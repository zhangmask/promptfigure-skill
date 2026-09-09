# 安装这个技能（AI Agent Skill）

把 `promptfigure-api/` 整个文件夹放进你的 AI 工具的技能目录即可：

| 工具 | 技能目录（复制到此处） |
|---|---|
| Claude Code | `~/.claude/skills/promptfigure-api/` |
| Claude Desktop（Agent Skills） | 设置 → Skills → 导入本 zip，或放 `~/.claude/skills/` |
| WorkBuddy / OpenClaw | `~/.workbuddy/skills/promptfigure-api/` |
| Codex / Cursor / Cline 等任意 Agent | 无技能目录的，把 `SKILL.md` 内容追加到 `AGENTS.md` / `CLAUDE.md` / 规则文件末尾 |

安装后对 AI 说「帮我用 promptFigure 画一张 XXX 图」，它会自动读取 `SKILL.md` 并按流程执行：
注册/登录 → 拿 key（或复用你已有的 `PROMPTFIGURE_KEY`）→ 调 API 出图。

## 需要准备

- 一个账号：https://promptfigure.pages.dev 注册（邮箱 + 密码 ≥8 位，无需邮箱验证）
- 余额：控制台充值（$1 起整数，每满 $50 赠 $1）；API 按次计费 standard $0.02 / premium $0.15
- API key：控制台「API 密钥」创建，`pf_` 开头明文只显示一次

## 保持最新

技能会过期。最新版永远在：https://promptfigure.pages.dev/downloads/promptfigure-api.zip
安装说明与 API 文档：https://promptfigure.pages.dev/docs/zh-CN/api
