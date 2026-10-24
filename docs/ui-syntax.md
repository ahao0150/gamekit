# `.ui` 语法规范 v0.6

> AI 专用界面描述语言。目标：**扁平、无嵌套、可定位到行、可直接静态断言**。
> API 对应 `packages/runtime/src/core/ui/layout.ts` 的 `NodeSpec` / `StackSpec` / `SizeSpec`。

---

## 1. 语句

| 语句 | 作用 | 一个文件里有几个 |
|---|---|---|
| `region` | 划分屏幕区域 + 定义该区域的排布方式 | 若干（通常 2–4） |
| `put` | 往**上一个 region** 里放一个组件 | 若干 |
| `layer` | **分段行**（v0.5）：切换后续 region 的归属层，`base` 或 `overlay` | 0–2（不写 = base） |
| `style` | `put` 的内联修饰词，不是独立行 | — |

**没有嵌套、没有括号、没有缩进语义。** 行序就是语义：`put` 归属它上面最近的那个 `region`。

---

## 2. 完整示例

```txt
# 注释以 # 开头，整行注释

# 顶部信息带：高 48，横向排，间距 8，内边距 12，交叉轴居中
region header top 48 row gap 8 pad 12 align center
put coinBadge  size auto
put statusText size fill
put pause      size fixed 24 align end

# 中间主体：吃掉剩余空间，纵向排，内边距 12
region body fill column pad 12
put parcelGrid size fill

# 底部按钮带：高 72，纵向排，间距 8，内边距 12，交叉轴拉满
region footer bottom 72 column gap 8 pad 12 align stretch
put primaryButton   size fill cross fixed 56 style tone=primary label="开始配送"
put secondaryButton size fill cross fixed 44 style tone=secondary
```

---

## 3. `region` 语法

```
region <name> <top|bottom|fill> <n|n%> [row|column] [gap <n>] [pad <n>] [pad-x <n>] [pad-y <n>] [align <a>] [justify <j>] [at <x> <y> size <w> <h>]
```

| 部分 | 必填 | 说明 |
|---|---|---|
| `name` | ✅ | 标识符，`[a-zA-Z_][a-zA-Z0-9_]*`，文件内唯一 |
| `top` / `bottom` | ✅ | 从顶部累加 / 从底部累减，后跟高度 |
| `fill` | ✅ | 吃掉剩余高度（多个 region 写 fill 时平分） |
| `row` / `column` | ❌ | 排布方向，默认 `column` |
| `gap <n>` | ❌ | 子元素间距，默认 0（固定像素） |
| `pad <n>` | ❌ | **四边**内边距，默认 0 |
| `pad-x <n>` | ❌ | **左右**内边距（覆盖 pad 的左右两值） |
| `pad-y <n>` | ❌ | **上下**内边距（覆盖 pad 的上下两值） |
| `align` | ❌ | 交叉轴对齐：`start`(默认) / `center` / `end` / `stretch` |
| `justify` | ❌ | **主轴**对齐（v0.4）：`start`(默认) / `center` / `end` / `space-between` |
| `at <x> <y>` | ❌ | 任意位置（v0.6，**只在 overlay 层**）：region 的**中心点**；必须配 `size`，见 §3.4 |
| `size <w> <h>` | ❌ | `at` 的宽高（v0.6）；大于视口时钳到视口并进 errors，见 §3.4 |

> **`top` 是累加，不是绝对偏移（踩过两次的坑）**
>
> `region head top 9%` 之后写 `region hudLayer top 9%`，第二个 region 从 **76px** 开始
> （9% × 844），**不是从 0 开始** —— 两者是上下相接的两条带，不是重叠的两层。
>
> 症状很隐蔽：深底上看不出来，等换了浅底、给 HUD 加了底板，才发现文字落在 HUD 带下方 76px。
> 《拼豆工坊》的 board / iron 两屏就中过这一条（T63 引入，T73 换浅底时暴露）。
>
> 想让两块**同高叠放**（HUD 底板 + HUD 文字、面板底 + 面板内容），不要写两个 `top`：
>
> - 用 `layer overlay` + `at 50% 4.5% size 100% 9%` 把文字层定位到和底板同一块区域；
> - 或者 base 层放一个**占位组件**撑住那条带的高度，文字放 overlay。
>
> 同理 `bottom` 也是从底部**累减**：两个 `bottom` 是上下相接，不是叠放。

