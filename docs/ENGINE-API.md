# gamekit 引擎 API 总表

> 核对日期：2026-10-21（T43 文档修订，上一版 2026-10-20 T25）。
> 规则：**一行一个导出**，只写「签名 + 行为 + 一行示例」，不写评价词。
> 全部条目来自读代码（`packages/runtime/src/**`）；行为与代码不一致时以代码为准。
>
> **导入方式**：barrel `@mg/runtime` 尚未落地。现在从 `packages/runtime/src/...` 相对导入，
> 现成例子见 `games/ui-demo/src/app/deps.ts`。

## core/ui —— 布局

| 导出 | 签名 | 说明 |
|---|---|---|
| `layout` | `(spec: LayoutSpec, viewport: LayoutViewport) => LayoutResult` | 纯函数求布局。返回 `regions`（带矩形）、`rects`（命名节点矩形）、`paintOrder`（层序→层内序）、`meta`（每节点 `layer/hit/layerIndex/index`）、`errors`（中文，不抛异常） |
| `bindComponents` | `(spec, { registry, env }) => BoundUi` | 给节点注入 `measure` 并校验参数值；返回 `{ spec, errors, components, props }`，**未注册组件不抛错**、收进 `errors` |
| `assertComponents` | `(bound: BoundUi, rects) => readonly string[]` | 布局后跑组件静态断言（文字溢出、卡片压扁），返回中文问题列表 |
| `defineComponent` | `(name: string, def: ComponentDef) => DefinedComponent` | 定义一个组件；`ComponentDef` = `{ props?, defaultSize?, measure, draw, assert? }`，名字必须 `[A-Za-z_][A-Za-z0-9_]*` |
| `createComponentRegistry` | `() => ComponentRegistry` | 新建注册表：`register/get/has/names/propKeys/propDecls`；同名重复注册直接抛错 |
| `checkPropValue` | `(type: string, value: StyleValue) => string \| null` | 校验参数值；`'number'` / `'string'` / `'boolean'` / `'a\|b'` 枚举，合法返回 `null` |
| `estimateTextWidth` | `(text: string, font: number) => number` | 估算文字宽（CJK 1 字宽、ASCII 0.55 字宽），布局期不碰 canvas |
| `stringProp` / `numberProp` / `boolProp` | `(props, key, fallback) => T` | 组件里读参数并兜底 |
| `DEFAULT_THEME` | `ComponentTheme` | 默认主题：`fontFamily/ink/light/primary/secondary/panel/gridLine/disabled` |
| `parse` | `(source: string, opts?: { fileName?, knownComponents?, componentProps? }) => ParsedUi` | `.ui` 源码 → spec；`errors` 带行号、一次报全 |
| `describeGrammar` / `UI_GRAMMAR` | `() => UiGrammar` | 语法单一真源（`UI_SYNTAX_VERSION` / 动词 / 修饰词 / 取值表） |
| 类型 | `LayoutSpec` `RegionSpec` `NodeSpec` `StackSpec` `Size` `SizeSpec` `StyleProps` `NodeMeta` `LayoutResult` `LayoutViewport` | 布局 spec 结构；`fill` / `auto` / `fixed(n)` / `ratio(r)` 是尺寸构造器 |

## core/ui —— 自绘区域切分（动态 UI 专用）

> 为什么有这一节：`.ui` 由布局求解给矩形，`iaa-simple` 用 `computeRect` + `minSize/maxSize`，
> 只有「在 canvas 上自己画」的部分**没有约束** → 游戏代码只能拿 `viewport` 手算，
> 写出 `vp.width - 24`、`Math.max(90, vp.height * 0.16)`，320×568 下必然重叠或溢出
> （实测两次：《快递装车员》《拼豆工坊》的盘面/色块池互相压）。

| 导出 | 签名 | 说明 |
|---|---|---|
| `splitRows` | `(area: Rect, ratios: readonly number[]) => readonly Rect[]` | 纵向切带，首尾相接、端点对齐。比例**按总和归一化**：`[0.6,0.1,0.25,0.05]` 与 `[12,2,5,1]` 等价（权重写法，不用凑 100） |
| `splitCols` | `(area, ratios) => readonly Rect[]` | 横向切列，同上 |
| `gridOf` | `(area, cols, rows) => readonly Rect[]` | 切 `cols×rows` 均匀网格，**行优先**；末格右下精确等于区域右下（不因浮点累积差零点几像素） |
| `findOverlaps` | `(rects: Readonly<Record<string, Rect>>) => readonly (readonly [string,string])[]` | 两两相交检测（**贴边不算重叠**），返回名字对；空数组 = 都不重叠。**测试里用它代替肉眼看截图** |
| `ratiosSum` | `(ratios) => number` | 只做诊断，不做归一化 |
| 类型 | `Ratios` | `readonly number[]` |

