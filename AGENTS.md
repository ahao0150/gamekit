> ## ✅ 本仓库 v2 开发中（2026-10-20 重启）
>
> v1 曾于 2026-10-19 归档（当时团队转 Cocos Creator 3.8.8）；2026-10-20 用户放弃 Cocos 路线
> （判断 Cocos 对 AI 不友好：编辑器 GUI 点不了、场景序列化、构建链摩擦大），本仓库以 v1 的契约为基础重启。
>
> 当前栈：**Vite 8（Rolldown 内核）+ TypeScript strict + pnpm workspace**，
> 产物：**web / 微信小游戏 / 抖音小游戏** 三端。
> 方案与里程碑见 [docs/PLAN-v2.md](docs/PLAN-v2.md)；v1 归档原文见 [ARCHIVED.md](ARCHIVED.md)（仅历史记录，不是当前约束）。

# gamekit 开发规范（给 AI 与 Bot 读）

本文件是这个仓库的**硬规则**。改代码前先读完，违反任意一条会被打回。

## 0. 一句话

一套 TypeScript 源码，构建出 web / 微信小游戏 / 抖音小游戏。**主要读者是 AI（Bot），人只做验收。**

**要写游戏 / 写界面 / 查 API 先看文档**（都在本仓库，克隆下来就有）：
从零做一款游戏走 [`docs/START-HERE.md`](docs/START-HERE.md)；**写代码前的策划**走 [`docs/GAME-PLANNER.md`](docs/GAME-PLANNER.md)（默认轻量：Concept→Top→PRD）；`.ui` 语法真源是
[`docs/ui-syntax.md`](docs/ui-syntax.md)；引擎 API 总表是 [`docs/ENGINE-API.md`](docs/ENGINE-API.md)。
**PRD 的视觉小节怎么写、视觉层怎么落到代码**（三层分工、8 色板、字号层级、验收判据）看
[`docs/VISUAL-SKELETON.md`](docs/VISUAL-SKELETON.md) —— 跳过这一步的后果是「逻辑全绿、看着像表单」。
数值配表 / 存档 / 离线收益：[`docs/ECONOMY-SAVE.md`](docs/ECONOMY-SAVE.md)（`@mg/economy`）；
2D 物理：[`docs/PHYSICS-GUIDE.md`](docs/PHYSICS-GUIDE.md)（官方示例 [`games/platformer`](games/platformer/)：建世界 → static 地面 → dynamic 玩家 → `setVelocity` 跳跃）；
剧情扁平源：[`docs/STORY.md`](docs/STORY.md) · [`packages/story`](packages/story)（`@mg/story` + `lint-story.mjs` / `compile-story.mjs`）。
**做一款完整、能上线的游戏**（PRD → 占位可玩 → 美术并行 → 手感 → 截图自评 → 包体 → 部署）走
[`docs/GAME-WORKFLOW.md`](docs/GAME-WORKFLOW.md)。
本文件只管「改引擎代码的硬规则」，不管「怎么写游戏」——后者看上面几份。

## 1. 你要改什么，放哪里

| 你要做的事 | 放这里 |
|---|---|
| 新增一个平台实现 | `packages/runtime/src/platform/<平台名>/index.ts` |
| 改平台契约 | `packages/runtime/src/platform/contract.ts`（**改前必须问 维护者**） |
| 加一个 core 能力 | `packages/runtime/src/core/<能力名>/`，含 `index.ts` + `contract.ts` + `*.test.ts` |
| 改构建行为 | `packages/vite-plugin/src/` |
| 加 CLI 命令 | `packages/cli/src/commands/<命令名>.ts` |
| 做游戏玩法 | 游戏项目自己的 `src/app/`，**不许改 runtime** |
| 数值配表 / 成长模拟 | `packages/economy/`（`@mg/economy`） |
| 剧情脚本与检查 | `packages/story/`（`@mg/story`） |
| 策划流程 / 空模板 | [`docs/GAME-PLANNER.md`](docs/GAME-PLANNER.md) · [`docs/templates/game-planner/`](docs/templates/game-planner/) |
| 2D 物理官方示例（platformer） | `games/platformer/` + [`docs/PHYSICS-GUIDE.md`](docs/PHYSICS-GUIDE.md) |
| 改美术资源 | 游戏项目自己的 `assets/`，不进 runtime |
| 放美术样张 / 原图 / 中间产物 | 游戏项目自己的 `artifacts/`，**不进 `assets/`**（见 §7） |

