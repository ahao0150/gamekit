# gamekit 接口设计 v0.1

> ⚠ **本文已过期，仅历史参考。** 这是 v1 阶段（2026-10-19）的接口设计稿，状态停在
> 「待主导者确认」。v2 已改用 [PLAN-v2.md](PLAN-v2.md) 作为方案、[CONVENTIONS.md](CONVENTIONS.md)
> 作为工程约定、各包 `**/contract.ts` 作为冻结契约。**不要照本文写新代码**——
> 包结构、UI 层、构建产物都已变化（例如 UI 层现在是 `.ui` 语言 + region/put 求解器，
> 不是本文描述的 Widget 锚点布局）。
>
> 保留原因：第 2 节「同一份代码被复制 9 次」的调研数据与第 3 节七条铁律仍是有效背景。

> 原状态（v1 时代）：待主导者确认。确认后本文件的「契约清单」与 `packages/runtime/src/**/contract.ts` 冻结，开始由 Bot 实现。

## 0. 一句话

一套 TypeScript 源码，构建出 web / 微信小游戏 / 抖音小游戏。**主要读者是 AI（Bot），人只做验收。**

这句话决定了后面所有设计取向：能让 AI 少猜、少读、少记的东西优先；能让 AI 一次改对的东西优先；人类手感的编辑器优先度最低。

## 1. 明确不做什么

- **不做场景编辑器**。不学 Cocos / Laya 的编辑器路线：场景是代码和 JSON，不是 `.scene` 二进制。
- **不做通用引擎**。不做 ECS 全家桶、不做 3D、不做通用物理。2D + 横板/俯视 + IAA 小游戏。
- **不做老项目迁移**。wanli 与现有 8 款仓库继续用各自的 `build.js`，kit 不反向依赖、不共享代码。
- **不做模块级 HMR**。游戏主循环热替换是伪需求，web 端要的是「保存即刷新」。

## 2. 依据：同一份代码被复制了 9 次

| 仓库 | `src/platform.js` | 备注 |
|---|---|---|
| caihong-daoshui | 7177 B | 与下面 4 个**字节完全一致** |
| iaa-game | 7177 B | 一致 |
| minigame-5 | 7177 B | 一致 |
| nuoche-chuku | 7177 B | 一致 |
| xiaoxiao-guoyuan | 7177 B | 一致 |
| minigame-4 | 6094 B | 早期版本 |
| minigame-3 | 5964 B | 早期版本 |
| minigame-2 | 4891 B | 早期版本 |
| minigame-1 | 3377 B | 早期版本 |

9 款游戏的 `src/` 合计约 73 万字节，全部是同一套「手写文件顺序 + 全局命名空间 + 自研 build.js」结构。

所以 kit 的最小价值不是「更先进的引擎」，而是两件事：

1. 把 9 份 `platform.js` 和 9 份 `build.js` 收敛成 **1 份 runtime + 1 个插件**；
2. 给出一份**可扩展的契约**，让下一个平台（支付宝/快手/QQ/百度）只加一个实现文件。

## 3. AI 友好七条铁律

这七条是硬约束，评审时逐条对照。违反任何一条就是打回。

1. **契约先行**：任何跨模块调用都必须先有 `.ts` interface。interface 是可编译的规范，markdown 只写「为什么」。禁止「先写实现，接口看着办」。
2. **一层一职责**：一个文件只承担一个概念，单文件 ≤ 300 行（数据文件除外）。文件超限说明抽象错了。
3. **无全局可变状态**：不得有 `var S = {...}` 这种全局大对象。所有状态挂在 `Game` 实例上，通过参数传递。
4. **数据 / 逻辑 / 渲染三分**：
   - 数据 = 纯 JSON / 纯对象字面量，无函数、无引用（AI 生成最稳）；
   - 逻辑 = 纯函数，输入旧状态输出新状态，可单测，不碰 canvas；
   - 渲染 = 只读状态、只画，不做判定。
