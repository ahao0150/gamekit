/**
 * 绘制：皮肤背景 + 按 `paintOrder` 正序画组件。
 * 数据单通道：`view.data` → `DrawDeps.data`；漏键走 `resolveUiData` 报错。
 */

import { resolveUiData } from './deps';
import type { ComponentAssets, Ctx2D, DrawDeps } from './deps';
import type { ScreenLayout } from './layout';
import { activeSkin } from './skins';

/** 空资产：皮肤用程序纹理 + theme 纯色，缺图不白屏、不蓝问号。 */
export const EMPTY_ASSETS: ComponentAssets = { get: () => null };

export interface Renderer {
  draw(ctx: Ctx2D, view: ScreenLayout): void;
}

export const createRenderer = (
  deps: Omit<DrawDeps, 'theme' | 'assets'> & Partial<Pick<DrawDeps, 'theme' | 'assets'>> = {},
): Renderer => {
  const skin = activeSkin();
  const baseDeps: DrawDeps = {
    assets: deps.assets ?? EMPTY_ASSETS,
    theme: deps.theme ?? skin.theme,
    ...(deps.data !== undefined ? { data: deps.data } : {}),
  };
  return {
    draw(ctx, view) {
      const resolved = resolveUiData(view.data, baseDeps.data);
      if (resolved.errors.length > 0) {
        for (const message of resolved.errors) console.error(`[mg ui data] ${message}`);
      }
      const drawDeps: DrawDeps = { ...baseDeps, data: resolved.data };
      skin.paint.background(ctx, view.viewport);
      for (const name of view.paintOrder) {
        const def = view.components[name];
        const rect = view.rects[name];
        if (def === undefined || rect === undefined) continue;
        def.draw(ctx, rect, view.props[name] ?? {}, drawDeps);
        if (name === 'panel' && skin.paint.panelOverlay !== undefined) {
          skin.paint.panelOverlay(ctx, rect);
        }
      }
    },
  };
};