参数非法（空数组 / 0 / 负数 / NaN / 非整数行列数）**直接抛错**，不静默兜底 ——
静默兜底会把布局错误藏起来，正是要避免的。

```ts
// 盘面页：区域由 .ui 求解给出，内部只用切分，不再出现 viewport
const area = view.rects.boardArea;
const [play, slotRow, pool, toolBar] = splitRows(area, [0.6, 0.1, 0.25, 0.05]);
const cells = gridOf(play, 16, 16);              // 256 个格子矩形，行优先
const poolRows = splitRows(pool, [1, 1]);        // 色块池两行

// 测试里断言「四块不重叠」，而不是靠肉眼看截图
expect(findOverlaps({ play, slotRow, pool, toolBar })).toEqual([]);
```

## core/ui —— 交互纯函数（都不碰 canvas、不改入参）

`HitEntry = { name, rect, hit: 'self'|'block'|'none', layer, index }`；`HitPoint = { x, y }`；矩形左闭右开。

| 导出 | 签名 | 说明 |
|---|---|---|
| `pickHit` | `(entries, point) => HitEntry \| null` | 按绘制顺序**逆序**找最上面的命中；跳过 `hit:'none'`；返回 `block` 表示「吃掉了这次点击但没有动作」 |
| `sortForPaint` | `(entries) => readonly HitEntry[]` | 绘制顺序：`layer` 升序 → `index` 升序；返回新数组 |
| `hitTest` | `(rect \| undefined, point) => boolean` | 单矩形命中；`w<=0 \|\| h<=0` 或 NaN 坐标一律 false |
| `pressDown` | `(state, entries, point, pointerId) => PressState` | 按下：只有 `hit='self'` 才进入 pressed；已按住时忽略（多点保护） |
| `pressMove` | `(state, entries, point) => PressState` | 按住期间移出原元素即取消（用 `pickHit` 判「落点最上层还是不是它」） |
| `pressUp` | `(state, entries, point, pointerId) => { state, activated }` | 松手点仍在 pressed 元素内才返回 `activated=名字`；id 不匹配不改变状态 |
| `IDLE_PRESS` | `{ pressed: null, pointerId: null }` | 空闲常量 |
| `scrollClamp` | `(offset, contentSize, viewSize) => number` | 钳到 `[0, max(0, contentSize - viewSize)]` |
| `scrollDragStart` / `scrollDragEnd` | `(state) => ScrollState` | 进入/退出拖动；start 清速度、end 保留速度进入惯性 |
| `scrollDragMove` | `(state, delta, contentSize, viewSize) => ScrollState` | 跟手 `offset += delta` 并硬钳制（不回弹）；非拖动状态原样返回 |
| `scrollTick` | `(state, dt, contentSize, viewSize) => ScrollState` | 惯性：`v ×= 0.92^(dt×60)`，位移取区间积分（dt 再大位移也有上界）；撞边界 `velocity=0`；拖动中不跑 |
| `IDLE_SCROLL` | `{ offset: 0, velocity: 0, dragging: false }` | 空闲常量 |
| `carouselDragStart` / `carouselDragEnd` | `(state) => CarouselState` | 开始/结束拖动（速度由调用方在 release 时传） |
| `carouselDragMove` | `(state, delta, pageW, count) => CarouselState` | 跟手并硬钳到 `[-pageW, pageW]` |
| `carouselRelease` | `(state, velocity, pageW, count) => CarouselState` | 松手判定（**速度优先**：`\|v\|>500` 按方向翻页，否则 `\|offset\|>pageW/3` 翻页）；翻页时立即更新 `index` 并把 `offset` 换算成相对新页的值，保证视觉连续 |
| `carouselTick` | `(state, dt, pageW, count) => CarouselState` | 吸附：`offset ×= 0.92^(dt×60)`，`\|offset\| < 0.5` 归零（严格 0） |
| `carouselNext` / `carouselPrev` | `(state, count, loop = false) => CarouselState` | 按钮翻页；`loop` 时回绕（最后一页→0、第一页→count-1），否则到边界不动 |
| `IDLE_CAROUSEL` | `{ index: 0, offset: 0, dragging: false, velocity: 0 }` | 空闲常量 |
| `dragStart` | `(state, entries, point, pointerId, draggable: readonly string[]) => DragState` | 按下：命中 `self` 且在**白名单**里才进入拖拽；否则返回 `IDLE_DRAG` |
| `dragMove` | `(state, point, threshold = 8) => DragState` | 更新 `dx/dy`；欧氏位移 **> 阈值**才 `active=true`，**一旦 active 不回退** |
| `dragEnd` | `(state, pointerId?) => { state, result }` | 松手交回 `{ target, dx, dy, active, point }` 并回 IDLE；`active:false` 表示这其实是点击（点击归 `press`）；传了 id 且不匹配则无效 |
| `IDLE_DRAG` / `DRAG_THRESHOLD` | `DragState` / `8` | 空闲常量 / 默认阈值 |
| `snapTo` | `(center, targets, radius) => SnapResult \| null` | 找 **中心到中心**距离最近、且在 `radius` 内的目标；等距取数组先出现的；`radius<=0`/空/NaN → null |
| `listWindow` | `({ scrollTop, count, itemH, gap?, viewH }) => ListWindow` | 虚拟列表可见窗口（**O(1)**，不遍历）：`{ start, end, offsetY, totalH }`；`offsetY ≤ 0` |
| `listIndexAt` | `(point, rect, scrollTop, { itemH, gap?, count }) => number \| null` | 列表子项命中：点在第几项。容器外 / `gap` 空隙 / 超出 `count` → `null`（**不就近归并**） |
| `gridIndexAt` | `(point, rect, scrollTop, { cols, cellW, cellH, gapX?, gapY?, count }) => number \| null` | 网格子项命中：点在第几格。容器外 / 行列间距 / 最后一行不满 / 超出 `count` → `null`。`cellW` 传 `grid.ts` 的 `cellWidth()`，与绘制同源 |

