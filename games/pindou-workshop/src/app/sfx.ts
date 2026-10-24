/**
 * 音效接线：把 runtime 的 `core/audio` 接到平台音频句柄上（形制照 kuaidi-load 的 sfx.ts）。
 *
 * **本工程目前没有音频资源**：`assets/` 下只有一张 `ui/btn.png`，构建注入的
 * `virtual:mg-manifest` 里没有任何 `sfx/*` key。所以：
 * - `handleOf()` 拿不到路径 → `createSound` 返回 null → `playSfx` 静默返回 null，
 *   **玩法完全不受影响**，也**不会**往包里塞假音频；
 * - 开关（音效/音乐）仍然真实作用于 `AudioService` 的 bus 静音，刷新后从存档恢复；
 * - 等美术/音频同事交付资源、把文件放进 `assets/sfx/` 后，只需把 `SFX_KEYS` 与真实
 *   文件名对齐，**本文件一行不用改**（key 就是「相对 assets/ 去扩展名」）。
 *
 * 五个事件点（T65 任务书）：拿起 / 归位成功 / 落位错误 / 定型 / 结算。
 */

import { createAudio } from './deps';
import type { AssetManifest, AudioHandle, AudioService, PlatformAdapter, PlayingAudio } from './deps';

/** 音效 key：相对 assets/ 去扩展名（与构建注入的清单同一套命名） */
export const SFX_KEYS = ['sfx/pick', 'sfx/place', 'sfx/reject', 'sfx/iron', 'sfx/result'] as const;
export type SfxKey = (typeof SFX_KEYS)[number];

export interface Sfx {
  readonly service: AudioService;
  /** 播一个音效；没有资源 / 平台无音频能力 → 静默 */
  play(key: SfxKey): void;
  /** 音效开关（false = 静音 sfx bus） */
  setSound(on: boolean): void;
  /** 音乐开关（false = 静音 bgm bus） */
  setMusic(on: boolean): void;
  /** 解锁音频：必须在用户手势里调（首次点击/触摸） */
  unlock(): Promise<boolean>;
  /** 已建立的底层句柄数（测试用：本工程没有音频资源，这里应为 0） */
  readonly handleCount: number;
  /** 本次会话播过的事件（测试与验收脚本用） */
  readonly played: readonly SfxKey[];
  dispose(): void;
}

export interface SfxOptions {
  readonly platform: PlatformAdapter;
  readonly manifest: AssetManifest;
}

export const createSfx = (opts: SfxOptions): Sfx => {
  const { platform, manifest } = opts;
  const handles = new Map<string, AudioHandle>();
  const played: SfxKey[] = [];

  /** 拿（并缓存）底层句柄；清单里没有这个 key / 平台建不出 → null（不响、不报错） */
  const handleOf = (key: string): AudioHandle | null => {
    const cached = handles.get(key);
    if (cached) return cached;
    const path = manifest[key]?.[0];
    if (!path) return null;
    try {
      const created = platform.createAudio?.(path);
      if (!created) return null;
      handles.set(key, created);
      return created;
    } catch {
      return null;
    }
  };

  const service = createAudio({
    createSound: (key, o): PlayingAudio | null => {
      const handle = handleOf(key);
      if (!handle) return null;
      const resumable = handle as AudioHandle & { resume?: () => void };
      let stopped = false;
      try {
        handle.setVolume(o.volume);
        handle.setLoop(o.loop);
        handle.play();
      } catch {
        return null;
      }
      return {
        stop: () => {
          stopped = true;
          handle.stop();
        },
        pause: () => handle.pause(),
        ...(typeof resumable.resume === 'function' ? { resume: () => resumable.resume?.() } : {}),
        get finished(): boolean {
          return stopped;
        },
      };
    },
  });

  return {
    service,
    play(key: SfxKey): void {
      played.push(key);
      if (played.length > 64) played.shift();
      service.playSfx(key);
    },
    setSound(on: boolean): void {
      service.setMuted('sfx', !on);
    },
    setMusic(on: boolean): void {
      service.setMuted('bgm', !on);
    },
    unlock: (): Promise<boolean> => service.unlock(),
    get handleCount(): number {
      return handles.size;
    },
    get played(): readonly SfxKey[] {
      return played;
    },
    dispose(): void {
      for (const handle of handles.values()) {
        try {
          handle.destroy();
        } catch {
          // 释放失败不影响退出
        }
      }
      handles.clear();
    },
  };
};
