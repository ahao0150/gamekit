/**
 * 精灵图集（T26）：基准里的 `drawImage` 负载从这里取图。
 *
 * 为什么不用纯色块：纯色 64×64 的 drawImage 在 GPU 上会被优化成一次填充，
 * 测出来偏低；真实精灵有图案（圆 + 斜线 + 色相），光栅化成本更接近游戏。
 *
 * 图集一次性生成（8×8 = 64 格，每格 64×64，共 512×512），所有配置复用同一张，
 * 避免「每次配置重新造图」把初始化成本混进帧耗时。
 */

/** 图集里的一个格子（源坐标）。 */
export interface AtlasCell {
  readonly sx: number;
  readonly sy: number;
}

/** 一次生成的精灵图集。 */
export interface Atlas {
  readonly canvas: HTMLCanvasElement;
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  readonly cells: readonly AtlasCell[];
}

/** 建图集：确定性图案（不碰 Math.random，任何一次运行都长一样）。 */
export const createAtlas = (cell = 64, cols = 8, rows = 8): Atlas => {
  const canvas = document.createElement('canvas');
  canvas.width = cell * cols;
  canvas.height = cell * rows;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('无法创建 2D 上下文：图集生成失败');

  const cells: AtlasCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const sx = col * cell;
      const sy = row * cell;
      cells.push({ sx, sy });
      const hue = (col * 37 + row * 53) % 360;
      ctx.fillStyle = `hsl(${hue}, 68%, 52%)`;
      ctx.fillRect(sx, sy, cell, cell);
      ctx.fillStyle = `hsl(${hue}, 62%, 34%)`;
      ctx.beginPath();
      ctx.arc(sx + cell / 2, sy + cell / 2, cell * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `hsl(${hue}, 70%, 78%)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx + 6, sy + cell - 6);
      ctx.lineTo(sx + cell - 6, sy + 6);
      ctx.stroke();
    }
  }
  return { canvas, cell, cols, rows, cells };
};