## core/ui —— 写自定义组件要用的形状

`ComponentDef` 的四个成员（`defineComponent` 的第二参）：

| 成员 | 签名 | 说明 |
|---|---|---|
| `measure` | `(env: MeasureEnv, box: Rect, props: StyleProps) => { w: number; h: number }` | 布局期调；**纯函数**，不许碰 canvas |
| `draw` | `(ctx: Ctx2D, box: Rect, props: StyleProps, deps: DrawDeps) => void` | 绘制期调；只读状态、只画，不做判定 |
| `assert` | `(box: Rect, props: StyleProps) => readonly string[]` | 静态断言（中文问题列表，空数组 = 没问题） |
| `props` / `defaultSize` | `Record<string, string>` / `{ w?, h? }` | 参数类型声明（`'string'` / `'number'` / `'boolean'` / `'a\|b'`）与默认尺寸 |

| 名字 | 形状 | 说明 |
|---|---|---|
| `DrawDeps` | `{ assets: ComponentAssets; theme: ComponentTheme; data?: UiData }` | 绘制期依赖，由游戏注入。`assets.get(key) => ImageAsset \| null`；`theme` 是 7 个颜色 + `fontFamily`；`data` 是游戏数据快照（与 `MeasureEnv.data` 同源） |
| `MeasureEnv` | `{ viewport: { width: number; height: number }; data: Readonly<Record<string, unknown>> }` | 布局期环境；纯数据，不碰 canvas。`viewport` 是**逻辑像素**的当前屏型 |
| `ComponentAssets` | `{ get(key: string): ImageAsset \| null }` | 素材查询（结构子集，测试可直接塞假对象） |
| `ComponentTheme` | `{ fontFamily, ink, light, primary, secondary, panel, gridLine, disabled }` | 全字符串颜色；`DEFAULT_THEME` 是默认值 |

`builtin-draw.ts` 里画文字 / 图标的工具（自定义组件最常用，**不用自己拼 fillText**）：

| 导出 | 签名 | 说明 |
|---|---|---|
| `drawCenteredText` | `(ctx, rect, text, color, fontFamily) => void` | 居中文字；字号 = `min(rect.h × 0.36, rect.w / 字数)`（与 `estimateTextWidth` 同口径）；空串不画 |
| `drawTextAt` | `(ctx, rect, text, font, x, color, fontFamily) => void` | 左对齐文字（图标右侧用）；画完把 `textAlign` 恢复成 `center` |
| `drawIcon` | `(ctx, img: ImageAsset, x, y, size) => void` | 画图标；源矩形从帧的 `sx/sy` 起算 |
| `fillRect` | `(ctx, rect, color) => void` | 填一块矩形（`fillStyle` + `fillRect`） |

> 导入方式：这些都在 `packages/runtime/src/core/ui/builtin-draw.ts` 与 `.../components.ts`。
> `iaa-ui` 模板的 `src/app/deps.ts` 已经转出了 `drawCenteredText` / `fillRect` / `defineComponent` /
> `DEFAULT_THEME` / `DrawDeps` / `MeasureEnv`，但**没有**转 `stringProp` 等读参数小工具 ——
> 那几个要直接从 `.../core/ui/components` 导入（见 `templates/iaa-ui/README.md` 的自定义组件示例）。

## core/ui/widgets —— 22 个通用组件

`createWidgetRegistry() => ComponentRegistry`（一次装 22 个）、`WIDGET_COMPONENTS`。

