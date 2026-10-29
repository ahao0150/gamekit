/**
 * 复合组件的**几何唯一真源**（SVG 先行实验第 3 步的核心约束）。
 *
 * 五个复合组件（albumCover / progressBar / controlsRow / iconButton / playButton）各有一份
 * `xxxPartsOf(box)`：`measure`、`draw`、单元测试**三处共用同一个函数**，不许各写一套。
 * 这是把设计稿里 10 个内部 rect（progressTrack / timeRow / timeCurrent / timeTotal /
 * prevBtn / playBtn / nextBtn / repeatBtn / likeBtn / listBtn）变成可断言对象的唯一办法。
 *
 * 数值全部来自 `experiments/svg-first/design/SPEC.md` ③ 的 rect 表（bake.mjs 从 SVG 实测）。
 * 改这里之前先跑 `node tools/svg-rect-diff.mjs` 与 `parts.test.ts` —— 对拍会立刻报红。
 */

import type { Rect } from './deps';

export interface Point {
  readonly x: number;
  readonly y: number;
}

// ────────────────────────────── albumCover ──────────────────────────────

/** 设计稿基准边长（SVG 里封面就是 318×318；其他屏型按短边等比缩放内部装饰）。 */
export const COVER_BASE = 318;
/** 方章相对封面左上角的偏移（SVG `translate(20,254)`）。 */
const SEAL_OFFSET = { x: 20, y: 254, w: 44, h: 44 } as const;
/** 高光矩形高度（SVG `<rect ... height="168">`）。 */
const GLOSS_HEIGHT = 168;

export interface AlbumCoverParts {
  /** 封面正方形（box 在 390×844 下恰好等于它；跨屏型取短边）。 */
  readonly cover: Rect;
  /** 方章「乐」。 */
  readonly seal: Rect;
  /** 斜向高光覆盖区。 */
  readonly gloss: Rect;
  /** 设计稿基准 → 当前边长 的缩放比（390 下为 1）。 */
  readonly scale: number;
}

export const albumCoverPartsOf = (box: Rect): AlbumCoverParts => {
  // `.ui` 用 `size fill aspect 1`（v0.7）时 box 本身已是正方形，这里的 min 是**兜底**：
  // 调用方若没写 aspect（或换了别的比例），仍然画出内接正方形而不是把封面拉变形。
  const side = Math.min(box.w, box.h);
  const scale = side / COVER_BASE;
  const cover: Rect = { x: box.x, y: box.y, w: side, h: side };
  return {
    cover,
    scale,
    seal: {
      x: cover.x + SEAL_OFFSET.x * scale,
      y: cover.y + SEAL_OFFSET.y * scale,
      w: SEAL_OFFSET.w * scale,
      h: SEAL_OFFSET.h * scale,
    },
    gloss: { x: cover.x, y: cover.y, w: side, h: GLOSS_HEIGHT * scale },
  };
};

// ───────────────────────────── progressBar ─────────────────────────────

/** 轨道高 / 轨道与时间行间距 / 时间行高 / 单侧时间宽（SPEC ③ 的 4 个子 rect）。 */
export const TRACK_H = 18;
export const TRACK_GAP = 8;
export const TIME_ROW_H = 18;
export const TIME_W = 60;

export interface ProgressBarParts {
  readonly track: Rect;
  readonly timeRow: Rect;
  readonly timeCurrent: Rect;
  readonly timeTotal: Rect;
}

export const progressBarPartsOf = (box: Rect): ProgressBarParts => {
  const rowY = box.y + TRACK_H + TRACK_GAP;
  return {
    track: { x: box.x, y: box.y, w: box.w, h: TRACK_H },
    timeRow: { x: box.x, y: rowY, w: box.w, h: TIME_ROW_H },
    timeCurrent: { x: box.x, y: rowY, w: TIME_W, h: TIME_ROW_H },
    timeTotal: { x: box.x + box.w - TIME_W, y: rowY, w: TIME_W, h: TIME_ROW_H },
  };
};

// ───────────────────────────── controlsRow ─────────────────────────────

export interface ControlsRowOptions {
  readonly gap: number;
  readonly justify: 'start' | 'center' | 'end' | 'space-between';
  /** 每个子键的边长（设计稿里都是正方形圆键）。 */
  readonly sizes: readonly number[];
}

/** 主控三键：52 / 84 / 52，间距 32，整体居中（SPEC ③ 的 primaryControls）。 */
export const PRIMARY_CONTROLS: ControlsRowOptions = { gap: 32, justify: 'center', sizes: [52, 84, 52] };
/** 次级三键：44 × 3，间距 0，两端分开（SPEC ③ 的 secondaryRow）。 */
export const SECONDARY_CONTROLS: ControlsRowOptions = { gap: 0, justify: 'space-between', sizes: [44, 44, 44] };

/**
 * 一行正方键的矩形。与 `layout()` 的 row 语义同口径：
 * 主轴按 justify 摆放、交叉轴垂直居中。
 */
export const controlsRowPartsOf = (box: Rect, opts: ControlsRowOptions = PRIMARY_CONTROLS): readonly Rect[] => {
  const total = opts.sizes.reduce((sum, size) => sum + size, 0) + opts.gap * Math.max(0, opts.sizes.length - 1);
  const free = box.w - total;
  const between = opts.justify === 'space-between' && opts.sizes.length > 1
    ? free / (opts.sizes.length - 1)
    : 0;
  let cursor = opts.justify === 'center' ? free / 2 : opts.justify === 'end' ? free : 0;
  return opts.sizes.map((size) => {
    const rect: Rect = { x: box.x + cursor, y: box.y + (box.h - size) / 2, w: size, h: size };
    cursor += size + opts.gap + between;
    return rect;
  });
};

// ───────────────────────────── iconButton ─────────────────────────────

export interface IconButtonParts {
  /** 触摸目标（= box，设计稿里 44 / 52）。 */
  readonly box: Rect;
  /** 圆盘：距边 0.5px，让 1px 描边落在像素内（SVG `r=21.5` @44）。 */
  readonly disc: Rect;
}

export const iconButtonPartsOf = (box: Rect): IconButtonParts => ({
  box,
  disc: { x: box.x + 0.5, y: box.y + 0.5, w: box.w - 1, h: box.h - 1 },
});

// ───────────────────────────── playButton ─────────────────────────────

export interface Circle {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

export interface PlayButtonParts {
  readonly box: Rect;
  /** 金色细外环（SVG `r=41` @84）。 */
  readonly ring: Circle;
  /** 渐变圆盘（SVG `r=38` @84）。 */
  readonly disc: Circle;
  /** 内侧高光环（SVG `r=37` @84）。 */
  readonly gloss: Circle;
  /** 播放三角（SVG `M34 27 L56 42 L34 57`，相对 84 中心 42,42）。 */
  readonly triangle: readonly [Point, Point, Point];
}

export const playButtonPartsOf = (box: Rect): PlayButtonParts => {
  const radius = Math.min(box.w, box.h) / 2;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const k = radius / 42; // 设计稿基准半径
  return {
    box,
    ring: { cx, cy, r: radius - 1 * k },
    disc: { cx, cy, r: radius - 4 * k },
    gloss: { cx, cy, r: radius - 5 * k },
    triangle: [
      { x: cx - 8 * k, y: cy - 15 * k },
      { x: cx + 14 * k, y: cy },
      { x: cx - 8 * k, y: cy + 15 * k },
    ],
  };
};