## 2. 七条铁律（判据）

1. **契约先行**：跨模块调用先有 `.ts` interface。没有契约的实现不接受。
2. **一层一职责**：单文件 300 行是提醒线、500 行是警告线；`pnpm lint` 只报 warning，不拦 CI。
   确需长文件时，在文件前 5 行内写 `// @long-file <原因>` 豁免（原因必须非空，没写原因不豁免）。
   仍鼓励先拆：超了先想抽象是不是错了。
3. **无全局可变状态**：禁止 `var S = {}` / 模块级可变单例。状态挂在 `Game` 实例上。
4. **数据 / 逻辑 / 渲染三分**：
   - 数据文件只放字面量，不放函数；
   - 逻辑是纯函数，输入旧状态 → 输出新状态，不碰 canvas；
   - 渲染只读状态、只画，不做判定。
5. **平台差异只在 `platform/`**：业务与 core 里出现 `wx.` / `tt.` / `window.` / `navigator.` 一律打回。用 `platform.can('xxx')`。
6. **禁魔法**：不用装饰器、不用隐式 DI、类继承 ≤ 2 层、不写猜不到的全局副作用。
7. **契约配测试**：每条公开 API 至少 1 条契约测试；纯函数（布局、经济、状态迁移）必须可测且不依赖 DOM。

## 3. 新增一个平台（厂商适配器）的标准步骤

**这是本框架唯一需要扩展的地方，必须做到「加平台不碰 core」。**

1. 新建 `packages/runtime/src/platform/<平台名>/index.ts`；
2. 实现 `PlatformAdapter`（契约见 `platform/contract.ts`）——必需成员最小化，可选能力用可选属性；
3. 写 `probe()`：判断当前是否该平台（如 `typeof wx !== 'undefined'`），**探测代码只准出现在这里**；
4. 导出 `register()`，内部调 `registry.register({ name, probe, factory, priority })`；
5. 在 `platform/index.ts` 的注册入口里加一行 import；
6. 补契约测试：用 mock 环境断言 `can()`、`onPointer()`、`loadImage()` 的行为。

**禁止**：为了新平台去改 `core/`、改 `contract.ts` 的必需成员、在业务代码里加平台判断。

## 4. 改契约的流程

契约（`**/contract.ts`）是冻结的。要改必须：

1. 写一段「为什么要改、影响谁」，贴给 维护者；
2. 等 维护者 同意；
3. 同一次提交里改契约 + 改所有实现 + 补测试。**禁止只改契约留实现报错。**

## 5. 提交前自检

```bash
pnpm -w typecheck      # tsc --noEmit，必须 0 错误
pnpm -w test           # 单元测试，必须全绿（只跑 packages/** 与 templates/**，不含 games/**）
pnpm -w lint           # 含「平台黑名单」「单文件行数」「禁 var」检查
pnpm -w verify-platform # 真浏览器平台适配门禁：dpr 五档 × 两视口 × build/dev，必须全绿
```

**两条前置条件，不满足会白折腾：**

1. **`pnpm -w test` 不覆盖 `games/`** —— 根 `vitest.config.ts` 的 include 只有
   `packages/**/src/**/*.test.ts` 和 `templates/**/src/**/*.test.ts`。新游戏自己的测试
   必须在游戏目录内跑：`cd games/<name> && pnpm test`。别以为根测试绿了游戏测试也绿。
2. **`verify-platform` 必须在 danger-full-access 会话跑** —— 它开真无头 Chrome。
   DSH 的 workspace-write 沙箱下 Chrome 的 crashpad 会 `OpenProcess: 拒绝访问 (0x5)` →
   `crash server failed to launch, self-terminating` → **Chrome 启动即自杀**、
   `DevToolsActivePort` 永不出现。表现像「端口被占 / 浏览器版本不对」，极易误判；
   `--no-sandbox` 等开关都救不了。见 `docs/TEAM-TOOLS.md` §五-5。

