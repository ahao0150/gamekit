import { describe, expect, it } from 'vitest';
import { createMockAdapter } from '@mg/runtime/mock';
import type { MockAdapter } from '@mg/runtime/mock';
import type { PlatformAdapter } from './deps';
import { createSave } from './deps';
import { createGame, REWARD_SCORE } from './game';
import { computeLayout } from './layout';
import { fromSaveData, SAVE_VERSION } from './state';

const mock = (): MockAdapter => createMockAdapter({ screen: { width: 390, height: 844 } });

const tapCenter = (platform: PlatformAdapter): { x: number; y: number } => {
  const layout = computeLayout({
    screen: { x: 0, y: 0, w: platform.screen.width, h: platform.screen.height },
    insets: platform.screen.insets,
    reserveBanner: platform.can('ad-banner'),
  });
  return { x: layout.tapButton.x + layout.tapButton.w / 2, y: layout.tapButton.y + layout.tapButton.h / 2 };
};

const click = (platform: MockAdapter, point: { x: number; y: number }): void => {
  platform.emitPointer('down', point.x, point.y);
  platform.emitPointer('up', point.x, point.y);
};

const reloadScore = (platform: PlatformAdapter): number =>
  fromSaveData(createSave({ version: SAVE_VERSION, store: platform.storage }).load<unknown>()).score;

describe('点按钮 → 分数变 → 存档 → 重新 createSave 读回', () => {
  it('真实指针路径：点主按钮加分并落盘', () => {
    const platform = mock();
    const game = createGame(platform);
    game.start();
    click(platform, tapCenter(platform));
    expect(game.state.score).toBe(1);
    game.stop();
    expect(reloadScore(platform)).toBe(1);
  });

  it('重新 createGame 会读回存档（刷新后分数还在）', () => {
    const platform = mock();
    const first = createGame(platform);
    first.start();
    click(platform, tapCenter(platform));
    click(platform, tapCenter(platform));
    first.stop();

    const second = createGame(platform);
    expect(second.state.score).toBe(2);
    second.stop();
  });

  it('点按钮外不加分', () => {
    const platform = mock();
    const game = createGame(platform);
    game.start();
    click(platform, { x: 1, y: 1 });
    expect(game.state.score).toBe(0);
    game.stop();
  });

  it('stop 之后指针监听已解除，再点不加分', () => {
    const platform = mock();
    const game = createGame(platform);
    game.start();
    game.stop();
    click(platform, tapCenter(platform));
    expect(game.state.score).toBe(0);
  });
});

describe('激励视频 no-op 与 banner 占位', () => {
  it('平台有广告能力：看完激励视频加分并落盘', async () => {
    const platform = createMockAdapter({
      screen: { width: 390, height: 844 },
      capabilities: ['pointer', 'storage', 'ad-rewarded'],
    });
    const game = createGame(platform);
    game.start();
    await game.watchRewarded();
    expect(game.state.score).toBe(REWARD_SCORE);
    expect(game.state.rewardedCount).toBe(1);
    game.stop();
    expect(reloadScore(platform)).toBe(REWARD_SCORE);
  });

  it('平台没有广告能力：不抛错、不加分、提示 no-op', async () => {
    const base = mock();
    const platform: PlatformAdapter = { ...base, ads: undefined };
    const game = createGame(platform);
    game.start();
    await expect(game.watchRewarded()).resolves.toBeUndefined();
    expect(game.state.score).toBe(0);
    expect(game.state.hint).toContain('no-op');
    game.stop();
  });

  it('有 ad-banner 能力才预留广告位并调 showBanner', () => {
    const withBanner = createMockAdapter({
      screen: { width: 390, height: 844 },
      capabilities: ['pointer', 'storage', 'ad-banner'],
    });
    const game = createGame(withBanner);
    game.start();
    expect(withBanner.adCalls).toContain('showBanner');
    game.stop();

    const withoutBanner = mock();
    const plain = createGame(withoutBanner);
    plain.start();
    expect(withoutBanner.adCalls).not.toContain('showBanner');
    plain.stop();
  });
});
