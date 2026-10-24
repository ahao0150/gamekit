/**
 * 布局装配：六屏 `.ui`（board 有「首关 / 有广告入口」两个变体）→ rects/paintOrder/meta。
 * 数据双通道铁律：grid 的 items 布局期喂 env.data、绘制期喂 DrawDeps.data（render.ts）。
 *
 * T65：`canRewarded` 由游戏传进来（平台能不能放激励视频），决定广告按钮的禁用态；
 * 次数上限来自 `items.ts` 的 `AD_LIMITS`，本文件只负责把文案/禁用态喂给 `.ui` 组件。
 */

import homeUi from '../../ui/home.ui';
import selectUi from '../../ui/select.ui';
import boardUi from '../../ui/board.ui';
import boardAdsUi from '../../ui/board-ads.ui';
import ironUi from '../../ui/iron.ui';
import resultUi from '../../ui/result.ui';
import { bindComponents, layout } from './deps';
import type { ComponentDef, ComponentRegistry, LayoutSpec, LayoutViewport, NodeMeta, Rect, StyleProps, UiData } from './deps';
import { LEVELS } from './levels';
import { adEntriesOf } from './items';
import { createRegistry } from './ui-registry';
import type { GameState, Screen } from './state';

const UI_OF: Readonly<Record<Screen, { readonly spec: LayoutSpec }>> = {
  home: homeUi,
  select: selectUi,
  board: boardUi,
  iron: ironUi,
  result: resultUi,
};

/** 第 2 关起换成带广告入口的盘面（首关不给广告） */
export const BOARD_ADS_FROM_LEVEL = 2;

export interface ScreenLayout {
  readonly screen: Screen;
  readonly viewport: LayoutViewport;
  readonly rects: Readonly<Record<string, Rect>>;
  readonly paintOrder: readonly string[];
  readonly meta: Readonly<Record<string, NodeMeta>>;
  readonly components: Readonly<Record<string, ComponentDef>>;
  readonly props: Readonly<Record<string, StyleProps>>;
  readonly errors: readonly string[];
}

export interface LayoutEngine {
  readonly registry: ComponentRegistry;
  compute(screen: Screen, viewport: LayoutViewport, state: GameState): ScreenLayout;
}

export interface LayoutEngineOptions {
  /** 平台能不能放激励视频：false → 三个广告按钮全部 disabled */
  readonly canRewarded?: boolean;
}

const fmt = (s: number): string => `${Math.ceil(s)}s`;
const onOff = (on: boolean, name: string): string => `${name} ${on ? '开' : '关'}`;

const dynamicProps = (state: GameState, canRewarded: boolean): Readonly<Record<string, StyleProps>> => {
  switch (state.screen) {
    case 'home':
      return {
        primaryButton: { label: `继续拼豆 · 第${state.unlocked}关` },
        secondaryButton: { label: '关卡选择' },
        // T73：音效 / 音乐合并成一个「声音」开关（两个 bus 同值，见 state.ts toggleSound）
        soundToggle: { label: onOff(state.sound, '声音') },
      };
    case 'select':
      return { statusText: { label: `已解锁 ${state.unlocked}/${LEVELS.length} · 数字为关卡号` } };
    case 'board': {
      const placed = state.pieces.filter((p) => p.placed).length;
      const base: Record<string, StyleProps> = {
        label: { text: `时间 ${fmt(state.timeLeft)} · 归位 ${placed}/${state.pieces.length}` },
        statusText: { label: state.toast || '拖动色块到对应颜色格' },
      };
      const entries = adEntriesOf({ levelId: state.levelId, left: state.itemLeft, canRewarded });
      const [hint, time, slot] = entries;
      if (hint !== undefined) base['secondaryButton'] = { label: hint.label, disabled: !hint.enabled };
      if (time !== undefined) base['primaryButton'] = { label: time.label, disabled: !time.enabled };
      if (slot !== undefined) base['button'] = { text: slot.label, state: slot.enabled ? 'normal' : 'disabled' };
      return base;
    }
    case 'iron': {
      const burnt = (state.iron.cells.filter((c) => c === 2).length / Math.max(1, state.iron.cells.length)) * 100;
      return {
        label: { text: `温度 ${Math.round(state.iron.plate.temp)} · 烫糊 ${burnt.toFixed(0)}%` },
        statusText: { label: state.toast || '按住加热 · 拖板扫过图案' },
      };
    }
    case 'result':
      return {
        label: { text: state.outcome === 'win' ? '通关！' : '失败了' },
        statusText: { label: state.toast },
        primaryButton: { label: state.outcome === 'win' ? '下一关' : '再来一局' },
        secondaryButton: { label: '选 关' },
      };
    default:
      return {};
  }
};

const mergeProps = (
  base: Readonly<Record<string, StyleProps>>,
  dynamic: Readonly<Record<string, StyleProps>>,
): Readonly<Record<string, StyleProps>> => {
  const out: Record<string, StyleProps> = {};
  for (const [name, props] of Object.entries(base)) out[name] = { ...props, ...(dynamic[name] ?? {}) };
  for (const [name, props] of Object.entries(dynamic)) {
    if (out[name] === undefined) out[name] = props;
  }
  return out;
};

/** select 屏 grid 的 items：关卡号 + 解锁进度（绘制期 renderItem 画缩略，见 render.ts） */
export const selectData = (state?: GameState): UiData => ({
  items: LEVELS.map((l) => l.id),
  unlocked: state?.unlocked ?? LEVELS.length,
});

export const createLayoutEngine = (opts: LayoutEngineOptions = {}): LayoutEngine => {
  const registry = createRegistry();
  const canRewarded = opts.canRewarded === true;
  return {
    registry,
    compute(screen, viewport, state): ScreenLayout {
      const spec = screen === 'board' && state.levelId >= BOARD_ADS_FROM_LEVEL ? boardAdsUi.spec : UI_OF[screen].spec;
      const data: UiData = screen === 'select' ? selectData(state) : {};
      const bound = bindComponents(spec, { registry, env: { viewport, data } });
      const solved = layout(bound.spec, viewport);
      return {
        screen,
        viewport,
        rects: solved.rects,
        paintOrder: solved.paintOrder,
        meta: solved.meta,
        components: bound.components,
        props: mergeProps(bound.props, dynamicProps(state, canRewarded)),
        errors: [...bound.errors, ...solved.errors],
      };
    },
  };
};