| 组件 | 文件 | 一行说明 |
|---|---|---|
| `progress` | widgets/progress.ts | 进度条（纯绘制） |
| `button` | widgets/button.ts | 三态按钮（贴图/scale/位移/透明度同时生效） |
| `panel` | widgets/panel.ts | 九宫格面板 |
| `label` | widgets/label.ts | 文本 + 省略号 |
| `icon` | widgets/icon.ts | 等比图标 |
| `badge` | widgets/badge.ts | 角标/红点 |
| `divider` | widgets/divider.ts | 分割线 |
| `avatar` | widgets/avatar.ts | 头像（圆形 clip） |
| `list` | widgets/list.ts | 虚拟列表（`items` + `renderItem`） |
| `input` | widgets/input.ts | 输入框（**只画不弹键盘**；`focused` 画光标，超长按宽度截断补 `…`） |
| `toast` | widgets/toast.ts | 轻提示（`opacity` 由游戏 tween） |
| `slider` | widgets/slider.ts | 滑杆 0..1 |
| `switch` | widgets/switch.ts | 开关（注册名 `switch`，导出变量 `switchToggle`） |
| `checkbox` | widgets/checkbox.ts | 复选框（path 对勾） |
| `radio` | widgets/radio.ts | 单选框 |
| `tabs` | widgets/tabs.ts | 标签栏（数据 `tabs`） |
| `segmented` | widgets/segmented.ts | 分段控件（数据 `segments`） |
| `keypad` | widgets/keypad.ts | 数字键盘（数据 `keys`；命中用 `keypadHit`） |
| `scrollbar` | widgets/scrollbar.ts | 滚动条 |
| `carousel` | widgets/carousel.ts | 轮播（数据 `pages` + `renderItem`） |
| `grid` | widgets/grid.ts | 网格容器（4 列 × cellH，虚拟/实渲染两模式，clip 到自身） |
| `scroll` | widgets/scroll.ts | 通用滑动容器（只裁剪 + 平移，内容由 `renderContent` 画） |

Props 与默认值见 `docs/ui-syntax.md` §12。另有：
- `keypadHit(box, { cols, keyH, gap, keys }, point)`（键盘命中，与绘制共用 `keypadMetrics` / `keypadCell`）；
- `listIndexAt` / `gridIndexAt`（`core/ui/item-hit.ts`，列表/网格的**子项**命中换算，几何与绘制同源）；
- `fitText` / `cursorVisibleAt`（`widgets/input.ts` 导出，纯函数）。

## core/fx —— Canvas 2D 特效（纯绘制，不依赖素材）

`Rect = { x, y, w, h }`；`viewport = { width, height }`。

| 导出 | 签名 | 行为 |
|---|---|---|
| `drawWithGlow` | `(ctx, rect, { color, intensity?=1, layers?=3, blur?=0 }, draw: () => void) => void` | 先叠 `layers` 层径向渐变（`lighter` 混合）再 `draw()`；`intensity=0` 不画光晕但内容照画 |
| `drawWithDissolve` | `(ctx, rect, { progress, noise, edgeColor? }, draw) => void` | `progress=0` 画内容、`=1` 完全不画；中间用 `destination-out` 挖确定性噪声网格；**会擦当前画布已有像素，必须用在隔离层** |
| `drawWithChromatic` | `(ctx, rect, { offset, alpha?=0.6 }, draw) => void` | `draw` 被调用 3 次（右偏 → 左偏 → 原色）；`offset=0` 时只画 1 次 |
| `drawFlash` | `(ctx, viewport, { color?='#ffffff', alpha }) => void` | 全屏 `fillRect` 一次；`alpha<=0` 不画 |
| `beginShake` | `(ctx, viewport, { amplitude, rotation?=0, seed?=0 }) => () => void` | `save + translate/rotate`，返回的函数做一次 `restore`（**必须配对调用**）；振幅钳到视口短边 10%、旋转钳到 3°；两者都为 0 时不 save |
| `drawVignette` | `(ctx, viewport, { strength, color?='#000000' }) => void` | 一次全屏径向渐变（内圈 45% 短边半径、外圈到角）；`strength<=0` 不画 |
| `drawScanline` | `(ctx, viewport, { gap, thickness, alpha, color? }) => void` | 从 y=0 按 `gap+thickness` 节拍画横条；`thickness` 钳到 `gap`；最后一条按剩余高度裁 |
| `clamp01` / `withAlpha` | `(v, fallback?) => number` / `(color, alpha) => string` | 钳到 0..1 / 给 `#rgb`、`#rrggbb`、`rgb()`、`rgba()` 加 alpha |

参数全部钳制；不同特效的随机性走 `hash01(seed)`（确定性，同 seed 同结果）。

## core/camera —— 2D 跟随相机

| 导出 | 签名 | 说明 |
|---|---|---|
| `createCamera` | `({ viewport, bounds?, deadzone?, smoothing?=?, lookAhead?=0, zoom?=1 }) => Camera` | 世界→屏幕的唯一换算处；`smoothing` 按 60fps 定义（`k = 1-(1-s)^(dt×60)`），不同帧率收敛一致 |

