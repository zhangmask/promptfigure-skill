# promptFigure 本地插件

在你的 AI 宿主（Codex / Claude Code / 任何支持 Agent Skills 的工具）里为论文配科研图。
AI 通过 `pf` 命令读写锚点、出图、收审批；你在独立 GUI 窗口里看论文、看高亮、点审批。

> 插件与 skill 是**双向捆绑**的同一个产品：npm 装插件，skill 随包带；下载 skill 的 zip，
> 插件就在包里。三条安装路径任选其一。

## 安装

**① npm（推荐，插件 + 两个 skill 一起到手）**

```bash
npm i -g promptfigure
pf skill install            # 把随包的 promptfigure-local / promptfigure-api 装进 ~/.claude/skills/
pf login pf_你的key         # 官网控制台创建 key（默认扣额度，按次扣余额）
```

**② 从技能 zip 内（不装 npm 全局包）**

```bash
cd plugin                   # 技能包 zip 解压后的 plugin/ 目录
npm install && npm link     # 全局可用 pf（也可不 link：node bin/pf.mjs …）
```

**③ GitHub 仓库**：[zhangmask/promptfigure-plugin](https://github.com/zhangmask/promptfigure-plugin)
（Release 里也有免安装的源码包；技能包总下载页：https://promptfigure.top/skill ）

## 宿主接入（插件自带两个 skill，`pf skill install` 一次装好）

`skill/` 下随包发行两个 skill，按宿主环境二选一或都装（不冲突，触发条件不同）：

| skill | 适合 | 能力 |
|---|---|---|
| `promptfigure-local` | 装了本插件的宿主（Claude Code / Codex 等） | 文档只读预览、锚点定位、GUI 审批、本地规则层 craft、`pf export svg` |
| `promptfigure-api` | 任何能跑 curl 的宿主（不想装插件） | REST 直调 `/api/v1/generate`，四阶段审核协议 |

- **一键装**：`pf skill install [--dir <路径>]`（默认 `~/.claude/skills/`；`pf skill path` 只看包内路径）
- **Codex**：把 `adapters/codex/` 里的 `promptfigure/` 放进 Codex 的 plugins 目录（或按 `marketplace.json` 本地安装）
- **无技能目录的宿主**：把某个 skill 的 `SKILL.md` 内容追加进 `AGENTS.md` / `CLAUDE.md` 末尾

> `adapters/` 全部由 `node scripts/build-adapters.mjs` 生成，**勿手改**；skill 唯一源在 `skill/`。

## 用起来（AI 做的事，人只需要开个头）

```bash
pf open 我的论文.docx         # → 独立窗口预览论文，打印 docId
```

之后 AI 会按 skill 里的流程：`review status → doc outline/context → anchor set → render → 等你审批 → premium 定稿`。

## 第二阶段：提示词工作台与托盘

```bash
pf craft --intent "两级检测框架流程图" --entities "预处理,增强,分类" --out prompt.txt
pf render --at "§3.2 ¶2" --model standard --prompt-file prompt.txt
pf tray          # 托盘常驻（需 python + pystray pillow）：服务不随窗口死、挂了自动拉起
```

- **规则层**（`src/craft.mjs`，随插件分发、确定性、零成本）：自省句净化、hex 色号色名化、科研风格基线、12 条出图前自审清单——蒸馏自服务端审查链，每条带来源注释
- **判断层**归宿主 AI：按 craft 输出的 checklist 自审
- **评测**：`node scripts/eval-craft.mjs --dry-run`（免费预览三组对比计划）；`--run --yes` 才真实出图（≈$0.48/24 张）
- `pf doctor` 体检；LaTeX 编译详见下表

## 文档格式与预览

| 格式 | 预览方式 | 说明 |
|---|---|---|
| `.docx` | 保版式渲染（docx-preview） | Word / WPS 另存的 docx 都支持 |
| `.tex` | **本地编译成 PDF** 再渲染 | 自动探测 tectonic / latexmk / pdflatex；没有环境跑 `pf setup-tex` 自动装便携 tectonic（~20MB，免安装免管理员，国内镜像自动回退）；首次编译需联网拉宏包，之后秒级；改了源码 `pf doc compile` 重编译 |
| `.pdf` | pdf.js 整页渲染 + 文本层高亮 | 直接打开即可 |
| `.doc` / `.wps` 老格式 | 不支持 | 请在 Word/WPS 里「另存为 .docx」 |

出问题先 `pf doctor` 体检（TeX 引擎 / key / 服务状态）。

## GUI 你能做什么

- 看论文（docx 保版式渲染 / pdf / tex），高亮标出每张图对应的原文位置
  黄=待审批草稿 绿=已审定稿 红=被驳回 橙=原文已改动待复核 灰=位置丢失
- 点高亮或图库缩略图 → 版本对比 → 全屏
- **唯一可操作 = 审批**：通过 / 驳回（可写意见）/ 提交反馈给 AI
- 在对话里直接说"第 3 张不行"也行 —— AI 会写进同一份审批状态

## 结构

```
bin/pf.mjs          CLI 入口
src/                服务（唯一状态源）/ 解析 / 锚点 / 出图 / 审批
web/                零构建前端（docx-preview + pdfjs，全部本地资源，无外呼）
skill/              SKILL.md 唯一源
scripts/            build-adapters.mjs / test-e2e.mjs
```

数据在 `~/.promptfigure/`（config.json 存 key，权限 600；projects/<docId>/ 存锚点、图、events.jsonl 审批史）。

## 红线

- **零侵入**：插件永不写你的论文/代码/数据文件，所有写操作只落 `~/.promptfigure/`
- **premium 门禁**：未审批通过的图，代码级拒绝出定稿
- **唯一外呼 = 出图**：不连任何 CDN、无遥测
- 本地服务只绑 `127.0.0.1`，GUI 审批需会话令牌（pf open 开窗口时注入）

## 开发

```bash
npm install
node scripts/test-e2e.mjs        # 构造测试 docx 走全链路（解析/建锚/changed/门禁）
node scripts/build-adapters.mjs  # 重新生成宿主适配器
```
