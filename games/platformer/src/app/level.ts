/**
 * 关卡数据（纯字面量 + 纯函数）。世界坐标：像素、y 向下。
 *
 * 第一关设计（横向 1560 = 4 屏宽，竖屏 390×844）：
 * - 地面段：0–520 / 640–1020 / 1120–1560（两个坑：520–640 = 120 宽，1020–1120 = 100 宽）
 * - 浮空平台 4 块，顶面比地面高 80–95px，都够得着
 * - 出生点在地面段 1 上，掉落判定线 y = 900（低于地面底部，掉坑必死）
 *
 * 跳跃实测（CDP 真按键，2026-10-20）：顶点比地面高 ~209px、滞空 ~0.75s；
 * 按住跳不放（可变跳跃的完整高度）横向能飞 ~250px，所以 120px 的坑
 * 「起跳窗口约 100px 宽」，第一关不用精确踩点。松手早就是一次矮跳。
 */

export interface LevelRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 世界尺寸（相机 bounds 用）。 */
export const WORLD = { w: 1560, h: 844 } as const;

/** 地面段（静态体，顶面 y = 680）。 */
export const GROUND: readonly LevelRect[] = [
  { x: 0, y: 680, w: 520, h: 164 },
  { x: 640, y: 680, w: 380, h: 164 },
  { x: 1120, y: 680, w: 440, h: 164 },
];

/** 浮空平台（静态体，厚 24）。 */
export const PLATFORMS: readonly LevelRect[] = [
  // 高度按「从地面跳得上去」设计：按住跳的实测顶点比地面高 ~209px，
  // 平台顶面只高 80–95px，留足余量，不用精确踩点。
  { x: 240, y: 600, w: 140, h: 24 },
  { x: 700, y: 590, w: 120, h: 24 },
  { x: 980, y: 600, w: 130, h: 24 },
  { x: 1240, y: 585, w: 150, h: 24 },
];

/**
 * 世界边界墙（static）：贴在世界左右边界外侧。
 *
 * 没有它，玩家从地面段 1 左端（x=0）走出去后脚下没有任何碰撞体，会掉到
 * FALL_LINE 判死；而相机 bounds 从 x=0 起不跟随，表现出来就是「开局往左走
 * 走一段直接摔死」。墙高取整个世界高度，玩家在任意高度都出不去。
 */
export const WALLS: readonly LevelRect[] = [
  { x: -20, y: 0, w: 20, h: WORLD.h },
  { x: WORLD.w, y: 0, w: 20, h: WORLD.h },
];

/**
 * 所有静态矩形（建 static body + 判定脚下有没有地时都用）。
 * 顺序：地面 → 平台 → 边界墙；墙在 x 方向、顶面在 y=0，feetOn 不会误判成地。
 */
export const SOLIDS: readonly LevelRect[] = [...GROUND, ...PLATFORMS, ...WALLS];

/** 玩家尺寸（碰撞盒）。 */
export const PLAYER = { w: 28, h: 36 } as const;

/** 出生点（脚底贴地面段 1 的顶面）。 */
export const SPAWN = { x: 80, y: 680 - PLAYER.h / 2 } as const;

/** 掉落判定线：低于它就当掉坑。 */
export const FALL_LINE = 900;

/** 移动/跳跃手感参数（像素/秒）。 */
export const MOVE = {
  /** 地面横向速度 */
  speed: 220,
  /** 起跳速度（向上为负）：h = v²/(2g) = 620²/3600 ≈ 107px */
  jumpSpeed: 620,
  /** 松手后保留的上冲速度（可变跳跃高度） */
  releaseSpeed: 240,
  /** 重力（与物理世界一致） */
  gravity: 1800,
  /** 死亡后复活的无敌时间（秒） */
  respawnDelay: 0.45,
} as const;

/** 相机参数（竖屏：纵向固定，只有横向跟随）。 */
export const CAMERA = {
  deadzone: { w: 120, h: 100000 },
  lookAhead: 60,
  smoothing: 0.12,
  margin: 150,
} as const;

/** 某个矩形是否与玩家脚下的探测带相交（判断是否踩在实地上）。 */
export const feetOn = (rect: LevelRect, playerX: number, playerY: number, probe = 4): boolean => {
  const left = playerX - PLAYER.w / 2;
  const right = playerX + PLAYER.w / 2;
  const feet = playerY + PLAYER.h / 2;
  const top = rect.y;
  return rect.x < right && rect.x + rect.w > left && top >= feet - probe && top <= feet + probe;
};
/** 敌人定义：在 [fromX, toX] 之间来回巡逻（y 是中心；站在地面顶面上）。 */
export interface EnemyDef {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly fromX: number;
  readonly toX: number;
  readonly speed: number;
  readonly w: number;
  readonly h: number;
}

/** 三只巡逻怪：地面段 1 / 2 / 3 各一只，都不跨坑（掉坑是玩家的事）。 */
export const ENEMIES: readonly EnemyDef[] = [
  { id: 1, x: 380, y: 667, fromX: 340, toX: 470, speed: 60, w: 30, h: 26 },
  { id: 2, x: 820, y: 667, fromX: 760, toX: 980, speed: 70, w: 30, h: 26 },
  { id: 3, x: 1300, y: 667, fromX: 1200, toX: 1450, speed: 55, w: 30, h: 26 },
];

/** 金币：6 枚，沿路径与平台摆放（都够得着）。 */
export const COINS: readonly { readonly id: number; readonly x: number; readonly y: number }[] = [
  { id: 1, x: 300, y: 560 },
  { id: 2, x: 450, y: 620 },
  { id: 3, x: 735, y: 540 },
  { id: 4, x: 1010, y: 555 },
  { id: 5, x: 1290, y: 530 },
  { id: 6, x: 1470, y: 630 },
];

/** 终点旗子：地面段 3 的右端。 */
export const GOAL = { x: 1490, y: 570, w: 36, h: 110 } as const;