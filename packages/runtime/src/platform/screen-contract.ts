/**
 * 屏幕信息契约（T47 从 `contract.ts` 拆出来）。
 *
 * 为什么拆：`contract.ts` 贴着单文件 300 行上限（AGENTS 铁律 2），而屏幕信息
 * 是适配层最底层的一块数据面。对外导入路径仍然是 `platform/contract`
 * （由它 re-export），与 `keyboard-contract.ts` / `wheel-contract.ts` 同一套做法。
 *
 * 本文件里**唯一的新概念是 `menuButton`**（系统胶囊 / 菜单按钮）：
 * 微信、抖音在右上角浮一个系统按钮，它**不在 `safeArea` 里**（safeArea 只描述
 * 刘海 / 圆角 / Home 条），所以必须单独采集，否则 HUD 会被它压住。
 *
 * 坐标约定（三端统一）：`MenuButtonRect` 是**画布逻辑坐标**（原点 = 画布左上角），
 * 单位与 `screen.width/height` 一致。平台原始值（微信的
 * `getMenuButtonBoundingClientRect()`）是**以屏幕左上角为原点**，
 * 小游戏里画布铺满屏幕，两者 1:1；万一宿主把画布挪了位（开发者工具 / 嵌套容器），
 * 用 `toMenuButtonRect(raw, offset)` 把偏移减掉。
 */

/** 矩形（逻辑像素）。字段名与 `core/ui` 的 `Rect` 同形，但 platform 不 import core。 */
export interface MenuButtonRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 四边内缩（逻辑像素） */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const ZERO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * 屏幕信息。width/height 是**逻辑像素**（已按适配策略换算），不是物理像素。
 * 绘制时统一用 `ctx.setTransform(dpr,0,0,dpr,0,0)` 进入逻辑坐标系。
 */
export interface ScreenInfo {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly insets: Insets;
  readonly orientation: 'landscape' | 'portrait';
  /**
   * 系统浮层按钮（微信/抖音右上角胶囊）占用的矩形；没有该 UI 的平台不实现。
   * 逻辑像素，相对**画布左上角**。布局层用它把 HUD 挪开。
   */
  readonly menuButton?: MenuButtonRect;
}

/**
 * 平台 API 返回的原始胶囊矩形。
 *
 * 微信：`wx.getMenuButtonBoundingClientRect()` → `{ width, height, top, right, bottom, left }`，
 * 单位 px、**以屏幕左上角为原点**（官方文档 + Taro 文档都这么写）。
 * 抖音：字段同形（见 `douyin/api.ts` 的「未确认」说明）。
 */
