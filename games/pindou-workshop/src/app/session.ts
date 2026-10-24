/**
 * 会话服务层：把「广告 / 存档 / 音效」三件 IAA 能力包在一起，给 `game.ts` 一个薄接口。
 *
 * 为什么单独成文件：这三个能力都是**有副作用的异步/IO 边界**（激励视频要 await、
 * 存档要写平台 KV、音效要碰平台音频句柄），塞进 game.ts 会让主循环文件超 300 行，
 * 也让「广告失败不该影响玩法」这条规则无处表达。game.ts 只 dispatch 纯 action。
 *
 * 三条硬规则（T65）：
 * 1. **只有 `AdResult.ok === true` 才发奖励**（未完成/无填充/不支持/冷却 一律不发）；
 * 2. 发不了奖励时返回一条 `toast` action —— 按钮虽然会禁用，但真发生了也要有反馈；
 * 3. 插屏只在**通关**路径上按频次弹，失败/重试永远不会弹。
 */

import { manifest } from 'virtual:mg-manifest';
import { createAdGateway } from './ads-flow';
import { createProgress } from './progress';
import { createSfx } from './sfx';
import type { SfxKey } from './sfx';
import { hintCellOf, shouldInterstitial } from './items';
import type { AdItem } from './items';
import type { Action, GameState, Progress } from './state';
import type { PlatformAdapter } from './deps';

export interface Session {
  readonly canRewarded: boolean;
  /** 首个用户手势里解锁音频（浏览器自动播放策略） */
  unlockAudio(): void;
  onGrab(): void;
  onPlace(): void;
  onReject(): void;
  /** 熨烫段：每多一格定型播一次 */
  onIronTick(doneCount: number): void;
  /** 结果落地：存档 + 结算音效 + 按频次弹插屏 */
  onResult(state: GameState): void;
  /** 广告道具：走完激励视频 → 返回要 dispatch 的 action（失败时是一条 toast） */
  requestAd(item: AdItem, state: GameState): Promise<Action>;
  /** 设置变化：静音生效 + 存档 */
  syncSettings(state: GameState): void;
  /** 直接存档（关卡开始/结算时调） */
  save(state: GameState): void;
  /** 读存档（启动时 hydrate、验收脚本断言用） */
  load(): Progress | null;
  /** 本次会话播过的事件（测试与验收脚本读） */
  readonly played: readonly SfxKey[];
  dispose(): void;
}

/** 熨烫格「刚定型」的判定口径（game.ts 只喂总数，这里记住上一帧） */
export const createSession = (platform: PlatformAdapter): Session => {
  const ads = createAdGateway(platform);
  const progress = createProgress(platform);
  const sfx = createSfx({ platform, manifest });
  let lastDone = 0;
  let lastClears = -1;
  let audioUnlocked = false;

  const unlockAudio = (): void => {
    if (audioUnlocked) return;
    audioUnlocked = true;
    void sfx.unlock();
  };

  return {
    canRewarded: ads.canRewarded,
    unlockAudio,
    onGrab: () => sfx.play('sfx/pick'),
    onPlace: () => sfx.play('sfx/place'),
    onReject: () => sfx.play('sfx/reject'),
    onIronTick: (doneCount: number): void => {
      if (doneCount > lastDone) sfx.play('sfx/iron');
      lastDone = doneCount;
    },
    onResult(state: GameState): void {
      sfx.play('sfx/result');
      progress.store(state);
      // 插屏：只在通关路径、且累计通关数到了 3 的倍数时弹（重试同一关不会弹）
      if (state.outcome === 'win' && state.clears !== lastClears && shouldInterstitial(state.clears)) {
        lastClears = state.clears;
        void ads.showInterstitial();
      }
    },
    async requestAd(item: AdItem, state: GameState): Promise<Action> {
      unlockAudio();
      const result = await ads.showRewarded();
      if (!result.ok) {
        const why = result.reason === 'unsupported' ? '当前环境不支持广告' : '广告没看完，没有奖励';
        return { kind: 'toast', text: why };
      }
      if (item === 'time') return { kind: 'adTime' };
      if (item === 'slot') return { kind: 'adSlot' };
      const filled: number[] = [];
      for (const p of state.pieces) if (p.loc.t === 'grid') filled.push(p.loc.i);
      const pending: number[] = [];
      for (const p of state.pieces) if (!p.placed) pending.push(p.color);
      const cell = hintCellOf(state.grid, filled, pending, () => Math.random());
      if (cell < 0) return { kind: 'toast', text: '没有可以提示的格子' };
      return { kind: 'adHint', cell };
    },
    syncSettings(state: GameState): void {
      sfx.setSound(state.sound);
      sfx.setMusic(state.music);
      progress.store(state);
    },
    save(state: GameState): void {
      progress.store(state);
    },
    load(): Progress | null {
      return progress.load();
    },
    get played(): readonly SfxKey[] {
      return sfx.played;
    },
    dispose(): void {
      sfx.dispose();
    },
  };
};
