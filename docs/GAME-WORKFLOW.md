# 做一款「能上线、不难看」的游戏：完整工作流（GAME-WORKFLOW）

> 适用于任何 AI / 团队用 gamekit 从零做一款 H5 / 小游戏。自包含、与工具无关。
> 语法与 API 细节仍以 [`START-HERE.md`](START-HERE.md)、[`ui-syntax.md`](ui-syntax.md)、
> [`ENGINE-API.md`](ENGINE-API.md) 为准；本文只管**顺序与验收标准**。
> 实战样例：`games/yunduan-dieta/`（云端叠塔）。

**一句话流程：策划（推荐）→ PRD → 程序占位可玩版（同时并行出美术）→ 接美术 → 手感 → 验收截图自评 → 包体 → 部署。**
任何一步没过，不要进入下一步，更不要直接交「灰盒子」原型。

---

## 0. 策划（写代码前，推荐）

在写 `PRD.md` / `mg create` 之前，用策划流程把概念和循环钉死：

→ 总览与门禁：[**GAME-PLANNER.md**](GAME-PLANNER.md)  
→ 空模板：[`templates/game-planner/`](templates/game-planner/)

| 模式 | 做法 |
|---|---|
| **轻量（默认）** | `00_concept` → `01_top_design` → 直接产出 `PRD.md` + `ART-BRIEF.md` |
| **完整** | 再跑 `02_architecture` → `03_systems`；需要时接 `@mg/economy` TSV、`@mg/story` `.story.tsv` |

未过策划出门闸门（见 GAME-PLANNER），不要开始 §2 的占位实现。

---

## 1. 先写 PRD（`games/<name>/PRD.md`）

写代码前先落一页 PRD，篇幅一屏以内。必须包含：

| 段落 | 要写清楚的 |
|---|---|
| 一句话 | 屏幕方向（竖屏/横屏）+ 玩家做什么 + 爽点 |
| 核心循环 | 玩家每一步操作 → 系统反馈，编号列出 |
| 失败条件 | 什么时候结束；有无复活 |
| 计分 | 基础分、奖励分（连击等）、最高分是否本地存档 |
| 难度曲线 | 什么随进度变化（速度 / 数量），上限是多少 |
| 广告位 | 位置与触发（如结算页激励复活、首页横幅）。**所有占位广告的文案统一写「测试广告位」**，不接真实广告 / 支付 SDK |
| 界面 | 每个界面一行：首页 / 游戏 / 结算 …… 上面有什么 |
| 手感与反馈 | 见 §4 清单，挑本作要用的 |
| 美术清单 | 见 §3，文件名与尺寸 |
| 不做（scope cut） | 明确本版**不做**的：音效、排行榜、商店…… 防止范围膨胀 |

## 2. 先做程序占位的可玩版（美术并行）

### 2.1 建项目与安装依赖

1. `pnpm mg create <name>`（默认 iaa-ui 模板，自带暖木纹 / 玻璃皮肤，见模板 `docs/SKINS.md`）。
2. **建完回到仓库根跑一次 `pnpm install`**。新游戏会让 `pnpm-workspace.yaml` 的 importer 多一个，
   `pnpm-lock.yaml` 随之变化；这个改动必须随本次提交（否则别人 / CI 装依赖会锁文件不一致或失败）。
3. 每个界面一个 `ui/*.ui`：按钮、标题、面板、HUD 用 `.ui` 占位拿矩形；整屏玩法区留一个空 region，
   运行期从 `rects` 取矩形自绘。界面「可点组件 → 动作」放 `state.ts` 的 `ACTION_OF`。
4. 核心规则写成**纯模块**（如 `src/app/<玩法>.ts`）：不碰 canvas / 平台，坐标用归一化单位
   （例如「舞台宽 = 1」），渲染层再乘矩形尺寸 → 换屏型不改数字，也方便单测。
5. 占位图形也要好看：渐变 + 圆角 + 高光条 + 描边 + 投影，配色取皮肤主题色系。
   **禁止纯灰矩形 / 默认蓝按钮**。按钮、面板沿用皮肤或自绘同风格（如木纹）。
6. **美术同时开工**（另一个人 / 另一个进程），出图写进 `assets/art/`。
7. **缺图回落加载**：先读构建资源清单（`virtual:mg-manifest`，构建期扫描 `assets/` 生成），
   只加载清单里真实存在的 key；成功就用图，缺失 / 失败（`null` / 抛错）就继续用程序绘制。
   游戏任何时候都可玩，美术到一张亮一张。**不要按写死的文件路径盲加载**——不存在的图会 404，
   直接进 `console.error`，验收脚本会判红。