export interface RawMenuButtonRect {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** 画布左上角在页面里的偏移（小游戏恒 0,0，开发者工具/嵌套容器里可能不是）。 */
export interface CanvasOffset {
  readonly left: number;
  readonly top: number;
}

const finite = (value: number): number => (Number.isFinite(value) ? value : 0);

/**
 * 原始矩形（页面/屏幕坐标）→ 画布逻辑坐标。
 *
 * 校验：宽高取 `width/height`，缺失时退化用 `right-left` / `bottom-top`；
 * 宽高 <= 0（没有胶囊 / 数据坏了）直接返回 undefined —— 布局层不该拿到一个
 * 「零尺寸但在那儿」的胶囊去避让。坐标允许被钳到 0（画布外的部分不算）。
 */
export const toMenuButtonRect = (
  raw: RawMenuButtonRect,
  offset: CanvasOffset = { left: 0, top: 0 },
): MenuButtonRect | undefined => {
  const w = finite(raw.width) > 0 ? finite(raw.width) : finite(raw.right) - finite(raw.left);
  const h = finite(raw.height) > 0 ? finite(raw.height) : finite(raw.bottom) - finite(raw.top);
  if (!(w > 0) || !(h > 0)) return undefined;
  const x = Math.max(0, finite(raw.left) - finite(offset.left));
  const y = Math.max(0, finite(raw.top) - finite(offset.top));
  return { x, y, w, h };
};

/**
 * 防御性归一：把**明显超出屏幕**的矩形按 dpr 折回逻辑像素，再钳进屏幕。
 *
 * 为什么要这一步：微信返回 px、逻辑像素；而抖音的 `getMenuButtonLayout` 有真机
 * 采样值（`{"width":85,"height":32,"top":6,"right":2192,"bottom":38,"left":2107}`）
 * 明显是**物理像素**（2192 ≈ 1096×dpr2）。文档抓不到，所以不猜哪一端是哪种口径，
 * 只按「装不下就 /dpr」判：合法逻辑矩形一定在屏幕内，该判定不会误伤。
 */
export const normalizeMenuButtonRect = (
  rect: MenuButtonRect,
  screen: { readonly width: number; readonly height: number; readonly dpr: number },
): MenuButtonRect => {
  const dpr = Number.isFinite(screen.dpr) && screen.dpr > 0 ? screen.dpr : 1;
  const width = finite(screen.width);
  const height = finite(screen.height);
  const overflow = rect.x + rect.w > width + 1 || rect.y + rect.h > height + 1;
  const scaled = overflow && dpr !== 1
    ? { x: rect.x / dpr, y: rect.y / dpr, w: rect.w / dpr, h: rect.h / dpr }
    : rect;
  const x = Math.min(Math.max(0, scaled.x), Math.max(0, width));
  const y = Math.min(Math.max(0, scaled.y), Math.max(0, height));
  return {
    x,
    y,
    w: Math.min(scaled.w, Math.max(0, width - x)),
    h: Math.min(scaled.h, Math.max(0, height - y)),
  };
};

/** 小游戏宿主上「读胶囊」用到的那两个 API（wx / tt 同形；两个都可选）。 */
export interface MiniMenuButtonApi {
  getMenuButtonBoundingClientRect?(): RawMenuButtonRect;
  getMenuButtonLayout?(): RawMenuButtonRect;
}

/** 画布对象上可能存在的 `getBoundingClientRect`（小游戏里通常没有）。 */
interface CanvasWithBox {
  getBoundingClientRect?(): { readonly left: number; readonly top: number };
}

/** 读画布偏移：小游戏没有这个方法就按 (0,0) —— 画布铺满屏幕，页面坐标即画布坐标。 */
const canvasOffsetOf = (canvas: unknown): CanvasOffset => {
  const box = canvas as CanvasWithBox | null;
  if (box === null || box === undefined || typeof box.getBoundingClientRect !== 'function') {
    return { left: 0, top: 0 };
  }
  try {
    const rect = box.getBoundingClientRect();
    return { left: finite(rect.left), top: finite(rect.top) };
  } catch {
    return { left: 0, top: 0 };
  }
};

/**
 * 小游戏端读胶囊（wx / tt 共用一份）。
 *
 * 三条规矩：
 * 1. **老基础库没有该 API → undefined**，构造期绝不抛错（与键盘同一条原则）；
 * 2. API 调用本身也可能抛（部分宿主的实现会），包 try/catch 后当没有；
 * 3. 优先 `getMenuButtonBoundingClientRect`（微信同形），没有才退到抖音的
 *    `getMenuButtonLayout`（字段同形，可能给物理像素 → 走 normalize 折回）。
 */
export const readMiniMenuButton = (
  api: MiniMenuButtonApi,
  canvas: unknown,
  screen: { readonly width: number; readonly height: number; readonly dpr: number },
): MenuButtonRect | undefined => {
  const read = typeof api.getMenuButtonBoundingClientRect === 'function'
    ? (): RawMenuButtonRect => api.getMenuButtonBoundingClientRect!()
    : typeof api.getMenuButtonLayout === 'function'
      ? (): RawMenuButtonRect => api.getMenuButtonLayout!()
      : null;
  if (read === null) return undefined;
  let raw: RawMenuButtonRect;
  try {
    raw = read();
  } catch {
    return undefined;
  }
  const rect = toMenuButtonRect(raw, canvasOffsetOf(canvas));
  return rect === undefined ? undefined : normalizeMenuButtonRect(rect, screen);
};
