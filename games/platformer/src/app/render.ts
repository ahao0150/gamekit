/**
 * 渲染：**世界层**（走相机变换 + 渲染剔除）→ 死亡提示。
 *
 * T45：HUD 与通关 / 失败面板已迁到 `.ui` 层（见 `ui.ts` 与 `ui/*.ui`）。
 * T80：触屏按键也迁到 `.ui`（`ui/controls.ui`）—— 原来这里的 `TOUCH` 常量是
 * 390×844 的绝对坐标，放进窄画框（PC 预览的 iframe、小屏）会把按钮画到画布外。
 * 现在这个文件只画**游戏世界**和一条 0.45 秒的瞬时死亡提示。
 *
 * 剔除只用在**绘制**上：视口外的地面/敌人/金币/终点不画。
 * 玩法逻辑一律全量更新（离屏怪物照样巡逻）—— 这条是 Chief 明确纠正过的设计。
 */

import { partitionByVisibility } from './deps';
import type { Camera, Ctx2D, CullRect, Rect, ScreenInfo } from './deps';
import type { Entities } from './entities';
import { CAMERA, PLAYER, SOLIDS, WORLD } from './level';
import type { LevelRect } from './level';
import type { GameState } from './state';

/** 可剔除实体（渲染用：只有位置 + 类型，不依赖玩法对象）。 */
export type RenderEntity = CullRect & { readonly kind: 'enemy' | 'coin' | 'goal' };

export interface ViewModel {
  readonly state: GameState;
  readonly camera: Camera;
  readonly screen: ScreenInfo;
  /** 视口内（含 margin）的地面与平台 */
  readonly solids: readonly LevelRect[];
  /** 视口内（含 margin）的实体 */
  readonly entities: readonly RenderEntity[];
}

/** 本帧要画的东西（剔除后的）与统计。 */
export interface SceneParts {
  readonly solids: readonly LevelRect[];
  readonly entities: readonly RenderEntity[];
  /** 实体总数（剔除前，调试用） */
  readonly total: number;
  /** 实际绘制数（调试用） */
  readonly drawn: number;
}

/**
 * 渲染剔除：地形 / 敌人 / 金币 / 终点只保留视口 + margin 内的。
 *
 * 从 `game.ts` 抽出来（T45）：这纯粹是「画面要画哪些东西」的几何，跟玩法状态迁移
 * 无关；放在渲染层，`game.ts` 的每帧循环只剩「拿结果去画」。
 * 注意：**玩法逻辑仍然全量更新**，这里只影响绘制。
 */
export const partitionScene = (camera: Camera, entities: Entities, margin = CAMERA.margin): SceneParts => {
  const solids = partitionByVisibility(SOLIDS, (rect) => rect, camera.visible, margin).visible;
  const alive = entities.enemies.filter((enemy) => enemy.alive);
  const coins = entities.coins.filter((coin) => !coin.taken);
  const cullable: readonly (CullRect & { kind: 'enemy' | 'coin' | 'goal' })[] = [
    ...alive.map((enemy) => ({
      kind: 'enemy' as const, x: enemy.x - 15, y: enemy.y - 13, w: 30, h: 26,
    })),
    ...coins.map((coin) => ({ kind: 'coin' as const, x: coin.x - 12, y: coin.y - 12, w: 24, h: 24 })),
    { kind: 'goal' as const, ...entities.goal },
  ];
  const visible = partitionByVisibility(cullable, (item) => item, camera.visible, margin).visible;
  return { solids, entities: visible, total: cullable.length, drawn: visible.length };
};

const COLORS = {
  skyTop: '#16222e',
  skyBottom: '#23384a',
  hillFar: '#1e3242',
  ground: '#3f7d4f',
  groundTop: '#59a86a',
  platform: '#4f9b63',
  player: '#e8b34a',
  playerEye: '#2b241c',
  enemy: '#c2453a',
  enemyEye: '#2b1a16',
  coin: '#f0c94a',
  goal: '#e0e8ea',
  goalPole: '#9fb3bb',
  hud: '#edf4ee',
  pit: '#0d1620',
} as const;

const fill = (ctx: Ctx2D, rect: Rect, color: string): void => {
  ctx.fillStyle = color;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
};

const text = (ctx: Ctx2D, value: string, x: number, y: number, size: number, color: string): void => {
  ctx.fillStyle = color;
  ctx.font = `${size}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(value, x, y);
};

export const render = (ctx: Ctx2D, view: ViewModel): void => {
  const { state, camera, screen } = view;
  fill(ctx, { x: 0, y: 0, w: screen.width, h: screen.height }, COLORS.skyTop);
  fill(ctx, { x: 0, y: screen.height * 0.55, w: screen.width, h: screen.height * 0.45 }, COLORS.skyBottom);
  const farShift = -camera.visible.x * 0.15;
  for (let i = 0; i < 6; i += 1) {
    fill(ctx, { x: ((i * 300 + farShift) % (screen.width + 300)) - 150, y: 470, w: 260, h: 380 }, COLORS.hillFar);
  }

  const restore = camera.apply(ctx);
  fill(ctx, { x: 0, y: 780, w: WORLD.w, h: 64 }, COLORS.pit);
  for (const solid of view.solids) {
    fill(ctx, solid, solid.h > 60 ? COLORS.ground : COLORS.platform);
    fill(ctx, { x: solid.x, y: solid.y, w: solid.w, h: 6 }, COLORS.groundTop);
  }

  // 实体（已剔除）：金币 = 黄圆、敌人 = 红块 + 眼、终点 = 旗杆 + 旗面
  for (const entity of view.entities) {
    if (entity.kind === 'coin') {
      ctx.fillStyle = COLORS.coin;
      ctx.beginPath();
      ctx.arc(entity.x + entity.w / 2, entity.y + entity.h / 2, entity.w / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (entity.kind === 'enemy') {
      fill(ctx, entity, COLORS.enemy);
      fill(ctx, { x: entity.x + 5, y: entity.y + 7, w: 5, h: 5 }, COLORS.enemyEye);
      fill(ctx, { x: entity.x + entity.w - 10, y: entity.y + 7, w: 5, h: 5 }, COLORS.enemyEye);
    } else {
      fill(ctx, { x: entity.x + entity.w / 2 - 3, y: entity.y, w: 6, h: entity.h }, COLORS.goalPole);
      fill(ctx, { x: entity.x + entity.w / 2 + 3, y: entity.y + 6, w: 26, h: 22 }, COLORS.goal);
    }
  }

  // 玩家：方块 + 朝向眼
  const p = state.player;
  fill(ctx, { x: p.x - PLAYER.w / 2, y: p.y - PLAYER.h / 2, w: PLAYER.w, h: PLAYER.h }, COLORS.player);
  fill(ctx, {
    x: p.x + (p.facing === 1 ? 4 : -8), y: p.y - PLAYER.h / 2 + 9, w: 5, h: 5,
  }, COLORS.playerEye);
  restore();

  if (state.phase === 'dead') {
    ctx.fillStyle = 'rgba(10,16,22,0.45)';
    ctx.fillRect(0, 0, screen.width, screen.height);
    text(ctx, '被撞了，回到起点', screen.width / 2 - 96, screen.height / 2 - 16, 22, COLORS.hud);
  }
};
