/**
 * 「点了哪个组件 → 该发什么 action」的映射表（纯函数，不碰平台、不碰 canvas）。
 *
 * 为什么单拎出来：`game.ts` 要管主循环、指针、动效接线，页面切换表放进去会把它顶到
 * 300 行以上（AGENTS 铁律 2）。这里只做映射，副作用（广告请求、存档、音效）留在 game.ts。
 *
 * 广告入口用 `{ ad: AdItem }` 标记而不是直接返回 action：激励视频是异步的，
 * 要等 `AdResult.ok` 才决定发哪条奖励 action。映射层不掺这个时序。
 */

import type { AdItem } from './items';
import type { Action, GameState, Screen } from './state';

export type TapResult = Action | { readonly ad: AdItem };

export const tapAction = (screen: Screen, name: string, state: GameState): TapResult | null => {
  if (screen === 'home') {
    if (name === 'primaryButton') return { kind: 'startLevel', levelId: state.unlocked };
    if (name === 'secondaryButton') return { kind: 'openSelect' };
    if (name === 'soundToggle') return { kind: 'toggleSound' };
    return null;
  }
  if (screen === 'select') {
    return name === 'button' ? { kind: 'home' } : null;
  }
  if (screen === 'board') {
    if (name === 'toast') return { kind: 'home' };
    if (name === 'secondaryButton') return { ad: 'hint' };
    if (name === 'primaryButton') return { ad: 'time' };
    if (name === 'button') return { ad: 'slot' };
    return null;
  }
  if (screen === 'iron') {
    if (name === 'button') return { kind: 'home' };
    if (name === 'primaryButton') return { kind: 'itemSteady' };
    return null;
  }
  if (name === 'primaryButton') return state.outcome === 'win' ? { kind: 'next' } : { kind: 'retry' };
  if (name === 'secondaryButton') return { kind: 'openSelect' };
  return null;
};