### 尺寸支持百分比（v0.2 起，v0.3 扩到全部）

以下位置都接受 `n`（固定像素）或 `n%`（比例）：

| 位置 | 百分比基数 |
|---|---|
| `region top/bottom` 高度 | 视口高 |
| `pad` / `pad-y` | 视口**高** |
| `pad` / `pad-x` | 视口**宽** |
| `gap`（column 方向） | 视口高 |
| `gap`（row 方向） | 视口宽 |
| `put size` / `put cross` | 可用空间（父容器主轴/交叉轴） |

**统一规则：水平方向的百分比用视口宽，垂直方向的用视口高。**

**为什么必须有**（v0.2 只做了 region 高度，v0.3 扩全）：固定像素的边距在窄屏上占比会变大——《快递装车员》旧布局的左右边距是 `0.05W`（390 = 19.5px、320 = 16px），而 `.ui` 写成固定 19.5px 后，320 下内容区窄了 7px，连锁把卡片和按钮都挤歪。我当时用「小间距对屏宽不敏感」当理由简化，实测证明这个判断是错的。

---

## 3.1 内边距：为什么拆成 pad / pad-x / pad-y

真实布局里最常见的需求是「只要左右留白」（内容区左右各 19.5px、上下贴边）。如果只有一个 `pad` 四边同值，就要靠「带高 = 内容高 + 2×pad」再加一条空带补偿——能写对，但绕，而且会把 320 屏推到溢出。

所以用具名两轴，无歧义、不用记 CSS 的 1/2/4 值顺序：

```txt
region body fill column pad-x 19.5 pad-y 0 gap 12
```

---

## 3.2 主轴对齐：justify（v0.4）

`align` 管**交叉轴**，`justify` 管**主轴**（row = 水平，column = 垂直）：

```txt
# 中央区域：交叉轴（水平）与主轴（垂直）都居中
region stage fill column align center justify center
put button size fixed 180 cross 180 style text="0 / 3"
```

> 示例统一用通用件 `button`。别照抄 `games/ui-demo` 里的 `tapTarget` —— 那是 ui-demo 的自定义件，
> 不在内置 9 个 / 通用 22 个里，写进新游戏会报「未知组件 'tapTarget'」。

| 取值 | 语义 |
|---|---|
| `start`（默认） | 从主轴起点排列（**旧行为，零变化**） |
| `center` | 剩余空间两端平分 |
| `end` | 贴主轴终点 |
| `space-between` | 两端贴边，剩余空间平均分到子元素之间（只有一个子元素时等同 `start`） |

**与 `fill` 混用**：`fill` 子元素先把剩余空间吃光，**剩下的**才交给 `justify` 分配。所以「有 fill 子元素时 justify 看起来没生效」是预期行为，不是 bug——`justify` 只分配 fill 之后真正的空隙。

**为什么加**：v0.3 之前要把一组元素在主轴居中，只能写「两个没有 `put` 的空 region 夹住」：

```txt
region gapTop fill
region stage top 240 column align center
put button size fixed 180 cross 180
region gapBottom fill
```

能写对，但每多一个居中块就多两行空 region，百分比还要凑总数到 100%。v0.4 起：

```txt
region stage fill column align center justify center
put button size fixed 180 cross 180
```

---

## 3.3 层：layer base / layer overlay（v0.5）

`layer` 是**分段行**，切换它下面所有 `region` 的归属层：

```txt
layer base
region base fill column justify center align center
put secondaryButton size fixed 56 cross 60% style label="打开弹窗"

layer overlay
region mask fill
put infoPanel size fill hit block
```

| 层 | 布局语义 | 层序 |
|---|---|---|
| `base`（默认） | 保持 v0.4 的流布局：region 依次纵向堆叠 | 先画，在下 |
| `overlay` | **每个 region 都是独立的整屏坐标系**（相对视口，不参与 base 的流）；多个 region 天然重叠 | 后画，在上 |

- **层序**：`base` 恒在 `overlay` 之下；同层内按声明顺序，后声明的画在上面。
- **`overlay` 的 `edge` / 高度被忽略，并且可以省略**（v0.6）：不写 `edge` 时按 `fill` 处理；写 `top`/`bottom` 也不改变结果。
- **`justify` / `align` 在 overlay 里照常生效**（各自相对整屏），所以「面板居中」「按钮叠在面板中央」都能表达。
- `layout()` 的输出新增 `paintOrder`（绘制正序）与 `meta`（每个组件的 `layer` / `hit`）：**绘制按 paintOrder 正序，命中按它逆序**。