```ts
// src/app/art.ts 示意
import { manifest } from 'virtual:mg-manifest';

export const ART_KEYS = ['bg', 'block_1', 'cover', 'btn_start'] as const;

// 清单 key 约定：assets/art/bg.png → art/bg
export const loadArt = async (platform) => {
  const book = {};
  await Promise.all(ART_KEYS.map(async (key) => {
    const paths = manifest[`art/${key}`];
    const src = Array.isArray(paths) ? paths.find((path) => typeof path === 'string') : undefined;
    if (src === undefined) return; // 清单里没有：不请求，直接走程序绘制
    try {
      const img = await platform.loadImage(src);
      if (img !== null && img.width > 0) book[key] = img;
    } catch { /* 有清单但加载失败：同样回落程序绘制 */ }
  }));
  return book;
};
```

### 2.2 自定义组件注册：编译期与运行期同一份声明

`.ui` 里用自定义组件时，**构建期编译选项**和**运行期组件注册表**必须认识同一批名字 / props。
写法固定为：

- `src/app/ui-spec.ts`：只放组件名与 props 类型（纯数据，不 import 任何 runtime）；
- `src/app/ui-options.ts`：从 runtime 的**具体子模块**组装 `UI_COMPILE_OPTIONS`；
- `vite.config.ts` 和 `vitest.config.ts` 都 `import { UI_COMPILE_OPTIONS } from './src/app/ui-options'`，
  分别交给 `uiPlugin(UI_COMPILE_OPTIONS)`。

```ts
// src/app/ui-options.ts —— 注意：全部走具体子模块，不 import '@mg/runtime' 总入口
import { optionsFromRegistry } from '../../../../packages/ui-plugin/src/index';
import type { CompileOptions } from '../../../../packages/ui-plugin/src/index';
import { createWidgetRegistry } from '../../../../packages/runtime/src/core/ui/widgets/index';
import { CUSTOM_UI_SPEC } from './ui-spec';

export const UI_COMPILE_OPTIONS: CompileOptions = (() => {
  const base = optionsFromRegistry(createWidgetRegistry());
  const componentProps: Record<string, readonly string[]> = { ...base.componentProps };
  for (const [name, props] of Object.entries(CUSTOM_UI_SPEC)) componentProps[name] = Object.keys(props);
  return {
    knownComponents: [...(base.knownComponents ?? []), ...Object.keys(CUSTOM_UI_SPEC)],
    componentProps,
  };
})();
```

```ts
// vite.config.ts / vitest.config.ts 的关键两行
import { uiPlugin } from '../../packages/ui-plugin/src/index';
import { UI_COMPILE_OPTIONS } from './src/app/ui-options';

export default defineConfig({ plugins: [uiPlugin(UI_COMPILE_OPTIONS)] /* … */ });
```

**为什么不能从 `@mg/runtime` 总入口 import**：`vite.config.ts` / `vitest.config.ts` 由 Node 原生 ESM
加载（不走 Vite 的 alias 与打包），总入口内部是无扩展名的相对导入，Node 会直接解析失败。
运行期 `ui-registry.ts` 仍然可以用 `@mg/runtime`；两边共享的是 `ui-spec.ts` 里的名字与 props。
若 `.ui` 里还用了按钮别名或纯占位 region（如 `startButton` / `playArea` / `adOverlay`），
也要一并写进 `knownComponents` 与 `componentProps`（region 的 props 可以是空数组），
否则编译期会报「未知组件」。
`vite.config.ts` / `vitest.config.ts` 的其余部分与 `games/yunduan-dieta/vite.config.ts` 同口径，
只是把 `uiPlugin(...)` 的参数换成 `UI_COMPILE_OPTIONS`。

### 2.3 数据通道：布局期和绘制期用同一份 data

组件在布局期从 `MeasureEnv.data` 量尺寸，在绘制期从 `DrawDeps.data` 取数据。**两边必须是同一份**：
把布局期用的 `data` 原样传给绘制依赖，或干脆只用 `ScreenLayout.data` 单通道（推荐）。
否则每帧都会报：

```
[mg ui data] 绘制期未传入 data，但布局期有数据。数据组件会「状态对、画面空」……
```

```ts
// 推荐：布局结果上带 data，绘制只读这一份
const view = layout(root, { width, height, data: game.data });
const deps: DrawDeps = { assets, theme, data: view.data };
// 分两边构造时也要同源：resolveUiData(view.data, drawData) 会检查漏传 / 缺键
```

