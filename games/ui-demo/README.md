# ui-demo —— `.ui` 布局链的端到端验证

**这不是一个游戏产品，是工具链的活体样本。** 三个界面（菜单 / 进行中 / 结算）全部
由 `.ui` 描述，布局由 `layout()` 求解，绘制由 T7 组件注册表完成，构建走 `mg` 三端。

刻意**没有美术、没有动效、没有音乐**：T10 验证的是「从界面到构建」这条链是否真的
能用，画面代码只是证据。

## 玩法（最简闭环）

点「开始」→ 进游戏 → 点中央目标 3 次 → 进结算 → 点「再来一次」回菜单。
游戏里还有一条「放弃」路径（进行中 → 回菜单）。状态机是纯函数，见 `src/app/state.ts`。

## 三个界面

| 文件 | 界面 | 组件 |
|---|---|---|
| `ui/menu.ui` | 主菜单 | `infoPanel`（标题面板）/ `statusText`（说明）/ `primaryButton`（开始） |
| `ui/play.ui` | 游戏中 | `statusText`（提示）/ `coinBadge`（命中数）/ `tapTarget`（可点目标，**自定义**）/ `secondaryButton`（放弃） |
| `ui/result.ui` | 结算 | `statusText`（标题）/ `scorePanel`（成绩 + 评级，**自定义**）/ `primaryButton`（再来一次） |

`.ui` 里没有坐标：只有 `region` 带切分（top / bottom / fill）+ `put` 尺寸约束
（fill / fixed / 百分比 / auto）。布局是约束，不是坐标 —— 换屏型只换 viewport。

## 目录

```
games/ui-demo/
├── ui/                     三个界面的 .ui 源码
│   ├── menu.ui
│   ├── play.ui
│   └── result.ui
├── src/
│   ├── main.ts             入口：平台 → 建游戏 → 调试钩子
│   ├── env.d.ts            `*.ui` 模块的类型声明
│   └── app/
│       ├── deps.ts         runtime 依赖汇聚点（唯一直接 import runtime 的文件）
│       ├── state.ts        状态机（纯函数）
│       ├── ui-registry.ts  组件注册表：内置 9 个 + 自定义 2 个
│       ├── custom-components.ts  tapTarget（可点目标）/ scorePanel（结算面板）
│       ├── layout.ts       `.ui` 产物 + 注册表 → 每界面每视口的组件矩形
│       ├── render.ts       按 put 顺序调组件 draw（纯色背景，无美术）
│       ├── game.ts         循环 + 真实 pointer 事件 + 命中判定
│       ├── debug.ts        只读调试钩子 `globalThis.__mg`
│       └── *.test.ts       state / layout / render / game 测试（22 条）
├── tools/
│   ├── verify-ui.mjs       界面层验收（MCP ui.check / ui.preview，三界面 × 两视口）
│   └── verify-runtime.mjs  运行时验收（调试 MCP：tree / screenshot / click 全流程）
├── vite.config.ts          挂 `.ui` 编译插件（选项来自组件注册表）
├── vitest.config.ts        测试也挂同一个插件
└── game.config.json        图集开启（atlas.enabled: true）
```

## 自定义组件注册流程（demo 要证明的那一步）

```ts
// src/app/custom-components.ts
export const tapTarget = defineComponent('tapTarget', {
  props: { label: 'string' },              // style 键 + 值校验
  defaultSize: { w: 180, h: 180 },
  measure: () => ({ w: 180, h: 180 }),     // 布局期（纯函数）
  draw: (ctx, box, props, deps) => { … },  // 绘制期（只画）
  assert: (box) => box.w < 96 ? ['目标太小'] : [],  // 静态断言
});

// src/app/ui-registry.ts
export const createDemoRegistry = () => {
  const registry = createBuiltinRegistry();   // 9 个内置件
  registry.register(tapTarget);
  registry.register(scorePanel);
  return registry;
};
```

同一份注册表有两个消费者：`vite.config.ts` / `vitest.config.ts` 用它生成 `.ui`
**构建期**校验选项（`knownComponents` / `componentProps`），游戏运行时用它做
`bindComponents`（注入 `measure`）。两边同源，不会出现「构建说合法、运行时报未知组件」。

## 怎么跑

```bash
cd games/ui-demo

# 单元测试（22 条：状态机 / 三界面×两视口布局 / 真实绘制 / 真实 pointer 事件）
node ../../node_modules/vitest/vitest.mjs run

# 界面层验收：MCP 离线工具 ui.check / ui.preview，三界面 × 390×844 + 320×568
# 不需要启动游戏、不需要浏览器
node tools/verify-ui.mjs

# 三端构建 + 包体检查
node ../../packages/cli/bin/mg.mjs build --all
node ../../packages/cli/bin/mg.mjs check --all
```

运行时验收（要浏览器 + 调试 MCP，两步分开跑）：

```bash
node ../../packages/cli/bin/mg.mjs dev --port 5173 --strict-port      # 终端 1
node ../../tools/open-game.mjs --url http://127.0.0.1:5173/ --seconds 300  # 终端 2
node tools/verify-runtime.mjs                                          # 终端 3
```

`verify-runtime.mjs` 会自己 spawn `mg-debug-mcp`，走 MCP stdio + WebSocket 驱动页面：
`canvas()` 尺寸 → `tree()` 认出三界面文案 → `screenshot()` 三张 → `click()` 真实
pointer 事件完成 menu → play → result → menu。

## 已知限制（都是布局语言 v0.3 的边界，不是 bug）

1. **同一个组件名在一个界面里只能 put 一次** —— `rects` 以组件名为键，同名会互相覆盖。
   需要两个同类型元素时，注册两个名字（或等语法支持实例名）。
2. **column 流没有主轴居中** —— `align` 只管交叉轴。垂直定位靠「没有 put 的空 region
   带」把内容推到目标位置（见三个 `.ui` 里的 `gap1` / `gapTop` / `gap2`）。
3. **`size auto` 依赖组件 `measure()`** —— 组件没注册时按 0 走。本 demo 的 `.ui`
   全部用 fixed / 百分比 / fill，所以 `mg.ui.check` 的 0 尺寸断言不会误报。
