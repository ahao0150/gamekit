# 视觉骨架（visual skeleton）

> 这份文档解决一个问题：**同样的框架、同样的骨架内容，为什么有的版本一看就是成品，有的像表单？**
> 结论不是代码写得多不多，而是**开工前有没有定视觉语言**，以及**`.ui` 和 canvas 的分工对不对**。

来源：两个同类行商题材项目的实际对照（一个跳过策划阶段直接按数据契约写码，一个走
[`GAME-PLANNER.md`](GAME-PLANNER.md) 的轻量模式先出 PRD / ART-BRIEF / HANDOFF）。数字见 §6。

---

## 1. 三层分工（最容易搞错的一层）

| 层 | 文件 | 管什么 | **不管什么** |
|---|---|---|---|
| 结构 | `ui/*.ui` | 分区带（top/bottom/fill）、命中区、数据组件挂载点 | 颜色、字号、图标、装饰、行内排版 |
| 语言 | `src/app/paint.ts` | 调色板常量 + 绘制原语（文字/面板/分隔线/徽标/地形） | 哪一屏放什么、什么时候画 |
| 编排 | `src/app/render.ts` | 读状态 → 按原语把整屏画出来 | 任何判定、任何状态变更 |

**反例（真实踩过）**：把 `.ui` 当组件装配场——每个文字用 `label`、每个数字用 `coinBadge`、
每个按钮用 `button`。做出来能跑、能点、测试全绿，但视觉上就是一张表单：字号统一、
颜色单调、面板是纯色块、没有留白层次。

**正确做法**：`.ui` 只定骨架，视觉全部在 canvas 层按比例画。一个可玩的屏，`.ui` 通常只要
5–8 行：

```
layer base
region header  top 10%   → put label        # 只借一个占位组件拿到 rect
region scene   top 23%   → put panel
region stats   top 9%    → put coinBadge
region section top 8%    → put statusText
region nav     bottom 10%→ put tabs
region body    fill      → put list         # 数据组件仍然走数据通道
```

`render.ts` 从 `view.rects[name]` 拿到这些矩形，在里面自己画标题、数据带、卡片、选项卡。

> 为什么占位组件不能省：`.ui` 的价值就是**把几何算出来并守住视口边界**（换屏型不用改数字）。
> 你从 rects 拿框、在框内按比例画，两头的好处都要到。

---

## 2. 六条硬规范

### 2.1 调色板锁死，全项目只许这 8 个色

```ts
// src/app/paint.ts
export const COLORS = {
  paper: '#f4eddb',  // 宣纸底（整屏背景）
  ink:   '#233e36',  // 墨，主文字
  jade:  '#315e4d',  // 青绿，强调/选中
  red:   '#a64e36',  // 朱砂，主按钮/关键数值
  gold:  '#b4935d',  // 金线，分隔与装饰
  muted: '#7c8071',  // 次要文字
  line:  '#d6c9ae',  // 分隔线
  light: '#fffaf0',  // 面板白
} as const;
```

**判据**：`grep -rn "#[0-9a-fA-F]\{6\}" src/ | grep -v paint.ts` 应为空（`rgba()` 叠层除外）。
散落色值是"看着乱"的头号原因——两次随手的 `#333` 和 `#353535` 就能毁掉整套质感。

### 2.2 `text()` 必须带 maxWidth 自动缩字

```ts
const text = (c, str, x, y, size, color = COLORS.ink, align = 'left', max?: number, serif = false) => {
  c.fillStyle = color; c.textAlign = align; c.textBaseline = 'middle';
  const family = serif ? 'KaiTi, STKaiti, SimSun, serif' : '"Microsoft YaHei", sans-serif';
  c.font = `${serif ? '' : '500 '}${size}px ${family}`;
  if (max && c.measureText(str).width > max) {
    c.font = `${Math.max(9, size * max / c.measureText(str).width)}px ${family}`;  // 超长自动缩
  }
  c.fillText(str, x, y);
};
```

这一条决定了**能不能在小屏塞满信息而不溢出**。没有它，你只能靠"少写内容"或"到处截断"。

### 2.3 坐标一律用比例，禁止写死像素

```ts
text(c, '柳溪镇', top.x + top.w * 0.09, top.y + top.h * 0.53, 49 * scale, COLORS.ink, 'left', top.w * 0.82, true);
```

`pnpm -w lint` 的规则 5 会拦 `viewport.width - 24` 这类写法。理由见
[`ui-syntax.md`](ui-syntax.md) 附录「位置不要写死坐标」：`fit: contain` 时 320 屏画布只有约 262 宽。

### 2.4 中文单字做图标（方章）

零素材成本拿到识别度：

```ts
const emblem = (c, x, y, size, glyph, color = COLORS.red) => {
  panel(c, { x: x - size / 2, y: y - size / 2, w: size, h: size }, color, color, 2);  // 圆角只用 2，硬边像印章
  text(c, glyph, x, y, size * 0.65, COLORS.paper, 'center', size * 0.85, true);
};
// 用法：米=金 / 茶=青绿 / 锦=朱砂 / 盐=灰蓝 …
```