## 3. 美术需求单（`games/<slug>/ART-BRIEF.md`）

美术需求单固定写在 `games/<slug>/ART-BRIEF.md`，交给出图方。按本作替换下表内容：

| 文件 | 尺寸 / 格式 | 要求 |
|---|---|---|
| `assets/art/bg.png` | 750×1334，不透明 | 竖屏背景；**顶部留干净天空 / 纯色区**（便于向上滚动时与渐变无缝衔接）；不要放 UI 和文字 |
| `assets/art/<sprite>_1..N.png` | 如 400×80，**透明底** | 方块 / 角色 / 道具；同系列统一光源与描边；横向可拉伸件两端留圆角（用三段切绘制，两端不拉伸） |
| `assets/art/cover.png` | 750×1000 左右 | 封面 / 首页主视觉，**带游戏标题字**；也用于导航页封面（部署前可缩成小 jpg） |
| `assets/art/btn_start.png` | 如 360×120，透明底 | 按钮底图，**不带文字**（文字由代码叠加，便于改文案 / 多语言） |

规则：
- 原图、草稿、拼图预览、生成日志一律放 `games/<slug>/artifacts/art/`，**不要放 `assets/`**。
  **`assets/` 下的所有文件都会进包**，`assets/art/_raw/`、`_preview/` 同样会进包，顶爆微信主包 4 MB 红线。
  `artifacts/` 已在 `.gitignore` 里，不进库。
- 接入后对照图检查：标题是否与代码画的标题重复（封面自带标题时，首页不要再画一遍）。

## 4. 手感（juice）清单

至少做 4 项，每项都要能在截图或录屏里看到：

- [ ] **震屏**：失败 / 大偏差时强，普通操作弱；指数衰减（`shake *= exp(-dt*10)`），HUD 不跟着震
- [ ] **挤压回弹**：落地 / 点击后 0.1–0.2 s 的 squash & stretch
- [ ] **粒子**：成功 / 完美时向外迸发，带重力和淡出
- [ ] **飘字**：「完美 ×N」「+2」上飘淡出，字要有描边保证对比度
- [ ] **闪光**：完美时白色描边 + 扩散光环
- [ ] **镜头**：目标位置平滑插值（`cam += (target - cam) * min(1, dt*4)`），不要瞬移
- [ ] **视差背景**：远景慢、近景快；随进度变色（如黄昏 → 夜空）
- [ ] **按钮按下态**：按下下沉几像素；首页主按钮轻微呼吸
- [ ] **振动**：有 `platform.vibrate` 时轻 / 中 / 重三档
- [ ] 失败后先停留约 1 s 展示掉落，再进结算；结算页前 0.5 s 忽略点击，防误触
- [ ] **输入只走 pointer 事件**（`platform.onPointer`），不直接读 `window` 鼠标 / 触摸事件；
      桌面鼠标与触屏都要实测（`pnpm shots <slug>` 默认 `both`，两种模式都跑）

## 5. 验收（全部通过才算完成）

```bash
# 在游戏目录 games/<slug>/ 下
pnpm mg build --all        # web / wx / tt 三端（先跑 typecheck）
pnpm test                  # 本游戏单测（纯模块，正常 / 边界 / 失败各至少 1 例）
pnpm mg check              # 产物包体 / game.json / 资源清单检查（需先 build）

# 在仓库根
pnpm typecheck             # tsc --noEmit，必须 0 错误
pnpm test                  # 引擎 / 模板单测；注意：根测试不扫 games/，游戏测试回游戏目录跑
pnpm lint                  # 平台黑名单 / 单文件行数 / 禁 any 等硬规则
```

**真浏览器截图**：用仓库根的统一脚本（puppeteer-core，移动端 390×844 / DPR 2 / touch，
桌面端 1280×800 / DPR 1 / 真实鼠标事件）：

```bash
# 仓库根执行；不给 --url 时脚本自己静态服务 games/<slug>/build/web（需先 build）
pnpm shots <slug>                       # 默认 both：先 mobile 再 desktop
pnpm shots <slug> --mode mobile         # 只跑移动端
pnpm shots <slug> --url http://127.0.0.1:5173/   # 截已在跑的 dev server
pnpm shots <slug> --chrome /usr/bin/google-chrome --start startButton --tap-ms 350
```