`verify-platform` 守的是两类曾经真实发生过的适配缺陷：dpr 变换缺失（画面只占左上角
1/dpr²、点击与画面错位）、窄视口画布被裁（底部按钮点不到）。它自带反例自检 ——
人为制造坏状态时门禁必须报红，防止门禁自己变成假阳性。细节见
[templates/iaa-simple/README.md](templates/iaa-simple/README.md#平台适配门禁真浏览器)。

## 6. 构建命令

```bash
node packages/cli/bin/mg.mjs build --all        # 三端产物到 games/<name>/build/
node packages/cli/bin/mg.mjs build --target wx  # 只出微信
node packages/cli/bin/mg.mjs dev                # web 开发服务器
node packages/cli/bin/mg.mjs dev --port 5173 --strict-port   # 指定端口；被占直接失败
node packages/cli/bin/mg.mjs dev --host 0.0.0.0              # 监听全部网卡，局域网预览
```

`mg dev` 的 web 端默认绑 `127.0.0.1`（可用 `--host <addr>` 覆盖；日志报**实际**绑定的
host:port），默认不用 `localhost`：双栈机器上同一个端口的 IPv4/IPv6 可能各被一个服务占着，
按 `localhost` 访问会打到谁全看运气。`--host 0.0.0.0` 会监听全部网卡，供局域网设备预览。
`--strict-port` 让端口被占用时**直接报错退出**（exit 1），不静默顺延 ——
门禁与 CI 必须能确定自己打的是哪一个端口。

## 7. 禁止事项

- 禁止在 runtime 里 import 游戏业务代码。
- 禁止把美术素材放进 runtime。
- 禁止把美术样张 / 原图 / 中间产物放进 `assets/`：打包规则是「`assets/` 下一切
  媒体文件都进包」，样张进包会顶到微信主包 4MB 红线（实测一次 3.86MB 样张让 wx
  主包到了 3922.9KB，产物直接不能上架）。样张放 `artifacts/`。
- 禁止用 `any` 绕过类型（需要时用 `unknown` + 收窄）。
- 禁止 `import()` 动态导入与代码分割（小游戏不支持）。
- 禁止把资源交给 Vite 的 asset 管线处理（小游戏没有 `fetch` / `new URL`）。
- 禁止在手绘层写死 UI 坐标：按钮 / HUD / 面板的位置一律由 `.ui` 的约束算出
  （`top/bottom/fill` + `size/cross/align`）。`fit: contain` 时画布比屏幕窄
  （320 屏只有约 262），`{ x: 24, y: 700 }` 这类绝对坐标会让元素画到画布外；
  命中矩形必须从 layout 结果派生，**画与点同源**。实录见 `docs/ui-syntax.md`
  附录「位置不要写死坐标」。
- **禁止把主界面做成卡片列表 / 表格式面板 —— 游戏要像一个「地方」，不能像一个「APP」**。
  四条判据：① 主界面有空间关系（场景底 + 物件间有距离/道路，不是等距网格）；
  ② 建筑与角色是实体（屋顶/墙体/地面阴影，不是色块 + 文字）；
  ③ 信息浮在场景上（半透明 HUD 条，不占布局、不单独成区）；
  ④ 操作就地发生（点物件弹面板，不跳「XX 管理」页）。
  主循环内的操作 ≤ 0 次切屏；主界面之外的独立屏不超过 5 个。
  判据与改法见 [`docs/VISUAL-SKELETON.md`](docs/VISUAL-SKELETON.md) §0。
  实测代价：测试全绿、配色合规、六条视觉规范全满足，用户第一句话仍是「不符合，像个后台」。
  **豁免**：玩法里没有「位置」概念的类型不必做场景——文字冒险/视觉小说、问答测评、聊天模拟、
  卡牌图鉴、数值放置、纯格子解谜。判断口诀「玩法里有没有位置这个概念？」；
  豁免后仍要守排版层级、统一色板、操作反馈，且**不许硬塞假场景**。细则见同节「豁免」小节。
  **但豁免不等于优先选**：做新游戏时**优先选能做场景的玩法**，纯表单式玩法玩着累（用户原话
  「像点开一个 app 进行问卷调查」）。选题先做场景三问：核心动作在什么**地方**、玩家要不要**走**、
  每次去是否**不一样**——答不出就换玩法或加空间壳。见 §0.1。
- 禁止「先跑起来再说」的临时代码进 `main`。

## 8. 报告格式

做完一件事回报，只写三行：

1. 改了什么（文件路径）
2. 怎么验证的（测试名 / 数字）
3. 有没有偏离契约（有/无，有就说明）
