# START HERE：从零做一款游戏（gamekit v2）

> 目标：照着抄就能从零跑出「界面 → 三端产物」的闭环。
> **游戏必须建在 `gamekit/games/<name>/`**（`mg create` 拒绝仓库外路径）。
> **所有命令都在仓库根执行**（有 `pnpm-workspace.yaml` 的那层）。
> 仓库根可用：`pnpm mg -- <命令>`（= `node packages/cli/bin/mg.mjs <命令>`）。
> **要做一款完整的游戏（不只是跑通）**：先读 [`GAME-WORKFLOW.md`](GAME-WORKFLOW.md)（PRD、美术清单、手感、验收截图、包体）。
> **写代码前的策划**：先读 [`GAME-PLANNER.md`](GAME-PLANNER.md)（默认轻量 Concept→Top→PRD/ART-BRIEF；完整模式才跑 Architecture/Systems）。空模板在 [`templates/game-planner/`](templates/game-planner/)。
> 本文每个坑都是 **2026-10-21 起实测**撞出来的，报错原文照抄。

## 0. 先决条件

- **Node.js ≥ 22**（与 `package.json` engines / `mg doctor` 一致）；本机有 `pnpm`；仓库已 `pnpm install`。
- 跑真浏览器验收的会话必须是 **danger-full-access**（workspace-write 下 Chrome 启动即自杀）。

## 0.5 策划（写代码前）

新玩法先走 [`GAME-PLANNER.md`](GAME-PLANNER.md)：

1. 拷贝 [`templates/game-planner/`](templates/game-planner/) → `games/<name>/design/`（可先建目录再 `mg create`）。
2. **默认轻量**：填完 `00_concept` + `01_top_design` → 写出 `PRD.md` / `ART-BRIEF.md`。
3. **完整模式**（养成/双循环等）再跑 Architecture / Systems，并按需接 economy TSV、story.tsv。
4. `HANDOFF.md` 门禁勾完再进入下面的「创建游戏」。

## 1. 创建游戏（先选模板）

```bash
# 默认就是 iaa-ui（.ui 界面链：vite.config / ui-registry / env.d.ts / layout / render 都已接好）
pnpm mg -- create my-game
# 等价：node packages/cli/bin/mg.mjs create my-game

# 极简单屏 demo：手写布局老链（也算 verify-platform 门禁的样本）
pnpm mg -- create my-game --template iaa-simple
```

`--template` 就是 `templates/` 下的目录名，新增模板不用改 CLI。**iaa-ui**（默认）界面写在
`ui/home.ui`、组件走注册表（**34 个现成件 = 9 个内置业务件 + 25 个通用组件**）、命中用 `pickHit`，开箱 **暖木纹** 皮肤（另有清爽玻璃，见模板 `docs/SKINS.md`）；
**iaa-simple** 是手写 `computeLayout`，没有 `vite.config.ts` / `ui-registry.ts` / `ui/` ——
选它还想用 `.ui` 就得照本文 §3–§6 手工补一遍。

`create` 成功后会打印可复制命令，例如：
`cd games/my-game && node ../../packages/cli/bin/mg.mjs dev` 或 `pnpm mg -- dev --root games/my-game`。

## 2. 改 `game.config.json`

```json
{
  "design": { "width": 390, "height": 844 },
  "fit": "fill",
  "title": "我的游戏",
  "assetsDir": "assets",
  "subpackages": {}
}
```

`fit` 取 `contain` / `fill` / `height`（模板默认 `contain`）。`design` 与 `fit` 走 `virtual:mg-config`，
是**唯一真源** —— `main.ts` 不用再写一遍；改完跑一次 `build --all` 确认还是绿的。

## 3. 组件注册表：**iaa-ui 已自带（不用动）；iaa-simple 没有，必须自建**

**用 iaa-ui 模板的话这一节可以直接跳过** —— 它的 `src/app/ui-registry.ts` 已经写好，而且已经
遍历注册了 `WIDGET_COMPONENTS`（`createRegistry()` 出来是 **34 个组件**：9 个内置业务件 + 25 个通用件）。
`vite.config.ts` 与运行时 `bindComponents` 都从这一个工厂取，不用你操心。

只有 `iaa-simple`（或想从零搭）才需要新建 `src/app/ui-registry.ts`：

```ts
import { createBuiltinRegistry, WIDGET_COMPONENTS } from '@mg/runtime';
import type { ComponentRegistry } from '@mg/runtime';

/** 构建期（vite.config.ts）与运行时（bindComponents）必须是同一份。 */
export const createRegistry = (): ComponentRegistry => {
  const registry = createBuiltinRegistry();
  for (const comp of WIDGET_COMPONENTS) registry.register(comp);
  return registry;
};
```

