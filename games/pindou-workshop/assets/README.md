# assets/ —— 本作的**正式素材**（会进包）

T73 起《拼豆工坊》接了美术（B 透明亚克力工坊）。目录约定与 key 规则如下，
**规则由 `src/app/assets.ts` 的 `ART_KEYS` 与 `src/app/art.test.ts` 钉住**。

## 目录与 key

key = 相对 `assets/` 的路径去扩展名（构建期 `virtual:mg-manifest` 自动登记）：

| 文件 | key | 用途 |
|---|---|---|
| `bg/acrylic-desk.webp` | `bg/acrylic-desk` | 全屏背景，cover 绘制（1170×2532 正好是 390×844 的 3×，无裁切缩小） |
| `beads/{red,yellow,green,blue,purple,orange}.png` | `beads/*` | 6 色珠子：池子 / 已归位 / 拖拽 / 目标格指示点 |
| `icons/clock.png` | `icons/clock` | 盘面 HUD 左侧图标 |
| `icons/thermometer.png` | `icons/thermometer` | 熨烫 HUD 左侧图标 |
| `ui/hud-bar.png` | `ui/hud-bar` | HUD 磨砂条（九宫格，源边距 40） |
| `ui/btn-{primary,secondary}_{normal,disabled}.png` | `ui/btn-*` | 胶囊按钮；**key 由 runtime 的 `buttonKey()` 决定，命名不能改**（336×126） |

## 图集

`game.config.json` 的 `atlas` 段打开，`maxFrameSize: 1024`：
**背景 1170 宽超出上限 → 自动排除在图集外**（`atlas.json` 里没有 `bg/` 帧，只有
`@atlas/atlas-0.png` + 背景两条清单），其余 15 张进 1 页图集。

## 加图的规矩

1. **先有 UI 落点，才准进这个目录**。加载了没人画 = 死资源（T68 的 `btn.png` 教训，
   `art.test.ts` 会断言 `assets/` 与 `ART_KEYS` 完全一致）。
2. 单张 ≤200KB；背景这类大图用 webp（实测 q98 全尺寸 74.3KB，q82 会在雾紫渐变上出 DCT 块）。
3. 加完在 `src/app/assets.ts` 的 `ART_KEYS` 登记，并在 `render-art.ts` 加**缺图回退分支**
   （回退不是空白，是「接线前那套画法的等价物」）。
4. 取图统一走 `core/assets`（`assets.get(key)`），不写死文件路径 —— 小游戏没有 `fetch` / `new URL`。

## 素材来源

原图与样张在 `artifacts/art/`（**不进包**）；珠子由美术带 1px 内描边，代码侧仍保留
`mix(珠色, RIM_DARK, 0.5)` 的 rim 兜底（任一侧失效另一侧还在）。