`Camera`：`follow(target, velocity, dt)` 每帧更新（velocity 用于前瞻）、`apply(ctx) => restore`（应用世界→屏幕变换，**必须调用返回的 restore**）、`worldToScreen(p)` / `screenToWorld(p)`、`shake(amount)` 位置级抖动、`visible`（可见世界矩形，含抖动，渲染剔除用）、`center`、`zoom`。

## core/cull —— 视口剔除（纯函数）

| 导出 | 签名 | 说明 |
|---|---|---|
| `intersects` | `(a, b) => boolean` | AABB 相交（边挨着也算相交） |
| `activeWindow` | `(view, margin) => CullRect` | 视口外扩 margin 的激活窗口 |
| `isVisible` | `(rect, view, margin = 0) => boolean` | 是否落在窗口内；`w<=0 \|\| h<=0` 一律不可见；NaN 坐标判不可见 |
| `partitionByVisibility` | `<T>(items, rectOf, view, margin) => { visible, hidden }` | 按可见性分区，保持原顺序（剔除更新与绘制共用同一份判定） |

## core/loop —— 固定步长循环

| 导出 | 签名 | 说明 |
|---|---|---|
| `createLoop` | `({ update, render, step?=1/60, maxFrameTime?=0.25, maxSubSteps?=3, schedule?, now? }) => Loop` | 累加器式固定步长；`maxSubSteps` 防「卡顿后狂追」 |
| `tick` | `(state, nowMs, params?) => { state, steps, alpha, frameTime }` | 纯函数版本（测试用）：推进一次，返回新状态与渲染插值 `alpha` |
| `DEFAULT_STEP` / `DEFAULT_MAX_FRAME_TIME` / `DEFAULT_MAX_SUB_STEPS` | `1/60` / `0.25` / `3` | 默认常量 |

`Loop`：`start()` / `stop()` / `running` / `frame(nowMs)`（手动推一帧，测试用）。

## core/stage —— 界面栈

| 导出 | 签名 | 说明 |
|---|---|---|
| `createStage` | `() => Stage` | 界面管理器；同一时刻只有栈顶 `update`/`render`（`modal` 的界面会挡住下层） |

`Screen = { enter?, exit?, update?(dt), render?(ctx, alpha), modal? }`；`Stage`：`push(screen, opts?)` / `pop() => Screen | null` / `replace(screen)` / `current` / `depth` / `update(dt)` / `render(ctx, alpha)` / `clear()`。

## core/render —— 绘制服务

| 导出 | 签名 | 说明 |
|---|---|---|
| `createRender` | `({ ctx, dpr? }) => RenderService` | 2D 绘制封装（坐标是逻辑像素，dpr 由它处理） |

`RenderService`：`beginFrame(clearColor?)` / `endFrame()` / `fillRect` / `strokeRect` / `image(asset, rect, opts?)` / `text(text, at, style?)` / `textLines` / `line` / `circle(center, radius, color, filled?)` / `pushClip` / `popClip` / `pushAlpha` / `popAlpha` / `placeholder(rect, label?)` / `measureText(text, style?)` / `ctx`。

## core/assets —— 资源加载

| 导出 | 签名 | 说明 |
|---|---|---|
| `createAssets` | `({ loadImage, manifest, atlas?, concurrency?=4, timeoutMs?=10000, onProgress? }) => AssetService` | 平台 `loadImage` + 清单；图集（`atlas`）按帧切片 |
| `ImageAsset` | `{ key, width, height, src, native, sx, sy, sw, sh }` | 单张图/图集帧；`drawImage` 用 `native + sx/sy/sw/sh` |
| `AssetManifest` | `Readonly<Record<string, readonly string[]>>` | 逻辑 key → 候选路径列表 |

`AssetService`：`load(key, opts?) => Promise<ImageAsset \| null>` / `loadAll(keys, opts?)` / `get(key)` / `status(key): 'idle'\|'loading'\|'ready'\|'failed'` / `has` / `release` / `clear` / `loaded` / `total` / `failed` / `manifest`。

## core/tween —— 补间与弹簧

