/**
 * 只读调试钩子：把运行时状态与布局挂到 `globalThis.__mg`。
 *
 * 严格只读：`Object.defineProperty` + getter，每次读都是新快照，没有任何改状态的入口。
 *
 * T63：额外暴露**自绘区的几何**（盘面格 / 待取块矩形 / 临时位矩形 / 温度条）——
 * 截图脚本要的是「玩家真实看到的位置」，让它自己算会算错（而且会绕开被测代码）。
 * 几何由 board-geom 统一给出，脚本直接读，不复制一份公式。
 */

import type { PlatformAdapter, Rect } from './deps';
import type { Game } from './game';
import { artStatus } from './assets';
import type { ArtStatus } from './assets';
import type { JuiceFrame } from './juice';
import { adEntriesOf } from './items';
import type { AdEntry, ItemLeft } from './items';
import type { Progress } from './state';
import type { GameState } from './state';
import { boardGeomOf, ironGeomOf, poolPos, slotPos } from './board-geom';

export interface RectSnapshot {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PieceRect extends RectSnapshot {
  readonly id: number;
  readonly where: 'pool' | 'slot';
}

export interface GeomSnapshot {
  /** 盘面左上角与格边 */
  readonly board: { readonly bx: number; readonly by: number; readonly cell: number; readonly size: number };
  /** 待取块 / 临时位块的真实矩形（点击用） */
  readonly pieces: readonly PieceRect[];
  /** 熨烫页温度条 */
  readonly tempBar?: RectSnapshot;
}

export interface AdsSnapshot {
  readonly canRewarded: boolean;
  /** 三个广告入口的可用状态（与 UI 上的禁用态同源） */
  readonly entries: readonly AdEntry[];
}

export interface ArtFrameSnapshot {
  readonly width: number;
  readonly height: number;
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  readonly src: string;
}

export interface MgDebugSnapshot {
  readonly state: GameState;
  readonly layout: Readonly<Record<string, RectSnapshot>>;
  readonly geom: GeomSnapshot | null;
  /** 动效快照（只读）：验收脚本按它判断「画的是什么」，不靠猜时间 */
  readonly fx: JuiceFrame;
  /** 广告可用状态（T65：验收脚本读它断言「禁用」而不是靠肉眼） */
  readonly ads: AdsSnapshot;
  /** 存档快照（T65：刷新后恢复的断言读它） */
  readonly progress: Progress | null;
  /** 美术资源加载状态（T73：验收脚本断言「缺图回退真的发生过」） */
  readonly assets: ArtStatus;
  /**
   * 取某个 key 的帧信息（T73：定位「key 加载到了、但组件画不出来」这类问题）。
   * 组件画图时看的是 `width/height`（帧尺寸）与 `sx/sy/sw/sh`（源矩形），**不是整图尺寸**，
   * 所以这两个对不上（例如 `drawCapsule` 要求恰好 336×126）就会静默回退纯色。
   */
  readonly artInfo: (key: string) => ArtFrameSnapshot | null;
  readonly errors: readonly string[];
  readonly platform: {
    readonly name: string;
    readonly width: number;
    readonly height: number;
    readonly dpr: number;
  };
}

/** 由 view.rects（.ui 求解结果）推出几何快照 */
const geomOf = (game: Game): GeomSnapshot | null => {
  const area = game.layout.rects['boardArea'];
  const state = game.state;
  if (area === undefined) return null;
  if (state.screen === 'iron') {
    const g = ironGeomOf(area);
    return { board: { bx: g.bx, by: g.by, cell: g.cell, size: g.size }, pieces: [], tempBar: g.bar };
  }
  if (state.screen !== 'board') return null;
  const spawn = state.pieces.filter((p) => p.loc.t === 'spawn');
  const g = boardGeomOf(area, spawn.length, state.tempSlots);
  const pieces: PieceRect[] = spawn.map((p, k) => {
    const pos = poolPos(g, k);
    return { id: p.id, where: 'pool' as const, x: pos.x, y: pos.y, w: pos.s, h: pos.s };
  });
  for (const p of state.pieces) {
    if (p.loc.t !== 'temp') continue;
    const pos = slotPos(g, p.loc.k);
    pieces.push({ id: p.id, where: 'slot' as const, x: pos.x, y: pos.y, w: pos.s, h: pos.s });
  }
  return { board: { bx: g.bx, by: g.by, cell: g.cell, size: g.size }, pieces };
};

/** 装只读钩子。同一个页面重复调用会抛错（configurable:false），所以只装一次。 */
export const installDebugHook = (game: Game, platform: PlatformAdapter): void => {
  const canRewarded = platform.can('ad-rewarded');
  Object.defineProperty(globalThis, '__mg', {
    configurable: false,
    enumerable: true,
    get: (): MgDebugSnapshot => ({
      state: game.state,
      layout: game.layout.rects,
      geom: geomOf(game),
      fx: game.fx,
      ads: { canRewarded, entries: adEntriesOf({ levelId: game.state.levelId, left: game.state.itemLeft as ItemLeft, canRewarded }) },
      progress: game.progress,
      assets: artStatus(game.assets),
      artInfo: (key: string): ArtFrameSnapshot | null => {
        const img = game.assets.get(key);
        return img === null
          ? null
          : { width: img.width, height: img.height, sx: img.sx, sy: img.sy, sw: img.sw, sh: img.sh, src: img.src };
      },
      errors: game.layout.errors,
      platform: {
        name: platform.name,
        width: platform.screen.width,
        height: platform.screen.height,
        dpr: platform.screen.dpr,
      },
    }),
  });
};

export type { Rect };