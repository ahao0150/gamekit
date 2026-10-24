/**
 * 全局状态与迁移（纯函数）。拼豆段（A）+ 熨烫段（B）+ 流程屏 + 进度/道具/设置。
 *
 * T65：加了 IAA 变现（广告道具次数）、存档进度、音效/音乐开关。
 * 所有「能不能用广告道具」的判断都不在这里（见 ads-flow.ts），这里只吃结果。
 */

import { LEVELS, GRID } from './levels';
import type { Level } from './levels';
import { AD_LIMITS, FULL_ITEMS } from './items';
import type { AdItem, ItemLeft } from './items';
import { allDone, burntRate, ironFailed, initialIron, ironSweep, stepTemp, withAlignment } from './iron';
import type { IronState } from './iron';

export type Screen = 'home' | 'select' | 'board' | 'iron' | 'result';

export type Loc = { readonly t: 'spawn' } | { readonly t: 'grid'; readonly i: number } | { readonly t: 'temp'; readonly k: number };

export interface Piece {
  readonly id: number;
  readonly color: number;
  readonly loc: Loc;
  readonly placed: boolean;
}


/** 每关最好成绩（剩余秒数越大越好、烫糊率越低越好） */
export interface LevelBest {
  readonly timeLeft: number;
  readonly burnt: number;
}

/** 存档里的进度（不含单局盘面状态） */
export interface Progress {
  readonly unlocked: number;
  readonly clears: number;
  readonly best: Readonly<Record<string, LevelBest>>;
  readonly sound: boolean;
  readonly music: boolean;
  readonly itemLeft: ItemLeft;
}

export interface GameState {
  readonly screen: Screen;
  readonly sound: boolean;
  readonly music: boolean;
  readonly levelId: number;
  readonly pieces: readonly Piece[];
  /** 目标图案（GRID²，-1 空位） */
  readonly grid: readonly number[];
  readonly timeLeft: number;
  readonly tempSlots: number;
  /** 落错震屏强度（0..1，渲染层衰减） */
  readonly shake: number;
  readonly iron: IronState;
  /** 结算：null = 进行中 */
  readonly outcome: 'win' | 'fail' | null;
  readonly toast: string;
  /** 进度（存档） */
  readonly unlocked: number;
  readonly clears: number;
  readonly best: Readonly<Record<string, LevelBest>>;
  /** 广告道具剩余次数 */
  readonly itemLeft: ItemLeft;
  /** 广告提示锁定的格（画金色角标，不能拖走） */
  readonly hinted: readonly number[];
}

export type Action =
  | { readonly kind: 'home' }
  | { readonly kind: 'openSelect' }
  | { readonly kind: 'toggleSound' }
  | { readonly kind: 'toggleMusic' }
  | { readonly kind: 'startLevel'; readonly levelId: number }
  | { readonly kind: 'tick'; readonly dt: number }
  | { readonly kind: 'drop'; readonly pieceId: number; readonly target: Loc }
  | { readonly kind: 'itemSteady' }
  | { readonly kind: 'adHint'; readonly cell: number }
  | { readonly kind: 'adTime' }
  | { readonly kind: 'adSlot' }
  | { readonly kind: 'toast'; readonly text: string }
  | { readonly kind: 'ironMove'; readonly gx: number; readonly gy: number }
  | { readonly kind: 'ironHeat'; readonly on: boolean }
  | { readonly kind: 'ironTick'; readonly dt: number }
  | { readonly kind: 'retry' }
  | { readonly kind: 'next' }
  | { readonly kind: 'restore'; readonly progress: Progress };


export const INITIAL_STATE: GameState = {
  screen: 'home', sound: true, music: true, levelId: 1, pieces: [], grid: [], timeLeft: 0,
  tempSlots: 0, shake: 0, iron: initialIron([]), outcome: null, toast: '',
  unlocked: 1, clears: 0, best: {}, itemLeft: FULL_ITEMS, hinted: [],
};

export const levelOf = (id: number): Level => LEVELS.find((l) => l.id === id) ?? LEVELS[0]!;