**每款游戏一份步骤配置**：`tools/shots/steps/<slug>.json` 声明「开始按钮的 layout key、
要点的目标（layout key / 相对坐标 / `__mg.geom` 矩形）、每步期望的屏幕字段、进度断言」。
脚本里没有任何游戏专属键名；没有配置时用通用默认流程（首页点开始 → 等结算），
并明确提示缺哪个文件。字段说明见 [`tools/shots/steps/README.md`](../tools/shots/steps/README.md)。

截图统一放 `games/<slug>/artifacts/shots/<mode>-<序号>-<步骤名>.png`（`artifacts/` 不进库）：

1. 首页（固定）
2. 配置里的每个步骤：点/拖真实坐标，轮询只读快照直到期望达成（或超时）后截图
3. 结算页（配置里能到结算的步骤；到不了时记 SKIP，不算失败）

脚本最后打印每个模式的 screen 流转、每步尝试次数与检查结果；`required` 步骤没达成就退出码 1。
调试钩子只读暴露必要状态（`globalThis.__mg.state` / `layout` / 可选 `geom`），**不要给测试开写状态的后门**。
`pageerror`、`console.error`、HTTP ≥ 400 任意一条出现，脚本退出码同样为 1。

**自评，逐张看图，问自己**：
- 有没有灰盒子、默认蓝按钮、未上色的占位？
- 图与图之间有没有接缝 / 色带（背景滚动交界处最常见）？
- 文字对比度够不够？有没有重复标题、文字溢出、被遮挡？
- 程序画的装饰（云、粒子）有没有压住美术图、出现奇怪的尖角 / 连线？
  （canvas 一条 path 画多个椭圆时，每个椭圆前要 `moveTo`，否则会连出线。）
- 输入是否统一走 pointer 事件（`platform.onPointer`）？`pnpm shots` 的 mobile 与 desktop 两种模式
  是否都能点得动（触屏 tap 与桌面鼠标按下 / 抬起各测一遍）？

发现问题就修，修完重新截图再看。不要只看一次就交。

## 6. 包体检查

- `mg build --all` 会报告各端主包大小。**微信 / 抖音小游戏主包硬限 4 MB**，超了必须处理：
  移出 `assets/` 里的非运行时文件；大图压缩（缩尺寸 / 量化 / 转 jpg）；或拆分包。
- web 端没有硬限，但首屏建议控制在 3 MB 左右以内。

## 7. 部署与游戏列表（与环境相关，这里只写通用要求）

各团队的服务器、域名、密钥都不同，**不要把服务器地址、私钥路径、账号密码写进仓库**。通用要求：

1. 部署 `build/web/` 产物到 `<站点>/games/<name>/`。
2. **部署前备份**线上旧版本，并留下可执行的回滚命令。
3. 如果站点有游戏列表（如 `games/index.json`），追加 / 更新条目：`id`、显示名、简介、版本、更新时间、封面、URL。
   首页 / 列表页应从这份 JSON 读取，不要手改页面。
4. 部署后检查：站点首页、列表页、游戏地址都返回 200；用真浏览器打开线上地址再跑一遍 §5 的截图脚本。
5. 占位广告文案统一为「测试广告位」；如果有自动检查，要拒绝部署任何含真实广告 / 支付 SDK 调用的包。

## 8. 数值 / 存档 / 剧情（挂机、RPG、带对话的作品）

策划阶段先定资源流与对话边界（[`GAME-PLANNER.md`](GAME-PLANNER.md)），再填表；不要先写深 JSON。


| 需求 | 文档 / 包 |
|---|---|
| 改升级曲线、产出、价格（TSV 真源） | [`ECONOMY-SAVE.md`](ECONOMY-SAVE.md) + `simulate.mjs` / `compile.mjs` |
| `lastSeenAt`、迁移、`createSave` | 同上 §4；示例 `packages/economy/examples/with-save.ts` |
| 2D 跳跃 / 碰撞 | [`PHYSICS-GUIDE.md`](PHYSICS-GUIDE.md) · 官方示例 [`games/platformer`](../games/platformer/)（四步：世界→static→dynamic→setVelocity） |
| 分支对话（`.story.tsv`） | [`STORY.md`](STORY.md) + `lint-story.mjs` / `compile-story.mjs` |

PRD 里写清：离线封顶小时、经验来源、价格是否自动购买；改表后必须跑 simulate 与 `pnpm -w test`。


## 交付时汇报

线上地址、截图路径、接入了哪些美术（缺哪些在走回落）、已知问题（包体、未做项）、提交的分支与 hash。
