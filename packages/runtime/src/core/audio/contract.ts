/**
 * 音频契约。
 *
 * 为什么要有 `unlock()`：web 端的 AudioContext 在用户手势之前是 suspended，
 * 微信/抖音也要求首次播放发生在用户交互后。三端都有这个约束，所以「解锁」
 * 是契约的一部分，不是某个平台的补丁。
 *
 * 为什么分 bus：音效与 BGM 必须能独立调音量、独立静音（设置面板的标准需求）。
 *
 * 为什么没有音频能力也要实现：契约要求「无能力时 no-op」，业务代码不许写
 * `if (platform.can('audio'))` 包住每一次播放入口——那是重复分支。
 */

export type AudioBus = 'sfx' | 'bgm';

export interface PlayOptions {
  /** 0..1，默认 1；会再乘以 bus 音量 */
  readonly volume?: number;
  /** 是否循环；BGM 默认 true，音效默认 false */
  readonly loop?: boolean;
}

/** 一个正在播放的音频实例（音效可能需要多实例叠加）。 */
export interface PlayingAudio {
  stop(): void;
  /**
   * 暂停并保持播放位置。平台底层有 pause 的实现**必须**提供
   * （web 的 HTMLAudioElement、wx/tt 的 InnerAudioContext 都有）。
   * 不提供时 core 层降级为「stop + resume 时重播」，即从头开始。
   */
  pause?(): void;
  /** 从暂停位置继续，与 `pause` 成对出现。 */
  resume?(): void;
  readonly finished: boolean;
}

export interface AudioService {
  /**
   * 尝试解锁音频。必须在用户手势里调用（首次点击/触摸）。
   * 已解锁时立即 resolve；未解锁且平台不允许时返回 false，不抛错。
   */
  unlock(): Promise<boolean>;

  readonly unlocked: boolean;

  /** 播放音效（可叠加）。资源缺失时静默忽略。 */
  playSfx(key: string, opts?: PlayOptions): PlayingAudio | null;

  /** 播放 BGM（同一时刻只有一条，新的一首顶掉旧的）。 */
  playBgm(key: string, opts?: PlayOptions): void;

  /**
   * 停止 BGM。
   * 不做淡出：core 层没有定时器抽象，为淡出引入 setTimeout 会和主循环的固定步长
   * 打架，也会让测试被迫用假时钟。淡出留给游戏业务自己在 loop.update 里调
   * `setVolume` 实现——那才是它该在的地方。
   */
  stopBgm(): void;
  pauseBgm(): void;
  resumeBgm(): void;

  /** bus 音量 0..1 */
  setVolume(bus: AudioBus, volume: number): void;
  getVolume(bus: AudioBus): number;

  /** 静音开关，独立于音量（静音后改音量不发声） */
  setMuted(bus: AudioBus, muted: boolean): void;
  isMuted(bus: AudioBus): boolean;
}

export type CreateAudio = (opts: {
  /** 由 platform 提供；没有音频能力时传 undefined，服务降级为 no-op */
  readonly createSound?: (src: string, opts: { loop: boolean; volume: number }) => PlayingAudio | null;
  readonly unlock?: () => Promise<boolean>;
}) => AudioService;
