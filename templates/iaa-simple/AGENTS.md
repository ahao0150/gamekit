# AGENTS.md —— 给 AI 的工程说明书（iaa-simple 模板）

> 你正在一个**游戏工程**里，不是引擎仓库。这个工程用**手写布局链**：界面坐标在
> `src/app/layout.ts` 里用纯函数算（`computeRect` / `insetRect`），**不用 `.ui`、不用组件注册表**。
> 本文件是「这个工程怎么用」的说明书；语法与 API 在仓库文档里，别靠记忆写。

## 先读什么

从本工程目录（`games/<你的游戏名>/`）出发，这些路径能直接打开：

| 文档 | 什么时候读 |
|---|---|
| [`../../docs/START-HERE.md`](../../docs/START-HERE.md) | **第一次进来先读**：从零做一款游戏的流程、三端构建、验收清单。注意它 §3–§6 讲的是「怎么手工补 `.ui` 链」——**本模板不需要**（已经用手写布局） |
| [`../../docs/ENGINE-API.md`](../../docs/ENGINE-API.md) | 查 API 签名：`computeRect` 等锚点布局函数、loop / ads / save / input、平台适配 |
| [`../../docs/ui-syntax.md`](../../docs/ui-syntax.md) | **本模板不用**。哪天想改成声明式界面，换成 `--template iaa-ui` 建的工程再读它 |

## 这个工程的目录约定

```
src/app/layout.ts   界面布局（**改界面主要改这里**）：纯函数，输入屏型 + 安全区 → 输出全部矩形
src/app/state.ts    游戏状态 + 存档结构（纯函数，不碰 canvas、不碰平台）
src/app/game.ts     玩法与渲染：只消费 layout 算好的矩形，不自己算坐标
src/app/deps.ts     runtime 依赖汇聚点（唯一直接 import runtime 的文件）
assets/             正式素材（**会进包**，注意 wx 主包 4MB 红线）
artifacts/          样张 / 原图 / 中间产物（**不进包**）
tools/              真浏览器验证脚本（`verify-platform.mjs` 是平台适配门禁）
```

## 改界面怎么改

**改 `src/app/layout.ts` 的 `computeLayout()`**，不要在 `game.ts` 的 `draw()` 里写坐标。

```ts
// layout.ts 里一个矩形长这样：锚点 + 比例尺寸 + 上下限
const tapButton = computeRect(safe, {
  anchor: at(0.5, 0.42), pivot: at(0.5, 0.5),
  size: ratio(0.56, 0.12), minSize: at(180, 64), maxSize: at(280, 96),
});
```

`game.ts` 只做 `fill(ctx, v.tapButton, …)` / `hitTest(v.tapButton, point)` —— 位置与尺寸都由
`layout.ts` 负责。加一个元素 = 在 `Layout` 接口加字段 + 在 `computeLayout` 里算 + 在 `draw` 里画。

## AI 必须守的几条

1. **布局必须是纯函数**：`computeLayout(input)` 只读入参（屏型、安全区、是否预留 banner），
   输出矩形；不碰 canvas、不读全局状态。这样它能在 Node 里用各种极端屏型单测。
2. **坐标只在 `layout.ts` 里算**：渲染层与命中判定只消费矩形。在 `draw()` 里写死坐标，
   换屏型就会错位，而且单测抓不到。
3. **极端屏型要能过**：模板自带布局测试覆盖 320×480、1000×300 这类比例；改布局后先跑
   `node ../../node_modules/vitest/vitest.mjs run`，越界会直接红。
4. **按能力分支，不写平台名**：判断有没有 banner 用 `platform.can('ad-banner')`，
   不要写 `if (platform.name === 'wechat')` —— 平台差异只允许出现在 `packages/runtime/src/platform/`。
5. **素材进 `assets/` 会进包、样张放 `artifacts/`**。样张塞进 `assets/` 会顶爆微信主包 4MB 红线。
6. **要做平台跳跃 / 物理** → 这套手写布局链不合适，换成 `--template iaa-ui` 的工程，
   物理用法见 `../../docs/START-HERE.md` §8。
7. **不许拿 viewport 自己算带像素的量**：`viewport.width - 24`、`Math.min(vp.width / N, 30)`、
   `Math.max(90, vp.height * 0.16)` 这类写法会被 `pnpm -w lint` 判红（规则 5）。
   要比例就在 `computeRect` 里用 `ratio()`；要上下限用 `minSize` / `maxSize` —— **那就是 clamp**。
   确实必须固定的物理量（触摸目标下限、描边、字号）提到常量文件，
   并在该行用 `// @fixed-layout <原因>` 显式豁免。

## 验收怎么做

```bash
node ../../packages/cli/bin/mg.mjs build --all          # 三端产物进 build/（web / wx / tt）
node ../../node_modules/vitest/vitest.mjs run           # 本工程单测（布局断言 + 真实点击路径 + 存档往返）
node tools/verify-platform.mjs                          # 真浏览器平台门禁：dpr × 视口 × build/dev
```

**截图必须肉眼确认画面内容，不能只读状态。** 「状态全绿、画面全空」已经复现过多次。
每张截图过一遍：背景有颜色 / 按钮可见且位置对 / 数字与状态一致 / 截图尺寸与目标视口一致。
做不了视觉验收就写「视觉验收未做，已用像素统计替代」并给出数字。

## 不要改什么

- **不改 `packages/**`**（引擎源码）和 `templates/**` —— 那是仓库的事，不是这个工程的事。
- 不改 `node_modules/`。只改本工程目录（`games/<游戏名>/`）里的文件。
- 不要把 `verify-platform.mjs` 的断言改松：它是门禁，红了说明适配真坏了。