---

## 3.4 任意位置：at + size（v0.6）

九宫格（`justify` + `align`）拼不出任意位置：角色头顶的对话框、某个坐标的物品详情、
随机位置的飘字都需要「中心点定在这里」。`at` 就是它：

```txt
layer overlay
# 中心点在 (30%, 70%) 的提示底板：宽 60%、高 18%
region tip at 30% 70% size 60% 18%
put panel size fill

# 同一个中心点的文字，窄一点叠在上面
region tipText at 30% 70% size 50% 8%
put label size fill style text="+1 金币" fontSize=16 align=center
```

**三条口径（写死）**：

| 规则 | 说明 |
|---|---|
| `at <x> <y>` 是**中心点** | 不是左上角。中心点在角色头顶时，矩形自然向四周展开，作者不用自己减半宽 |
| 百分比按方向取基数 | `x` 用视口宽、`y` 用视口高（与其他百分比长度同一口径，见 §3 的基数表） |
| **必须配 `size <w> <h>`** | 缺了**报错**。`size` 只接受像素或百分比，不接受 `fill` / `auto` |

**为什么 `size` 不能省**：`region top 48` 的高度是「这条带多高」，而 `at` 的 region 脱离流，
它的宽高只能显式给。若允许 `size auto`，布局就得先跑一遍 `measure()` 再回头定位：
既让布局依赖组件注册表（纯函数被破坏），又让离线 `ui.check`（没绑定组件）算不出位置。

**只在 overlay 层有效**：base 层写 `at` 会**报错**——base 是流布局，位置由流决定，
允许写会让人误以为能定位。反过来 `size` 单独写（没有 `at`）也报错，「必须成对」。

**边界行为**：

| 写法（390×844） | 结果 |
|---|---|
| `at 30% 70% size 60% 18%` | `x=0, y=514.84, w=234, h=151.92` |
| `at 0% 0%` | 中心点落在视口左上角 → 左上角为 `(-117, -75.96)`（一半在视口外，但仍可见） |
| `at 100% 100%` | 中心点在视口右下角 → 左上角 `(273, 768.04)` |
| `at 150% -50%` | 完全跑出视口 → **中心点钳回最近的视口边缘**，内容不会消失 |
| `size` 大于视口 | 钳到视口尺寸，并在 `layout().errors` / `ui.check` 里给一条提示（不报错，布局仍可用） |

`at` 与 `justify` / `align` **互不冲突**：前两个决定 region **落在哪**，
后两个决定 region **内部**的 put 怎么排（`at` 只换掉 region 的框，内部流布局不变）。

真实用法示例：[`games/ui-demo/ui/at-anywhere.ui`](../games/ui-demo/ui/at-anywhere.ui)。

---

## 4. `put` 语法

```
put <component> [size <尺寸>] [cross <尺寸>] [align <a>] [hit <mode>] [style <k>=<v> ...]
```

| 部分 | 必填 | 说明 |
|---|---|---|
| `component` | ✅ | 组件名（必须已在组件注册表里，否则**报错**） |
| `size` | ❌ | **主轴**尺寸，默认 `auto` |
| `cross` | ❌ | **交叉轴**尺寸，默认跟随 region 的 `align` |
| `align` | ❌ | 覆盖该元素在交叉轴上的对齐 |
| `hit` | ❌ | 命中语义（v0.5）：`self`(默认) / `block` / `none`，见 §4.1 |
| `style` | ❌ | 组件参数，`key=value` 对，值可带引号 |

### 尺寸写法

| 写法 | 含义 | 例子 |
|---|---|---|
| `fill` | 主轴吃掉剩余空间 | 按钮撑满宽度 |
| `auto` | 由组件自己的 `measure()` 决定 | 图标按素材尺寸 |
| `fixed <n>` 或直接 `<n>` | 固定逻辑像素 | `size 24` |
| `ratio <r>` 或 `<r>%` | 占可用空间的比例 | `size 50%` |

---

## 4.1 命中语义：hit self | block | none（v0.5）