/** 发牌：图案格各出一个色块，确定性打乱到 spawn 区 */
export const dealPieces = (level: Level): readonly Piece[] => {
  const base: Piece[] = [];
  let id = 0;
  level.grid.forEach((color) => {
    if (color >= 0) base.push({ id, color, loc: { t: 'spawn' }, placed: false });
    if (color >= 0) id += 1;
  });
  const pieces = [...base];
  const rnd = (n: number, seed: number): number => ((seed * 1103515245 + 12345) % 2147483648) % n;
  for (let i = pieces.length - 1; i > 0; i -= 1) {
    const j = rnd(i + 1, i * 7919 + level.id * 104729);
    const ti = pieces[i]!;
    const tj = pieces[j]!;
    pieces[i] = tj;
    pieces[j] = ti;
  }
  return pieces;
};

const startLevel = (state: GameState, id: number): GameState => {
  const clamped = Math.max(1, Math.min(LEVELS.length, Math.min(id, state.unlocked)));
  const level = levelOf(clamped);
  return {
    ...state,
    screen: 'board',
    levelId: clamped,
    pieces: dealPieces(level),
    grid: level.grid,
    timeLeft: level.timeLimitSec,
    tempSlots: level.tempSlots,
    shake: 0,
    outcome: null,
    toast: '',
    hinted: [],
    itemLeft: FULL_ITEMS,
  };
};

const locKey = (l: Loc): string => (l.t === 'grid' ? `g${l.i}` : l.t === 'temp' ? `t${l.k}` : 's');

/** 结算：记最好成绩、解锁下一关、累计通关数 */
const settle = (state: GameState, outcome: 'win' | 'fail'): GameState => {
  if (outcome !== 'win') return state;
  const key = String(state.levelId);
  const prev = state.best[key];
  const now = { timeLeft: Math.max(0, state.timeLeft), burnt: burntRate(state.iron) };
  const better = prev === undefined || now.timeLeft > prev.timeLeft || (now.timeLeft === prev.timeLeft && now.burnt < prev.burnt);
  return {
    ...state,
    clears: state.clears + 1,
    unlocked: Math.min(LEVELS.length, Math.max(state.unlocked, state.levelId + 1)),
    best: better ? { ...state.best, [key]: now } : state.best,
  };
};

/** 用存档进度覆盖设置/进度（其余单局状态不动） */
export const withProgress = (state: GameState, p: Progress): GameState => ({
  ...state,
  unlocked: Math.max(1, Math.min(LEVELS.length, Math.floor(p.unlocked) || 1)),
  clears: Math.max(0, Math.floor(p.clears) || 0),
  best: p.best,
  sound: p.sound,
  music: p.music,
  itemLeft: p.itemLeft,
});

const useItem = (state: GameState, item: AdItem): ItemLeft => ({
  hint: state.itemLeft.hint - (item === 'hint' ? 1 : 0),
  time: state.itemLeft.time - (item === 'time' ? 1 : 0),
  slot: state.itemLeft.slot - (item === 'slot' ? 1 : 0),
});

