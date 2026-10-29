# AGENTS.md —— 给 AI 的工程说明书（iaa-ui 模板）

> 你正在一个**游戏工程**里，不是引擎仓库。这个工程的界面用 `.ui` 声明式描述，
> 布局由引擎求解，组件来自通用注册表（`WIDGET_COMPONENTS`）。
> 本文件是「这个工程怎么用」的说明书；语法与 API 在仓库文档里，别靠记忆写。

## 先读什么

从本工程目录（`games/<你的游戏名>/`）出发，这些路径能直接打开：

| 文档 | 什么时候读 |
|---|---|
| [`../../docs/START-HERE.md`](../../docs/START-HERE.md) | **第一次进来先读**：从零做一款游戏的完整流程（建项目 → 写 `.ui` → 接布局/渲染 → 三端构建 → 验收） |
| [`../../docs/ui-syntax.md`](../../docs/ui-syntax.md) | 写/改 `.ui` 前必读：`region` / `put` / `layer` 语法、尺寸与对齐、命中语义、通用组件的 props |
| [`../../docs/ENGINE-API.md`](../../docs/ENGINE-API.md) | 查 API 签名时读：布局与交互纯函数、`DrawDeps`/`MeasureEnv`、平台适配、物理（可选包） |
| [`../../docs/GAME-WORKFLOW.md`](../../docs/GAME-WORKFLOW.md) | **做完整游戏的流程**：先写 PRD.md、美术并行与缺图回落、手感清单、截图自评、包体与部署 |
| [`docs/SKINS.md`](docs/SKINS.md) | 开箱皮肤：暖木纹 / 清爽玻璃，切换与缺图回落 |

## 这个工程的目录约定

```
ui/*.ui             界面描述（布局是约束，不是坐标）—— 改界面主要改这里
src/app/state.ts    纯数据 + 纯函数状态迁移（不碰 canvas、不碰平台）
src/app/layout.ts   .ui 编译产物 → bindComponents → layout → rects/paintOrder/meta
src/app/render.ts   按 paintOrder 正序画（只读状态、只画）
src/app/game.ts     真实 pointer → pickHit → reduce；绘制循环
src/app/ui-registry.ts  组件注册表（构建期与运行时同一份工厂）
assets/             正式素材（**会进包**，注意 wx 主包 4MB 红线）
artifacts/          样张 / 原图 / 中间产物（**不进包**）
```

## 改界面怎么改

**只改 `ui/*.ui`**，其余不用碰。改完：

```bash
node ../../packages/cli/bin/mg.mjs build --all    # 构建期会校验组件名与 style 键
```

要加新界面：新建 `ui/xxx.ui` → `src/app/state.ts` 的 `Screen` 加类型与 `ACTION_OF` →
`src/app/layout.ts` 的 `UI_OF` 加一行。详见 `../../docs/START-HERE.md`。

## AI 必须守的几条

1. **`put` 的第一个词必须是注册表里的组件名**（如 `put button …`），不能自造实例名
   （不能写 `put startButton`）。拼错时 `mg build` 报「未知组件 'xxx'，已注册的有：…」，照抄报错即可。
2. **一个界面里同名组件只能出现一次**（`rects` 以组件名为键）。要两个按钮，注册不同名称的别名，并同步编译期与运行时注册表。
3. **布局是约束不是坐标**：只用 `top/bottom/fill` 切带 + `size/cross/align/justify` 定位，
   不要写 x/y。换屏型（390×844 ↔ 320×568）不用改任何数字。
4. **数据驱动组件优先单通道**：把 data 传给 `layout.compute(..., data)`（挂在 `ScreenLayout.data`），
   绘制期自动注入；若分两边传，漏键会走 `resolveUiData` 报错。
5. **世界边界要自己加墙**：做平台跳跃 / 横版时，物理世界没有隐式边界，地图四周要自己加
   `static` 刚体，否则角色会掉出世界。
6. **自绘的东西也要有约束**：需要在 canvas 上自己画的（盘面、棋盘、摇杆、血条），
   先在 `.ui` 里留一个空 region 当容器，运行期从 `rects.<名字>` 取矩形、内部**按比例均分**；
   不要在 `render.ts` / `game.ts` 里拿 `viewport.width` 自己减边距。这类写法会被
   `pnpm -w lint` 的规则 5 判红：
   `viewport.width - 24`、`Math.min(vp.width / N, 30)`、`Math.max(90, vp.height * 0.16)`。
   必须固定的物理量（触摸目标 44、描边 1–2、字号）提到常量文件，行尾加
   `// @fixed-layout <原因>` 才放行 —— 让「写死」变成需要解释的决策。
7. **单文件行数**：300 行是提醒线、500 行是警告线；`pnpm -w lint` 只报 warning，不拦 CI。
   确需长文件时，在文件前 5 行内写 `// @long-file <原因>` 豁免（原因必须非空，没写原因不豁免）。
   仍鼓励先拆。

## 验收怎么做

```bash
node ../../packages/cli/bin/mg.mjs build --all     # 三端产物进 build/（web / wx / tt）
node ../../node_modules/vitest/vitest.mjs run      # 本工程单测
```

**截图必须肉眼确认画面内容，不能只读状态。** 「状态全绿、画面全空」已经复现过多次
（分数在涨、棋盘一格没画）。每张截图过一遍：背景有颜色 / 可点元素可见 / 数字与状态一致 /
截图尺寸与目标视口一致。做不了视觉验收就写「视觉验收未做，已用像素统计替代」并给出数字。

## 不要改什么

- **不改 `packages/**`**（引擎源码）和 `templates/**` —— 那是仓库的事，不是这个工程的事。
- 不改 `node_modules/`。不把样张放进 `assets/`（会进包顶爆 4MB 红线）。
- 只改本工程目录（`games/<游戏名>/`）里的文件。

默认模板只使用通用组件。旧业务件注册表仍可显式接入，不要把旧示例的组件名直接抄进新界面。
资源格式、三端验收边界见 `../../docs/PLATFORM-ACCEPTANCE.md`。