5. **平台差异只允许存在于 `platform/`**：业务代码里出现 `wx.` / `tt.` / `window.` / `navigator.` 一律打回，只能按能力探测。
6. **禁魔法**：不用装饰器、不用隐式依赖注入、类继承不超过 2 层、不写「猜不到的全局副作用」。
7. **契约配测试**：每条公开 API 至少 1 条契约测试；纯函数（布局、经济、状态迁移）必须 100% 可测且不依赖 DOM。

## 4. 分层

```
游戏业务 app/            ← 每款游戏自己的玩法，只消费 runtime 公开 API
    ↑
runtime                  ← 平台无关能力 + 平台适配
    ├── core/            ← loop stage input assets audio ads save ui render
    └── platform/        ← contract.ts（契约）+ web / wechat / douyin 实现
```

依赖方向单向：`app → runtime/core → runtime/platform`。**core 不许反向依赖 app，platform 不许 import core**。

## 5. 平台适配层：可扩展是硬指标

核心思想：**业务代码永远不知道自己跑在哪个平台**，只问「你有没有这个能力」。

```ts
if (game.platform.can('ad-rewarded')) { ... }
```

而不是：

```ts
if (typeof wx !== 'undefined') { ... }   // 禁止
```

新增平台 = 新增一个目录实现 `PlatformAdapter` + 调一次 `registerPlatform()`。core 和业务代码零改动。

能力清单（`Capability`）目前定为：
`pointer` / `touch-multi` / `keyboard` / `safe-area` / `audio` / `storage` /
`ad-banner` / `ad-interstitial` / `ad-rewarded` / `share` / `vibrate` / `subpackage` / `wasm`

可选能力用可选属性表达（`ads?`、`share?`、`loadSubpackage?`），实现方没能力就不实现，业务侧必须先 `can()` 再调。

## 6. runtime 公开契约清单

| 契约 | 作用 | 关键点 |
|---|---|---|
| `createGame(opts): Game` | 唯一入口 | 返回实例，无全局状态 |
| `Game.loop` | 固定步长更新 + 渲染 | `update(dt)` 固定 1/60，`render(alpha)` 插值 |
| `Game.stage` | 场景/界面栈 | `push/pop/replace`，每层有 `enter/exit/update/render` |
| `Game.input` | 统一输入 | 指针/触摸/键盘统一成 `Action`，平台无关 |
| `Game.assets` | 资源加载 | 平台 `loadImage` + 缓存 + 失败回落 + 进度 |
| `Game.audio` | 音效/BGM | 三端差异封装，web 需用户手势解锁 |
| `Game.ads` | 广告三件套 | banner/插屏/激励，无能力时为 no-op 并返回 `false` |
| `Game.save` | 存档 | schema 版本 + 迁移 + 原子写 + 防脏档 |
| `Game.ui` | Widget 锚点布局 | 布局是**纯函数** `computeRect(parent, props)`，可脱离 canvas 单测 |
| `Game.render` | 2D 绘制薄封装 | 九宫格、文本、精灵、图层；只画不判 |
| `Game.use(system)` | 扩展机制 | 物理等一切非必需能力都走这里，见 6.1 |

设计取舍：`ui` 与 `render` 分开，是因为布局失败（HUD 越界）是过往最痛的 bug，必须能纯函数断言。

### 6.1 扩展机制：物理这类能力怎么进来

**core 不内置物理。** 物理、粒子、寻路、回放这类「不是每款游戏都要」的能力，一律实现成 `System`，用 `game.use(system)` 挂到循环上（契约见 `core/extension.ts`）。

这样做的三个结果：

1. 不用物理的游戏，物理代码不进包（按需 import + tree-shake）；
2. 换物理实现不动 core、不动业务代码；
3. core 永远不知道物理存在。

物理对外的契约是 `PhysicsWorld`：只输出 `x / y / angle / 速度` 与碰撞事件，**不负责画**。渲染层自己去 world 读状态来画，所以换物理实现时渲染一行都不用改。

