# promptFigure Agent Skill

让 AI Agent（Claude Code / Claude Desktop / WorkBuddy / Codex / Cursor 等）自动调用 [promptFigure](https://promptfigure.pages.dev) 生成科研配图——机制图、实验流程图、技术路线图、图形摘要等。

安装后，AI 会自动完成注册、API key 创建，并把你的绘图意图（大白话即可）转成 API 调用，返回可直接放进论文的 PNG。

## 安装

**npx skills（Claude Code / Cursor / Codex 等 20+ Agent）：**

```bash
npx skills add zhangmask/promptfigure-skill
```

**手动安装：** 把本仓库的 `promptfigure-api` 文件夹（或整仓内容）放进你的技能目录：

| 工具 | 技能目录 |
|---|---|
| Claude Code | `~/.claude/skills/promptfigure-api/` |
| WorkBuddy / OpenClaw | `~/.workbuddy/skills/promptfigure-api/` |
| Claude Desktop | 设置 → Skills 导入 |
| Codex / Cline 等 | 将 SKILL.md 内容追加到 AGENTS.md / 规则文件 |

详见 [INSTALL.md](promptfigure-api/INSTALL.md) 与 [SKILL.md](promptfigure-api/SKILL.md)。

## 准备

- 账号：https://promptfigure.pages.dev 注册（邮箱 + 密码 ≥8 位，无需邮箱验证）
- 余额：控制台充值（$1 起整数，每满 $50 赠 $1）——API 按次计费，standard $0.02 / 次、premium $0.15 / 次
- 生成失败自动原路退款

## 文档

- API 文档：https://promptfigure.pages.dev/docs/zh-CN/api
- API 调试台：https://promptfigure.pages.dev/docs/zh-CN/api-playground
- 常见问题：https://promptfigure.pages.dev/docs/zh-CN/faq

## License

MIT
