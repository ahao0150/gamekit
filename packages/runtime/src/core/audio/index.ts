/**
 * 音频实现。
 *
 * 结构：全部状态在 createAudio 闭包里（无全局可变状态）。
 * 三个要点：
 * 1. unlock 状态机 locked → unlocking → unlocked；unlocking 期间重复调用复用同一个
 *    Promise，不重复触发平台解锁（重复触发在部分宿主上会弹两次授权）。
 * 2. bus（sfx/bgm）音量与静音是两组独立状态：静音只决定「发不发声」，不影响 getVolume。
 * 3. 没注入 createSound 时整个服务 no-op：播放返回 null / 不做任何事，绝不抛错——
 *    业务代码因此不需要 `can('audio')` 分支（契约如此约定）。
 */

import type {
  AudioBus,
  AudioService,
  CreateAudio,
  PlayOptions,
  PlayingAudio,
} from './contract';

/** unlock 状态机状态 */
type UnlockState = 'locked' | 'unlocking' | 'unlocked';

interface BusState {
  volume: number;
  muted: boolean;
}

/** 音量钳到 0..1 */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 该 bus 当前是否实际发声（未静音才发声，与音量数值无关） */
function audible(bus: BusState): boolean {
  return !bus.muted;
}

export const createAudio: CreateAudio = (opts): AudioService => {
  const createSound = opts.createSound;
  const platformUnlock = opts.unlock;

  let unlockState: UnlockState = 'locked';
  let unlockPromise: Promise<boolean> | null = null;

  const buses: Record<AudioBus, BusState> = {
    sfx: { volume: 1, muted: false },
    bgm: { volume: 1, muted: false },
  };

  // BGM 单实例：同一时刻只有一条，新的顶掉旧的
  let bgm: PlayingAudio | null = null;
  let bgmKey = '';
  let bgmPaused = false;

  function effectiveVolume(bus: AudioBus, playVolume: number | undefined): number {
    const b = buses[bus];
    return audible(b) ? clamp01(b.volume * clamp01(playVolume ?? 1)) : 0;
  }

  function stopBgmInstance(): void {
    if (bgm) {
      try {
        bgm.stop();
      } catch {
        // 平台实现的 stop 不应抛，兜底吞掉
      }
    }
    bgm = null;
  }

  const service: AudioService = {
    unlock(): Promise<boolean> {
      // 已解锁：立即成功，不重复触发
      if (unlockState === 'unlocked') return Promise.resolve(true);
      // 解锁中：复用同一次触发（重复调用不重复触发平台侧逻辑）
      if (unlockState === 'unlocking' && unlockPromise) return unlockPromise;

      // 无平台解锁函数（无音频能力 / 无需解锁）：直接视为解锁成功
      if (!platformUnlock) {
        unlockState = 'unlocked';
        return Promise.resolve(true);
      }

      unlockState = 'unlocking';
      unlockPromise = platformUnlock()
        .then((ok) => {
          unlockState = ok ? 'unlocked' : 'locked'; // false 可稍后重试
          unlockPromise = null;
          return ok;
        })
        .catch(() => {
          // 平台解锁抛错视为「本次不允许」，回到 locked，不向上抛
          unlockState = 'locked';
          unlockPromise = null;
          return false;
        });
      return unlockPromise;
    },

    get unlocked(): boolean {
      return unlockState === 'unlocked';
    },

    playSfx(key: string, playOpts?: PlayOptions): PlayingAudio | null {
      if (!createSound) return null; // 无音频能力：no-op
      const loop = playOpts?.loop ?? false; // 音效默认不循环
      const volume = effectiveVolume('sfx', playOpts?.volume);
      // 静音时音量 0：仍创建实例（保持触发语义），由平台以 0 音量播放
      try {
        return createSound(key, { loop, volume });
      } catch {
        return null; // 资源缺失等：静默忽略
      }
    },

    playBgm(key: string, playOpts?: PlayOptions): void {
      if (!createSound) return; // 无音频能力：no-op
      if (bgmKey === key && bgm && !bgm.finished && !bgmPaused) return; // 同曲在播不重启
      stopBgmInstance();
      bgmKey = key;
      bgmPaused = false;
      const loop = playOpts?.loop ?? true; // BGM 默认循环
      const volume = effectiveVolume('bgm', playOpts?.volume);
      try {
        bgm = createSound(key, { loop, volume });
      } catch {
        bgm = null;
      }
    },

    stopBgm(): void {
      stopBgmInstance();
      bgmKey = '';
      bgmPaused = false;
    },

    pauseBgm(): void {
      if (!bgm || bgmPaused) return;
      // 优先用平台 pause：保住播放位置，恢复时从暂停处继续
      if (typeof bgm.pause === 'function') {
        try {
          bgm.pause();
          bgmPaused = true;
          return;
        } catch {
          // pause 抛错则走下面的降级
        }
      }
      // 降级：PlayingAudio 没有 pause（或 pause 抛错）→ stop + resume 时重播（从头开始）
      stopBgmInstance();
      bgmPaused = true;
    },

    resumeBgm(): void {
      if (!bgmPaused) return;
      bgmPaused = false;
      // 优先用平台 resume：与 pause 成对，从暂停位置继续
      if (bgm && typeof bgm.resume === 'function') {
        try {
          bgm.resume();
          return;
        } catch {
          // resume 抛错则重播
        }
      }
      if (!createSound || !bgmKey) return;
      const volume = effectiveVolume('bgm', undefined);
      try {
        bgm = createSound(bgmKey, { loop: true, volume });
      } catch {
        bgm = null;
      }
    },

    setVolume(bus: AudioBus, volume: number): void {
      buses[bus].volume = clamp01(volume);
    },

    getVolume(bus: AudioBus): number {
      return buses[bus].volume; // 静音不影响读数
    },

    setMuted(bus: AudioBus, muted: boolean): void {
      buses[bus].muted = muted;
    },

    isMuted(bus: AudioBus): boolean {
      return buses[bus].muted;
    },
  };

  return service;
};
