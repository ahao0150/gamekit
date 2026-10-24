/**
 * web 音频句柄契约测试（Node，无 DOM，用假 Audio）。
 *
 * 守三类真实发生过的缺陷：
 * 1. `play()` 的 rejection 没人接 → unhandled rejection 打进控制台。
 *    `void p` 不接 rejection，必须是 `p.catch()`；触发场景是
 *    「stop() 打断 pending 的 play()」→ AbortError。
 * 2. `stop()` 必须真的回到 0（重触发要能从头响）。
 * 3. `pause()` / `resume()` 必须保留播放位置（BGM 暂停恢复不能重头播）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebAudio } from './audio';

/** 可控的假 HTMLAudioElement：能模拟 play() 被拒。 */
class FakeAudio {
  /** 下次 play() 返回 reject（模拟自动播放策略拒绝 / pause 打断）。 */
  static rejectNext = false;
  /** 所有实例（便于从外部观察）。 */
  static instances: FakeAudio[] = [];

  src: string;
  loop = false;
  volume = 1;
  currentTime = 0;
  paused = true;
  playCalls = 0;
  pauseCalls = 0;
  loadCalls = 0;

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }

  play(): Promise<void> {
    this.playCalls += 1;
    if (FakeAudio.rejectNext) {
      const err = new Error('play() request was interrupted by a call to pause()');
      err.name = 'AbortError';
      return Promise.reject(err);
    }
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls += 1;
    this.paused = true;
  }

  removeAttribute(attr: string): void {
    if (attr === 'src') this.src = '';
  }

  load(): void {
    this.loadCalls += 1;
  }
}

/** 取唯一实例；没有就报错（让测试信息直说，而不是 undefined 崩）。 */
function first(): FakeAudio {
  const el = FakeAudio.instances[0];
  if (!el) throw new Error('expected one Audio instance');
  return el;
}

/** 收集本轮异步里的 unhandledRejection。 */
function watchUnhandled(): { seen: unknown[]; stop: () => void } {
  const seen: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    seen.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  return {
    seen,
    stop: () => {
      process.off('unhandledRejection', onUnhandled);
    },
  };
}

/** 等到 microtask + 一个宏任务都跑完（unhandledRejection 在 tick 后触发）。 */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

afterEach(() => {
  FakeAudio.rejectNext = false;
  FakeAudio.instances = [];
  vi.unstubAllGlobals();
});

describe('createWebAudio', () => {
  it('构造时用给定 src 造元素', () => {
    vi.stubGlobal('Audio', FakeAudio);
    createWebAudio('assets/sfx/click.wav');
    expect(FakeAudio.instances).toHaveLength(1);
    expect(first().src).toBe('assets/sfx/click.wav');
  });

  it('play() 被拒（AbortError）不产生 unhandled rejection', async () => {
    const watch = watchUnhandled();
    try {
      vi.stubGlobal('Audio', FakeAudio);
      FakeAudio.rejectNext = true;
      const a = createWebAudio('assets/sfx/place.wav');
      a.play();
      await flush();
      expect(watch.seen).toHaveLength(0);
    } finally {
      watch.stop();
    }
  });

  it('resume() 被拒也不产生 unhandled rejection', async () => {
    const watch = watchUnhandled();
    try {
      vi.stubGlobal('Audio', FakeAudio);
      FakeAudio.rejectNext = true;
      const a = createWebAudio('assets/sfx/place.wav');
      a.resume();
      await flush();
      expect(watch.seen).toHaveLength(0);
    } finally {
      watch.stop();
    }
  });

  it('stop() 真的回到 0（重触发要能从头响）', () => {
    vi.stubGlobal('Audio', FakeAudio);
    const a = createWebAudio('assets/sfx/click.wav');
    const el = first();
    el.currentTime = 0.032;
    a.stop();
    expect(el.currentTime).toBe(0);
    expect(el.paused).toBe(true);
  });

  it('pause() 保留播放位置，resume() 从该位置继续（BGM 暂停恢复不重头）', () => {
    vi.stubGlobal('Audio', FakeAudio);
    const a = createWebAudio('assets/bgm/theme.wav');
    const el = first();
    el.currentTime = 12.5;
    a.pause();
    expect(el.currentTime).toBe(12.5);
    a.resume();
    expect(el.currentTime).toBe(12.5);
    expect(el.playCalls).toBe(1);
  });

  it('setVolume 钳制到 0..1', () => {
    vi.stubGlobal('Audio', FakeAudio);
    const a = createWebAudio('assets/sfx/click.wav');
    const el = first();
    a.setVolume(-1);
    expect(el.volume).toBe(0);
    a.setVolume(3);
    expect(el.volume).toBe(1);
    a.setVolume(0.4);
    expect(el.volume).toBe(0.4);
  });

  it('destroy() 停播、摘掉 src 并 load 释放', () => {
    vi.stubGlobal('Audio', FakeAudio);
    const a = createWebAudio('assets/sfx/win.wav');
    const el = first();
    a.destroy();
    expect(el.paused).toBe(true);
    expect(el.src).toBe('');
    expect(el.loadCalls).toBe(1);
  });
});
