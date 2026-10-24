/**
 * 平台层音频句柄的扩展类型。
 *
 * 为什么单独这个文件：
 * 契约（platform/contract.ts）里的 `AudioHandle` 是冻结的，里面有 `pause()`
 * 但**没有** `resume()`。而「BGM 暂停后从原处继续」（而不是从头重播）需要
 * `resume()`。改契约要先确认，所以这里用一个扩展类型把这项能力显式化：
 *
 *   - 三端底层对象本来就有这两个方法（HTMLAudioElement / InnerAudioContext），
 *     接上即可；
 *   - 契约没被改动，原有 `AudioHandle` 的使用方一律不受影响；
 *   - `ResumableAudioHandle extends AudioHandle`，可以安全地赋给契约里
 *     `createAudio?(src): AudioHandle` 的返回位。
 *
 * 另外，「某平台没有 resume」是允许的：那种平台的 createAudio 直接返回
 * `AudioHandle`（不含 resume），core 侧用可选链判断并降级。
 */

import type { AudioHandle } from './contract';

/** 支持「暂停 → 从原处继续」的音频句柄。 */
export interface ResumableAudioHandle extends AudioHandle {
  /** 从暂停位置继续播放（不是从头重播）。 */
  resume(): void;
}
