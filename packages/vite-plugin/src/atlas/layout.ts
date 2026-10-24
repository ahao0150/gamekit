/**
 * 排布（shelf packing）：把一堆图塞进若干页图集。
 *
 * 为什么用 shelf 而不是 MaxRects：图集里的图大多是同一档尺寸（图标、格子、按钮），
 * shelf 的利用率已经很接近最优，但**实现与可验证性**好得多（行高固定、位置可预测）。
 * 一旦上 MaxRects，「为什么不重叠」这件事就得靠复杂断言兜，收益不值。
 *
 * 三条硬约束（单测直接断言）：
 * 1. 任意两帧不重叠，且间隔 ≥ padding；
 * 2. 每帧都在页内，且离页边 ≥ padding；
 * 3. 一页装不下（宽或高超过 maxTextureSize）→ 新开一页，绝不放宽约束硬塞。
 */

import type { PackedRect, PageLayout, PackOptions } from './types';

/** 排布的输入项（只需要 key 与尺寸，不需要像素）。 */
export interface PackItem {
  readonly key: string;
  readonly width: number;
  readonly height: number;
}

interface Shelf {
  /** 这一行的 y 与行高（行高 = 该行第一个元素的高度） */
  y: number;
  height: number;
  /** 下一个可用的 x */
  nextX: number;
}

interface PageState {
  width: number;
  height: number;
  shelves: Shelf[];
  rects: PackedRect[];
  usedHeight: number;
}

/** 一页内的边距等于 padding：图离页边也留这么多，避免采样时吃到相邻页边。 */
const fitsWidth = (x: number, w: number, pageWidth: number, padding: number): boolean =>
  x + w + padding <= pageWidth;

const pageName = (index: number): string => `atlas-${index}.png`;

/**
 * 排布。返回的每页 `height` 已按实际用量裁短（不是整张 maxTextureSize），
 * 这样产物里不会出现大片空白像素（微信 4MB 主包红线对体积敏感）。
 */
export const packLayout = (items: readonly PackItem[], opts: PackOptions): PageLayout[] => {
  const pageSize = Math.max(1, Math.floor(opts.maxTextureSize));
  const padding = Math.max(0, Math.floor(opts.padding));
  // 高的先进：shelf 的行高由第一个元素决定，先放高的能少浪费行内空间
  const sorted = [...items].sort((a, b) => b.height - a.height || b.width - a.width || a.key.localeCompare(b.key));

  const pages: PageState[] = [];
  const newPage = (): PageState => {
    const page: PageState = { width: pageSize, height: pageSize, shelves: [], rects: [], usedHeight: padding };
    pages.push(page);
    return page;
  };

  for (const item of sorted) {
    if (item.width + padding * 2 > pageSize || item.height + padding * 2 > pageSize) {
      // 单张就比一页还大：排不进去（调用方应该已经按 maxFrameSize 过滤，这里兜底）
      continue;
    }
    let placed = false;
    for (const page of pages) {
      // 先试已有的行
      for (const shelf of page.shelves) {
        if (item.height <= shelf.height && fitsWidth(shelf.nextX, item.width, page.width, padding)) {
          page.rects.push({ key: item.key, x: shelf.nextX, y: shelf.y, w: item.width, h: item.height });
          shelf.nextX += item.width + padding;
          placed = true;
          break;
        }
      }
      if (placed) break;
      // 再试开新行
      const last = page.shelves[page.shelves.length - 1];
      const nextY = last === undefined ? padding : last.y + last.height + padding;
      if (nextY + item.height + padding <= page.height) {
        page.shelves.push({ y: nextY, height: item.height, nextX: padding + item.width + padding });
        page.rects.push({ key: item.key, x: padding, y: nextY, w: item.width, h: item.height });
        page.usedHeight = Math.max(page.usedHeight, nextY + item.height + padding);
        placed = true;
        break;
      }
    }
    if (placed) continue;
    // 现有页都放不下 → 新开一页
    const page = newPage();
    page.shelves.push({ y: padding, height: item.height, nextX: padding + item.width + padding });
    page.rects.push({ key: item.key, x: padding, y: padding, w: item.width, h: item.height });
    page.usedHeight = Math.max(page.usedHeight, padding + item.height + padding);
  }

  return pages.map((page, index) => ({
    name: pageName(index),
    width: page.width,
    // 裁短到实际用量（PNG 高度不需要是 2 的幂）
    height: Math.max(1, Math.ceil(page.usedHeight)),
    usedHeight: page.usedHeight,
    rects: page.rects,
  }));
};
