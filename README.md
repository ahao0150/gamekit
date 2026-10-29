# gamekit

团队内部 2D 小游戏工具链：**一套 TypeScript 源码，构建出 web / 微信小游戏 / 抖音小游戏。**

设计取向是为 AI 写代码服务：契约先行、一层一职责、平台差异隔离在一个目录里。

## 文档在哪

写游戏 / 写界面 / 查 API，先看这四份（都在本仓库 `docs/` 下，克隆下来就有）：

| 文档 | 什么时候看 |
|---|---|
| [`docs/START-HERE.md`](docs/START-HERE.md) | **从零做一款游戏**：建项目 → 写 `.ui` → 接布局/渲染 → 三端构建 → 验收（10 步，命令可直接抄） |
| [`docs/ui-syntax.md`](docs/ui-syntax.md) | **`.ui` 语法真源**（当前 v0.6）：`region` / `put` / `layer`、尺寸与对齐、命中语义、25 个通用组件的 props |
| [`docs/ENGINE-API.md`](docs/ENGINE-API.md) | **引擎 API 总表**：core/ui 布局与交互纯函数、组件绘制工具（`drawCenteredText` 等）、`DrawDeps`/`MeasureEnv` 形状、platform 契约 |
| [`docs/perf-bench.md`](docs/perf-bench.md) | **Canvas 2D 性能基准**：能画多少、什么时候必须上 WebGL、离屏缓存收益 |
| [`docs/GAME-PLANNER.md`](docs/GAME-PLANNER.md) | **策划流程**（Concept→…→PRD；轻量默认） |
| [`docs/ECONOMY-SAVE.md`](docs/ECONOMY-SAVE.md) | **数值配表 TSV + 存档 + 离线收益**（`@mg/economy`） |
| [`docs/STORY.md`](docs/STORY.md) | **扁平剧情 `.story.tsv`**（`@mg/story`） |
| [`docs/PHYSICS-GUIDE.md`](docs/PHYSICS-GUIDE.md) | **2D 物理**何时用、像素换算、验收清单 |

团队内部文档（夜间计划/进展、协作工具、服务清单等）**不在本仓库**，在本团队自己的工作区里 —— 克隆本仓库的人只需要上面四份。

- 入门硬规则：[AGENTS.md](AGENTS.md)
- 工程约定（配置字段 / 产物结构 / 命令行语义 / 包体红线）：[docs/CONVENTIONS.md](docs/CONVENTIONS.md)
- ⚠ [docs/DESIGN.md](docs/DESIGN.md) 是 **v1 时代的接口设计稿（状态：待确认）**，已被
  v2 取代，**仅历史参考**，不要照它写新代码。

## 包

| 路径 | 作用 |
|---|---|
| `packages/runtime` | 引擎核心（loop/stage/input/assets/audio/ads/save/ui/render/tween）+ 平台适配（web / wechat / douyin / mock），源码级依赖，构建时 tree-shake 进游戏 |
| `packages/vite-plugin` | `@mg/vite`：三端产物、资源管线、**图集打包**、包体红线检查 |
| `packages/ui-plugin` | `@mg/ui-plugin`：`.ui` 编译（dev 与 build 走同一个函数） |
| `packages/economy` | `@mg/economy`：配表校验、simulate、离线收益 |
| `packages/story` | `@mg/story`：JSON 剧情运行与 lint |
| `packages/physics-2d` | `@mg/physics-2d`：planck 薄封装（可选） |
| `packages/debug-mcp` | 调试 MCP server：离线 5 个 `ui.*` 工具 + 运行时 10 个工具，WebSocket 端口 7788 |
| `packages/cli` | `mg` 命令：create / dev / build / check / pack / doctor |
| `templates/iaa-ui` | **默认模板**：`.ui` 界面链 + 通用组件注册表 |
| `templates/iaa-simple` | 手写布局 demo：广告三件套 + 主菜单 + 存档 + 最小玩法 |

## 游戏目录与维护方式

框架只在本开源仓库维护；游戏可以放在任意独立目录，推荐与框架分开：

```powershell
pnpm mg -- create my-game --dir 'D:\games\my-game'
```

CLI自动链接本地框架并重定位构建/测试配置。进入游戏目录执行`pnpm install`，之后使用
`pnpm dev/test/build/check`。未传--dir时继续兼容`games/<name>`。详见[独立项目指南](docs/EXTERNAL-PROJECTS.md)。

聊天气泡、聊天列表、聊天输入条已包含在通用组件中，无需维护私有引擎副本。

## 快速开始

```bash
pnpm install            # 仓库根装一次（workspace 覆盖 packages/ / templates/ / games/）
pnpm -w typecheck
pnpm -w test
pnpm run doctor         # 人话体检：Node ≥ 22、pnpm、契约文件等

# 建新游戏（默认模板 iaa-ui；必须在仓库根）
pnpm mg -- create my-game
# 或：node packages/cli/bin/mg.mjs create my-game

cd games/my-game
pnpm dev                # = mg dev（游戏目录内 @mg/cli 已把 mg 链进 PATH）
pnpm dev --host 0.0.0.0 # 监听全部网卡，同网段设备可用本机局域网 IP 预览
pnpm build              # = mg build --all（会先 typecheck；校验 ui/*.ui 都被 import）
```

**命令写法规则**：

- **仓库根**：`pnpm mg -- <命令>` 或 `node packages/cli/bin/mg.mjs <命令>`（根 scripts 已提供 `mg`）。
- **游戏目录内**：写 `pnpm <script>`（模板 scripts 已绑好）或 `pnpm exec mg <命令>`。
- **Node.js ≥ 22**（`engines` 与 `mg doctor` 同一口径）。

**测试边界**：根 `pnpm -w test` 只跑 `packages/**` 与 `templates/**`
（根 `vitest.config.ts` 的 include 只列这两处），**不覆盖 `games/**`**。
新游戏自己的测试要在游戏目录内跑：`cd games/<name> && pnpm test`。

## 与老项目的关系

完全不迁。老项目继续用各自的 `build.js`，本仓库不反向依赖它们；需要的能力从这里重写，不做共享代码。