**`createBuiltinRegistry()` 只给 9 个内置业务件**（`packages/runtime/src/core/ui/builtin.ts` 的
`BUILTIN_COMPONENTS`）：`primaryButton` / `secondaryButton` / `coinBadge` / `statusText` /
`pause` / `parcelGrid` / `infoPanel` / `card0` / `card1`。
要用通用组件（`progress` / `panel` / `label` / `button` / `input` / `list` / `grid` / `scroll` /
`slider` / `tabs` / `segmented` / `keypad` / `carousel` / `scrollbar` / `toast` / `switch` /
`checkbox` / `radio` / `divider` / `badge` / `icon` / `avatar` / `chatBubble` / `chatList` /
`chatComposer` 共 **25 个**，其中 `input` / `grid` /
`scroll` 是 T31/T34 新增的），**必须像上面那样遍历注册 `WIDGET_COMPONENTS`**，否则构建直接失败：

```
ui/home.ui:17: 未知组件 'progress'，已注册的有：primaryButton / secondaryButton / coinBadge /
statusText / pause / parcelGrid / infoPanel / card0 / card1
```

> `.ui` 里 `put` 的第一个词是**组件名**，不能自造；一个界面里同名组件只能出现一次（`rects` 以名为键），
> 需要两个按钮就注册两个名字。
> `tapTarget` / `scorePanel` 是 `games/ui-demo` 的**自定义件**，不在内置 9 个里 —— 新游戏里写它们会报
> 「未知组件」。

## 4. 写界面 `ui/home.ui`

```
# 语法真源：docs/ui-syntax.md（v0.6）
layer base

region head top 20% column justify center align stretch pad-x 8%
put panel size fill style fillColor="#22303c"

region body fill column justify center align stretch pad-x 8% gap 4%
put progress size fixed 16 cross 100% style value=40 max=100 radius=8
put label size fixed 28 style text="我的游戏" fontSize=18 align=center

region footer bottom 20% column justify end align stretch pad-x 8%
put button size fixed 56 style text="开始" state=normal
```

写完先离线看布局（不需要注册表；但 `size auto` 会报 0×0，见坑 6）；可抄 `games/ui-demo/tools/verify-ui.mjs`。

### 顶部 HUD 必须避开系统胶囊

微信 / 抖音小游戏右上角有一个系统按钮（胶囊 `···` + `○`），它**不在 `safeArea` 里**，会压住顶部 HUD。
读 `platform.screen.menuButton`（`{x,y,w,h} | undefined`，画布逻辑坐标），在 `layout()` **之后**把 HUD 层
矩形整体下移 `menuButton.y + menuButton.h + 8`——**别在 `.ui` 里写胶囊坐标**（它随机型变）。
web / 老基础库是 `undefined`（走零偏移）；**微信开发者工具里这个 API 返回空对象 `{}`，于是
`menuButton` 也是 `undefined`、HUD 不下移，必须真机验证**。两种做法、硬规则与 20 行参考实现见
`ui-authoring` skill 的「顶部系统 UI（胶囊）避让」一节，实现在 `games/platformer/src/app/ui.ts`
（`hudOffsetFor` / `shiftRects`）。浮层不受影响：胶囊只压顶部。

## 5. 挂 `.ui` 编译链 —— 建 `vite.config.ts`（iaa-ui 已自带）

```ts
import { defineConfig } from 'vite';
import { optionsFromRegistry, uiPlugin } from '../../packages/ui-plugin/src/index';
import { createRegistry } from './src/app/ui-registry';

export default defineConfig({
  plugins: [uiPlugin(optionsFromRegistry(createRegistry()))],
});
```

不挂它直接 import `.ui`，构建报的是**语法错误**（不是「不支持 .ui」）：

```
mg build: web 构建失败：Build failed with 1 error:
[PARSE_ERROR] Invalid Character ` `
  ╭─[ ui/home.ui:1:2 ]
```

## 6. 加 `.ui` 的类型声明 —— `src/env.d.ts`（iaa-ui 已自带）

```ts
declare module '*.ui' {
  import type { LayoutSpec } from '../../../packages/runtime/src/core/ui/layout';
  const ui: {
    readonly name: string;
    readonly spec: LayoutSpec;
    readonly components: readonly string[];
    readonly source: string;
    readonly lines: Readonly<Record<string, number>>;
  };
  export default ui;
}
```