物理实现候选（第一版只冻结契约，不实现）：

| 方案 | 依赖形态 | 三端适配 | 体积 | 判断 |
|---|---|---|---|---|
| [planck.js](https://github.com/piqnt/planck.js) | 纯 JS，Box2D 移植 | 零适配 | ~300KB min | **首选** |
| box2d-wasm | WASM | 需要平台 WASM 加载器 | ~200KB | 性能备选 |
| matter-js | 纯 JS，非 Box2D API | 零适配 | ~90KB min | 更轻，但关节与 CCD 弱 |

首选纯 JS 的理由：微信有 [WXWebAssembly](https://developers.weixin.qq.com/minigame/dev/guide/performance/perf-webassembly.html)、抖音有 [TTWebAssembly](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/framework/basic-function/web-assembly)，WASM 两端都支持，但加载 API 各不同、不能用 `fetch`。平台契约里已预留 `wasm?` 能力，将来接 box2d-wasm 不需要改架构；但第一版不引入这个不确定性，先用纯 JS。

物理是**可选包**（`@mg/physics-*`），不进主包。

## 7. 构建链（Vite）

`@mg/vite` 插件只做三件事，不许长成第二个 build.js（上限 400 行）：

1. **产物**：`web` 出 `index.html + game.[hash].js`；`wx`/`tt` 出单文件 `game.js` + `game.json` + `project.config.json`。
2. **资源**：沿用「源目录择优 → 打进包 → 写清单」的管线，`webp/png` 同名择优、分包映射、清单注入。
3. **检查**：包体红线（主包 4MB）、资源缺失、清单与产物一致性。

三条硬约束：

- **资源绝不交给 Vite 处理**。小游戏没有 `new URL`、没有 `fetch`，Vite 的 asset 依赖机制必挂。资源走 `publicDir` + 插件写清单。
- **禁止动态 `import()` 与 code splitting**。小游戏是单文件 + 手工分包，两套模型不混。
- **wx/tt 开发只能 `build --watch`**，没有 HMR；web 端才有 dev server。

## 8. CLI

```
mg create <name> [--template iaa-simple]   从模板建项目
mg dev                                     web 开发（dev server + 保存刷新）
mg dev --host 0.0.0.0                      监听全部网卡，局域网设备可预览
mg dev --target wx|tt                      构建监听，配合开发者工具
mg build [--target web|wx|tt] [--all]      构建
mg check                                   包体红线 / 资源清单 / 契约一致性
mg pack                                    美术资源压缩（webp）与图集
mg doctor                                  环境与配置体检
```

## 9. 什么叫「接口稳定」

这一版设计要过下面五条才算稳定，否则继续改：

1. `packages/runtime/src/**/contract.ts` 能通过 `tsc --noEmit`，且 `pnpm --filter runtime test` 全绿；
2. 用**一个 300 行以内的验证 demo**（小球跑动 + 一个按钮 + 一次存档 + 一个 banner 占位）打出三端，web 与微信/抖音开发者工具模拟器都能跑；
3. 平台契约的「新增一个平台」有书面步骤，按步骤能在不碰 core 的情况下加出第 4 个实现（用 mock 平台验证即可）；
4. 每个 core 契约有至少 1 条契约测试；ui 布局是纯函数且有越界断言；
5. `AGENTS.md` 能让一个新 Bot 在不问人的情况下加出一个新界面。

## 10. 分工（待确认后执行）

| 阶段 | 谁 | 产出 |
|---|---|---|
| 接口设计（本文件 + contract.ts） | 维护者 | 冻结契约 |
| runtime platform 三实现 | AI | web / wechat / douyin |
| runtime core（loop/stage/input/assets/save/ui/render） | AI | 契约实现 + 测试 |
| vite 插件 + CLI | AI | 三端产物 + 命令 |
| 验证 demo + 三端实跑 | 验收 | 三端截图 + 测试报告 |

验收标准与卡点由 维护者 定，Bot 之间不互相验收。
