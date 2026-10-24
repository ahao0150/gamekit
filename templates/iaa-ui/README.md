# iaa-ui 模板

开箱默认 **暖木纹** 皮肤（另有清爽玻璃）；切换见 [`docs/SKINS.md`](docs/SKINS.md)。
缺图时走主题色回落，不会灰底蓝问号。：开箱就是 `.ui` 界面链

> 与 `iaa-simple` 的区别：**布局用 `.ui` 描述**（约束，不是坐标），组件走注册表，
> 命中用 `pickHit`（谁画在上面谁先接点击）。玩法只是「点按钮加分」的最小闭环。

## 用法

```powershell
# 在仓库根
node packages/cli/bin/mg.mjs create my-game --template iaa-ui
cd games/my-game
node ../../packages/cli/bin/mg.mjs dev --port 5173   # 本地跑
node ../../packages/cli/bin/mg.mjs build --all       # 三端产物到 build/
node ../../node_modules/vitest/vitest.mjs run        # 本模板单测
```

> `mg` 不是全局命令，仓库根的 `pnpm mg` 也不存在，一律 `node …/mg.mjs`。

## 目录

```
templates/iaa-ui/
  game.config.json     # design / fit / title —— 唯一真源（design/fit 走 virtual:mg-config）
  vite.config.ts       # 挂 @mg/ui-plugin（.ui 编译链），选项来自同一个组件注册表
  ui/home.ui           # 界面描述：region 切分 + put 组件 + layer 分层
  src/main.ts          # 入口：resolvePlatform → createGame → start
  src/env.d.ts         # declare module '*.ui'（类型声明，缺了 tsc 会红）
  src/app/
    ui-registry.ts     # 内置 9 个业务件 + 通用 22 个 = 31 个组件
    deps.ts            # runtime 依赖汇聚点（唯一直接 import runtime 的文件）
    layout.ts          # bindComponents → layout → rects / paintOrder / meta
    render.ts          # 按 paintOrder 正序画
    game.ts            # 真实 pointer → pickHit → reduce；绘制循环
    state.ts           # 纯数据 + 纯函数状态迁移
    debug.ts           # 只读调试钩子 __mg（给自动化验收用）
    *.test.ts          # 单测（不依赖 DOM）
```

## 改界面

只改 `ui/home.ui`，不用碰代码。语法真源：[`docs/ui-syntax.md`](../../docs/ui-syntax.md)（从本模板目录上跳两级到仓库根）。

```txt
region head   top 26% column justify center align stretch pad-x 8%
put panel     size fill style fillColor="#22303c"
region footer bottom 26% column justify end align stretch pad-x 10%
put button    size fixed 56 style text="点我 +1"
```

三条硬约束：

1. **`put` 的第一个词是组件名**，必须已在注册表里（拼错构建期直接报「未知组件」）；
2. **一个界面里同名组件只能出现一次**（`rects` 以组件名为键）——要两个按钮就注册
   两个名字，或用 `primaryButton` / `secondaryButton` 这类已有的不同名组件；
3. **布局是约束不是坐标**：只有 `top/bottom/fill` 切分 + `size/cross/align/justify`，
   换屏型不用改任何数。

## 加自己的组件

```ts
// src/app/ui-registry.ts
// deps.ts 转出了：defineComponent / drawCenteredText / fillRect / DEFAULT_THEME / WIDGET_COMPONENTS…
// 但**没有**转 stringProp / numberProp / boolProp —— 那几个直接从这里拿：
import { stringProp } from '@mg/runtime';
import { defineComponent, drawCenteredText, fillRect } from './deps';
import type { DrawDeps } from './deps';

registry.register(
  defineComponent('myCard', {
    props: { label: 'string' },
    defaultSize: { w: 200, h: 80 },
    measure: () => ({ w: 200, h: 80 }),
    draw: (ctx, box, props, deps: DrawDeps) => {
      fillRect(ctx, box, deps.theme.panel);
      // drawCenteredText(ctx, rect, text, color, fontFamily)：字号由 min(rect.h×0.36, rect.w/字数) 算
      drawCenteredText(ctx, box, stringProp(props, 'label'), deps.theme.light, deps.theme.fontFamily);
    },
  }),
);
```

自定义组件的四个成员（`measure` / `draw` / `assert` / `props`+`defaultSize`）、`DrawDeps` 与
`MeasureEnv` 的字段形状、`drawCenteredText` / `drawTextAt` / `drawIcon` / `fillRect` 的完整签名，
见 [`docs/ENGINE-API.md`](../../docs/ENGINE-API.md) 的「core/ui —— 写自定义组件要用的形状」一节。

`measure` 是纯函数（布局期调）、`draw` 只读不判定 —— 构建期与运行时用的是同一个
组件定义，所以 `.ui` 里拼错 props 键也会在构建期报错。

## 加界面

1. 新建 `ui/xxx.ui`；
2. `src/app/state.ts` 的 `Screen` 加类型，`ACTION_OF` 加该界面的可点映射；
3. `src/app/layout.ts` 的 `UI_OF` 加一行 `xxx: xxxUi`；
4. 状态迁移里加切界面的 action。

## 验收

- 界面层：`ui.check` 两视口（离线，不需要注册表；`size auto` 会报 0×0 是预期）
- 运行时：`games/ui-demo/tools/verify-{ui,runtime,input}.mjs` 是「真实鼠标/键盘驱动」的写法参照。
  ⚠ `verify-input.mjs` 用 puppeteer，而仓库里**没装** puppeteer —— 它靠 `createRequire` 从本机另一个
  项目借（文件里硬编码了 `projects/tanqiu-fengbao` 的路径）。新游戏照抄时要换成自己的 CDP 客户端
  （`templates/iaa-simple/tools/lib/harness.mjs` 是零依赖的那套），否则换台机器就跑不了。
- **截图必须肉眼确认画面内容**：状态全绿但画面空已经复现过三次。打开截图确认按钮/格子/文字真的在画面上。
- 平台门禁：`node templates/iaa-simple/tools/verify-platform.mjs`（测的是 iaa-simple 老链，
  不覆盖本模板，但能验证 runtime / 平台层没坏）

## 与 iaa-simple 的取舍

| | iaa-simple | iaa-ui |
|---|---|---|
| 布局 | 手写 `computeLayout`（坐标用比例算） | `.ui` 描述（约束） |
| 组件 | 自己画 | 注册表 + 31 个现成组件（9 内置业务件 + 22 通用件） |
| 命中 | 手写 `hitTest` | `pickHit`（层级 + block/self/none） |
| 适用 | 单屏极简 demo | 有多个界面 / 浮层 / 列表的游戏 |

`iaa-simple` 保留不动：`verify-platform` 门禁测的就是它的手写链。
