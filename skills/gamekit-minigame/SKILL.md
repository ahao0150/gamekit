---
name: gamekit-minigame
description: 用 gamekit 框架从零创建并开发一款三端小游戏（web / 微信小游戏 / 抖音小游戏）。当要在 gamekit 仓库里新建游戏、加玩法、接界面、出三端产物或做验收时使用。给出 mg create 流程、七个核心文件的职责、构建与门禁命令、六条实测踩坑判据。只改 .ui 界面布局时用 ui-authoring skill；改引擎（packages/**）不属于本 skill，先读仓库 AGENTS.md。
---

# 用 gamekit 做一款小游戏

一套 TypeScript 源码 → web / 微信小游戏 / 抖音小游戏三端产物。
**读者假设是 AI，人只做验收** —— 所以下面的判据都写成可执行命令和数字。

## 仓库与入口

本 skill 假定你站在 **gamekit 仓库根**（有 `pnpm-workspace.yaml` 的那一层）。
不确定就先确认：`pwd` + `ls package.json pnpm-workspace.yaml`。

- 先读这三份，别靠记忆写：
  - `docs/START-HERE.md` —— 从零到三端产物的完整流程
  - `docs/ui-syntax.md` —— `.ui` 语法真源
  - `docs/ENGINE-API.md` —— 引擎 API 总表
- 硬规则：`AGENTS.md`（改引擎前必读）

## 0. 开工前（30 秒，别跳）

```bash
git status            # 有未提交改动、或不在自己的分支 → 先问，别硬改
pnpm install
pnpm doctor           # Node ≥ 22 / pnpm / 依赖 / 契约文件 / 模板
```

`mg doctor` 不全绿就不要往下走，后面的错都会伪装成别的问题。

## 1. 建项目

```bash
pnpm mg -- create my-game                        # 默认 iaa-ui 模板
pnpm mg -- create my-game --template iaa-simple  # 极简单屏 demo（手写布局老链）
```

- **iaa-ui**（默认）：`.ui` 链已接好 —— `vite.config.ts` / `src/app/ui-registry.ts` / `ui/*.ui` / `env.d.ts` 全都在，**31 个组件**（9 个内置业务件 + 22 个通用件）开箱可写。
- **iaa-simple**：没有 `vite.config.ts` / `ui-registry.ts` / `ui/`，要 `.ui` 就得自己补一遍（照着 START-HERE §3–§6）。

游戏必须建在 `games/<name>/`：`mg create` 会**拒绝仓库外路径**，三端构建与 workspace 协议都依赖这个前提。

## 2. 改 `game.config.json`（唯一真源）

```json
{
  "design": { "width": 390, "height": 844 },
  "fit": "fill",
  "title": "我的游戏",
  "assetsDir": "assets",
  "subpackages": {}
}
```

`fit` 三个值，**选错会直接导致 UI 位置错乱**：

| 值 | 效果 | 什么时候用 |
|---|---|---|
| `fill` | 拉伸铺满，无黑边 | 大多数小游戏 |
| `contain` | 等比缩放，两侧留黑边 | 需要保证构图不被裁切时 |
| `height` | 按高度铺满，宽度自适应 | 竖屏 |

> `contain` 下 **`screen.width` 是画布的 CSS 显示宽度，不是窗口宽度**（320 屏只剩约 262）。
> 任何按屏幕宽度算的坐标都会错 128px 起步 —— 所以位置一律走 `.ui`（见 §7 坑 6）。

这份配置走 `virtual:mg-config`，`main.ts` 不用再写一遍；改完跑一次 `build --all` 确认还是绿的。

## 3. 认这七个文件（写代码前先知道谁管什么）

```
ui/*.ui                界面描述（约束，不是坐标）
src/app/state.ts       纯数据 + 纯函数状态迁移（不碰 canvas、不碰平台）
src/app/layout.ts      .ui 编译产物 → bindComponents → layout → rects/paintOrder/meta
src/app/render.ts      按 paintOrder 正序画（只读状态、只画、不判定）
src/app/game.ts        指针/键盘 → 判定 → reduce；绘制循环
src/app/ui-registry.ts 组件注册表（构建期与运行时同一个工厂）
src/app/deps.ts        唯一直接 import runtime 的地方（其它文件从它拿）
```

**数据 / 逻辑 / 渲染三分**：数据文件只放字面量；逻辑是纯函数（旧状态 → 新状态）；渲染只读状态只画。这不是为了好看——它是让单测能跑、让改 A 不会碰坏 B 的前提。

## 4. 写界面 → 转 `ui-authoring` skill

只改 `ui/*.ui` 时用那个 skill（含语法速查与 `ui.check` / `ui.preview` 工作流）。三条硬约束先记住：

1. **`put` 第一个词必须是注册表里的组件名**，不能自造实例名。拼错时 `mg build` 报「未知组件 'xxx'，已注册的有：…」——照抄报错改。
2. **一个界面里同名组件只能出现一次**（`rects` 以组件名为键）。要两个按钮就换不同组件。
3. **位置只许用 `top/bottom/fill` + `size/cross/align/justify`**，没有 x/y。

## 5. 构建与门禁

```bash
cd games/my-game
pnpm dev      # dev server，默认 127.0.0.1
pnpm build    # = mg build --all → build/{web,wx,tt}，会先跑 tsc
pnpm check    # 包体与配置校验
pnpm test     # 这个游戏自己的单测
```

- 包体红线：**3 MB 团队发布线 / 4 MB 微信硬限**，`mg check` 会拦。
- `pnpm -w test` **不覆盖 `games/`** —— 只跑 `packages/**` 和 `templates/**`。游戏测试必须在游戏目录里跑。
- 参考量级：`games/platformer` 三端各约 250 KB。

## 6. 验收（最容易被糊弄过去的一节）

**测试绿 ≠ 画面对。** 实测过：1293 条测试全绿的同时，触屏按钮画在画布外，没人发现。

三条一起做：

1. **把构建产物跑起来截图**，肉眼确认：背景有颜色 / 可点元素可见 / 数字与状态一致 / 截图尺寸与目标视口一致。
2. **至少两个视口**：`390×844` 与 `320×568`（窄屏最容易露馅：按钮出界、文字溢出、面板被裁）。
3. **无视觉能力时用像素统计替代**，并写明这是替代：唯一主色 ≥ 4、非背景占比 > 50%、横向颜色切换 ≥ 6（多行采样取中位数）。

截图用 **puppeteer-core**（仓库根已装），别用 `chrome --headless --screenshot`：
后者对 canvas 抓不到内容，只会得到纯背景色（`--virtual-time-budget` 各种值都试过）。

## 7. 六个实测坑（每条配判据）

| # | 坑 | 症状 | 判据 / 改法 |
|---|---|---|---|
| 1 | `region top` 是**累加** | 第二个 `top 9%` 从 76px 开始，文字落在 HUD 带外 | 同高叠放用 `layer overlay` + `at x y size w h` |
| 2 | 一个界面**同名组件唯一** | 第二个同名组件不生效 | 换组件名，或用 `button`/`primaryButton`/`secondaryButton` |
| 3 | 样张误入 `assets/` | 包体暴涨顶红线（实测 3.86MB 让 wx 主包到 3922.9KB，不能上架） | 样张 / 原图 / 中间产物一律放 `artifacts/` |
| 4 | 数据组件只喂一个通道 | 状态全对、画面全空 | `bindComponents(env.data)` 与 `DrawDeps.data` **两个都传** |
| 5 | 世界边界要自己加墙 | 角色掉出地图 | 物理世界没有隐式边界，四周加 `static` 刚体 |
| 6 | **UI 位置写死坐标** | 390 正常，320 / 窄 iframe 里按钮画到画布外、点不中 | 位置一律 `.ui` 约束；命中矩形从 layout 结果派生，**画与点同源** |

## 8. 不要做什么

- 不改 `packages/**`（引擎源码）和 `templates/**` —— 那是仓库的事，不是这个游戏的事。
- 不改 `node_modules/`。
- 不用 `any` 绕过类型（用 `unknown` + 收窄）。
- 不用 `import()` 动态导入（小游戏不支持代码分割）。
- 不把资源交给 Vite 的 asset 管线（小游戏没有 `fetch` / `new URL`）。
- 不在 runtime 里 import 游戏业务代码。

## 交付前自检

- [ ] `pnpm doctor` 全绿
- [ ] `pnpm test`（游戏目录内）全绿
- [ ] `pnpm build` 三端产物都出来，`pnpm check` 过
- [ ] 390×844 与 320×568 各一张截图，**看过画面**
- [ ] 没有新增的 `assets/` 样张、没有 `any`、没有动态 import
- [ ] 回报三行：改了什么 / 怎么验证的（数字）/ 有没有偏离契约
