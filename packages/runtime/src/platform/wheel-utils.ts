/**
 * 滚轮 delta 归一（三端共用的纯函数）。
 *
 * 为什么必须归一：DOM 的 `WheelEvent.deltaY` 单位由 `deltaMode` 决定 ——
 * 0 = 像素、1 = 行、2 = 页。同一台机器上，触控板给 0（往往是 ±1~±50），
 * 老式鼠标 / Firefox 给 1（±3 行），部分场景给 2。不换算的话：
 * - 行模式一格被当成 1px，滚一屏要划上百次（看起来像「滚轮坏了」）；
 * - 页模式一格只有 1px，同样几乎不动。
 *
 * 微信 / 抖音的滚轮回调没有 deltaMode（它们的字段本身就是像素级增量），
 * 所以只有 web 侧会用到 `normalizeWheelDelta`，但**函数放在 platform/ 公共层**：
 * 以后哪个端要报行/页单位，直接复用，不在两个文件里各写一遍 16 和「视口高」。
 */

/** 行模式下一行折算多少像素（浏览器默认字号 16px；Chrome/Firefox 实测一行约 16px）。 */
export const WHEEL_LINE_HEIGHT = 16;

/**
 * 把滚轮增量换算成像素。
 *
 * - `mode` 0 或未知：已经是像素，原样返回（未知模式当像素比当行更保守，
 *   宁可滚得少也不要一下跳一屏）；
 * - `mode` 1：× 16（行）；
 * - `mode` 2：× 视口高（页）。
 *
 * 脏数据（NaN / Infinity）一律 0：滚轮事件来自浏览器，不该让一个坏数字
 * 把滚动位污染成 NaN。
 */
export const normalizeWheelDelta = (delta: number, mode: number, viewportHeight: number): number => {
  if (!Number.isFinite(delta)) return 0;
  if (mode === 1) return delta * WHEEL_LINE_HEIGHT;
  if (mode === 2) {
    const page = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0;
    return delta * page;
  }
  return delta;
};
