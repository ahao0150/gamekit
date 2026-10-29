# 音乐播放器 · SVG 先行设计规格

> 基准视口 **390×844**。设计稿：[`player-390.svg`](player-390.svg)；视觉稿：[`player-390.png`](player-390.png)。
> 本文件第 ③ 节的 rect 表由 `node experiments/svg-first/tools/bake.mjs` 从 SVG 真实几何量出，
> **禁止手改**（手改会在下次 bake 时被覆盖，且对拍会立刻报红）。

## ① 设计意图（5 行）

1. **深色墨底 + 玻璃拟态**：底色不纯黑，用 `ink` 的三档明暗派生（`#16261f → #233e36 → #1b2f28`）做纵向渐变，避免「一片死黑」。
2. **三处渐变光晕代替模糊**：封面后方青绿径向光、右下金色径向光、播放键自身的中心提亮——全部用 `radialGradient` 叠透明度，**不依赖 `feGaussianBlur` / `box-shadow`**（小游戏端性能）。
3. **三层分离**：背景（渐变 + 两处光晕 + 顶部压暗）→ 中景（底部玻璃面板 + 玻璃厚度高光边）→ 前景（封面、曲名、进度、控制键）。
4. **层级靠「亮度 + 尺寸」而不是靠阴影**：播放键 84px 是全界面最大最亮的元素（`#fffaf0` 中心），上一首/下一首 52px 玻璃圆、次级键 44px 只有线条——三档尺寸差一眼可辨。
5. **零素材**：封面用渐变 + 三条抽象声波弧 + 方章「乐」（中文单字做图标），不依赖任何位图。

## ② Token 表

### 颜色（8 色板 + 明暗派生，全部带 `data-token`）

| token | 值 | 来源 | 用在哪 |
|---|---|---|---|
| `--color-bg-deep` | `#16261f` | `ink` × 0.62（压暗） | 整屏底、顶部压暗、播放三角 |
| `--color-bg` | `#233e36` | `ink`（原色） | 背景渐变中段 |
| `--color-bg-soft` | `#1b2f28` | `ink` × 0.75 | 背景渐变末端、封面渐变末端 |
| `--color-cover` | `url(#coverGrad)` | `jade-light #4a8570` → `jade #315e4d` → `#1b2f28` | 封面主体 |
| `--color-accent` | `#315e4d` → `#4a8570` | `jade` / `jade` × 1.5（提亮） | 进度已播条 |
| `--color-accent-hi` | `#b4935d` | `gold` | 进度头部、播放键外环、循环箭头 |
| `--color-play` | `url(#playGrad)` | `light #fffaf0` → `line #d6c9ae` → `gold #b4935d` | 播放键（最亮） |
| `--color-text` | `#fffaf0` | `light` | 曲名、主图标 |
| `--color-text-2` | `#d6c9ae` | `line`（作次级文字） | 歌手、时间、次级图标、header 标题 |
| `--color-text-3` | `#7c8071` | `muted` | 总时长（最低层信息） |
| `--color-track` | `rgba(255,250,240,0.10)` | `light` @10% | 进度轨道底 |
| `--color-glass` | `url(#glassFill)` / `url(#glassSoft)` | `light` @9%→4% / 13%→6% | 玻璃面板、圆键底 |
| `--color-glass-line` | `rgba(255,250,240,0.12~0.18)` | `light` @12–18% | 玻璃描边、封面内描边 |
| `--color-seal` | `#a64e36` | `red` | 封面方章 |
| `--color-danger` | `#c9704f` | `red` × 1.2（提亮） | 喜欢（已点） |
| `--color-gloss` | `url(#gloss)` | `light` @20%→0 | 封面斜向高光 |

**对比度自检**（口径见 `docs/UI-PIPELINE.md` §2③，正文下限 4.5:1）：

| 组合 | 实测 | 判定 |
|---|---|---|
| `--color-text` `#fffaf0` on `#233e36` | **13.4:1** | ✅ |
| `--color-text-2` `#d6c9ae` on `#233e36` | **7.6:1** | ✅ |
| `--color-text-3` `#7c8071` on `#233e36` | **2.9:1** | ⚠️ 仅用于「总时长」这类可选项，不进正文 |
| 播放三角 `#16261f` on `playGrad` 中心 `#fffaf0` | **15.6:1** | ✅ |

### 字号（只用六档）

