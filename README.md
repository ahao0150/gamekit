# gamekit

一套 TypeScript 源码，构建 **web / 微信小游戏 / 抖音小游戏** 三端。

面向 AI 协作的 2D 小游戏工具链：声明式界面语言、契约先行的引擎内核、真浏览器适配门禁。

![Node](https://img.shields.io/badge/node-%E2%89%A5%2022-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Vitest](https://img.shields.io/badge/test-vitest-6E9F18?logo=vitest&logoColor=white)

---

## 特点

- **一套源码三端产物** — `web` / `wx`（微信小游戏）/ `tt`（抖音小游戏）。平台差异只隔离在 `packages/runtime/src/platform/` 一层，业务与 core 里不出现任何 `wx.` / `tt.` / `window.`
- **声明式 `.ui` 界面语言** — 布局是约束不是坐标：`region` 切带 + `size/cross/align` 定位。换屏型（390×844 ↔ 320×568）不用改任何数字
- **契约先行** — 每个能力都有 `.ts` interface + 契约测试。改契约必须同一次提交里改完所有实现和测试
- **真浏览器适配门禁** — `pnpm verify-platform` 跑 dpr 五档 × 多视口 × build/dev，并自带反例自检（故意制造坏状态时门禁必须报红，防止门禁自己变假阳性）
- **图集打包 + 包体红线** — `mg check` 按 3 MB 发布线、4 MB 平台硬限校验，样张误入 `assets/` 会当场拦下
- **为 AI 写代码设计** — `AGENTS.md` 是给 AI 的硬规则，分主题文档齐全。新接手的 AI 不问人也能加出一个界面

## 快速开始

要求 **Node.js ≥ 22** 与 **pnpm**。

```bash
git clone https://github.com/ahao0150/gamekit.git
cd gamekit
pnpm install

pnpm doctor          # 体检：Node 版本 / pnpm / 依赖 / 契约文件 / 模板
```

跑一个示例：

```bash
cd games/platformer
pnpm dev                  # dev server，默认绑 127.0.0.1
pnpm dev --host 0.0.0.0   # 监听全部网卡，手机连同一局域网可预览
```

构建三端产物：

```bash
cd games/platformer
pnpm build        # = mg build --all，产物在 build/{web,wx,tt}
pnpm check        # 包体与配置校验
pnpm test         # 该游戏自己的单测
```

新建一款游戏（必须在仓库内，`mg create` 会拒绝仓库外路径）：

```bash
pnpm mg -- create my-game
cd games/my-game
pnpm dev
```

> **命令写法**：仓库根用 `pnpm mg -- <命令>` 或 `node packages/cli/bin/mg.mjs <命令>`；游戏目录内直接 `pnpm <script>`（模板已绑好 `mg`）。

## 示例工程

| 目录 | 演示什么 | 怎么跑 |
|---|---|---|
| [`games/platformer`](games/platformer) | 2D 物理（planck）：static 地面 + dynamic 玩家 + `setVelocity` 跳跃 | `pnpm dev` |
| [`games/ui-demo`](games/ui-demo) | `.ui` 界面语言：region 切带、组件注册表、命中测试 | `pnpm dev` |
| [`games/pindou-workshop`](games/pindou-workshop) | 完整小游戏：12 关 + IAA 变现 + 存档 + 图集美术接入 | `pnpm dev` |
| [`games/bench`](games/bench) | Canvas 2D 性能基准：draw 成本、掉帧点、离屏缓存收益 | `pnpm dev`（纯 Vite，非 `mg dev`）/ `pnpm bench` |

## 目录结构

```
packages/
  runtime/       引擎内核：loop / stage / input / assets / audio / ads / save / ui / render / tween
                 + 平台适配层（web / wechat / douyin / mock）
  vite-plugin/   @mg/vite：三端产物、资源管线、图集打包、包体红线检查
  ui-plugin/     @mg/ui-plugin：.ui 编译（dev 与 build 走同一个函数）
  economy/       @mg/economy：配表校验、模拟、离线收益
  story/         @mg/story：剧情扁平源 + lint / compile
  physics-2d/    @mg/physics-2d：planck 薄封装（可选）
  debug-mcp/     调试 MCP server：离线 5 个 ui.* 工具 + 运行时 10 个工具
  cli/           mg 命令：create / dev / build / check / pack / doctor

templates/
  iaa-ui/        默认模板：.ui 界面链 + 31 个组件注册表
  iaa-simple/    手写布局 demo：广告三件套 + 主菜单 + 存档 + 最小玩法

games/           游戏工程只能放这里（mg create 强制）
docs/            文档
```

## 文档

| 文档 | 什么时候看 |
|---|---|
| [`docs/START-HERE.md`](docs/START-HERE.md) | **从零做一款游戏**：建项目 → 写 `.ui` → 接布局/渲染 → 三端构建 → 验收 |
| [`docs/ui-syntax.md`](docs/ui-syntax.md) | **`.ui` 语法真源**：`region` / `put` / `layer`、尺寸与对齐、命中语义、通用组件 props |
| [`docs/ENGINE-API.md`](docs/ENGINE-API.md) | **引擎 API 总表**：布局与交互纯函数、绘制工具、`DrawDeps` / `MeasureEnv`、platform 契约 |
| [`docs/GAME-WORKFLOW.md`](docs/GAME-WORKFLOW.md) | **做一款完整能上线的游戏**：PRD → 占位可玩 → 美术并行 → 手感 → 截图自评 → 包体 → 部署 |
| [`docs/GAME-PLANNER.md`](docs/GAME-PLANNER.md) | 写代码前的策划流程（默认轻量：Concept → Top → PRD） |
| [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) | 工程约定：配置字段、产物结构、命令语义、包体红线 |
| [`docs/PHYSICS-GUIDE.md`](docs/PHYSICS-GUIDE.md) | 2D 物理：何时用、像素换算、验收清单 |
| [`docs/ECONOMY-SAVE.md`](docs/ECONOMY-SAVE.md) | 数值配表 TSV + 存档 + 离线收益 |
| [`docs/STORY.md`](docs/STORY.md) | 扁平剧情 `.story.tsv` |
| [`docs/UI-PIPELINE.md`](docs/UI-PIPELINE.md) | 美术到代码：风格板 → 整屏图 → tokens → 图层切割 → 补全 → 位图字体 |
| [`docs/perf-bench.md`](docs/perf-bench.md) | Canvas 2D 性能基准：能画多少、什么时候必须上 WebGL |
| [`AGENTS.md`](AGENTS.md) | 改引擎代码的硬规则（给 AI 的判据） |

## 核心设计

**一层一职责**：契约（`contract.ts`）→ 实现 → 测试，三层分开。单文件 300 行是提醒线、500 行是警告线。

**数据 / 逻辑 / 渲染三分**：数据文件只放字面量；逻辑是纯函数（输入旧状态 → 输出新状态，不碰 canvas）；渲染只读状态、只画、不做判定。

**平台差异只在 `packages/runtime/src/platform/`**：新增一个平台 = 新建一个目录 + 实现 `PlatformAdapter` + 写 `probe()`，**不碰 core、不碰契约的必需成员**。

**无全局可变状态**：状态挂在 `Game` 实例上，禁止模块级可变单例。

## 已知约束

- **Node.js ≥ 22**（`engines` 与 `mg doctor` 同一口径）
- **游戏工程只能在 `games/<name>/`** —— `mg create` 会拒绝仓库外路径，三端构建与 workspace 协议都依赖这个前提
- **根 `pnpm -w test` 不覆盖 `games/`** —— 只跑 `packages/**` 与 `templates/**`。新游戏自己的测试要在游戏目录内跑
- **`pnpm verify-platform` 需要真实浏览器** —— 在受限沙箱里 Chrome 的 crashpad 会启动即自杀，必须在有完整进程权限的环境下跑
- **小游戏不支持 `import()` 动态导入与代码分割**，资源也不能交给 Vite 的 asset 管线

## 状态

v2，开发中。接口（`contract.ts`）在冻结前会有变动，改动会在对应文档里标注。
