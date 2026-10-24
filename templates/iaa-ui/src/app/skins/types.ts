/**
 * 开箱皮肤契约：两套内置主题（暖木纹 / 清爽玻璃）。
 * 不含任何本机绝对路径；牌面/实体图由各游戏自行再生，皮肤只提供 UI 底色与程序纹理。
 */

import type { ComponentTheme, Ctx2D, Rect } from '../deps';

export type SkinId = 'wood' | 'glass';

export interface SkinPaint {
  /** 全屏背景（程序纹理，不依赖外部图） */
  readonly background: (ctx: Ctx2D, viewport: { readonly width: number; readonly height: number }) => void;
  /** 可选：在组件矩形上叠一层质感（面板等）；不传则只靠 theme 纯色 */
  readonly panelOverlay?: (ctx: Ctx2D, box: Rect) => void;
}

export interface SkinDefinition {
  readonly id: SkinId;
  /** 中文名，给人和 AI 读 */
  readonly label: string;
  readonly theme: ComponentTheme;
  readonly paint: SkinPaint;
}