| 档 | 用在哪 |
|---|---|
| 28 | 曲名 `songTitle` |
| 20 | 方章「乐」 |
| 16 | （本界面未用，留给弹层标题） |`n| 36 | （本界面未用，留给结算数字/大标题） |
| 14 | 歌手 `artistName` |
| 12 | header 标题、当前/总时长 |

### 圆角

| 值 | 用在哪 |
|---|---|
| 28 | 封面 `albumCover`、底部玻璃面板 |
| 9 | 进度轨道 / 已播条（高 18 的一半 = 胶囊） |
| 5 | 方章 |
| 999（圆） | 所有圆形按钮（用 `<circle>`，等价） |

### 间距（4 的倍数）

| 值 | 用在哪 |
|---|---|
| 12 | header 的 `gap` |
| 24 | stage 的 `gap`、`pad-y`、header `pad-x` |
| 28 | dock 的 `pad-x` |
| 32 | 主控三键 `gap` |
| 36 | stage `pad-x` |
| 8 | 进度条内部 `gap`（轨道 → 时间行） |
| 18 | dock `pad-y` |

### 触摸目标

最小 **44×44**（`backBtn` / `moreBtn` / 三个次级键都是 44）。主控 52 / 84，均 ≥44。

## ③ rect 表（390×844，脚本量出）

坐标原点 = 视口左上角，单位 px，保留四位小数。**实测列**来自浏览器 `getBBox() × getCLM()` 的包围盒；
**约束列**是 `data-size` / `data-cross` 的声明，用于核对「属性说的」和「画出来的」是同一件事。

<!-- RECTS:BEGIN（本表由 tools/bake.mjs 生成，禁止手改） -->

| # | data-name | comp | x | y | w | h | 约束（size / cross） |
|---|---|---|---|---|---|---|---|
| 1 | `backBtn` | custom:iconButton | 24.0000 | 20.2000 | 44.0000 | 44.0000 | fixed:44 / fixed:44 |
| 2 | `headerTitle` | label | 80.0000 | 32.2000 | 230.0000 | 20.0000 | fill / fixed:20 |
| 3 | `moreBtn` | custom:iconButton | 322.0000 | 20.2000 | 44.0000 | 44.0000 | fixed:44 / fixed:44 |
| 4 | `albumCover` | custom:albumCover | 36.0000 | 115.9200 | 318.0000 | 318.0000 | fixed:318 / fixed:318 |
| 5 | `songTitle` | label | 36.0000 | 457.9200 | 318.0000 | 40.0000 | fixed:40 / fill |
| 6 | `artistName` | label | 36.0000 | 521.9200 | 318.0000 | 20.0000 | fixed:20 / fill |
| 7 | `progressBar` | custom:progressBar | 36.0000 | 565.9200 | 318.0000 | 44.0000 | fixed:44 / fill |
| 8 | `progressTrack` | custom:progressTrack | 36.0000 | 565.9200 | 318.0000 | 18.0000 | fixed:18 / fill |
| 9 | `timeRow` | custom:timeRow | 36.0000 | 591.9200 | 318.0000 | 18.0000 | fixed:18 / fill |
| 10 | `timeCurrent` | label | 36.0000 | 591.9200 | 60.0000 | 18.0000 | fixed:60 / fixed:18 |
| 11 | `timeTotal` | label | 294.0000 | 591.9200 | 60.0000 | 18.0000 | fixed:60 / fixed:18 |
| 12 | `primaryControls` | custom:controlsRow | 28.0000 | 659.4400 | 334.0000 | 84.0000 | fixed:84 / fill |
| 13 | `prevBtn` | custom:iconButton | 69.0000 | 675.4400 | 52.0000 | 52.0000 | fixed:52 / fixed:52 |
| 14 | `playBtn` | custom:playButton | 153.0000 | 659.4400 | 84.0000 | 84.0000 | fixed:84 / fixed:84 |
| 15 | `nextBtn` | custom:iconButton | 269.0000 | 675.4400 | 52.0000 | 52.0000 | fixed:52 / fixed:52 |
| 16 | `secondaryRow` | custom:controlsRow | 28.0000 | 782.0000 | 334.0000 | 44.0000 | fixed:44 / fill |
| 17 | `repeatBtn` | custom:iconButton | 28.0000 | 782.0000 | 44.0000 | 44.0000 | fixed:44 / fixed:44 |
| 18 | `likeBtn` | custom:iconButton | 173.0000 | 782.0000 | 44.0000 | 44.0000 | fixed:44 / fixed:44 |
| 19 | `listBtn` | custom:iconButton | 318.0000 | 782.0000 | 44.0000 | 44.0000 | fixed:44 / fixed:44 |

<!-- RECTS:END -->

### 怎么用这张表

下一步做 `.ui` 还原时，`.ui` 只写约束（`region` + `put` 的 size/cross），不写坐标；
还原后跑 `layout()` 拿到 `rects`，与上表**逐 name 比对**，每项误差 ≤ **0.5px** 才算还原成功。
`custom:*` 的组件按 `bubbleParts` 那套「几何只写一份」实现：`measure` 与 `draw` 共用同一个 `partsOf(box)`，
内部件（`progressTrack` / `timeRow` / `prevBtn` …）的矩形由它算出，正好与本表最后一节对得上。

## 附：这套 SVG 的表达边界（实验结论，供下一步讨论）

1. **`.ui` 没有 aspect ratio**：封面必须是正方形，本稿用 `data-size="fixed:318" data-cross="fixed:318"` 钉住。
   跨屏型还原时应改成 `cross 100%` + 组件内「取 min(w,h) 画正方形」，此时组件 box 与正方形不再重合，
   对拍要改成比对组件的正方形而不是 box。
2. **一个 region 只能一个方向**：`stage` 是 column，所以「控制键一行」必须做成 composite
   （`custom:controlsRow`，内部再 row）。这是本稿有 5 个 `custom:` 组件的唯一原因。
3. **没有绝对定位**：进度手柄的位置跟「当前播放进度」走，本质是组件内部相对量，不该进 `.ui`。