比"找一套图标素材"快得多，而且风格天然统一。

### 2.5 `.ui` 只做骨架，视觉在 canvas（见 §1）

### 2.6 桌面居中纸卷

手机竖屏游戏在 PC 上拉满会变形。做法：

```ts
const vp = { width: Math.min(520, viewport.width), height: viewport.height - topInset };
const offset = (viewport.width - vp.width) / 2;   // 水平居中
```

**判据**：1280×900 截图里，游戏内容是一窄条居中纸卷，两侧留白，不是被拉伸铺满。

---

## 3. PRD 里必须写清的视觉项

`PRD.md` 的视觉部分不能只写"国风"两个字。至少写清这六项（照这个格式填）：

```markdown
界面：首页/集市/商路/狐友/账册/路遇/结局        ← 屏数与屏名，一屏只做一件事
视觉：青绿山水、宣纸、朱砂、金线              ← 调色板来源（8 个色值写进 PRD）
字号：大标题 49 / 副标题 21 / 正文 14 / 标签 11  ← 层级，别超过 5 级
桌面：居中纸卷，宽度上限 520px                ← PC 表现
反馈：按下反馈、数值飘字、页面过渡            ← 可点元素必须有反馈，不可点必须有禁用态
素材：进包 ≤ 500KB，样张留在 artifacts/       ← 包体纪律
```

**每屏一个动作**：这一屏让用户做什么，写一句。写完发现某屏写不出这句，说明它该合并或删掉。

---

## 4. 验收（视觉这关不能靠"我觉得"）

1. **三张截图，逐张自己看**：390×844、320×568，**外加桌面 1280×900**（验居中纸卷）
2. 每张都要能指出：宣纸底、衬线大标题、圆角面板 + 1px 描边、中文单字图标、主色按钮、分隔线、至少一处禁用态
3. 没有视觉能力时用像素统计替代并写明：唯一主色 ≥ 4、非背景占比 > 50%
4. 包体：进包图片 ≤ 500 KB；样张一律在 `artifacts/`
5. **逻辑测试必须仍然全绿**——视觉改造不许动 `state.ts` / 价格计算；红了先报，不许改断言凑绿

---

## 5. 已知反例（都真实发生过）

| 反例 | 症状 | 改法 |
|---|---|---|
| `.ui` 当组件装配场 | 能跑但像表单：字号统一、面板纯色块 | §1 三层分工 |
| 色值散落各处 | "说不上哪里乱" | §2.1 收敛到 `paint.ts` |
| 文字不加 maxWidth | 长货名溢出卡片 / 挤掉价格 | §2.2 |
| 买卖只有"每次 1 件" | 负重 20 要点 20 下 | 给 1 / 5 / 全部 三档，或长按连续 |
| 320 屏按钮贴底 | 看着像被裁掉 | `pad-y` 留白 + `layout.test.ts` 断言 rect 不越界 |
| 只喂布局期 data | 状态全对、画面空 | 见 [`ui-syntax.md`](ui-syntax.md) 数据通道一节 |

---

## 6. 对照样本的数字（同一框架、同类题材）

| | 走策划流程的版本 | 跳过策划直接写码的版本 |
|---|---|---|
| TS 代码 | 926 行 | 1775 行 |
| `.ui` 文件 | 2 个（各 300–400 字节） | 3 个（组件装配场） |
| 界面数 | 5 屏 | 3 屏 |
| 测试 | 17 条 | 42 条 |
| 进包图片 | 1 张 415 KB（首页整屏 + 内页横幅裁切复用） | 0 |
| 包体 | 483 KB | 69 KB |
| 观感 | 一眼成品 | 骨架能跑，没人想多看一眼 |

**代码少一半、界面多两屏、看起来像成品**——差别不在写了多少，在于开工前那几页纸。

顺带一条省包体的技巧：**一张主图多用**。首页整屏铺一张，内页顶部 23% 的横幅区用
`drawImage` 裁它的一块，两处只付一次包体。

---

## 7. 与现有文档

| 文档 | 关系 |
|---|---|
| [`GAME-PLANNER.md`](GAME-PLANNER.md) | 策划流程与出门闸门；本文是「PRD 的视觉部分怎么写」的下沉 |
| [`ui-syntax.md`](ui-syntax.md) | `.ui` 语法真源；分区与命中语义在那边 |
| [`ENGINE-API.md`](ENGINE-API.md) | `DrawDeps` / `MeasureEnv` / 布局纯函数签名 |
| [`GAME-WORKFLOW.md`](GAME-WORKFLOW.md) | 美术并行、缺图回落、截图自评在那边 |
| [`../AGENTS.md`](../AGENTS.md) | §7 禁止写死坐标的硬规则 |