不加报 `error TS2307: Cannot find module '../ui/home.ui' or its corresponding type declarations.`
**`mg build` 不做类型检查**，所以「构建绿 + tsc 红」是正常组合，别被构建成功骗了。

## 7. 接进布局与绘制

`src/app/layout.ts` 把 `.ui` 编译产物接上（与 ui-demo 同构）：

```ts
import { bindComponents, layout } from './deps';
import homeUi from '../../ui/home.ui';
import { createRegistry } from './ui-registry';

const registry = createRegistry(); // 挂在 engine 实例上，别做模块级单例

export const createLayoutEngine = () => ({
  registry,
  compute(viewport: { width: number; height: number }) {
    const bound = bindComponents(homeUi.spec, { registry, env: { viewport, data: {} } });
    const solved = layout(bound.spec, viewport);
    return { rects: solved.rects, paintOrder: solved.paintOrder, meta: solved.meta, errors: [...bound.errors, ...solved.errors] };
  },
});
```

`src/app/render.ts` 按 **`paintOrder` 正序**画，命中用 **`pickHit`**（逆序、block 吃掉）：

```ts
import { pickHit } from './deps';

for (const name of view.paintOrder) {
  view.components[name]?.draw(ctx, view.rects[name], view.props[name] ?? {}, deps); // 绘制：正序
}
const hit = pickHit(entries, point);   // 命中：逆序
if (hit === null) return;              // 空白
if (hit.hit === 'block') return;       // 遮罩吃掉，不往下找
if (hit.hit === 'self' && ACTION_OF[current][hit.name]) state = reduce(state, action);
```

完整的布局 / 状态 / 渲染 / 交互分层照抄 `games/ui-demo/src/app/`（6 个文件，每个 ≤300 行）。

### 要在 canvas 上自绘的东西，区域也得由 `.ui` 给

盘面、棋盘、摇杆、血条这类必须自己画的内容，**不要拿 `viewport` 自己减边距**：
先在 `.ui` 里留一个空 `region` 当容器（例 `region boardArea fill`），运行期从
`solved.rects.boardArea` 取矩形，内部只按比例均分格子。这样换屏型不用改任何数字。

```ts
const area = view.rects.boardArea;                        // .ui 求解出来的区域
const [play, slotRow, pool, toolBar] = splitRows(area, [0.6, 0.1, 0.25, 0.05]);
const cells = gridOf(play, GRID, GRID);                   // 256 个格子矩形，行优先
```

`splitRows` / `splitCols` / `gridOf` / `findOverlaps` 在 `core/ui/split.ts`（已从 `core/ui` 转出）。
比例按总和归一化，所以权重写法也成立（`[12,2,5,1]` 等价于上面的小数）；末格自动收口到边界。
**别在自绘代码里再出现 `viewport.width - 24` 这种式子** —— `pnpm -w lint` 规则 5 会拦。
布局重叠要写成断言（`findOverlaps(...) === []`），不要靠肉眼看截图。

`pnpm -w lint` 的规则 5 会拦这些写法（实测《拼豆工坊》因此把顶部 HUD 带入和底部色块行画歪）：
`viewport.width - 24`、`Math.min(vp.width - 24 / N, 30)`、`Math.max(90, vp.height * 0.16)`。
确实必须固定的物理量（触摸目标 44、描边 1–2、字号）提到常量文件，行尾加
`// @fixed-layout <原因>` 显式豁免。

## 8. 数值 / 存档 / 剧情（可选）

| 能力 | 包 / 文档 |
|---|---|
| 配表 TSV、simulate、compile | [`docs/ECONOMY-SAVE.md`](ECONOMY-SAVE.md) · `simulate.mjs` / `compile.mjs --table <dir>` |
| `createSave` + `lastSeenAt` | 同上 §4 |
| 分支对话（扁平 `.story.tsv`） | [`docs/STORY.md`](STORY.md) · `lint-story.mjs packages/story/examples/demo.story.tsv` |

## 9. 加物理（可选，用到才装）

物理是**独立包** `@mg/physics-2d`（`packages/physics-2d/`）——只有 import 它才进包。
实操指南见 [`docs/PHYSICS-GUIDE.md`](PHYSICS-GUIDE.md)；契约与 API 表见 `docs/ENGINE-API.md` 的「packages/physics-2d」段。
**物理只用于「真的需要模拟」的东西**（重力、堆叠、弹射、被撞飞）。

### 官方示例与最小抄作业路径

可玩样例：**[`games/platformer`](../games/platformer/)**（横版跳跃；README 已标明是 physics-2d 官方示例，不是 iaa-simple）。

