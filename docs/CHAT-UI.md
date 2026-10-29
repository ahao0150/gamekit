# 聊天框组件设计（chat UI）

> 面向 AI 的聊天界面组件设计：**3 个组件、1 条数据通道、10 条中文报错**。
> 适用：聊天模拟 / NPC 对话 / 世界频道 / 私聊。语法真源 `docs/ui-syntax.md` v0.6，
> API 真源 `docs/ENGINE-API.md`，动效数值来自 `docs/motion.md`（T0–T3 四档）。

**结论先行**：切成 **`chatList` / `chatComposer` / `chatBubble`** 三件，不切五件也不做一件。
理由在 §3.1 逐条论证 —— 关键约束是「**可点区域必须出现在 `layout()` 的 `rects` 里**」，
这条约束直接排除「一个大组件包住输入框」。

---

## 1. 调研（实时来源）

抓取方式：`web_fetch` 逐个页面取正文。下表每一格标注「已核实 / 无实时来源」——
**产品视觉数值（气泡最大宽占比、输入区像素高）除 TDesign 外没有一家公开文档写，按规矩留空，不用模型记忆补。**

> rpx 换算口径：TDesign 按 375pt 设计稿，**1px = 2rpx**。下文 `64rpx` 一律折算成 `32px` 并注明原值。

### 1.1 四款产品 + 一套可核实数值的对照

| | 微信（小游戏） | QQ | Discord | 游戏内聊天（SummerEngine 接入文档） | TDesign `chat-message` / `chat-sender`（腾讯，数值来源） |
|---|---|---|---|---|---|
| **气泡左右分流** | 无实时来源 | 无实时来源 | 无实时来源（只知有 Cozy / Compact 两档密度） | 无实时来源 | 已核实：`.left` = `flex-direction: row` + `align-items: flex-start`；`.right` = `row-reverse` + `align-items: flex-end` |
| **气泡最大宽占比** | 无实时来源 | 无实时来源 | 无实时来源 | 无实时来源 | 已核实：`__detail { max-width: 100% }`，**组件不给百分比上限**，由父容器决定 |
| **头像位置** | 无实时来源 | 已核实（定性）：「头像和聊天气泡是承载信息的主要载体」，简洁模式屏蔽装扮后仍保留两者 | 已核实（定性）：Cozy **显示大图标**；Compact **隐藏头像** | 无实时来源 | 已核实：头像 `64rpx = 32px`、圆形；`margin-right: 24rpx = 12px`，右侧时改 `margin-left` |
| **时间戳 / 分组** | 无实时来源 | 无实时来源 | 已核实：Cozy **时间戳在消息上方**；Compact **时间戳在用户名左侧**，且**不可隐藏** | 已核实：每条显示作者名；打开看最新消息，可再往回翻一点 | 已核实：头部信息行高 `44rpx = 22px`、下间距 `16rpx = 8px`、色为占位灰；消息之间下间距 `32rpx = 16px` |
| **输入区高度 / 键盘避让** | 已核实（API 层）：`wx.showKeyboard({ defaultValue, maxLength, multiple, confirmHold, confirmType })`，`confirmType` ∈ `done/next/search/go/send`；**键盘由系统弹，游戏只画自己的框** | 无实时来源 | 无实时来源 | 无实时来源 | 已核实：发送区圆角 `32rpx = 16px`、内边距 `22rpx 0 = 11px`、外边距 `24rpx 24rpx 80rpx = 12/12/40px`；输入区 `min-height 134rpx = 67px`、`max-height 280rpx = 140px`；发送键 `64rpx = 32px`；**键盘避让 = `transition: margin-bottom 0.3s ease`** |
| **滚动：贴底 vs 上滑脱离** | 无实时来源 | 无实时来源 | 已核实：Compact 同屏消息数是 Cozy 的 **2–3 倍**（密度差异，不是滚动策略） | 已核实：有速率限制；被过滤的消息对所有人不显示、只告诉发送者；消息保留 24 小时 | 已核实：聊天列表有 `--reverse` 变体，用 `transform: scaleY(-1)` 做反向列表（等价于「贴底 + 新消息从下往上长」） |

### 1.2 微信官方设计指南能给的（与本组件相关的两条）

