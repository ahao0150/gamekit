/**
 * web 的音频实现。
 *
 * 为什么单独一个文件：
 * 音频是 web 端最独立的一块（HTMLAudioElement + 浏览器自动播放策略），
 * 和画布/屏幕/事件接线没有耦合，拆出来 index.ts 就只剩「装配」。
 *
 * 关键语义（core 的 BGM 暂停/恢复依赖它）：
 * - `pause()` 调 HTMLAudioElement.pause()，**保留播放位置**；
 * - `resume()` 调 play()，浏览器会**从暂停处继续**，不是从头重播。
 *   这正是 core 之前缺 resume 时 BGM「暂停再恢复从头播」的根因。
 * - `stop()` 才是真的从头：先 pause 再把 currentTime 归零。
 * - `play()` 返回的 Promise 必须 catch：自动播放被拒时会 reject，
 *   但那属于「用户还没交互」，不该在音频层抛出去打断游戏流程；
 *   真要感知解锁，业务走 core 的 unlock()。
 *
 * 为什么是 `.catch()` 而不是只写 `void`（真踩过，2026-10-20）：
 * `void promise` 只丢弃返回值，**不会**接住 rejection —— 它仍会变成 unhandled
 * rejection 打进控制台。典型触发是「stop() 打断一个 pending 的 play()」：
 * 浏览器抛 AbortError: play() request was interrupted by a call to pause()，
 * 于是重触发音效的写法（stop + play）必然在控制台留错。
 * 所以重触发的正确写法是「不 stop、直接 play()」（播完后再 play 浏览器会回到 0
 * 从头播），且这一层的异常一律吞掉。
 */

import type { ResumableAudioHandle } from '../audio';

/** 造一个 web 音频句柄。 */
export const createWebAudio = (src: string): ResumableAudioHandle => {
  const el = new Audio(src);
  el.loop = false;
  return {
    play: () => {
      void el.play().catch(() => {});
    },
    pause: () => el.pause(),
    resume: () => {
      void el.play().catch(() => {});
    },
    stop: () => {
      el.pause();
      el.currentTime = 0;
    },
    setVolume: (v: number) => {
      el.volume = Math.max(0, Math.min(1, v));
    },
    setLoop: (loop: boolean) => {
      el.loop = loop;
    },
    destroy: () => {
      el.pause();
      el.removeAttribute('src');
      el.load();
    },
  };
};