| 步骤 | 打开 |
|---|---|
| 建世界 | [`game.ts`](../games/platformer/src/app/game.ts) ≈L43 · [`deps.ts`](../games/platformer/src/app/deps.ts) |
| static 地面 | 同 `game.ts` ≈L49–54 · 数据 [`level.ts`](../games/platformer/src/app/level.ts) `SOLIDS` |
| dynamic 玩家 | 同 `game.ts` ≈L55–59（务必 `fixedRotation: true`） |
| 跳跃 `setVelocity` | `tryJump` ≈L110–114；每帧移动 + `step` ≈L151–161 |

更细的表与验收清单见 [`PHYSICS-GUIDE.md`](PHYSICS-GUIDE.md)。

### 最小可跑示例：方块落到地面

```ts
import { createPhysicsWorld } from '../../../../packages/physics-2d/src/index';

const physics = createPhysicsWorld({ gravity: { x: 0, y: 1800 } });   // 像素/秒²，不是米
// x / y 是刚体的**质心**：地面矩形 (15, 680, 360, 40) 要写成 (15+180, 680+20) = (195, 700)
physics.addBody({ type: 'static', shape: { kind: 'box', w: 360, h: 40 }, x: 195, y: 700, userData: 'ground' });
const box = physics.addBody({
  type: 'dynamic', shape: { kind: 'box', w: 48, h: 48 }, x: 195, y: 120, fixedRotation: true, userData: 'box',
});

// 快照里没有尺寸/形状（坑 7）——渲染要自己记一份
const SIZE: Record<string, { w: number; h: number; color: string }> = {
  ground: { w: 360, h: 40, color: '#2b4a52' },
  box: { w: 48, h: 48, color: '#e67e22' },
};

export const stepPhysics = (dt: number): void => physics.step(dt);   // 每帧传真实 dt
export const drawPhysics = (ctx: CanvasRenderingContext2D): void => {
  for (const pose of physics.snapshot()) {
    const { w, h, color } = SIZE[pose.userData as string]!;
    ctx.fillStyle = color;
    ctx.fillRect(pose.x - w / 2, pose.y - h / 2, w, h);   // pose 是质心，画左上角要减半
  }
};
// 落地判据：physics.poseOf(box)!.y 会停在 654.5 左右
// （地面顶 = 700−20 = 680，方块半高 24 → 理论 656；planck 允许约 1.5px 穿透 slop，所以落在 654.5）
```

### 这七个坑都真实踩过

1. **像素当米用，跳跃速度会被钳掉 5 倍以上**：所有常量按**像素**写（`gravity` 也是像素/秒²）。
   封装内部有 `PIXELS_PER_UNIT = 100` 换算；但如果你按 Box2D 教程写米口径（`gravity: 18`、
   `jumpSpeed: 6.2`），planck 的 `maxTranslation = 2 单位/步` 会把 620px/s 钳成约 120px/s，
   跳跃高度从 ~107px 掉到个位数像素 —— 表现就是「怎么调都跳不高」。
   platformer 的正确值是 `gravity 1800` + `jumpSpeed 620`。
2. **kinematic 与 static 不产生碰撞**（Box2D 语义）：平台跳跃的地面用 `static`、玩家必须
   `dynamic`；拿 `kinematic` 当玩家会直接穿过地面。
3. **角色几乎都要 `fixedRotation: true`**：dynamic 体这个字段**默认 false**，不锁旋转会被撞得打转。
4. **`onContact` 是「接触开始」不是「持续接触」**：踩怪判定要么在事件里读 `vy`，要么每帧用快照
   自己算。platformer 用的是后者（脚底落在敌人上部 60% 且 `pose.vy > 0`），因为事件只来一次。
5. **休眠与剔除**：`setActive(false)` 的刚体不参与步进 —— 100 个离屏刚体 `0.0125ms/step` vs
   100 个活跃 `0.9745ms/step`（**78 倍**）；唤醒时位姿原样保留，不用手工冻结状态。
6. **物理是可选包**：只有 import 了才进包；platformer 的 222 KB 里约 190 KB 是 planck + 封装。
   不用物理的游戏一点都不付。
7. **快照里没有尺寸 / 形状**：`BodyPose` 只有 `id / x / y / angle / vx / vy / userData`。
   渲染要知道画多大，得自己按 `userData` 存尺寸表（或把尺寸塞进 `userData`）。

### 什么时候别用物理

**敌人巡逻、金币碰撞这类纯逻辑判定不要挂刚体**。platformer 的敌人就是纯逻辑巡逻（自己走、自己
判边界），只有地形和玩家在物理世界里。给纯逻辑挂刚体会同时付出三样代价：包体、确定性和调试成本。