| 取值 | 语义 | 典型用途 |
|---|---|---|
| `self`（默认） | 自己有 action 才响应；与 v0.4 之前**完全等价** | 普通按钮 |
| `block` | **吃掉这次点击、但自己没有动作**，不继续往下找 | 弹窗遮罩、loading 层 |
| `none` | 完全透明，点击穿透到下面的元素 | 纯装饰、只读文字 |

命中顺序 = 绘制顺序的**逆序**（谁画在上面谁先接点击），由 `hit.ts` 的 `pickHit` 从 `layout()` 输出的 `meta` 推出。默认 `self` 保证老界面的按钮行为零变化。

---

## 5. `style` 修饰词

```
style tone=primary label="开始配送" disabled=false
```

- `key=value`，空格分隔
- 值含空格必须加引号
- `true` / `false` / 纯数字会被解析成布尔或数字，其余是字符串
- **带引号的值永远是字符串**（v0.5 修订 / T16）：`text="3"` 是字符串 `'3'`、`flag="true"` 是字符串 `'true'`；不带引号的 `value=50` 才是数字 `50`。引号是作者「这是字符串」的显式意图，不该被类型猜测覆盖
- **不认识的 key 必须报错**（组件声明了 `props` 类型，拼错就是错）

---

> **`fillColor` 不是万能调色器：九宫格底组件有图时它会被忽略（踩过的坑）**
>
> `panel` / `infoPanel` / `card0` / `card1` 这些「九宫格底」组件的画法是
> **先查素材、有图就画图、没图才 `fillRect(fillColor)`**。所以 `fillColor` 是**缺图回退色**，
> 不是底色控制器 —— 一旦 `assets/` 里有了对应素材（`ui/panel` 等），你写的 `fillColor`
> 就完全不起作用。
>
> 典型翻车：想给全屏遮罩写 `put panel … fillColor="rgba(0,0,0,0.4)"`，接上 `ui/panel` 素材后
> 遮罩变成一块**不透明的全屏磨砂白板**，背景整个被盖住。正确做法是让 `.ui` 里放一个
> **不画图的占位组件**（自己注册，`draw: () => {}`）拿 rect 与 `hit block`，透明遮罩在
> `render.ts` 里自绘。《拼豆工坊》的 `backdropMask` 就是这么做的。
>
> 顺带纠正一个常见误解：`fillColor` 的值**支持任意 CSS 颜色字符串**，`rgba(27,33,31,0.30)`
> 这种写法词法层会带引号原样保留、能正常进 `fillStyle`。它失效从来不是格式问题，
> 而是「走了画图分支」。

---

## 6. 错误处理（写死在解析器里）

所有错误都带**文件 + 行号 + 可操作提示**，一次报全，不在第一个错误处中断：

```
home.ui:5: 未知组件 'prymaryButton'，已注册的有：primaryButton / secondaryButton / coinBadge / statusText / pause / parcelGrid
home.ui:8: region 'body' 重复定义（第 3 行已定义）
home.ui:11: put 之前没有 region（第 1 行开始就必须先定义 region）
home.ui:14: size 只接受 fill / auto / fixed <n> / ratio <r>，收到 'bigg'
home.ui:17: style 键 'tonee' 不是组件 primaryButton 的合法参数，可用：tone / label / disabled
```

---

## 7. 编译产物

`.ui` 文件在构建时（dev 和 build **走同一个函数**）编译成 TS 模块：

```ts
import homeUi from './ui/home.ui';

homeUi = {
  name: 'home',                    // 文件名（去扩展名）
  spec: <NodeSpec>,                // 直接喂给 layout()
  components: ['primaryButton', …], // 用到的组件名（用于注册表校验）
  source: 'ui/home.ui',
  lines: { primaryButton: 14, … },  // 组件 → 源行号（报错定位用）
}
```

**运行时不需要解析器**——解析在构建期完成，运行时只拿 `spec`。

---

## 8. 为什么是这套（给维护者）

| 需求 | 这套语法怎么满足 |
|---|---|
| AI 少犯语法错 | 无括号、无逗号、无缩进；一行一个元素 |
| 报错能定位 | 每行映射到源行号，行号进编译产物 |
| 可静态断言 | 编译产物是纯数据，`layout()` 是纯函数，Node 里能算 |
| 可 diff | 改一个元素 = 改一行，git diff 干净 |
| 跨分辨率 | 全是约束（fill / auto / ratio / align），没有绝对坐标 |
| 不需要工具链 | 纯文本 + Vite 插件，不引 babel / esbuild jsx |

