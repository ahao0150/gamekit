/**
 * 玩法与界面：单屏 IAA demo（点按钮加分 → 存档 → 刷新后分数还在）。
 * 平台差异只通过 platform.can() 与注入的适配器处理，这里没有任何平台专属 API 判断。
 */
import { createAds, createLoop, createSave } from './deps';
import type { AdsOptions, Ctx2D, PlatformAdapter, PointerEvent, Rect } from './deps';
import { computeLayout, hitTest, scoreFillRect } from './layout';
import type { Layout } from './layout';
import { addScore, formatScore, fromSaveData, rewardScore, SAVE_VERSION, toSaveData, withHint } from './state';
import type { GameState, SaveData } from './state';

export interface Game {
  readonly state: GameState;
  /**
   * 只读：当前布局（逻辑像素，左上角原点）。
   * 自动化点击要按真实位置点，所以需要一个能读到按钮矩形的出口；
   * 返回的是**副本**，拿到的人改不到内部状态。
   */
  readonly layout: Layout;
  start(): void;
  stop(): void;
  /** 点一次主按钮（调试/测试用；真实点击走 platform.onPointer） */
  tap(): void;
  /** 走一次激励视频（调试/测试用） */
  watchRewarded(): Promise<void>;
}

/** 分数条满格目标（只影响显示比例，不限制加分）；激励视频奖励分。 */
export const SCORE_GOAL = 10;
export const REWARD_SCORE = 5;

const COLORS = { bg: '#0f151b', panel: '#22303c', accent: '#4dd0e1', text: '#e8f4f8', dim: '#7f97a6' };

const fill = (ctx: Ctx2D, rect: Rect, color: string): void => {
  ctx.fillStyle = color;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
};

const textAt = (ctx: Ctx2D, x: number, y: number, text: string, size: number, color: string): void => {
  ctx.fillStyle = color;
  ctx.font = `${size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
};

const drawButton = (ctx: Ctx2D, rect: Rect, label: string, bg: string, fg: string): void => {
  fill(ctx, rect, bg);
  textAt(ctx, rect.x + rect.w / 2, rect.y + rect.h / 2, label, Math.round(rect.h * 0.32), fg);
};

/** 平台可选的 AdService → core 广告服务的 backend；没有广告能力返回 undefined（core 降级为 no-op）。 */
const adsBackend = (platform: PlatformAdapter): AdsOptions['backend'] => {
  const api = platform.ads;
  if (api === undefined) return undefined;
  return {
    showBanner: (opts) => api.showBanner(opts),
    hideBanner: () => api.hideBanner(),
    showInterstitial: async () => {
      try {
        await api.showInterstitial();
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: 'error', detail: String(error) };
      }
    },
    showRewarded: async () => {
      const result = await api.showRewarded();
      return result.ok ? { ok: true } : { ok: false, reason: result.reason ?? 'incomplete' };
    },
  };
};

export const createGame = (platform: PlatformAdapter): Game => {
  const ctx = platform.canvas.getContext('2d');
  const save = createSave({ version: SAVE_VERSION, store: platform.storage });
  const ads = createAds({ backend: adsBackend(platform) });
  const bannerCapable = platform.can('ad-banner');
  let state: GameState = fromSaveData(save.load<unknown>());
  let bannerShown = false;

  /** 布局每帧重算（纯函数，自动跟随 resize / 旋转，不需缓存）。 */
  const view = () =>
    computeLayout({
      screen: { x: 0, y: 0, w: platform.screen.width, h: platform.screen.height },
      insets: platform.screen.insets,
      reserveBanner: bannerCapable,
    });

  const persist = (): void => {
    save.save<SaveData>(toSaveData(state));
  };

  const tap = (): void => {
    state = addScore(state, 1);
    persist();
  };

  const watchRewarded = async (): Promise<void> => {
    const result = await ads.showRewarded();
    if (result.ok) {
      state = rewardScore(state, REWARD_SCORE);
      persist();
      return;
    }
    state = withHint(state, result.reason === 'unsupported' ? '平台没有广告能力（no-op）' : '广告未完成，未加分');
  };

  const draw = (): void => {
    if (ctx === null) return; // mock 平台默认没有 2d 上下文，单测不渲染
    const v = view();
    fill(ctx, { x: 0, y: 0, w: platform.screen.width, h: platform.screen.height }, COLORS.bg);
    fill(ctx, v.scoreBar, COLORS.panel);
    fill(ctx, scoreFillRect(v.scoreBar, state.score, SCORE_GOAL), COLORS.accent);
    textAt(ctx, v.scoreBar.x + v.scoreBar.w / 2, v.scoreBar.y - 12, formatScore(state.score, SCORE_GOAL), 12, COLORS.dim);
    drawButton(ctx, v.tapButton, '点我 +1', COLORS.accent, COLORS.bg);
    drawButton(ctx, v.rewardedButton, `看广告 +${REWARD_SCORE}`, COLORS.panel, COLORS.text);
    if (v.bannerSlot.w > 0) {
      fill(ctx, v.bannerSlot, COLORS.panel);
      textAt(ctx, v.bannerSlot.x + v.bannerSlot.w / 2, v.bannerSlot.y + v.bannerSlot.h / 2, 'banner 占位', 12, COLORS.dim);
    }
    textAt(ctx, v.hintArea.x + v.hintArea.w / 2, v.hintArea.y + v.hintArea.h / 2, state.hint, 16, COLORS.text);
  };

  const pointer = (event: PointerEvent): void => {
    if (event.kind !== 'up') return;
    const point = { x: event.pointer.x, y: event.pointer.y };
    const v = view();
    if (hitTest(v.tapButton, point)) {
      tap();
      return;
    }
    if (hitTest(v.rewardedButton, point)) void watchRewarded();
  };

  const loop = createLoop({ update: () => undefined, render: () => draw() });
  const unsubscribe = platform.onPointer(pointer);

  const start = (): void => {
    if (bannerCapable && !bannerShown) {
      const slot = view().bannerSlot;
      ads.showBanner({ x: slot.x, y: slot.y, width: slot.w, height: slot.h });
      bannerShown = true;
    }
    loop.start();
  };

  const stop = (): void => {
    loop.stop();
    unsubscribe();
    if (bannerShown) {
      ads.hideBanner();
      bannerShown = false;
    }
  };

  return {
    get state(): GameState {
      return state;
    },
    get layout(): Layout {
      // 深拷贝一份：矩形是对象，直接给引用的话外部能改到内部布局
      const v = view();
      return {
        safe: { ...v.safe },
        scoreBar: { ...v.scoreBar },
        tapButton: { ...v.tapButton },
        rewardedButton: { ...v.rewardedButton },
        bannerSlot: { ...v.bannerSlot },
        hintArea: { ...v.hintArea },
      };
    },
    start,
    stop,
    tap,
    watchRewarded,
  };
};