export const reduce = (state: GameState, action: Action): GameState => {
  switch (action.kind) {
    case 'home':
      return { ...INITIAL_STATE, sound: state.sound, music: state.music, unlocked: state.unlocked, clears: state.clears, best: state.best };
    case 'openSelect':
      return { ...state, screen: 'select' };
    case 'toggleSound': {
      // T73：界面合并成一个「声音」开关 —— sfx 与 bgm 两个 bus 同值。
      // 存档里的 `music` 字段保留（旧档兼容 / 将来想分开还能用），只是界面不再单独显示。
      const next = !state.sound;
      return { ...state, sound: next, music: next };
    }
    case 'toggleMusic':
      return { ...state, music: !state.music };
    case 'startLevel':
      return startLevel(state, action.levelId);
    case 'restore':
      return withProgress(state, action.progress);
    case 'toast':
      return { ...state, toast: action.text };
    case 'tick': {
      if (state.screen !== 'board' || state.outcome !== null) return state;
      const timeLeft = Math.max(0, state.timeLeft - action.dt);
      const shake = Math.max(0, state.shake - action.dt * 3);
      if (timeLeft <= 0) return { ...settle(state, 'fail'), timeLeft: 0, screen: 'result', outcome: 'fail', toast: '时间到！' };
      return { ...state, timeLeft, shake };
    }
    case 'drop': {
      if (state.screen !== 'board') return state;
      const piece = state.pieces.find((p) => p.id === action.pieceId);
      if (piece === undefined || piece.placed) return state;
      const target = action.target;

      if (target.t === 'temp') {
        if (target.k >= state.tempSlots) return state;
        const taken = state.pieces.some((p) => p.id !== piece.id && locKey(p.loc) === locKey(target));
        if (taken) return state;
        return { ...state, pieces: state.pieces.map((p) => (p.id === piece.id ? { ...p, loc: target, placed: false } : p)) };
      }
      if (target.t !== 'grid') return state;

      // 图案格：颜色对 + 空位才吸附；否则弹回 + 震屏
      if (state.grid[target.i] !== piece.color) {
        return { ...state, shake: 1, toast: '位置不对，弹回了' };
      }
      const occupied = state.pieces.some((p) => p.id !== piece.id && p.loc.t === 'grid' && p.loc.i === target.i);
      if (occupied) return { ...state, shake: 1, toast: '这里已经有豆子了' };
      const pieces = state.pieces.map((p) => (p.id === piece.id ? { ...p, loc: target, placed: true } : p));
      if (pieces.every((p) => p.placed)) {
        const targets = state.grid.map((v, i) => (v >= 0 ? i : -1)).filter((i) => i >= 0);
        return { ...state, pieces, screen: 'iron', iron: initialIron(targets) };
      }
      return { ...state, pieces };
    }
    case 'itemSteady':
      if (state.screen !== 'iron') return state;
      return { ...state, iron: { ...state.iron, steadySec: 5 }, toast: '温度稳定 5 秒' };
    case 'adHint': {
      if (state.screen !== 'board' || state.itemLeft.hint <= 0) return state;
      const cell = action.cell;
      if (cell < 0 || cell >= state.grid.length) return state;
      const color = state.grid[cell];
      if (color === undefined || color < 0) return state;
      const free = state.pieces.find((p) => !p.placed && p.color === color);
      if (free === undefined) return state;
      const loc: Loc = { t: 'grid', i: cell };
      const pieces = state.pieces.map((p) => (p.id === free.id ? { ...p, loc, placed: true } : p));
      const done = pieces.every((p) => p.placed);
      const targets = state.grid.map((v, i) => (v >= 0 ? i : -1)).filter((i) => i >= 0);
      return {
        ...state,
        pieces,
        itemLeft: useItem(state, 'hint'),
        hinted: [...state.hinted, cell],
        toast: '已帮你锁住一格',
        ...(done ? { screen: 'iron' as const, iron: initialIron(targets) } : {}),
      };
    }
    case 'adTime': {
      if (state.screen !== 'board' || state.itemLeft.time <= 0) return state;
      return { ...state, timeLeft: state.timeLeft + 30, itemLeft: useItem(state, 'time'), toast: '广告奖励：+30 秒' };
    }
    case 'adSlot': {
      if (state.screen !== 'board' || state.itemLeft.slot <= 0) return state;
      return { ...state, tempSlots: Math.min(4, state.tempSlots + 1), itemLeft: useItem(state, 'slot'), toast: '广告奖励：临时位 +1' };
    }
    case 'ironMove': {
      if (state.screen !== 'iron') return state;
      const plate = withAlignment({ ...state.iron.plate, gx: action.gx, gy: action.gy });
      return { ...state, iron: ironSweep({ ...state.iron, plate }) };
    }
    case 'ironHeat': {
      if (state.screen !== 'iron') return state;
      return { ...state, iron: { ...state.iron, heating: action.on } };
    }
    case 'ironTick': {
      if (state.screen !== 'iron' || state.outcome !== null) return state;
      const iron = ironSweep(stepTemp(state.iron, action.dt));
      if (ironFailed(iron)) {
        return { ...settle(state, 'fail'), iron, screen: 'result', outcome: 'fail', toast: `烫糊了 ${(burntRate(iron) * 100).toFixed(0)}%` };
      }
      if (allDone(iron)) return { ...settle(state, 'win'), iron, screen: 'result', outcome: 'win', toast: '熨烫完成！' };
      return { ...state, iron };
    }
    case 'retry':
      return state.outcome === null ? state : startLevel(state, state.levelId);
    case 'next':
      return startLevel(state, Math.min(LEVELS.length, state.levelId + 1));
  }
};

/** A 段进度 */
export const placedCount = (state: GameState): number => state.pieces.filter((p) => p.placed).length;

export const GRID_SIZE = GRID;