---

## 9. 明确不支持

| 不支持 | 原因 |
|---|---|
| 嵌套缩进 | 三层以上 AI 就开始丢层级，扁平 + 归属最近 region 更稳 |
| 绝对坐标 `x=20 y=700` | AI 算数必错，且换屏型崩 |
| 表达式 / 变量 / 计算 | 语法一旦能算，就不可静态断言了 |
| 条件渲染 | 那是逻辑层的事；`.ui` 只描述「长什么样」，不描述「什么时候显示」 |
| 动画 | 同上。动效走 `docs/motion.md` 那套，不混进布局描述 |

---

## 10. 已知局限（v0.3 实测，v0.4 更新）

写 `games/ui-demo` 时实际撞到的两条：

### ① 同一组件名在一个 region 里出现两次 → 必然重叠

`rects` 以组件名为键，重名会互相覆盖。`ui.check` 能抓到并报错——**保持报错，不改成允许重名**。重名就是描述写错了，让人改比让引擎猜更有价值。

如果确实需要两个同样的组件（比如并排两个按钮），用不同的 `style` 语义区分名字（`primaryButton` / `secondaryButton`），或者注册一个带索引的组件。

### ② 主轴居中（缺 `justify`）→ **v0.4 已解决**

v0.3 只有交叉轴的 `align`，没有主轴对齐。想把一组元素在垂直方向居中，只能靠「没有 `put` 的空 region」推位置：

```txt
region gapTop  20%     # 空的，只为把下面的内容推下去
region stage   200
```

**能绕过，但啰嗦，而且空 region 的百分比很难算准**（要凑总数到 100%）。

v0.4 加了 `justify start|center|end|space-between`（对齐 CSS flex 的 `justify-content`，见 §3.2），`games/ui-demo` 的 menu / play / result 三个界面已把空 region 换成 `justify center`。

### ③ 弹窗 / Toast / 引导没有浮层 → **v0.5 已解决**

v0.4 之前同一界面内的组件只能顺序流排，表达不了「浮层盖在基础层之上」；命中也是按声明顺序找第一个，不是按谁画在上面。v0.5 的 `layer`（§3.3）+ `hit`（§4.1）补上了这两块，`games/ui-demo/ui/popup.ui` 是真实用法示例。

---

## 11. 变更记录

| 版本 | 变更 | 触发原因 |
|---|---|---|
| v0.1 | 首版：三个动词、四种尺寸、错误格式、编译产物 | — |
| **v0.2** | ① `region` 的 `top`/`bottom` 支持百分比（基数=视口高）② 新增 `pad-x` / `pad-y` ③ `put` 的 `size` 支持 `50%` 写法 | 实现 T5 时发现两个缺口：固定像素带高在 320×568 上溢出 198px（只能表达固定设计稿）；`pad` 四边同值无法表达「只要左右留白」，逼得用「带高 + 2×pad + 空带补偿」的绕法 |
| **v0.3** | ① `pad` / `pad-x` / `pad-y` / `gap` **全部支持百分比** ② 明确基数规则：水平方向用视口宽、垂直方向用视口高 | 实测推翻 v0.2 的简化：kuaidi 旧布局左右边距是 `0.05W`（390=19.5、320=16），固定 19.5px 在 320 下让内容区窄 7px，连锁挤歪卡片和按钮，footer 溢出 2.95px |
| **v0.4** | ① `region` 新增主轴对齐 `justify start|center|end|space-between`（默认 `start`，旧布局零变化）② `fill` 子元素先吃剩余空间，剩下的才交给 justify | 写 `games/ui-demo` 时三个界面都要「一组元素在主轴居中」，只能靠「两个空 `fill` region 夹住」，每多一个居中块多两行、百分比还要凑 100%。T11 落地后 menu / play / result 的 `gap1`/`gap2`/`gapTop`/`gapBottom` 全部删掉 |
| **v0.5** | ① 分段行 `layer base|overlay`：overlay 每个 region 是独立整屏坐标系、彼此重叠，层序 base < overlay ② `put` 新增 `hit self|block|none`（默认 `self`，与旧行为等价）③ `layout()` 新增 `paintOrder` / `meta` | 弹窗、Toast、引导这类浮层表达不了「盖在基础层之上」；命中按声明顺序而不是「谁画在上面」，遮罩吃不掉点击。T13b 落地后 `games/ui-demo/ui/popup.ui` 用两层 + `hit block` 验证 |
| v0.5 修订 | `style` 的**带引号值保持字符串**，不再被数字化（`text="3"` → `'3'`）；不带引号才走布尔/数字转换 | 写通用组件 `badge` 时 `text="3"` 被转成 number，声明为 `string` 的参数校验报错，只能改用 `text="99+"` 绕过。引号本来就是显式字符串意图（T16） |
| **v0.6** | ① `region` 新增任意位置 `at <x> <y>`（**中心点**，不是左上角）+ 必填的 `size <w> <h>` ② overlay 的 `edge` 可省略（本来就不参与求解）③ `at` 只在 overlay 有效、必须与 `size` 成对，违反都**报错**；`size` 超视口钳到视口并进 `errors` | 九宫格（`justify` + `align`）拼不出「角色头顶的对话框 / 某个坐标的物品详情 / 随机位置的飘字」。T33 落地后 `games/ui-demo/ui/at-anywhere.ui` 用两个 `at` region 验证；390×844 下 `at 30% 70% size 60% 18%` = `x=0, y=514.84, w=234, h=151.92` |
| v0.3 附 | **不新增** `aspect` / 「按宽度算高度」原语。`parcelGrid` 的高度由组件 `measure()` 决定（`.ui` 写 `size auto`），因为「格子自适应车厢」是组件自己的知识，不是布局语言该管的 | 320 视口下 `cell = min(W×0.84/cols, H×0.32/rows)` 是宽度驱动，`.ui` 的百分比表达不了；但这不是布局语言的缺陷——**布局语言只管占位，内容尺寸归组件** |