来源：[微信小游戏设计指南](https://developers.weixin.qq.com/minigame/design/)（最后编辑 2026-07-04）

- **设计稿基准 `750×1334`**（4.7 寸，9:16 为主流比例）—— 说明「等比缩放」是平台推荐做法，
  与 `docs/ui-syntax.md` §3 的「百分比按视口宽/高」一致；
- **拇指热区**：官方给的是分区建议图（无文字数值），结论是**底部区域是高频操作区** ——
  这是 `chatComposer` 放 `bottom` 带、而不是浮在半空的依据。

### 1.3 微信软键盘 API（决定了「键盘避让」只能由游戏自己做）

来源：[wx.showKeyboard 官方页](https://developers.weixin.qq.com/minigame/dev/api/device/keyboard/wx.showKeyboard.html)
（HTTP 200，但正文被站内导航截断）+ [同文档镜像（含完整参数表）](https://www.bookstack.cn/read/minigame-api-201912/e456b0d07295bb01.md)

| 参数 | 类型 | 说明（原文） |
|---|---|---|
| `defaultValue` | string | 键盘输入框显示的默认值 |
| `maxLength` | number | 键盘中文本的最大长度 |
| `multiple` | boolean | 是否为多行输入 |
| `confirmHold` | boolean | 点击完成时键盘是否收起 |
| `confirmType` | string | 右下角按钮类型：`done` / `next` / `search` / `go` / `send` |

**两条推论（写进设计）**：

1. 小游戏端**没有 `cursorSpacing`** —— 键盘遮挡多少、要不要上移，**系统不管，游戏自己算**。
   这与本项目 `KeyboardService`（`packages/runtime/src/platform/keyboard-contract.ts:51`）
   的设计一致：`open(opts)` 只负责弹，位置由游戏给 `rect`。
2. `confirmType` 有 5 个合法值，本项目契约只收 `done / next / search / send`
   （`keyboard-contract.ts:35`），**缺 `go`**。聊天场景用 `send`，够用；不为此扩契约。

### 1.4 从调研得到的 4 条硬结论

1. **头像可选**（Discord Compact 直接不画）→ `showAvatar` 默认开、可关，关掉时气泡占满 `bubbleRatio`。
2. **时间戳位置随密度变**（Cozy 在上、Compact 在左）→ 本组件固定「**同一分钟内的连续消息不重复显示时间**」，位置放气泡上方左侧，不做两档密度（游戏不需要）。
3. **键盘避让必须自己做**（微信小游戏不给避让参数）→ 用「折减 viewport」方案（§3.5）。
4. **气泡宽度必须有上限**（TDesign 只在父容器层兜底，导致长消息一行拉满）→ 本组件内置 `bubbleRatio`，默认 **0.72**（390 宽 → 264px；320 宽 → 217px）。

### 1.5 抓取失败据实记录（未使用其数据）

| 页面 | 结果 |
|---|---|
| `https://tdesign.tencent.com/miniprogram/components/chat-message` | HTTP 200，但正文为空白 SPA，**无内容** → 改用同仓库 raw README / `.less` |
| `https://explainx.ai/.../discord/design-md` | HTTP 200，正文只有站点导航，**无内容** |
| `https://www.dexerto.com/...-3168810/` | HTTP 200，正文只有站点导航，**无内容** |
| `https://www.makeuseof.com/how-to-customize-discord-interface/` | HTTP 200，正文被截断在导航 |
| 微信 / QQ 的聊天气泡视觉规范 | **不存在公开文档**（四款产品的 px 值全部留空，见表 1.1） |

---

## 2. 本框架能力盘点

### 2.1 三个缺口（逐条核实到行号）

| # | 缺口 | 证据 | 影响 |
|---|---|---|---|
| 1 | `list` 项高写死 | `packages/runtime/src/core/ui/widgets/list.ts:47` `itemH: 'number'`；`:60` 读 `itemH`；`:84` `pitch = itemH + gap`；`:104` `itemRect.h = itemH` | 长消息折成 3 行时，气泡高度仍是 56，**压住下一条** |
| 2 | `label` 不换行 | `widgets/label.ts:15` `ellipsize()` 逐字裁剪补 `…`；`:55` 单次 `fillText` | 一条 30 字的消息被截成「今天的副本进度怎…」，**聊天的核心功能失效** |
| 3 | 没有折行工具 | `packages/runtime/src/core/render/contract.ts:72` `textLines()` 只接受**已经切好的** `string[]`；`:89` `measureText()` 只能测单行宽 | 没有任何函数能把 `string` 折成 `string[]` |

同时核实：`KeyboardService` 三端齐（`packages/runtime/src/platform/contract.ts:248`
`readonly keyboard?: KeyboardService;`，类型在 `platform/keyboard-contract.ts:51`，
`open/close/onInput/onConfirm/onClose` 五个成员全有）。
`input` 组件只画框（`widgets/input.ts:5` 注释第二条、`:65` 起）—— 这两条与现状说明一致。

### 2.2 能力盘点表

| 组件 / 能力 | 现有能力（文件:行号） | 聊天需要的差距 | 结论 |
|---|---|---|---|
| `list` | 虚拟窗口 `listWindow` O(1)（`list-window.ts:59`）、`clip` 到自身（`list.ts:79-82`） | 只支持等距 `pitch` | **需扩展**（dev-bot 在做 `data.itemHeights` + 二分）→ **`chatList` 不复用它**，自建变高窗口（§3.2） |
| `label` | 单行 + 省略号（`label.ts:15,55`） | 不折行 | **需扩展**：折行能力做成 `wrapText` 纯函数，`label` 保持单行（改它会让 8 处现有界面跟着变） |
| `avatar` | 圆形**真裁切** `clip`（`avatar.ts:23-32`）、`defaultSize 64`（`:17`） | 无差距，`size` 覆盖成 32 即可 | **复用** |
| `input` | 只画不弹键盘（`input.ts:5`）、`fitText` 按码点+宽度截断（`:39`）、光标 500ms 由 `Date.now()` 推（`:54`） | 单行够用；多行自绘 | **复用**（单行）/ **自绘**（`chatComposer` 多行模式） |
| `scroll` | 只 `clip` + `translate`，内容回调式（`scroll.ts:65-73`）；`scrollTop` 由调用方钳制（`:13-15`） | 不虚拟化、不折行、不知道项高 | **新做** `chatList` |
| `scrollbar` | 滑块长 = `viewport × 轨道长`（`ui-syntax.md` §12） | 无 | **复用** |
| `toast` | `opacity` 由游戏 tween（`ui-syntax.md` §12） | 无 | **复用**（发送失败提示） |
| `textLines` | 画 `string[]`（`render/contract.ts:72`） | 缺 `string → string[]` | **需扩展** `wrapText`（新函数，不改 `textLines`） |
| `measureText` | 单行宽（`render/contract.ts:89`） | 无 | **复用**（作为 `wrapText` 的 `measure` 注入） |
| `estimateTextWidth` | 纯函数估算，CJK 1 字宽 / ASCII 0.55（`ENGINE-API.md` core/ui 表） | 无 | **复用**（布局期默认 `measure`） |
| `listIndexAt` / `gridIndexAt` | 点位 → 第几项（`item-hit.ts`） | 不适用于变高 | **已由 dev-bot 落地** `listIndexAtVariable`（`variable-window.ts:116`，二分）—— 直接复用 |
| `scrollDragStart/Move/Tick` | 拖动跟手 + 硬钳制 + 指数惯性（`ENGINE-API.md` core/ui 交互表） | 无 | **复用** |
| `KeyboardService` | 三端齐（`platform/contract.ts:248`） | 无 | **复用** |
| `tween` / `MOTION` | 四档时长 + 四条曲线 + 两组弹簧（`core/tween/contract.ts:39`） | 无 | **复用** |
| `openSocket` | 状态机 / 队列 100 / 心跳 / 可选重连（`core/net/contract.ts:141`） | 无 | **复用**（本组件不碰网络，见 §3.6） |

### 2.3 一条架构约束（新增代码放哪）

`wrapText` 若落在 `core/render/`，`core/ui/widgets/*` 就要**值导入** render 模块。
检查过：`core/render/contract.ts:17` 对 ui 只有 `import type { Rect, Slice9Insets, Vec2 } from '../ui/contract'`
—— **type-only，编译后消失**，所以运行时不成环。

但更稳的放法是 **`packages/runtime/src/core/ui/text-wrap.ts`**（纯函数、不碰 canvas）：
`ui` 自包含，将来 `render` 想复用它也不会反向依赖。**建议 dev-bot 落在这里**；
若已落在 `core/render/`，chat 组件从那里导入即可，不用改。

---

## 3. AI 友好 API 设计（核心）

### 3.1 为什么是 3 件：`chatList` / `chatComposer` / `chatBubble`

**先说一条硬约束，它决定了切法**：`.ui` 的可点区域**只能**来自 `layout()` 的 `rects` + `meta`
（`ui-syntax.md` §4.1「命中顺序 = 绘制顺序的逆序，由 `hit.ts` 的 `pickHit` 从 `layout()` 输出的 `meta` 推出」；
`AGENTS.md` §7「命中矩形必须从 layout 结果派生，画与点同源」）。

由此：

| 方案 | 能否成立 | 原因 |
|---|---|---|
| **1 件**（一个 `chat` 包住消息区 + 输入框） | ❌ | 输入框和发送键只在组件内部有坐标，`rects` 里只有一个整屏矩形 → 点发送键时 `pickHit` 只能命中 `chat` 本身，游戏拿不到「点了发送」。要补就只能在组件里自己算命中，直接违反「画与点同源」（第二处算坐标） |
| **5 件**（+ `chatTimeDivider` + `chatStatusBadge`） | ❌ | 时间分隔是 `label` 加 `align=center` 就能画的；发送中/失败是气泡的**状态**（props），不是独立节点。多注册两件只会让 AI 多两个拼错的机会 |
| **3 件**（本文方案） | ✅ | `chatList` / `chatComposer` 各占一个 `.ui` 槽位 → 都在 `rects` 里；`chatBubble` 既可作为组件单放（NPC 头顶台词），也作为 `chatList` 的默认绘制单元 |

**这条界面实际只新增 2 个组件**：标题用现成的 `label`、关闭键用现成的 `button`（`size fixed 44 cross 44`，
正好压住 `§3.5` 那条「触摸目标 ≥44」的底线）。`chatBubble` 在这张 `.ui` 里不出现，它是给
「场景里单放一句台词」准备的；`chatList` 内部绘制时直接调它的 `bubbleParts`，不重复实现。

> 这一条是跑校验时倒逼出来的：初版我写了 `chatTitle` / `chatClose` 两个新组件名，
> `ui.check` 直接报 4 条「未知组件」、`rects` 里 **0 个节点**
> —— 有现成组件就不该造名字（见 §5.4 的实测记录）。

**`chatComposer` 内部有两个可点区（输入框 / 发送键），怎么不破约束？**
用框架已有先例：`keypad` 就是一个组件内含 9 个键，靠 `keypadHit(box, props, point)` 把点位换算成键
（`ENGINE-API.md` core/ui/widgets 表末）。`chatComposer` 同法：导出
`composerHit(box, props, point) => 'input' | 'send' | null`，**几何与绘制共用同一个 `composerParts(box, props)`**
（`ui-authoring` skill §写自定义组件 第 4 条硬规则）。

### 3.2 `chatList`：变高虚拟列表

**不读 `data.itemHeights`，只读 `data.items`。** 项高由组件内部算。

这不是「两套通道打架」，是两个层次的组件各用自己该用的方式（Chief 2026-10-27 拍板）：

| | `list`（泛型容器基元） | `chatList`（语义件） |
|---|---|---|
| 项内容 | `items: unknown[]` + `renderItem` 回调，组件原理上不知道一项多高 | 消息形状由组件自己定义（`text` / `who` / `at` …） |
| 高度来源 | **必须**外部给 `data.itemHeights` | **完全可推**：折行只依赖 `text` / `fontSize` / `bubbleRatio` / `box.w` |
| 结论 | 保留 `data.itemHeights` | 不用它，两者并存 |

```
数据：data.items: readonly ChatMessage[]
      data.renderBubble?: (ctx, item, rect, index) => void   // 可选覆盖
props：itemGap(8) bubbleRatio(0.72) fontSize(15) showTime(true)
       showAvatar(true) emptyText('还没有人说话') scrollTop(0) selfId('me')
```

- **变高窗口**：直接用 dev-bot 已落地的 `core/ui/variable-window.ts` —— `buildVariableIndex(heights, gap)`
  建前缀和（O(n) 一次，1 万项约 0.05ms，见该文件 `:41` 注释），`variableWindow(index, scrollTop, viewH)`
  求可见窗（O(log n)）。**`VariableIndex` 只在 `(items 引用, box.w, fontSize, bubbleRatio)` 变化时重建**，
  其余帧复用（1 万项每帧重折行会卡，这也是 `wrap.ts:157` 那条「组件不回调测量」的理由）。
- **`measure()` 返回 `{ w: box.w, h: box.h }`**（与 `list.ts:58` 同口径）：高度由外层 `size fill` 决定，
  内容总高只影响滚动，不影响占位。
- **子项命中不新造函数**：`core/ui/variable-window.ts:116` 的
  `listIndexAtVariable(point, rect, scrollTop, index, gap)` 就是变高版的 `listIndexAt`，
  语义一致：容器外 / gap 空隙 / 超出 → `null`，**不就近归并**。`chatList` 导出的
  `chatListIndexAt` 只是它的薄封装（把 `props` 换算成 `VariableIndex`），不重写逻辑。

#### 3.2.1 算高度：单一定义 + 两期同一 measure（硬约束 1）

**先摆出现有的明文规矩**：`core/ui/components.ts:227-232` 的注释写着
「布局期不许碰 canvas（`layout()` 是纯函数），所以用估算而不是 `measureText`。
口径与游戏 `draw.ts` 的 `textWidth` 一致 —— 两边不一样会让『测得下』和『画得下』出现偏差，
那是溢出的经典来源」。

所以 `chatList` / `chatBubble` 的**测量口径只有一条，写死三件事**：

| 事 | 写死成什么 | 为什么 |
|---|---|---|
| 唯一的 measure 函数 | `estimateTextWidth`（`components.ts:234`） | 它是纯函数，布局期可调；`ctx.measureText` 只能在绘制期调，两期口径必然漂移 |
| `wrapText` 的 `measure` 参数 | **默认值就是 `estimateTextWidth`，且 chat 组件永不传别的** | 一旦某处传 `ctx.measureText`，同一条消息在布局期折 2 行、绘制期折 3 行 → 压住下一条 |
| 高度函数的调用点 | `bubbleHeight(item, opts)` 单一定义，`measure()`（内容总高）/ `draw()`（窗口偏移）/ `chatListIndexAt()`（子项命中）**三处调同一个** | 与 `ui-authoring` 的 `partsOf` 同一规矩：几何只写一份，两边各写一套就会「画出来比占位大」 |

**绘制期怎么保证「画得下」**：靠 `TextStyle.maxWidth`（`core/render/contract.ts:35-42`），
绘制层会把它透传给 `ctx.fillText` 的第 4 参（`core/render/index.ts:168-170`，`>0` 才透传），
超宽由 canvas **横向压缩**兜住。传**同一个** `bubbleTextW`（由 `bubbleParts` 算出），
**不是**再测一遍宽度——测第二遍就是第二个口径。

> **`wrap.ts:6-10` 的旧注释是错的，已修**（dev-bot 2026-10-27 改，理由是这一条）：
>
> > 用真 `measureText` 折行看似更准，但布局期拿不到 ctx，两期结果必然不同 → 要么少算行数溢出容器、
> > 要么多算留白。所以折行一律按估算，真实字宽偏差交给绘制期 `fillText` 的 `maxWidth` 横向压缩兜住
> > （最坏是被压窄，不会溢出）。
>
> 所以 chat 组件**永不注入 `measure`**，两期都走 `wrap.ts:25` 的 `defaultMeasure`（= `estimateTextWidth`）。
>
> **一个坑**：`maxWidth <= 0` 时绘制层**不透传**（`render/index.ts:168` 注释：0/负数会让 canvas 把文字压成不可见）。
> 所以算出来是 0 等于没兜底 —— `bubbleParts` 必须保证 `bubbleTextW >= 1`。

真实调用就这么两行（`wrapText` 与 `measureItemHeights` 都在 `packages/runtime/src/core/render/wrap.ts`）：

```ts
// 折行（气泡内画文字用）：usable = 气泡宽 − padX×2
const lines = wrapText(item.text, bubbleTextW, { size: 15 });          // wrap.ts:103

// 项高（chatList 内部建索引用）：width 传**气泡宽**，paddingX 传左右内边距之和
const heights = measureItemHeights(items, bubbleW, {                     // wrap.ts:160
  paddingX: 32,          // 16 × 2
  paddingY: 16,          // 8 × 2
  style: { size: 15 },   // 行高自动取 size × 1.2 = 18
  textOf: (it) => (it as ChatMessage).text,
  minLines: 1,           // 非法项按 1 行算（§3.5 第 10 条）
});
```

**数据两期同源**：布局期读 `MeasureEnv.data`、绘制期读 `DrawDeps.data`，由 `resolveUiData`
（`core/ui/data-channel.ts:24`）保证是同一份；单通道写法见 `ui-syntax.md` §12。

#### 3.2.2 props 白名单：不留「手动传高度」的逃生口（硬约束 3）

`chatList` 的 props **只有这 8 个键**，一个不多：
`itemGap` / `bubbleRatio` / `fontSize` / `showTime` / `showAvatar` / `emptyText` / `scrollTop` / `selfId`。

**明确不给**：`itemH` / `itemHeight` / `rowHeight` / `lineHeight` / `heights` / `itemHeights`。
理由：只要有这个口子，AI 一定会用它（这是它最省事的写法），然后「手填 56」和「按文字算出来的 70」
对不上——正是本文档想避免的那类 bug 的入口。`lineHeight` 同理：它由 `fontSize × 1.2` 推导，
放开就会有人传 20 导致文字互相压住。

这条**由测试锁死**（见 §6 判据 16）：`Object.keys(chatList.props)` 必须恰好等于上面 8 个。

`ChatMessage` 形状（**只有 2 个必填字段，越少越不容易写错**）：

```ts
export interface ChatMessage {
  readonly who: string;                       // 说话者 id；左右分流判据 = who === props.selfId
  readonly text: string;                      // 纯文本；富文本走 renderBubble
  readonly id?: string;                       // 稳定 id（做动效 key）；缺省用下标
  readonly at?: number;                       // 毫秒时间戳；不给就不显示时间分隔
  readonly name?: string;                     // 昵称；who === selfId 时不显示
  readonly avatar?: string;                   // 素材 key，缺省用 theme.panel 占位
  readonly state?: 'sent' | 'sending' | 'failed';
}
```

**必填只有两个**：`who` + `text`。其余全可选，缺了不报错（`who` / `text` 缺了才报，见 §3.5 第 5/6/10 条）。

> ✅ **已裁定为可选**（2026-10-27）：`chat-bubble.ts` 的 `id` / `at` 已改为可选，
> 与同文件注释、运行期 `isMessage()`（`chat-list.ts:56-60`）三处口径统一。
> `at` 缺失时**不画时间行、也不计那 16px**（`needsTime` 对非有限值返回 false）。
> `id` 目前**零消费点**（不做按 id 的动效 key），类型留着备用，不为它造假需求。
`who` 是**任意字符串 id**（Chief 2026-10-27 定），不是枚举 —— 理由见 §3.6③。

`chatBubble` 的几何（**唯一真源**：`bubbleParts(box, props)`，`measure` / `draw` / `chatListIndexAt` 三处共用）：

| 量 | 值 | 依据 |
|---|---|---|
| 头像边长 | **32** | TDesign `@spacer-4 = 64rpx`（§1.1） |
| 头像与气泡间距 | **12** | TDesign `@spacer-1 = 24rpx` |
| 气泡内边距 | **padX 16 / padY 8** | TDesign `24rpx 32rpx` → 12/16；纵向取 8 因为纯文字不需要 12 |
| 行高 | **fontSize × 1.2**（15px → 18px） | `docs/ENGINE-API.md` core/render `TextStyle.lineHeight` 默认口径 |
| 圆角 | 靠头像一侧 **0**，其余三角 **12** | TDesign `0 / extraLarge` 的对话气泡语汇；12 在 52px 高的气泡上不塌 |
| 消息间距 | **8**（`itemGap`） | 比 TDesign 的 16 紧一档：游戏聊天信息密度更高 |
| 时间分隔行高 | **16**（`fontSize 12` 的 `label`，`align=center`） | 同分钟不重复显示（§1.4 第 2 条） |
| 配色 | 底色 `theme.panel` / 文字 `theme.light` / 时间与昵称 `theme.disabled` | 组件只从 `DrawDeps.theme` 取（`ui-authoring` 硬规则 3） |
| 失败色 | **`#C2543F`**（朱砂，`failColor` prop 可覆盖） | `theme` 只有 8 个颜色、没有 error 位；与 `docs/motion.md` 的警示色同源 |

### 3.3 `.ui` 怎么写（`ui/chat.ui`，可直接 `ui.check`）

```txt
layer base

# 顶部：固定 56px。不用 % —— 键盘避让要折减 viewport（§4 末尾 C-6 那段），百分比带会跟着抖
region header top 56 row gap 8 pad-x 4% align center
put label size fill cross 32 hit none style text="世界频道" fontSize=16 align=left
put button size fixed 44 cross 44 style text="×" textSize=20

# 消息区：吃掉剩余高度；align stretch 让 chatList 横向吃满（否则用它的 measure 默认宽 296）
region msgs fill column pad-x 3% align stretch
put chatList size fill style itemGap=8 bubbleRatio=0.72 fontSize=15 showTime=true showAvatar=true emptyText="还没有人说话"

# 输入区：固定 72px 带（列方向 size=高，fill 后正好 72−8×2=56）
region composer bottom 72 column pad-x 3% pad-y 8 align stretch
put chatComposer size fill style placeholder="说点什么…" maxLength=60 sendText="发送" sendWidth=56
```

四条写法纪律（每一条都对应 §3.5 里的一种报错）：

1. **`chatList` 只能 `size fill`**，不许 `auto` / 固定高度 —— 写错进 `assert()` 报错。
2. **消息数组不进 `.ui`**：`style` 只装标量（`ui-syntax.md` §5），`props` 声明里干脆不列 `items`，
   拼了也只会得到「不是合法参数 + 该去哪」。
3. **`hit` 只对 `chatComposer` 显式写**（默认就是 `self`）；只读文字写 `hit none`（见上面标题那行）。
4. **数字都是像素的物理量**（56 / 32 / 72 / 8），比例量（`pad-x 3%`、`bubbleRatio`）走比例 ——
   与 `ui-syntax.md` §3「水平方向百分比用视口宽」同一套基数。

### 3.4 数据怎么喂

**沿用单通道**：`.ui` 的 `data` 交给 `layout.compute(screen, viewport, state, data)`，
挂在 `ScreenLayout.data`，绘制期自动注入 `DrawDeps.data`（`ui-syntax.md` §12「数据组件的双通道注入」，
模板实现见 `templates/iaa-ui/src/app/layout.ts:83-97`）。

| 东西 | 谁给 | 什么时候给 | 走哪条通道 |
|---|---|---|---|
| `items`（消息数组） | 游戏 state | 每帧（只读快照） | `data.items` |
| 项高 | **组件自己算** | `(items.length, box.w, fontSize, bubbleRatio)` 变化时 | —— 不对外 |
| `renderBubble`（自定义气泡） | 游戏，可选 | 启动时给一次 | `data.renderBubble` |
| 气泡宽度上限 | 组件按 `bubbleRatio × box.w` 算 | 每帧 | `.ui` 的 `style bubbleRatio` |
| 输入框值 / 焦点 / 发送态 | 游戏 state | 每帧 | **`dynamicProps`**（`layout.ts:59-62` 的 `progress` / `statusText` 同一套） |
| 发送回调 | 游戏 | —— | **不进组件**：`pressUp().activated` → `composerHit()` 判区 → `dispatch` |

**为什么输入框的值不放进 `data`**：它是标量，`props` 本来就是干这个的；
放进 `data` 会让「布局期 / 绘制期两份数据」又多一个要对齐的键。

```ts
// 每帧
const data = { items: state.messages };                      // 只给数组
const view = engine.compute('chat', viewport, state, data);  // 单通道
// dynamicProps 里合并
const props = { chatComposer: { value: state.draft, focused: state.composerFocused,
                                sending: state.sending ? 'true' : 'false' } };
```

### 3.5 报错怎么报（AI 友好关键：10 条）

原则：**每条都说三件事** —— 谁错了（组件 + 行号 / 第几条）、为什么、改成什么。
`.ui` 行号来自编译产物 `lines`（`ui-syntax.md` §7）；运行期错误只报**一次**（不进每帧循环），
走 `console.error('[mg chat] ' + msg)`，与 `templates/iaa-ui/src/app/render.ts:31` 的
`[mg ui data]` 前缀同一风格。

| # | AI 会怎么写错 | 报错原文 |
|---|---|---|
| 1 | 组件名大小写错（`ChatList`） | `chat.ui:9: 未知组件 'ChatList'，已注册的有：chatBubble / chatList / chatComposer / list / label / input …（组件名区分大小写）` |
| 2 | 列表高度写死 / 写 `auto` | `chat.ui:9: chatList 的高度必须由外层槽位决定，收到 size=auto（会算出 0 高，整块不显示）。改成 size fill，或在 region 上写 top/bottom 给它一个带` |
| 3 | 把数组写进 `.ui`（`items=` / `messages=` / `list=`） | `chat.ui:9: style 键 'items' 不是组件 chatList 的合法参数，可用：itemGap / bubbleRatio / fontSize / showTime / showAvatar / emptyText / scrollTop / selfId。消息数组请通过 DrawDeps.data.items 注入（见 docs/CHAT-UI.md §3.4）` |
| 4 | 只喂布局期 data、没喂绘制期 | `[mg ui data] 绘制期未传入 data，但布局期有数据。数据组件会「状态对、画面空」——请把同一份 data 交给 DrawDeps.data，或只用 ScreenLayout.data 单通道`（沿用 `data-channel.ts:31` 原文） |
| 5 | 消息缺 `who` | `chatList 第 3 项形状不合法：缺少 who（string，说话者 id）。期望 { who: string; text: string }（其余可选），收到 { text: '好' }。这一项画成虚线占位框，高度按 1 行算，其余消息照常显示` |
| 6 | `who` 写成 boolean / 数字（`true` / `1`），想表达「是不是我」 | `chatList 第 2 项形状不合法：who 是 boolean（收到 true），必须是说话者 id 字符串。自己填 selfId 的值（默认 'me'），对方填他自己的 id（如 'npc-a'）；左右分流靠 who === props.selfId 判定` |
| 7 | `text` 塞了对象/数组（想传富文本） | `chatList 第 5 项形状不合法：text 是 object，只接受 string。富文本 / 表情 / 图片请用 data.renderBubble 自己画，并把 text 留给无障碍与日志` |
| 8 | `bubbleRatio` 越界 | `bubbleRatio 收到 1.6，只接受 0.4–1。默认 0.72；大于 1 会被钳到 1（气泡宽 = min(可用宽, 容器宽×bubbleRatio)），小于 0.4 一句话要折 4 行`（`chat-list.ts:219-221` 原文） |
| 9 | `chatComposer` 写了 `hit none` / 没接键盘 | `.ui` 期：`chat.ui:14: chatComposer 的 hit 是 none，点它不会聚焦（点击会穿透到下层）。输入框需要 hit self`<br>运行期：`chatComposer：点击输入区后 500ms 内没有调用 platform.keyboard.open()，键盘不会弹出（组件只画不弹，见 keyboard-contract.ts:51）。在 press 处理里调 platform.keyboard.open({ rect: view.rects.chatComposer })` |
| **10** | **整项不是对象 / 形状不合法（硬约束 2）** | `chatList 第 4 项形状不合法：不是对象（收到 string "你好"）。期望 { who: string; text: string }，可选 id / at / name / avatar / state。这一项画成虚线占位框，高度按 1 行算，其余消息照常显示` |

**第 10 条附带的实现要求（写死，别自由发挥）**：

1. **不静默跳过** —— 非法项仍占**一个固定的 1 行气泡高度**（`fontSize×1.2 + padY×2` = 34px）。
   直接 `continue` 会让下面所有项往上跳一格，用户看到的是「消息错位」而不是「一条消息坏了」。
2. **不画成空** —— 画虚线框 + 一行小字「格式错误（见控制台）」，让画面自己说明有问题。
3. **只报一次** —— 同一个 `id`（缺省为下标）的同类错误不重复刷屏；`items` 换成新引用的那一帧才允许再报。
4. 报错**必须给出完整的期望形状**（不是只说「格式不对」），AI 才能照着改。

另有 **3 条** `assert()` 静态断言（进 `bound.errors` / `ui.check` 输出，不 console；文案照 `chat-list.ts:213-244` 抄）：

| 触发 | 报错原文 |
|---|---|
| 视口装不下 2 行 | `列表视口高 68px < 一条气泡 34px 的 2 倍，最多只能看到 1 条`（`34 = 18 行高 + 16 上下边距`） |
| 写了高度类 props | `chatList 的 props 出现 'itemH'：高度由组件按文字算，不接受手填（可用：itemGap / bubbleRatio / fontSize / showTime / showAvatar / emptyText / scrollTop / selfId）` |

> `bubbleRatio` 那条已归到上表第 8 条（它是 `.ui` 期就报的，不是 `assert` 独占）。
> 且**不再卡 0.9**：气泡宽是 `min(可用宽, 容器宽 × bubbleRatio)`，`min` 本身就是真约束 ——
> ratio 再大也超不出可用宽，不可能顶到对侧头像。卡 0.9 会误杀「公告 / 系统频道要满宽气泡」
> 这类合理设计（`chat-list.ts:216-218` 的注释）。

### 3.6 三条「AI 最容易写错的地方」及预防设计

**① 把消息数据写进 `.ui`**（最常见：AI 把模板当 JSX）
预防：`chatList` 的 `props` 声明里**根本不出现**数组键 → 报错 #3 直接给出 `DrawDeps.data.items`；
另外 `ui/chat.ui` 示例里**一条消息都没有**，不给模仿样本。

**② 自己算气泡高度 / 自己算 scrollTop**
AI 的典型写法是 `const itemH = 56; y = i * itemH` 或 `scrollTop = items.length * 44`。
预防：`chatList` **不暴露任何高度类 prop**（白名单见 §3.2.2，没有 `itemH` / `lineHeight`，
由测试锁死）；`assert()` 在 `scrollTop > 内容总高 - 视口高` 时报错并给出正确写法
（`scrollTop = max(0, contentH - box.h)`，或直接 `scrollTick()` 的输出）；
`chatListHeights()` 导出给游戏侧预判高度（薄封装 `measureItemHeights`），避免游戏自己乘。

**③ 把「方向」写成 boolean 或二元枚举**（定稿：`who: string` + `props.selfId`）

三种写法都能画，但只有第三种不用改类型：

| 写法 | 谁最容易这么写 | 崩在哪 |
|---|---|---|
| `mine: boolean` / `isSelf: true` | AI 最爱（最省事） | 丢「谁说的」。两人对话够用，一进群聊就得加 `speakerId`，等于把字段重设计一遍 |
| `who: 'me' \| 'other'`（本文档初版） | 我第一版就是这么写的 | 类型里写死了「只有两个说话者」。加第三个人要改成 `'me'\|'npc-a'\|'npc-b'` → **破坏性变更**，所有游戏跟着改 |
| **`who: string` + `props.selfId`** ✅ | 定稿 | 两人对话填 `'me'` / `'npc'`，群聊填 `'npc-a'` / `'npc-b'`，**同一个类型不用改**；换视角（回放 / 旁观）只改 `selfId` 一个 prop，不动数据 |

判据只有一条：**`who === props.selfId` → 靠右，否则靠左**。`selfId` 默认 `'me'`，
所以最小用法（两人对话、自己叫 me）零配置就能跑。

为什么这算「AI 友好」而不是设计洁癖：**AI 看到 `mine` 会自然写布尔**（英文语义就是「是不是我的」），
看到 `who` 会自然想「谁」并去填一个人名/id —— 字段名本身就在把 AI 往正确形状上推。
反过来，报错 #6 就是专门堵「想表达是不是我 → 写成 `true`」这条路的。

`who` 的校验只用「是 string 且非空」，**不枚举**；`checkPropValue` 的枚举写法在这里故意不用。

---

## 4. 动效

全部取自 `MOTION`（`core/tween/contract.ts:39`，与 `docs/motion.md` v1.0 §9 同源）：

```
ms:      { instant: 60, micro: 120, state: 240, emphasis: 480 }
stagger: { step: 60, max: 4 }
ease:    in  cubic-bezier(0.4, 0, 1, 1)       y(.5)=0.324815
         standard cubic-bezier(0.4, 0, 0.2, 1) y(.5)=0.775561
         out cubic-bezier(0, 0, 0.2, 1)        y(.5)=0.839245
         back cubic-bezier(0.34, 1.56, 0.64, 1) y(.5)=1.087401
```

| # | 动效 | 触发 | 时长 / 曲线 | 变化量 | 判据 |
|---|---|---|---|---|---|
| C-1 | **气泡进场** | `items` 末尾新增 | **240ms**（T2）/ `out` | `scale 0.94 → 1.000` + `alpha 0 → 1`；同帧追加多条按 `stagger` 错峰 0/60/120/180ms，**最多 4 条**（`stagger.max`） | 260px 宽气泡 `scale 0.94` = 15.6px 位移差（>2px 可感知门槛 ✓）；末态 `scale` 1.000±0.01 |
| C-2 | **发送中** | 消息 `state='sending'` | **120ms**（T1）/ `standard` 淡到 0.6；转圈周期 **800ms** | 气泡 `alpha 1 → 0.6`；右侧 8px 圆点绕自身中心转整圈 | 圆点区 200ms 内像素差 ≥0.5%（旋转导致）；`alpha` 末值 0.6±0.02 |
| C-3 | **发送失败** | `state='failed'` | **120ms**（T1）/ `standard` | `alpha 0.6 → 1`；左缘 3px 竖条 `#C2543F`；气泡底色不改（只加竖条 + 底部 12px 高「重发」文案） | 竖条区 3px 宽内红色像素数 > 0 且 < 24（3×8）；末态 `alpha` 1.0±0.02 |
| C-4 | **贴底跟随** | 新消息到达且 `contentH - viewH - scrollTop ≤ 8` | **120ms**（T1）/ `out`，每帧 `redirect()` **不新建** | `scrollTop` 重定向到 `max(0, contentH - box.h)` | 连发 5 条后 `contentH - viewH - scrollTop ≤ 1px`；过程中 `scrollTop` 单调不减（不回弹） |
| C-5 | **上滑脱离** | 用户拖动，`scrollDragMove` 后 `scrollTop + viewH < contentH - 8` | 跟手无 tween（硬钳制） | 位移 = 手指位移；此时新消息到达**不改** `scrollTop`，只在底部显示「↓ 3 条新消息」 | 拖 40px → 位移 40±1px；脱离态新消息到达前后 `scrollTop` 差 ≤0.5px |
| C-6 | **键盘避让** | `keyboard.onClose` / 键盘高度变化 | **240ms**（T2）/ `standard` | `composer` 带底边 y 从 `H` → `H - K`（K = 键盘高）；目标 rect 由“折减 viewport 后重新 layout”得到，绘制期用 tween 插值逼近 | 200ms 时已走完 ≥70%（`standard` y(0.83)≈0.97）；240ms 后 `|y - target| ≤ 1px` |

**两条实现纪律**：

1. **C-5 的「脱离 / 贴底」是一个布尔状态，不是动画状态**：`followBottom` 只在
   `scrollDragStart`（转 false）和 `scrollTick` 撞到底部（转 true）时翻转。
   不要每帧用「是否在底部」重新判定 —— 跟手过程中会来回抖。
2. **C-2 的旋转不要用四条曲线**：`CURVES` 只有 in/standard/out/back，套上去转速会忽快忽慢。
   用 `(nowMs % 800) / 800 * 2π`。这条与 `input.ts:54` 的光标闪烁同思路（从 `Date.now()` 推，不开定时器）。

**键盘避让为什么选「折减 viewport」而不是「平移 rect」**：
`.ui` 的 `bottom` 带是相对视口的（`ui-syntax.md` §3）。把 `viewport.height` 减掉键盘高，
`composer` 自然上移、`msgs` 自然缩短，**一次 layout 解决两件事**，且不会出现「输入框上移了、消息区还压在键盘下面」。
代价是 `%` 高度带会跟着变 —— 所以 `header` 用固定 56（§3.3 第一条纪律）。
`hudOffsetFor`（`ui-authoring` skill 顶部胶囊避让那节）的「平移一层矩形」是回退方案：
只在平台给不出键盘高度、但能给出遮挡区域时用。

---

## 5. 完整示例

> **验证状态（据实标注）**：`.ui` **已跑过** `ui.check` + 注册表校验 + 两视口布局，
> 实测见 §5.4（12/0 通过；`ui.check` 只剩 2 条「未知组件」，因为 `chatList` / `chatComposer` 还没实现）。
> TS **未编译验证**（依赖 `wrapText` / barrel 导出，见附录 A），落地后**必须回来补跑**（§5.3）。

### 5.1 `ui/chat.ui`（8 条消息的界面骨架）

```txt
layer base

region header top 56 row gap 8 pad-x 4% align center
put label size fill cross 32 hit none style text="世界频道" fontSize=16 align=left
put button size fixed 44 cross 44 style text="×" textSize=20

region msgs fill column pad-x 3% align stretch
put chatList size fill style itemGap=8 bubbleRatio=0.72 fontSize=15 showTime=true showAvatar=true emptyText="还没有人说话"

region composer bottom 72 column pad-x 3% pad-y 8 align stretch
put chatComposer size fill style placeholder="说点什么…" maxLength=60 sendText="发送" sendWidth=56
```

### 5.2 游戏侧（`src/app/chat.ts` 片段，`import` 用包名）

```ts
// @long-file 示例文件：聊天界面的接线（state 迁移 + 命中 → dispatch）
// 只 import 用到的符号；`scrollTick` / `MOTION` 已由 dev-bot 补进 barrel（附录 A 第 4 条），可用包名。
import { bindComponents, layout, pickHit, scrollTick } from '@mg/runtime';
import { chatListIndexAt, composerHit } from '@mg/runtime';      // ← 本文档新增（§3.1 / §3.2）
import { wrapText } from '@mg/runtime';
import type { ChatMessage, Ctx2D, HitEntry, Rect, ScrollState, StyleProps, UiData } from '@mg/runtime';
import chatUi from '../../ui/chat.ui';

export interface ChatState {
  readonly messages: readonly ChatMessage[];   // 8 条起，见下
  readonly draft: string;
  readonly composerFocused: boolean;
  readonly sending: boolean;
  readonly followBottom: boolean;
}

/** 自己是谁 —— 左右分流只认这个（§3.6③）。换视角（回放/旁观）改这一处即可。 */
export const SELF_ID = 'me';

export const INITIAL_CHAT: ChatState = {
  messages: [
    // 三位说话者：自己（'me'）+ 两个人。who 是自由字符串，所以三人对话不用改类型。
    { id: 'm1', who: 'ahe', text: '今晚的副本还缺人吗？', at: 1_764_000_000_000, name: '阿禾' },
    { id: 'm2', who: 'me', text: '缺一个，你来不来', at: 1_764_000_030_000 },
    { id: 'm3', who: 'ahe', text: '来。我先把这边的货交掉，大概两分钟', at: 1_764_000_060_000, name: '阿禾' },
    { id: 'm4', who: 'me', text: '好，我在门口等', at: 1_764_000_090_000 },
    { id: 'm5', who: 'xiaoman', text: '带上我，我这周还没打过', at: 1_764_000_200_000, name: '小满' },
    { id: 'm6', who: 'me', text: '三个人正好，人满就开', at: 1_764_000_230_000 },
    { id: 'm7', who: 'ahe', text: '到了', at: 1_764_000_300_000, name: '阿禾' },
    { id: 'm8', who: 'xiaoman', text: '我也到了，就在桥头', at: 1_764_000_330_000, name: '小满' },
  ],
  draft: '',
  composerFocused: false,
  sending: false,
  followBottom: true,
};

/**
 * 一帧：布局 → 绘制数据 → 按键命中。
 * `data` 单通道（同时喂 measure 与 draw），只装数组类东西。
 */
export const composeFrame = (
  viewport: { readonly width: number; readonly height: number },
  state: ChatState,
  draftProps: Readonly<Record<string, StyleProps>>,
) => {
  const data: UiData = { items: state.messages };
  const bound = bindComponents(chatUi.spec, { registry: chatRegistry, env: { viewport, data } });
  const solved = layout(bound.spec, viewport);

  // 动态 props 与 .ui 的静态 style 逐键合并（同 templates/iaa-ui/src/app/layout.ts:67-77）
  const props: Record<string, StyleProps> = {};
  for (const [name, base] of Object.entries(bound.props)) props[name] = { ...base };
  props.chatComposer = {
    ...(props.chatComposer ?? {}),
    value: state.draft,
    focused: state.composerFocused,
    sending: state.sending,
    ...(draftProps.chatComposer ?? {}),
  };

  // `NodeMeta.layer` 是 LayerName('base'|'overlay')、`HitEntry.layer` 要 number ——
  // 取 `layerIndex`，**不能**把 meta 整个 spread 进 HitEntry（tsc 报 TS2322）
  const entries: HitEntry[] = solved.paintOrder.map((name) => {
    const meta = solved.meta[name]!;
    return { name, rect: solved.rects[name]!, hit: meta.hit, layer: meta.layerIndex, index: meta.index };
  });

  return { rects: solved.rects, props, entries, data, errors: [...bound.errors, ...solved.errors] };
};

/** 点击：先按 layout 命中到组件，再按组件内部区（keypadHit 同法）判到具体区。 */
export const onTap = (point: { readonly x: number; readonly y: number }, frame: ReturnType<typeof composeFrame>) => {
  const hit = pickHit(frame.entries, point);
  if (hit === null) return null;
  if (hit.name !== 'chatComposer') return hit.name;
  const box: Rect | undefined = frame.rects.chatComposer;
  if (box === undefined) return null;
  return composerHit(box, frame.props.chatComposer ?? {}, point); // 'input' | 'send' | null
};

/** 长按某条消息。`chatListIndexAt` 是 `listIndexAtVariable` 的薄封装（不重写逻辑），
 *  内部：measureItemHeights(items, listW, opts) → buildVariableIndex → listIndexAtVariable。
 *  这样游戏侧不需要知道 avatar / gap / bubbleRatio 这些常量。 */
export const messageAt = (
  point: { readonly x: number; readonly y: number },
  frame: ReturnType<typeof composeFrame>,
  scrollTop: number,
  state: ChatState,
): number | null => {
  const box: Rect | undefined = frame.rects.chatList;
  if (box === undefined) return null;
  return chatListIndexAt(point, box, frame.props.chatList ?? {}, state.messages, scrollTop);
};

/** 每帧：贴底跟随时把 scrollTop 拉到底；脱离状态交给惯性（C-4 / C-5）。
 *  注意 `scrollTick` 的 dt 单位是**秒**（core/ui/scroll.ts:83），传毫秒会让阻尼永远不衰减。 */
export const advanceScroll = (
  scroll: ScrollState,
  dtSec: number,
  contentH: number,
  viewH: number,
  state: ChatState,
): ScrollState => {
  if (!state.followBottom) return scrollTick(scroll, dtSec, contentH, viewH);
  const target = Math.max(0, contentH - viewH);
  return { offset: target, velocity: 0, dragging: scroll.dragging };
};

/**
 * 画一条气泡的文字（**兜底就落在这里**）：折行按估算，绘制带 `maxWidth`。
 *
 * `maxWidth` 走 `TextStyle.maxWidth`（core/render/contract.ts:35-42）→
 * 绘制层透传给 `ctx.fillText` 第 4 参（core/render/index.ts:168-170）。
 * 真实字宽比估算宽时，canvas 横向压缩，不会溢出气泡。
 */
export const drawBubbleText = (
  ctx: Ctx2D,
  text: string,
  at: { readonly x: number; readonly y: number },
  contentW: number,
  color: string,
): void => {
  const style = { size: 15, color, maxWidth: Math.max(1, contentW) }; // ← 必须 ≥1：≤0 不透传
  const lines = wrapText(text, style.maxWidth, style);                // 折行：两期同一估算
  const lh = style.size * 1.2;                                        // 18
  ctx.save();
  ctx.font = `${style.size}px sans-serif`;                             // 用 deps.theme.fontFamily
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;
  for (let i = 0; i < lines.length; i += 1) {
    ctx.fillText(lines[i] as string, at.x, at.y + i * lh, style.maxWidth); // ← 第三参之外的兜底
  }
  ctx.restore();
};

/** 气泡左右分流：只认这一个判据（§3.6③）。 */
export const isMine = (item: ChatMessage, selfId: string): boolean => item.who === selfId;
```

`chatRegistry` 的装配（与现有 31 件同一个 registry，`createWidgetRegistry` 已从 `@mg/runtime` 导出，见 `packages/runtime/src/index.ts:95`）：

```ts
import { createWidgetRegistry } from '@mg/runtime';   // 25 个通用组件（22 + chatBubble / chatList / chatComposer）
import { chatList, chatComposer, chatBubble } from '@mg/runtime';  // ← 本文档新增
const chatRegistry = createWidgetRegistry();
chatRegistry.register(chatBubble);
chatRegistry.register(chatList);
chatRegistry.register(chatComposer);
```

### 5.3 两条自检命令（可直接执行 / 何时补跑）

**① `.ui` 界面层 —— 现在就能跑**（`docs/START-HERE.md:319` 指定的做法：抄 `games/ui-demo/tools/verify-ui.mjs`）。
把 `ui/chat.ui` 落到游戏目录后，在**游戏目录**执行：

```bash
# 通用：把 verify-ui.mjs 抄到本游戏 tools/，改三处（SCREENS 换成 chat、registry 换成自己的、路径上跳两级）
node tools/verify-ui.mjs
```

本设计提交时用的是同一套逻辑的单界面版本（临时脚本，未入库），跑出来的结果见 §5.4。
它做四件事：MCP `ui.check`（语法 + 布局 + 结构断言，**不接注册表**）→ `compileUi` 注册表校验
→ `bindComponents` + `layout()` 两视口 → 打印每个组件 rect。

> 期望输出：**`errors = 0`**（组件已全部实现，不会再有「未知组件」）。
> 一旦出现任何一条，就是 `.ui` 或注册表接错了 —— 不许当「预期噪音」放过。

**② `tsc` —— 全段跑过：A 档 0 错误**（2026-10-27，barrel 与 `ChatMessage` 修好之后）

配置与仓库一致（`strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`），
用 `paths` 把 `@mg/runtime` 映射到 `packages/runtime/src/index.ts`，编译 §5.2 的完整示例：

```
A 档（文档原样，全部包名导入）：EXIT=0    0 error
```

三档完整记录（B / C 是修好之前的排查过程，**留着是为了说明「错在哪一层」，不是现状**）：

| 档 | 变量 | EXIT | 错误 | 当时的成因（**均已修**） |
|---|---|---|---|---|
| **A** | 文档原样（全部包名导入） | **0** ✅ | **0** | —— |
| B | 只把 chat 六个 import 改指 `core/ui/widgets`（仅验证用） | 1 | 8 条 `TS2741` | `ChatMessage.id` 当时是必填，与同文件注释、运行期 `isMessage()` 三处不一致 |
| C | B + 给 8 条消息补 `id` | 0 | 0 | 用来证明「代码本身类型正确，错在导出与类型定义」，把两个外部前置与我的代码分开 |

> A 档在修好前是 **6 条 `TS2305`**（chat 六个符号没进根 barrel）。补齐后归零，**示例一个字没改** ——
> 这条路径本身也是证据：**卡住时先分清是实现没导出还是自己写错**，不要为了「现在能编译」改回相对路径。

交付前要跑的两条（组件或 barrel 再动过就必须重跑）：

```bash
node packages/cli/bin/mg.mjs build --target web    # 组件名 / style 键的真校验在这里
pnpm -w typecheck                                  # 或 cd packages/runtime && npx tsc --noEmit
```

### 5.4 实测：两视口 rect + 内容高（组件落地后的真数值）

跑法见 §5.3①。注册表 = **34 个真实组件**（9 个内置业务件 + **25** 个通用组件，含 `chatBubble` / `chatList` / `chatComposer`），
**没有任何桩** —— 组件已全部实现，`ui.check` 0 条「未知组件」。

**结果：13 通过 / 0 失败。** `ui.check` / `compileUi` / `bind` / `layout` / `assertComponents` 全部 0 error。

| 组件 | 390×844（x / y / w / h） | 320×568（x / y / w / h） |
|---|---|---|
| `label`（标题） | 15.6 / 12 / **306.8** / 32 | 12.8 / 12 / **242.4** / 32 |
| `button`（关闭） | 330.4 / 6 / **44** / 44 | 263.2 / 6 / **44** / 44 |
| `chatList` | 11.7 / 56 / **366.6** / **716** | 9.6 / 56 / **300.8** / **440** |
| `chatComposer` | 11.7 / 780 / **366.6** / 56 | 9.6 / 504 / **300.8** / 56 |

区域带（`regions`）：

| region | 390×844（y / h） | 320×568（y / h） |
|---|---|---|
| `header` | 0 / 56 | 0 / 56 |
| `msgs` | 56 / 716 | 56 / 440 |
| `composer` | 772 / 72 | 496 / 72 |

**与上一轮（桩时代）逐位对比：四个 rect 完全相同**（366.6×716 / 300.8×440 / 11.7 / 9.6 …）——
说明实现落地的几何与设计一致，`chatList.measure` 回显可用框的口径（`chat-list.ts:146-149`）也和 `list.ts:58` 一致。

**实测内容高（`chatListHeights()` 真算，不是手算）**：

| 量 | 390×844 | 320×568 |
|---|---|---|
| 气泡宽 `min(可用宽, 366.6×0.72)` | **263.95** | **216.58** |
| 文字可用宽 `bubbleW − 32` | **231.95** | **184.58** |
| 逐项高（8 条，含时间分隔） | `50, 34, 68, 34, 50, 34, 50, 34` | 同左 |
| 内容总高（+ 7×8 gap） | **410.0** | **410.0** |
| 视口高 | 716 | 440 |
| 结论 | 不滚（410 < 716） | **不滚**（410 < 440） |

**两处修正（我上一轮手算错了，以实测为准）**：

1. **项高要算时间分隔行**：`chatListHeights` 对「同一分钟内的第一条」额外加 `TIME_H = 16`
   （`chat-list.ts:79` / `:93`）。8 条里第 1/3/5/7 条各带一个时间行 → 手算漏了这 64px。
2. **320 视口 8 条并不需要滚**（410 < 440）。上一轮我按「30 字消息折 3 行」估出 616，那是拿
   假设的长消息算的；示例里最长一条 18 字，在 184.58 宽下仍只折 **2 行**。所以「窄屏 8 条必滚」这个
   说法是错的 —— 要滚得靠**条数**（判据 5 用 16 条：按实测项高翻倍约 820 > 716 / 440）。

> 其余结论仍然成立：`button` 44×44 满足触摸门槛；`header` 56 高、按钮垂直居中 → `y = (56−44)/2 = 6`；
> 两视口 `assertComponents` 均 0 issue（`bubbleRatio 0.72` 在 `0.4–1` 内、视口装得下 2 行气泡）。

---

## 6. 验收判据（每条可判真假）

| # | 判据 | 口径（数字） |
|---|---|---|
| 1 | **结构不溢出** | 两视口跑 `layout()`：`errors.length === 0`；`findOverlaps(rects)` 返回 `[]`（贴边不算重叠，`split.ts` 契约）；四个 rect 全部落在 viewport 内（`x≥0 && y≥0 && x+w≤W && y+h≤H`） |
| 2 | **真的画了**（防「状态全绿、画面全空」） | 8 条消息、`msgs` 区 ROI 像素统计：**非背景像素占比 ≥ 5%**、**唯一主色 ≥ 3**、**横向颜色切换次数 ≥ 6**（多行采样取中位数，单行可能压在两气泡的间隙上） |
| 3 | **左右分流** | 判据是 `who === props.selfId`（不是枚举值）：`who='me'` 的气泡**右边缘** `x ≥ W × 0.90`；`who='ahe'` 的**左边缘** `x ≤ W × 0.10`。390 下实测预期：右侧 378.3（97.0%）、左侧 11.7（3.0%）。**再验一条**：把 `selfId` 改成 `'ahe'`，同一条数据左右**翻转**（原左侧气泡的右边缘 ≥ 0.90W）——证明分流靠 prop 而不是硬编码 |
| 4 | **气泡宽度上限** | 造一条 200 字的消息，量其气泡 bbox 宽：`w ≤ listW × 0.72 + 1`，且 `w > listW × 0.5`（证明不是被截断成一点点） |
| 5 | **滚动到底** | 够条数让内容总高超过视口：实测 8 条 = **410**，故取 **16 条（约 820）**，两视口都超（716 / 440）。`scrollTop = max(0, contentH − viewH)` 时，最后一条满足 `top + h ≤ box.y + box.h + 1`；首条 `top < box.y`（确实滚下去了）。内容高用 `chatListHeights()` 实测，不手算 |
| 6 | **滚动钳制** | `scrollTop = -50` 与 `scrollTop = 1e9` 都不崩：前者按 0 画、后者按 `contentH − viewH` 画，末帧像素与第 5 条一致（差 ≤1%） |
| 7 | **命中：发到组件** | `pickHit(entries, {x: W×0.9, y: composer.y + composer.h/2})` → `name === 'chatComposer'` |
| 8 | **命中：组件内分区** | `composerHit(box, props, 点)` 三点三答案：发送键中心 → `'send'`；输入框中心 → `'input'`；两者之间 4px 间隙 → `null`（**不就近归并**） |
| 9 | **变高命中** | `chatListIndexAt(point, rect, props, items, scrollTop)`（**第 3 参是 props**，不是 scrollTop —— 要靠 fontSize/bubbleRatio 重算项高）：8 条消息时点在「第 2 条气泡内」→ `1`；点在两气泡之间的 8px 间隙 → `null`；点在列表外 → `null`；越界索引 `items.length` 不存在（返回 `null`） |
| 10 | **键盘避让** | 键盘高 K=300：`composer` 带底边 y 由 `H` 变为 `H−300`（±2）；`msgs` 高减少 300（±2）；`header` rect **完全不变**（差 0） |
| 11 | **动效 C-1** | 新消息进场：取 t=0 / 120 / 240ms 三帧，相邻两帧气泡区像素差 ≥ 0.5%；末帧 `scale` 1.000±0.01；三条同时到达时第 1/2/3 条的首帧差异时刻相隔 **60ms ±16**（`stagger.step`） |
| 12 | **动效 C-4** | 贴底态连发 5 条：末态 `contentH − viewH − scrollTop ≤ 1px`；5 帧采样 `scrollTop` 单调不减 |
| 13 | **动效 C-5** | 拖动 40px：`scrollTop` 变化 40±1px；脱离态来新消息，前后 `scrollTop` 差 ≤0.5px；`followBottom` 在 `scrollDragStart` 后为 `false`、撞底后为 `true` |
| 14 | **报错可读** | 人为制造 §3.5 的 **10** 种错误，每种都命中对应文案，且**每条都包含「改成什么」**（无「已修改为」之类无法照做的措辞） |
| 15 | **无每帧日志** | 正常路径跑 600 帧，`console.error` 调用 **0 次**（错误只报一次且只在真错时报） |
| 16 | **props 白名单锁死**（§3.2.2） | 单测：`Object.keys(chatList.props)` 排序后 **恰好等于** `['bubbleRatio','emptyText','fontSize','itemGap','scrollTop','selfId','showAvatar','showTime']`（**8 个**）。多一个（尤其 `itemH` / `lineHeight`）即红 —— 这条锁的是「不留手动高度逃生口」 |
| 17 | **非法项不改布局** | `items` 第 4 项塞一个 `string`：`measureItemHeights()` 第 4 项仍为 **34**（`1×18+16`）；第 5 项及之后的 `offset` 与全合法时**逐项相等**（差 0）——证明「不静默跳过、不塌成 0」 |

> 判据 2 的三个阈值沿用 `ui-syntax.md` §12 实测结论（「唯一主色 ≥ 4、非背景 > 50%、横向切换 ≥ 6」的那条），
> 但**调低了非背景占比**：聊天区大面积留白是正常形态，按 50% 判会假红。5% / 3 色 / 6 次按 8 条气泡的实际覆盖算过
> （8×264×52 ≈ 11 万像素，`msgs` 区约 26 万像素 → 覆盖 40% 理论值，但气泡内还有 16px 内边距与文字留白，
> 实测预期落在 8–20% 区间，取 5% 作下限留余量）。

---

## 附录 A：依赖与待确认（与 dev-bot 的接口）

> 六节正文（§1–§6）之外的附录，只记「本设计依赖哪些还没落地的东西」。纯约定，不含设计内容。

本文档按「组件已落地」复核。**六条，按 2026-10-27 的实际代码逐条验过：**

| # | 状态 | 实测/结论 |
|---|---|---|
| 1 | ✅ **已落地，签名与本设计一致** | `wrapText(text, maxWidth, style?, measure?) => readonly string[]`（`core/render/wrap.ts:103`）；`measureItemHeights(items, width, opts)`（`:160`，注意第 2 参是**宽度**、`paddingX` 是左右之和）。两条口径已对齐：空串返回 `[]`（不是 `['']`），配合 `minLines: 1` 正好给出 §3.5 第 10 条要的 **34px** |
| 2 | ✅ **分层划分，不是偏离**（Chief 拍板） | `list` 是泛型容器基元，走 `data.itemHeights`；`chatList` 是语义件，自算高度。两者并存（对照表见 §3.2 开头） |
| 3 | ✅ **旧注释是错的，已修** | `wrap.ts:6-10` 曾主张「布局期估算、**绘制期传 `render.measureText`**」—— 错，已由 dev-bot 改掉（理由见 §3.2.1 引的那段原文）。配套：`TextStyle.maxWidth`（`contract.ts:35-42`）已声明并透传（`render/index.ts:168-170`，`>0` 才透传）。chat 组件永不注入 `measure`，两期都走 `wrap.ts:25` 的 `defaultMeasure` |
| 4 | ✅ **wrap / variable 的 barrel 已齐**（我上一次报错了，见下） | `index.ts:118` `export { measureItemHeights, wrapText }`；`index.ts:121-125` `buildVariableIndex` / `listIndexAtVariable` / `variableWindow` + 两个类型。**我上次读的是旧快照**（dev-bot 在我读之后补的） |
| **5** | ✅ **已修：33 个符号补齐 + 自动对比测试** | 根 barrel 补齐后，自动对比测试第一次运行就抓出 **33 个符号**从未导出过（不只是 chat 三件）：`core/ui/widgets/index` **25 个**（22 个旧组件的**本体**终于能按名字导入 + `cursorVisibleAt` / `fitText` / `keypadHit` + chat 三件）、`core/render/index` **3 个**（含 `createRender`）、`core/ui/index` **5 个**（`splitCols` / `splitRows` / `gridOf` / `findOverlaps` / `ratiosSum`）、`core/tween` **0 个**（上次已补对）。<br>最值得记的一条：**22 个旧组件本体从来没从包名导出过**——因为 `createWidgetRegistry()` 能用，所以一直没人发现；想手写注册表、只注册其中几个，就拿不到 `button` / `panel` / `list`。集成方式变成「自动对比」后这类漏点自己会跳出来（原来靠人记） |
| **6** | ✅ **已裁定为可选，与运行期一致** | `ChatMessage.id` / `ChatMessage.at` 改为可选，`chat-bubble.ts` 的注释、类型、运行期 `isMessage()`（`chat-list.ts:56-60`）三处口径统一。`at` 缺失时**不画时间行、也不计那 16px**（`needsTime` 对非有限值返回 false）。§5.2 的示例消息因此不需要 `id`，直接 `EXIT=0` |

**关于第 4 条，我报错了方向，但撞出了一个更值钱的问题：这 5 个符号当时没有任何 barrel 测试。**
`index.test.ts` 现在 13 条用例，覆盖 net / tween / scroll / wrap / variable；在补之前 wrap 与 variable 是 **0 条**
—— 「导出与测试脱节」：下次重构删掉 export，没有任何测试会红。

**barrel 漏洞有三种形态，第三种最危险**：

| 形态 | 例子 | 症状 | 怎么发现 |
|---|---|---|---|
| ① 实现没导出（**单个符号**） | `createCancel`（早先）、`chatBubble` / `chatList` / `chatComposer`（**本次**，见第 5 条，**已修**） | 游戏侧 import 直接炸，当场发现 | 报错即知，最好查 |
| ② 整块没导出（**一整个能力域**） | `core/tween`、`core/ui/scroll` | 不炸 —— 游戏会绕：写引擎内部相对路径（`<某款游戏>/src/app/deps.ts:22`）或**自己抄一份**（`pindou-workshop/src/app/anim.ts:116` 抄了三次多项式近似） | 只能靠「翻游戏代码看有没有奇怪的相对路径 / 重复实现」 |
| ③ **导出了但没测试锁住** | `wrap` / `variable-window` | **完全无症状，当下能用**；等有人重构删掉导出，才在下游炸 | 只有 barrel 契约测试能守；人眼看不出 |

第 ③ 种是这次真正抓到的：`runtime.wrapText` 明明可用，但 `index.test.ts` 里一条都没有 ——
**「现在能跑」不等于「以后还能跑」**。已由 dev-bot 补 2 条（`index.test.ts:96-118`：符号可见 + 行为可用双断言）。
本文档的立场：**任何新模块进 barrel 的同一次提交里必须有对应测试**，否则等于没导出。

三条历史证据（形态 ② 的代价）：

1. `games/<某款游戏>/src/app/deps.ts:22` 用引擎内部相对路径
   `'../../../../packages/runtime/src/core/tween/index'` 绕过包名；
2. `games/pindou-workshop/src/app/anim.ts:116` **自己重写了一个三次多项式近似**，
   注释写「同 `core/tween` 的 out 手感」—— 拿不到，只好抄一份；
3. `templates/iaa-ui/src/app/deps.ts` 只从 `@mg/runtime` 取 `createLoop` / 布局链 / 注册表 ——
   模板拿不到 `core/tween`，这正是「框架缺补间层」那个根因的遗留。

`chatBubble` 作为组件单放（NPC 头顶台词）时的 props 建议：
`who` `text` `name` `avatar` `maxWidth` `fontSize` `showTime` `showAvatar` `state` ——
与 `chatList` 内部绘制**共用同一个 `bubbleParts(box, props)` 几何函数**，不写两套。