| 导出 | 签名 | 说明 |
|---|---|---|
| `createTween` | `(key, { from, to, duration, easing?='out', delay?=0, loop?=false }) => Tween` | 单个补间；`advance(dtMs)` / `redirect(to, durationMs, easing?)` / `value` / `done` |
| `createTweenRunner` | `() => TweenRunner` | 按 key 管理一批补间：`set/get/value/sample/remove/clear/advance/activeCount/order` |
| `createTweenSystem` | `(runner: TweenRunner) => System` | 包成 `Loop` 的 system（`update(dt)`） |
| `MOTION` | `{ ms, ease, spring, stagger, shake }` | 运动常量：时长阶梯 / 缓动名 / 弹簧参数 / 错峰 / 抖动 |
| `createSpring` / `sampleSpring` | `(config) => Spring` / `(spring, tSeconds) => number` | 弹簧采样（含 `zeta` / `overshoot` / `settleSeconds` 推导） |
| `CURVES` / `createEasing` / `easingAt` / `easingAtParam` / `easingProgressAt` / `createTimeline` / `sampleTimeline` | — | 贝塞尔缓动与关键帧时间轴（`EasingName = 'in'\|'standard'\|'out'\|'back'`） |

## core/input —— 输入

| 导出 | 签名 | 说明 |
|---|---|---|
| `createInput` | `(platform: PlatformAdapter, opts?: { tapMaxMove?, tapMaxDuration?, mapping? }) => Input` | 把平台 pointer 事件变成 `onTap` / `onDrag` |
| `createDesignMapping` | `(screen, design, fit?='contain') => DesignMapping` | 屏幕坐标 → 设计逻辑坐标（含缩放/偏移） |

`Input`：`onTap(cb: (e: TapEvent) => void) => Unsubscribe` / `onDrag(cb: (e: DragEvent) => void)` / `isDown(id?)` / `downCount` / `handle(e: PointerEvent)` / `dispose()`。
`TapEvent = { id, x, y, duration }`；`DragEvent = { id, phase: 'start'\|'move'\|'end', x, y, startX, startY, dx, dy }`。

## core/audio —— 音频

| 导出 | 签名 | 说明 |
|---|---|---|
| `createAudio` | `({ createSound?, unlock? }) => AudioService` | 平台提供 `createSound` / `unlock`；两条总线 `sfx` / `bgm` |

`AudioService`：`unlock() => Promise<boolean>` / `unlocked` / `playSfx(key, { volume?, loop? })` / `playBgm(key, opts?)` / `stopBgm()` / `pauseBgm()` / `resumeBgm()` / `setVolume(bus, v)` / `getVolume(bus)` / `setMuted(bus, m)` / `isMuted(bus)`。

## core/save —— 存档

| 导出 | 签名 | 说明 |
|---|---|---|
| `createSave` | `({ namespace?='mg.save.', version, migrations?, store, now? }) => SaveService` | 带版本号的存档；迁移失败走 `recovered` / `corrupt`，不抛异常 |
| `saveKeys` | `(namespace?) => SaveKeys` | 生成存储键名 |
| `SaveService` | `load<T>() => T \| null` / `save<T>(data) => boolean` / `inspect() => SaveInspect` / `clear()` | `load` 首次启动返回 `null`（不抛错）；`inspect` 给出 `status/storedVersion/currentVersion/message` |

## core/ads —— 广告

| 导出 | 签名 | 说明 |
|---|---|---|
| `createAds` | `({ backend?, interstitialCooldownMs?, rewardedCooldownMs?, now? }) => AdsService` | 广告门面；`can(kind)` 先判能力/冷却 |
| `AdKind` | `'banner' \| 'interstitial' \| 'rewarded'` | 三种广告 |
| `AdResult` | `{ ok, reason?: 'unsupported'\|'incomplete'\|'no-fill'\|'cooldown'\|'error', detail? }` | 展示结果；`ok=false` 时**不要发奖** |

`AdsService`：`can(kind)` / `showBanner(opts?)` / `hideBanner()` / `showInterstitial() => Promise<AdResult>` / `showRewarded() => Promise<AdResult>` / `lastShownAt(kind)`。

## packages/physics-2d —— 2D 物理（planck 薄封装）

> 独立包 `@mg/physics-2d`（`packages/physics-2d/`），**可选**：只有 import 它才会进包。
> 契约在 `src/contract.ts`（100 行），实现 `src/index.ts`（211 行），17 条契约测试。
> 真实用例：`games/platformer` 第一关（玩家 dynamic + 地形 static）。

| 导出 | 签名 | 说明 |
|---|---|---|
| `createPhysicsWorld` | `(opts?: { gravity?: { x: number; y: number }; fixedStep?: number }) => PhysicsWorld` | 建世界。`gravity` 单位**像素/秒²**（y 向下为正），默认 `{ x: 0, y: 1800 }`；`fixedStep` 默认 `1/60` |
| `DEFAULT_GRAVITY` | `{ x: 0, y: 1800 }` | 默认重力（像素/秒²） |
| `DEFAULT_FIXED_STEP` | `1 / 60` | 默认固定步长（秒） |
| `PIXELS_PER_UNIT` | `100` | 内部像素 ↔ 物理单位（米）的换算比例；**对外永远是像素** |

`PhysicsWorld`：11 个方法 + 1 个只读属性。