---

## 12. 通用组件清单（T15–T34，2026-10-20/21 新增）

`.ui` 能写哪些组件由**注册表**决定。目前有两类来源：

| 类别 | 来源 | 用在哪 |
|---|---|---|
| **业务件**（新游戏不要用） | `packages/runtime/src/core/ui/builtin.ts` 的 `BUILTIN_COMPONENTS`，9 个 kuaidi 专用件（按代码顺序）：`primaryButton` `secondaryButton` `coinBadge` `statusText` `pause` `parcelGrid` `infoPanel` `card0` `card1` | 源头是《快递装车员》的业务语义（包裹格 / 金币角标 / 暂停键）；iaa-ui 模板默认也全部注册，但新界面优先用通用件。**`tapTarget` / `scorePanel` 不在这里** —— 它们是 `games/ui-demo/src/app/ui-registry.ts` 里的自定义件，新游戏里写会报「未知组件」 |
| **通用件**（推荐） | `packages/runtime/src/core/ui/widgets/`，`createWidgetRegistry()` 一次装 22 个（含 T31 新增的 `grid` / `scroll`、T34 新增的 `input`） | 任何新界面；颜色走 `DrawDeps.theme`，素材缺失回落纯色 |

两者合计 **31 个**（iaa-ui 模板的 `createRegistry()` 就是这 31 个）；`games/ui-demo` 另加
`tapTarget` / `scorePanel` 两个自定义件，合计 33 个。

```ts
import { createWidgetRegistry } from '…/packages/runtime/src/core/ui/widgets';
const registry = createWidgetRegistry();     // 22 个通用组件
const bound = bindComponents(parsed.spec, { registry, env: { viewport, data } });
```

### 22 个通用组件