## 10. 三端构建

```powershell
cd games/my-game
node ../../packages/cli/bin/mg.mjs build --all
```

产物 `build/web`（6 个文件）、`build/wx`、`build/tt`（各 7-8 个文件）；
包体打印形如 `mg 包体（wx）：主包 57.4 KB / 合计 57.4 KB，7 个文件`。

## 11. 验收

| 层级 | 怎么跑 |
|---|---|
| 界面层（离线） | 抄 `games/ui-demo/tools/verify-ui.mjs`（`ui.check` + 注册表校验 + 两视口布局） |
| 运行时 / 交互（真机） | 抄 `games/ui-demo/tools/verify-runtime.mjs`（MCP + 真实点击）、`verify-input.mjs`（puppeteer 直接 CDP） |
| 平台适配门禁 | `node templates/iaa-simple/tools/verify-platform.mjs`（dpr×视口×build/dev，98 条） |
| 单测 | `cd games/my-game && node ../../node_modules/vitest/vitest.mjs run`（根 `pnpm -w test` **不含 games/**） |

### 验收硬规则：截图必须肉眼确认画面内容，不能只读状态

「状态全绿、画面全空」已经复现过三次（最近一次：分数 0→10、剩余 36→34 都推进了，**棋盘一格都没画出来**）。
数据断言只能证明逻辑联通，证明不了渲染真的发生过。所以每轮验收必须有这一步：**打开截图，逐一确认
「该有的元素真的在画面上」**。

每张截图过一遍这份清单：

- 背景 / 面板：整块区域有颜色，不是白底；
- 每个可点元素：看得见、位置对、文字没溢出也没缺字；
- 数字 / 文案：与状态一致（分数、倒计时、按钮文字）；
- 视口：截图尺寸与目标一致（390×844 就是 390×844，不是被浏览器窗口拉过的 512×746）；
- 拿不准就 `read_image` 再看一遍，不要用「状态是对的」代替看画面。

**没有视觉能力的 Agent 怎么办**（`read_image` 会报 `model ... does not declare image input`）：
不要用状态断言顶替画面验收，改用 CDP 像素统计 —— 在棋盘 / 列表矩形内 `getImageData`，断言
**唯一主色 ≥ 4、非背景占比 > 50%、横向颜色切换 ≥ 6**（多行采样取中位数，单行可能正好压在
间隙上）。并在报告里**明确写「视觉验收未做，已用像素统计替代」**，不要默认读者知道你看见没看见。

## 12. 实测会卡住的 9 个坑

1. **`.ui` 必须自己挂 `uiPlugin`**：不挂报 `[PARSE_ERROR] Invalid Character`，看着像语法写错。
2. **`createBuiltinRegistry()` 只有 9 个业务件**：iaa-ui 的 `ui-registry.ts` **已经遍历注册好 34 个**，
   别重复改；iaa-simple / 从零搭的才需要自己补 `WIDGET_COMPONENTS`（§3）。
3. **模板没有 `src/env.d.ts`**：缺了 `tsc` 报 TS2307，而 `mg build` 照样绿。
4. **`import` 了 `.ui` 但没喂给 `layout()`**：会被 tree-shake，**产物大小一点不变、也不报错** ——
   看起来「接好了」其实界面完全没生效。判据是「构建期注册表校验有没有真的跑到 `.ui`」。
5. **`mg` 不是全局命令**：仓库根用 `pnpm mg -- <命令>` 或 `node packages/cli/bin/mg.mjs <命令>`；游戏目录内可用模板 scripts（`pnpm dev`）。
6. **`size auto` 需要注册表**：离线 `ui.check` 已接与构建相同的默认注册表（34 个组件）；若仍 0×0，检查是否漏注册自定义组件。
7. **别照抄 ui-demo 的 `vite.config.ts`**：它为端到端验收关掉了 `watch` / `hmr`（改代码要重启 dev server
   才生效）。日常开发用 §5 的最小配置。
8. **`mg build` 会先 typecheck，并检查每个 `ui/*.ui` 都被 import**：漏接的 `.ui` 会在构建结束时报错；
   可用 `--skip-typecheck` 跳过类型检查（不推荐）。
9. **数据组件优先单通道**：把 data 传给 `layout.compute(..., data)`，它会挂在 `ScreenLayout.data` 上，
   绘制期自动注入 `DrawDeps.data`。若仍分两边传，漏键会走 `resolveUiData` 报错。
   详见 `docs/ui-syntax.md` §12。
