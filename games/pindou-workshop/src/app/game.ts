/**
 * 游戏装配：把 `createPointer`（指针/拖拽）、`session`（广告/存档/音效）、
 * `juice`（动效）、`render`（绘制）、`layout`（.ui 求解）接在一起。
 *
 * T65：本文件只 dispatch 纯 action；激励视频、写档、播 sfx 这些副作用全在 session 里，
 * 所以「广告失败 / 存档失败」不会挡住玩法。
 */

import { createLoop, keypadHit, pickHit } from './deps';
import type { AssetService, Ctx2D, HitEntry, PlatformAdapter, Rect } from './deps';
import { ART_KEYS, createArt } from './assets';
import { createLayoutEngine } from './layout';
import type { ScreenLayout } from './layout';
import { createRenderer } from './render';
import { createJuice } from './juice';
import type { JuiceFrame } from './juice';
import { createPointer } from './pointer';
import { tapAction } from './actions';
import { createSession } from './session';
import { adEntriesOf } from './items';
import type { AdItem } from './items';
import { INITIAL_STATE, reduce } from './state';
import type { Action, GameState, Progress } from './state';
import { LEVELS } from './levels';

export interface Game {
  readonly state: GameState;
  readonly layout: ScreenLayout;
  /** 动效快照（只读；debug 钩子与验收脚本读它，别在游戏逻辑里读） */
  readonly fx: JuiceFrame;
  /** 存档快照（只读；验收脚本用它断言「刷新后恢复」） */
  readonly progress: Progress | null;
  /** 资源服务（只读；debug 钩子用它报「加载了几个 / 缺哪张」） */
  readonly assets: AssetService;
  start(): void;
  stop(): void;
}

const hitEntriesOf = (view: ScreenLayout): HitEntry[] => {
  const entries: HitEntry[] = [];
  for (const name of view.paintOrder) {
    const rect = view.rects[name];
    const meta = view.meta[name];
    if (rect === undefined || meta === undefined) continue;
    entries.push({ name, rect, hit: meta.hit, layer: meta.layerIndex, index: meta.index });
  }
  return entries;
};

export const createGame = (platform: PlatformAdapter): Game => {
  const ctx: Ctx2D | null = platform.canvas.getContext('2d');
  const session = createSession(platform);
  const engine = createLayoutEngine({ canRewarded: session.canRewarded });
  const art = createArt(platform);
  const renderer = createRenderer(art);
  // 不阻塞首帧：图没到先画回退分支，`core/loop` 每帧 render，下一帧自然换成图。
  // `loadAll` 本身不抛错（失败汇总在结果里），这里再兜一层。
  void art.loadAll([...ART_KEYS]).catch(() => undefined);
  const juice = createJuice();
  let saved = session.load();
  let state: GameState = saved === null ? INITIAL_STATE : reduce(INITIAL_STATE, { kind: 'restore', progress: saved });
  session.syncSettings(state);
  let lastScreen: GameState['screen'] = state.screen;
  let lastOutcome: GameState['outcome'] = state.outcome;

  const viewport = (): { width: number; height: number } => ({
    width: platform.screen.width,
    height: platform.screen.height,
  });
  const view = (): ScreenLayout => engine.compute(state.screen, viewport(), state);
  let current: ScreenLayout = view();

  const dispatch = (action: Action): void => {
    state = reduce(state, action);
    current = view();
  };

  const draw = (): void => {
    current = view();
    if (ctx !== null) renderer.draw(ctx, current, state, juice.frame, pointer.dragView());
  };

  /** 广告道具：先看次数/可用性（禁用态 UI 上也表达），再走激励视频 */
  const runAd = async (item: AdItem): Promise<void> => {
    const entry = adEntriesOf({ levelId: state.levelId, left: state.itemLeft, canRewarded: session.canRewarded })
      .find((e) => e.item === item);
    if (entry === undefined) return;
    if (!entry.enabled) {
      dispatch({ kind: 'toast', text: entry.hint });
      return;
    }
    const action = await session.requestAd(item, state);
    dispatch(action);
    session.save(state);
  };

  /** 选关 grid 的分格命中（未解锁的关卡返回 null） */
  const selectHit = (x: number, y: number): number | null => {
    const rect = current.rects['grid'];
    if (rect === undefined) return null;
    const hit = keypadHit(rect, { cols: 3, keyH: 64, gap: 8, keys: LEVELS.map(() => 'x') }, { x, y });
    if (hit === null) return null;
    const id = hit.index + 1;
    return id <= state.unlocked ? id : null;
  };

  /** `.ui` 组件点击：映射表 → action（广告入口走异步流程） */
  const uiTap = (x: number, y: number): boolean => {
    const picked = pickHit(hitEntriesOf(current), { x, y });
    if (picked === null || picked.hit !== 'self') return false;
    const tap = tapAction(state.screen, picked.name, state);
    if (tap === null) return false;
    session.unlockAudio();
    if ('ad' in tap) {
      void runAd(tap.ad);
      return true;
    }
    dispatch(tap);
    if (tap.kind === 'toggleSound' || tap.kind === 'toggleMusic') session.syncSettings(state);
    if (tap.kind === 'startLevel' || tap.kind === 'next' || tap.kind === 'retry') session.save(state);
    return true;
  };

  const pointer = createPointer({
    juice,
    state: () => state,
    view: () => current,
    dispatch,
    uiTap,
    selectHit,
    onGrab: () => session.onGrab(),
    onPlace: () => session.onPlace(),
    onReject: () => session.onReject(),
    onLevelStart: (levelId) => {
      dispatch({ kind: 'startLevel', levelId });
      session.save(state);
    },
    unlockAudio: () => session.unlockAudio(),
  });

  /** 每帧的副作用：熨烫定型音效、进盘面存档、结算存档 + 插屏 */
  const afterFrame = (): void => {
    if (state.screen === 'iron') {
      let done = 0;
      for (const c of state.iron.cells) if (c === 1) done += 1;
      session.onIronTick(done);
    }
    if (state.screen !== lastScreen) {
      if (state.screen === 'board') session.save(state);
      lastScreen = state.screen;
    }
    if (state.screen === 'result' && state.outcome !== null && state.outcome !== lastOutcome) {
      lastOutcome = state.outcome;
      session.onResult(state);
      saved = session.load();
    }
    if (state.screen !== 'result') lastOutcome = state.outcome;
  };

  const loop = createLoop({
    update: (dt) => {
      if (state.screen === 'board') dispatch({ kind: 'tick', dt });
      else if (state.screen === 'iron') dispatch({ kind: 'ironTick', dt });
      juice.update(dt, state);
      afterFrame();
    },
    render: () => draw(),
  });
  const unsubscribe = platform.onPointer((event) => pointer.handle(event));

  return {
    get state(): GameState {
      return state;
    },
    get layout(): ScreenLayout {
      const rects: Record<string, Rect> = {};
      for (const [name, rect] of Object.entries(current.rects)) rects[name] = { ...rect };
      return { ...current, rects };
    },
    get fx(): JuiceFrame {
      return juice.frame;
    },
    get progress(): Progress | null {
      return saved;
    },
    get assets(): AssetService {
      return art;
    },
    start(): void {
      draw();
      loop.start();
    },
    stop(): void {
      loop.stop();
      unsubscribe();
      session.dispose();
    },
  };
};