| 组件 | 主要 props（默认值） | 说明 |
|---|---|---|
| `progress` | `value`(0) `max`(100) `direction`(horizontal) `radius`(0) `trackColor` `fillColor` `showText`(false) `textSize` | 进度条；填充宽 = value/max × 轨道宽 |
| `button` | `state`(normal/pressed/disabled) `text` `textSize` `image` `pressedImage` `disabledImage` `pressedScale`(0.96) `pressedOffsetY`(2) `disabledOpacity`(0.45) | 三态按钮，默认 296×56；`state` 由交互层传 |
| `panel` | `image` `slice`(60) `fillColor` | 九宫格面板；缺图回落主题色（复用 `nine-slice.ts`） |
| `label` | `text` `fontSize`(16) `color` `align`(left) `maxWidth` | 文本；超宽加省略号 |
| `icon` | `image` `size`(32) | 图标等比居中；缺图画占位方块 |
| `badge` | `text` `dotSize`(10) `color` | 角标；`text` 空 = 纯圆点，固定在右上角内缩 2px |
| `divider` | `direction`(horizontal) `thickness`(1) `color` | 分割线 |
| `avatar` | `image` `shape`(circle/rounded) `radius`(12) | 头像；圆形用 `clip` 真裁切 |
| `list` | `itemH`(56) `gap`(0) `scrollTop`(0) `virtual`(true) `divider`(false) `itemColor` `dividerColor` `emptyText` | 列表；数据 `items` + `renderItem`，`virtual` 时 1 万项只画可见的几项 |
| `input` | `value` `placeholder` `maxLength`(20) `textSize` `bgColor` `borderColor` `radius`(8) `focused`(false) | 输入框，默认 280×48；**只画不弹键盘**——点它以后由游戏调 `platform.keyboard.open({ rect })`，`focused` 决定画不画光标（500ms 闪烁，不用定时器）；超长先按码点截、再按宽度截并补 `…` |
| `toast` | `text` `textSize`(16) `icon` `opacity`(1) `bgColor` `textColor` `radius`(8) | 轻提示，高固定 44；位置由 overlay region 决定 |
| `slider` | `value`(0) `knobSize`(20) `trackColor` `fillColor` `knobColor` `disabled`(false) `direction`(horizontal) | 滑杆；填充长 = value × (轨道长 − 滑块直径) |
| `switch` | `on`(false) `knobColor` `trackOnColor` `trackOffColor` `width`(52) `height`(30) | 开关；**注册名是 `switch`**（JS 保留字，导出变量叫 `switchToggle`） |
| `checkbox` | `checked`(false) `size`(24) `checkColor` `bgColor` `radius`(4) | 复选框；对勾是 path 描边（不是字符 ✓） |
| `radio` | `checked`(false) `size`(24) `color` `bgColor` | 单选框；选中时外圈 + 内点两次 `arc` |
| `tabs` | `active`(0) `itemH`(40) `activeColor` `color` `indicatorH`(3) | 标签栏；数据 `tabs: string[]` |
| `segmented` | `active`(0) `itemH`(32) `radius`(6) `activeColor` `itemColor` `textColor` | 分段控件；数据 `segments: string[]` |
| `keypad` | `cols`(3) `keyH`(52) `gap`(6) `keyColor` `textColor` `radius`(6) | 数字键盘；数据 `keys: string[]`（`del` / `ok` 就是普通字符串） |
| `scrollbar` | `value`(0) `viewport`(1) `direction`(vertical) `thickness`(4) `radius`(2) `trackColor` `thumbColor` `opacity`(1) | 滚动条；滑块长 = viewport × 轨道长，`viewport >= 1` 不画 |
| `carousel` | `index`(0) `offset`(0) `loop`(false) `indicator`(true) `indicatorSize`(6) `indicatorGap`(8) `indicatorColor` `indicatorActiveColor` `pageGap`(0) | 轮播；数据 `pages` + `renderItem`，只画可见的前后两页 |
| `grid` | `cols`(4) `cellH`(56) `gapX`(8) `gapY`(8) `scrollTop`(0) `virtual`(true) `itemColor` `emptyText` | 网格容器；`cellW = (w − gapX×(cols−1))/cols`，只画可见行、clip 到自身，最后一行不满不画空格 |
| `scroll` | `scrollTop`(0) `contentH`(0) `bgColor` | 通用滑动容器：只 `clip` + `translate(0,-scrollTop)`，内容由 `renderContent` 画（接收**未平移**的 box） |

> **输入框要自己接键盘**：`.ui` 里 `put input` 只是画一个框。点它 → 游戏侧
> `platform.keyboard?.open({ defaultValue, maxLength, rect: 布局里的矩形 })`；
> 订阅 `onInput` 回填 state、`onClose` 把 `focused` 关掉。`rect` 是**相对画布的逻辑像素**
> （web 端据此把真 `<input>` 精确盖在组件上）。注意 `.ui` 的 `put` 第一个词必须是
> **注册表里的组件名**（`input`），不是自定义实例名。

### 数据驱动组件（数组不进 `.ui`）