| 成员 | 签名 | 说明 |
|---|---|---|
| `addBody` | `(def: BodyDef) => BodyHandle` | 加刚体。**`x` / `y` 是刚体的质心（方块的中心，不是左上角）** |
| `step` | `(dt: number) => void` | 传真实 `dt`（秒）；内部累积到 `fixedStep` 才真 step，单帧最多追 5 步（追不上丢积压，防「卡顿后瞬移穿墙」） |
| `snapshot` | `() => readonly BodyPose[]` | 全部刚体的位姿快照（纯数据） |
| `poseOf` | `(handle: BodyHandle) => BodyPose \| null` | 单个刚体快照，找不到返回 `null`；返回的是内部复用缓存，**别改动它** |
| `setVelocity` | `(handle, vx, vy) => void` | 设速度（像素/秒）；kinematic 控制器与跳跃都走它 |
| `applyImpulse` | `(handle, ix, iy) => void` | 施加冲量（dynamic 体），作用在质心 |
| `setPosition` | `(handle, x, y) => void` | 直接摆位置（重生/传送）——**顺带把速度清零** |
| `onContact` | `(listener: ContactListener) => () => void` | 订阅「**接触开始**」事件，返回退订函数；**不是持续接触** |
| `setActive` | `(handle, active: boolean) => void` | 休眠 / 唤醒（离屏剔除用）：休眠体不参与步进，唤醒时位姿原样保留 |
| `isActive` | `(handle) => boolean` | 是否激活 |
| `removeBody` | `(handle) => void` | 移除刚体（重复调用安全） |
| `bodyCount` | `number`（只读属性） | 当前刚体数量 |

形状 / 定义 / 快照 / 事件的字段形状：

| 类型 | 形状 | 说明 |
|---|---|---|
| `ShapeDef` | `{ kind: 'box'; w; h } \| { kind: 'circle'; r }` | `w` / `h` 是**整边长度**（不是半边长）；`r` 是半径 |
| `BodyDef` | `{ type: 'static' \| 'dynamic' \| 'kinematic'; shape; x; y; friction?; restitution?; density?; fixedRotation?; userData? }` | 默认 `friction 0.4` / `restitution 0` / `density 1`；`fixedRotation` 对 **dynamic 默认 false**、对 static/kinematic 默认 true |
| `BodyPose` | `{ id; x; y; angle（弧度）; vx; vy; userData }` | 纯数据；渲染与判定只读它 |
| `ContactEvent` | `{ a: BodyHandle; b: BodyHandle; normalX; normalY }` | 从 a 指向 b 的单位法线（近似） |
| `BodyHandle` | `{ id: number }` | 不透明句柄，游戏只当 id 用 |
| `ContactListener` | `(event: ContactEvent) => void` | 碰撞开始回调 |

**三条必读语义**：

1. **单位是像素**：坐标 / 速度 / 重力 / 冲量全按像素写，内部才按 `PIXELS_PER_UNIT = 100` 换算成米。
   重力写 `{ x: 0, y: 1800 }` 是**像素/秒²**，不是米/秒²。
2. **固定步长在内部**：只传 `step(dt)` 的真实 dt（`1/60` 也行，但不要自己攒固定值、也不要跳帧）；
   内部累积到 `1/60` 才真 step，单帧最多 5 步。
3. **快照是纯数据**：渲染与玩法判定只读 `snapshot()` / `poseOf()`，**不要 import planck** ——
   这样玩法逻辑可单测、不依赖物理引擎内部状态。

**边界**：只有 `box` / `circle` 两种形状 —— **没有多边形、边、关节、射线、传感器、碰撞过滤层**。
planck 有这些，但契约没暴露；需要时按 AGENTS §4 的流程扩封装（先改 `contract.ts` 再改实现+测试）。

示例（`games/platformer` 的真实写法，节选）：

```ts
const physics = createPhysicsWorld({ gravity: { x: 0, y: 1800 } });
// 地形：static。x/y 传中心点 —— 关卡矩形 (x, y, w, h) 要换成 (x + w/2, y + h/2)
physics.addBody({ type: 'static', shape: { kind: 'box', w: 1200, h: 40 }, x: 600, y: 700, userData: 'solid' });
// 玩家：dynamic + fixedRotation（角色不锁旋转会被撞得打转）
const player = physics.addBody({
  type: 'dynamic', shape: { kind: 'box', w: 28, h: 40 }, x: 120, y: 500, friction: 0, fixedRotation: true, userData: 'player',
});
physics.step(dt);                      // 每帧传真实 dt
const pose = physics.poseOf(player);   // { x, y, vx, vy } —— 渲染与判定都读它
if (pose !== null && pose.vy < 0) physics.setVelocity(player, pose.vx, -620); // 跳跃
```

## platform —— 平台适配（差异只在这里）

