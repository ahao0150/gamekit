// audio 契约测试：unlock 状态机、bus 音量/静音独立、no-op 降级。Node 环境，无 DOM。
import { describe, expect, it, vi } from 'vitest';
import type { PlayingAudio } from './contract';
import { createAudio } from './index';

function makeSound(finished = false): PlayingAudio {
  const stops: number[] = [];
  return {
    stop() {
      stops.push(1);
    },
    get finished() {
      return finished;
    },
  };
}

describe('no-op 降级（无 createSound）', () => {
  it('播放/停全部不抛错', () => {
    const a = createAudio({});
    expect(a.playSfx('click')).toBeNull();
    expect(() => a.playBgm('bgm')).not.toThrow();
    expect(() => a.stopBgm()).not.toThrow();
    expect(() => a.pauseBgm()).not.toThrow();
    expect(() => a.resumeBgm()).not.toThrow();
  });

  it('unlock 无平台函数时直接成功', async () => {
    const a = createAudio({});
    await expect(a.unlock()).resolves.toBe(true);
    expect(a.unlocked).toBe(true);
  });
});

describe('unlock 状态机', () => {
  it('平台允许 → unlocked', async () => {
    const a = createAudio({ unlock: () => Promise.resolve(true) });
    expect(a.unlocked).toBe(false);
    await expect(a.unlock()).resolves.toBe(true);
    expect(a.unlocked).toBe(true);
  });

  it('平台不允许 → 回到 locked，可重试', async () => {
    const a = createAudio({ unlock: () => Promise.resolve(false) });
    await expect(a.unlock()).resolves.toBe(false);
    expect(a.unlocked).toBe(false);
    // 重试成功
    const b = createAudio({
      unlock: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
    });
    await expect(b.unlock()).resolves.toBe(false);
    await expect(b.unlock()).resolves.toBe(true);
    expect(b.unlocked).toBe(true);
  });

  it('解锁中重复调用复用同一次触发', async () => {
    let resolveFn: (v: boolean) => void = () => {};
    const unlock = vi.fn(
      () =>
        new Promise<boolean>((res) => {
          resolveFn = res;
        }),
    );
    const a = createAudio({ unlock });
    const p1 = a.unlock();
    const p2 = a.unlock();
    expect(unlock).toHaveBeenCalledTimes(1); // 不重复触发
    resolveFn(true);
    await expect(p1).resolves.toBe(true);
    await expect(p2).resolves.toBe(true);
  });

  it('已解锁后 unlock 立即 resolve 且不再触发平台函数', async () => {
    const unlock = vi.fn(() => Promise.resolve(true));
    const a = createAudio({ unlock });
    await a.unlock();
    await a.unlock();
    await a.unlock();
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it('平台 unlock 抛错不向上传播，返回 false', async () => {
    const a = createAudio({ unlock: () => Promise.reject(new Error('x')) });
    await expect(a.unlock()).resolves.toBe(false);
  });
});

describe('playSfx', () => {
  it('把 key 与计算音量传给 createSound', () => {
    const calls: Array<{ src: string; loop: boolean; volume: number }> = [];
    const a = createAudio({
      createSound: (src, o) => {
        calls.push({ src, loop: o.loop, volume: o.volume });
        return makeSound();
      },
    });
    a.playSfx('click');
    a.playSfx('boom', { volume: 0.5, loop: true });
    expect(calls[0]).toEqual({ src: 'click', loop: false, volume: 1 });
    expect(calls[1]).toEqual({ src: 'boom', loop: true, volume: 0.5 });
  });

  it('createSound 抛错时返回 null（资源缺失静默忽略）', () => {
    const a = createAudio({
      createSound: () => {
        throw new Error('missing');
      },
    });
    expect(a.playSfx('x')).toBeNull();
  });

  it('bus 音量参与乘法、静音时音量为 0', () => {
    const calls: number[] = [];
    const a = createAudio({
      createSound: (_s, o) => {
        calls.push(o.volume);
        return makeSound();
      },
    });
    a.setVolume('sfx', 0.5);
    a.playSfx('a', { volume: 0.8 }); // 0.5*0.8
    a.setMuted('sfx', true);
    a.playSfx('b'); // 静音 → 0
    expect(calls).toEqual([0.4, 0]);
  });
});

describe('BGM 单实例', () => {
  function makeTracker() {
    const log: string[] = [];
    const a = createAudio({
      createSound: (src, o) => {
        log.push(`play ${src} loop=${o.loop} v=${o.volume}`);
        const inst = makeSound();
        return {
          stop() {
            log.push(`stop ${src}`);
          },
          get finished() {
            return false;
          },
        };
      },
    });
    return { a, log };
  }

  it('新曲顶掉旧曲（旧实例被 stop）', () => {
    const { a, log } = makeTracker();
    a.playBgm('one');
    a.playBgm('two');
    expect(log).toEqual(['play one loop=true v=1', 'stop one', 'play two loop=true v=1']);
  });

  it('同曲在播不重启', () => {
    const { a, log } = makeTracker();
    a.playBgm('one');
    a.playBgm('one');
    expect(log).toHaveLength(1);
  });

  it('pause → resume 按原曲重播', () => {
    const { a, log } = makeTracker();
    a.playBgm('one');
    a.pauseBgm();
    a.resumeBgm();
    expect(log).toEqual(['play one loop=true v=1', 'stop one', 'play one loop=true v=1']);
  });

  it('带 pause/resume 的实现：走真暂停，不 stop 不重播', () => {
    const log: string[] = [];
    const a = createAudio({
      createSound: (src) => ({
        stop() {
          log.push(`stop ${src}`);
        },
        pause() {
          log.push(`pause ${src}`);
        },
        resume() {
          log.push(`resume ${src}`);
        },
        get finished() {
          return false;
        },
      }),
    });
    a.playBgm('one');
    a.pauseBgm();
    a.resumeBgm();
    // 断言：调的是 pause/resume，且全程零 stop、零重复 play
    expect(log).toEqual(['pause one', 'resume one']);
  });

  it('带 pause/resume 的实现：暂停后重复 pause/resume 幂等', () => {
    const log: string[] = [];
    const a = createAudio({
      createSound: (src) => ({
        stop() {
          log.push('stop');
        },
        pause() {
          log.push('pause');
        },
        resume() {
          log.push('resume');
        },
        get finished() {
          return false;
        },
      }),
    });
    a.playBgm('one');
    a.pauseBgm();
    a.pauseBgm(); // 已暂停：不应重复调平台 pause
    a.resumeBgm();
    a.resumeBgm(); // 未暂停：不应调平台 resume
    expect(log).toEqual(['pause', 'resume']);
  });

  it('降级实现（无 pause/resume）：暂停即 stop，恢复从头重播且状态回到在播', () => {
    let plays = 0;
    const log: string[] = [];
    const a = createAudio({
      createSound: (src) => {
        plays += 1;
        log.push(`play#${plays} ${src}`);
        return {
          stop() {
            log.push('stop');
          },
          get finished() {
            return false;
          },
        };
      },
    });
    a.playBgm('one');
    a.pauseBgm();
    a.resumeBgm();
    expect(log).toEqual(['play#1 one', 'stop', 'play#2 one']); // 重播 = 恢复为在播
    a.playBgm('one'); // 在播中同曲再点：不重启（证明状态已回到在播）
    expect(log).toHaveLength(3);
  });

  it('stopBgm 后 resume 不再重播', () => {
    const { a, log } = makeTracker();
    a.playBgm('one');
    a.stopBgm();
    a.resumeBgm();
    expect(log).toEqual(['play one loop=true v=1', 'stop one']);
  });
});

describe('音量与静音独立', () => {
  it('静音不改音量读数；改音量不解除静音', () => {
    const a = createAudio({});
    a.setVolume('bgm', 0.4);
    a.setMuted('bgm', true);
    expect(a.getVolume('bgm')).toBe(0.4);
    expect(a.isMuted('bgm')).toBe(true);
    a.setVolume('bgm', 0.9); // 静音中改音量
    expect(a.getVolume('bgm')).toBe(0.9);
    expect(a.isMuted('bgm')).toBe(true); // 仍静音
  });

  it('sfx 与 bgm 两 bus 互不影响', () => {
    const a = createAudio({});
    a.setVolume('sfx', 0.1);
    a.setMuted('bgm', true);
    expect(a.getVolume('bgm')).toBe(1);
    expect(a.isMuted('sfx')).toBe(false);
  });
});
