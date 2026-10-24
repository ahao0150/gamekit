/**
 * Canvas 2D 特效库（T23）。
 *
 * 为什么不用 Shader：小游戏里 WebGL 着色器的代价是「每帧全屏纹理上传 + 平台差异」，
 * 而下面这些观感用 Canvas 2D 就能覆盖 80% 场景，**零平台风险、零包体增量**
 *（没游戏 import 时整包不进产物）。
 *
 * 边界（与组件同一条）：
 * - 只读参数、只画，不读写全局状态（随机性走 `hash01(seed)`，不用 Math.random / 时间）；
 * - 所有参数钳制，坏参数不崩、不画负尺寸；
 * - 元素级特效接「画内容」回调，负责前后处理；全屏级直接画在视口上。
 *
 * 注意 `drawWithDissolve` 会 `destination-out` 擦除**当前画布**已有像素，
 * 必须用在隔离的一层（详见该文件头注释）。
 */

export type { GlowOptions } from './glow';
export { drawWithGlow } from './glow';
export type { DissolveOptions } from './dissolve';
export { drawWithDissolve } from './dissolve';
export type { ChromaticOptions } from './chromatic';
export { drawWithChromatic } from './chromatic';
export type { FlashOptions } from './flash';
export { drawFlash } from './flash';
export type { ShakeOptions } from './shake';
export { beginShake } from './shake';
export type { VignetteOptions } from './vignette';
export { drawVignette } from './vignette';
export type { ScanlineOptions } from './scanline';
export { drawScanline } from './scanline';
export { clamp01, withAlpha } from './util';