`style` 的值只能是 string / number / boolean，装不了数组。下面这些组件的数据由游戏在 `DrawDeps.data`（布局期是 `MeasureEnv.data`）注入：

| 组件 | 数据键 | 形状 |
|---|---|---|
| `list` | `items` + `renderItem` | `readonly unknown[]`；`(ctx, item, rect, index) => void` |
| `tabs` | `tabs` | `readonly string[]` |
| `segmented` | `segments` | `readonly string[]` |
| `keypad` | `keys` | `readonly string[]` |
| `carousel` | `pages` + `renderItem` | `readonly unknown[]`；`(ctx, page, rect, index) => void` |
| `grid` | `items` + `renderItem` | `readonly unknown[]`；`(ctx, item, rect, index) => void`（格内矩形，已扣除滚动） |
| `scroll` | `renderContent` | `(ctx, box, scrollTop) => void`；`box` 是**内容坐标系**（未平移）的容器矩形 |

### 数据组件的双通道注入（最容易踩的坑，必读）

数据驱动组件在**两个不同的时刻**各读一次 `data`。**推荐单通道**：把同一份 data 传给
`layout.compute(..., data)`，模板会挂到 `ScreenLayout.data`，绘制期自动注入
`DrawDeps.data`；若仍分两边手传，用 `resolveUiData(measure, draw)`——漏传或缺键会报中文错。

若你坚持分两边喂，**两边都必须传**：

1. **布局期**：`bindComponents(spec, { registry, env: { viewport, data } })` 的 `env.data`
   —— 给 `measure` 用（`list` / `grid` 要按项数算内容总高，量不出来就没法滚）；
2. **绘制期**：`renderer.draw(ctx, layout)` 时传的 `DrawDeps.data`
   —— 给 `draw` 用（真正去取 `items` / `renderItem` 把每一项画出来）。

**只喂布局期会怎样：状态全对、画面全空。**

- 点击命中正常 —— 几何来自布局，`gridIndexAt` / `listIndexAt` 照样算得出正确的格子；
- 分数、剩余数、选中态都在变 —— 那些走游戏 state；
- 但组件区域**一片纯色** —— `draw` 期 `deps.data` 里没有 `items`，一个格子都不画。

> **2026-10-21 实测复现**（外部探针做的一款 6×6 消除游戏撞出来的）：只喂 `MeasureEnv.data`、不喂 `DrawDeps.data` 时，棋盘区域「唯一主色 0 种、非背景像素 0%、横向颜色切换 0 次」，整块 100% 纯背景；补上绘制期 `data` 后变成「5 种主色、83.7%、11 次切换」。
>
> 判定「画面到底画没画」，不能只读状态（状态是绿的），也不能只靠肉眼（无视觉能力的 Agent 看不了图）。用像素统计断言：**唯一主色 ≥ 4、非背景占比 > 50%、横向颜色切换 ≥ 6**（多行采样取中位数，单行可能正好压在格子间隙上）。

> **点「第几项 / 第几格」不要自己反解矩形**：`list` / `grid` 的子项命中换算用
> `listIndexAt(point, rect, scrollTop, { itemH, gap?, count })` /
> `gridIndexAt(point, rect, scrollTop, { cols, cellW, cellH, gapX?, gapY?, count })`
> （`packages/runtime/src/core/ui/item-hit.ts`）。容器外、gap 空隙、最后一行不满、超出 `count`
> 一律返回 `null`（不是「就近归到某一项」）；`cellW` 与绘制共用 `grid.ts` 导出的 `cellWidth()`，
> 所以不会「看得见点不到」。签名见 `docs/ENGINE-API.md` 的 core/ui 交互段；
> `games/ui-demo/src/app/deps.ts` 已经把这两个函数和 `cellWidth` 一起转出来了，可直接 `import ... from './deps'`。

### `.ui` 用法示例

```txt
# 通用组件：需要内容宽度的用 fixed（离线 check 不接注册表，auto 会报 0×0）
region header top 12% row align center pad-x 5% gap 2%
put avatar size fixed 48 cross 48 style shape=circle
put label  size fill cross fixed 24 style text="标题" fontSize=18 align=left

region body fill column align stretch pad-x 6% gap 2%
put progress size fixed 16 style value=64 max=100 showText=true
put list     size fill style itemH=56 gap=8 virtual=true divider=true
```