| 导出 | 签名 | 说明 |
|---|---|---|
| `Ctx2D` | `CanvasRenderingContext2D` | 绘制上下文类型别名 |
| `GameImage` | `{ width, height, native }` | 可绘制图像（web 是 `HTMLImageElement`） |
| `GameCanvas` | `{ width, height, getContext('2d'), native }` | 最小画布契约 |
| `PlatformAdapter` | `{ loadImage, createSound?, unlock?, onPointer, can?, screen?, … }` | 平台适配器；业务代码用 `platform.can('xxx')`，**不写 `wx.` / `tt.` / `window.`** |
| `KeyboardService` | `open(opts?) / close() / onInput(cb) / onConfirm(cb) / onClose(cb)` | 系统软键盘（三端都有）；`KeyboardOptions = { defaultValue?, maxLength?, confirmType?, rect?, textSize? }`。类型在 `platform/keyboard-contract.ts`，从 `platform/contract` 导入 |

**能力位要分清**：`can('keyboard')` 是**桌面物理键盘**（小游戏恒 false）；`can('soft-keyboard')` 才是系统输入法（web / wx / tt 都 true）。宿主缺键盘 API 时适配器不挂 `keyboard`、能力位如实为 false。

web 端实现要点（`platform/web/keyboard.ts`）：造一个真 `<input>` 盖在画布对应位置（`rect` 是相对画布的逻辑像素，位置再叠画布视口偏移），`opacity: 0.01` 让它「可见但不显眼」（iOS Safari 要求真实可见才弹键盘），字号强制 ≥16px（小于它会触发页面自动缩放），`open/close` 都回调适配器的 resize 通道（软键盘会改视口高度）。

## packages/economy —— 数值配表与离线收益

> 独立包 `@mg/economy`（`packages/economy/`），纯函数、无 DOM。指南 [`ECONOMY-SAVE.md`](ECONOMY-SAVE.md)。

| 导出 | 说明 |
|---|---|
| `loadTablesFromDir(dir)` | 读 `levels` / `production`（或 `drops`）/ `prices` 的 **tsv/csv 优先**，json 为编译产物 |
| `compileTablesFromDir(src, out)` | 扁平源 → JSON |
| `parseTsvTable` / `parseCsvTable` | 首行表头的扁平表解析 |
| `loadTablesFromParts` / `validateEconomyTables` | 手写 schema 校验，失败抛中文错误 |
| `simulate(tables, opts)` | 多日成长报告：`finalLevel`、`finalGold`、`daily[]`、`blockedByGold` |
| `computeOfflineReward(input)` | `lastSeenAt`→`now` 按 `perHour` 结算；`caps.maxHours` / `maxGold` |
| `hourlyGoldRate` | 等级 + 已购 id → 每小时金币 |

CLI：`node packages/economy/bin/simulate.mjs --table <dir> --days N` · `node packages/economy/bin/compile.mjs --table <dir> [--out <dir>]`

## packages/story —— 扁平剧情

> `@mg/story`（`packages/story/`）。真源 `*.story.tsv`；指南 [`STORY.md`](STORY.md)。`lintStory` 检死路 / 断链 / 不可达结局。

| 导出 | 说明 |
|---|---|
| `parseFlatStory(tsvText)` | 扁平 TSV → `StoryScript` |
| `parseStoryScript(raw)` | 校验并解析编译后 JSON |
| `createStoryRunner(script)` | `{ state, choose(i), current(), isEnded() }` |
| `lintStory(raw)` | `LintReport` |
| `evalCondition(expr, state)` | `flags.*` / `vars.*` 简单比较 |

CLI：`node packages/story/bin/lint-story.mjs <file.story.tsv>` · `node packages/story/bin/compile-story.mjs <file> --out <json>`

## 调试（packages/debug-mcp）

MCP 服务：`node packages/debug-mcp/bin/mg-debug-mcp.mjs --port 7788`。

| 工具 | 说明 |
|---|---|
| `clients` | 列在线游戏客户端（`id` / `platform` / `screen` / `connectedAt`）；多客户端时先调它 |
| `canvas` / `tree` / `state` / `screenshot` / `click` | 运行时工具，默认打最新连上的客户端，可用 `client: 'c2'` 指定 |
| `snapshot` / `snapshotList` / `diff` / `checkRender` | 快照与「布局 vs 绘制」对照（磁盘快照跨会话可读） |
| `watch` | 轮询表达式并推 `notifications/message`（`logger=mg.watch`） |
| `ui.check` / `ui.layout` / `ui.preview` / `ui.grammar` / `ui.pattern` | **离线**工具，不连游戏（`ui.check` 不接组件注册表） |
| `save_simulate_days` / `save_patch` | **草案 stub**（未接游戏），见 [`DEBUG-SAVE-COMMANDS.md`](DEBUG-SAVE-COMMANDS.md) |
