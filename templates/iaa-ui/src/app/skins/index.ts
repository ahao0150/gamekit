/**
 * 皮肤入口：默认暖木纹。切换：改 `choice.ts` 的 `ACTIVE_SKIN_ID`。
 * 整套皮肤自包含在本模板 `src/app/skins/`，不依赖仓库外路径。
 */

import { ACTIVE_SKIN_ID } from './choice';
import { GLASS_SKIN } from './glass';
import { WOOD_SKIN } from './wood';
import type { SkinDefinition, SkinId } from './types';

export type { SkinDefinition, SkinId, SkinPaint } from './types';
export { WOOD_SKIN } from './wood';
export { GLASS_SKIN } from './glass';
export { ACTIVE_SKIN_ID } from './choice';

export const SKINS: Readonly<Record<SkinId, SkinDefinition>> = {
  wood: WOOD_SKIN,
  glass: GLASS_SKIN,
};

export const DEFAULT_SKIN_ID: SkinId = 'wood';

export const isSkinId = (value: string): value is SkinId => value === 'wood' || value === 'glass';

/** 按 id 取皮肤；未知 id 回落默认并在 errors 里说明。 */
export const resolveSkin = (id: string | undefined): { skin: SkinDefinition; errors: readonly string[] } => {
  if (id === undefined || id === '') return { skin: SKINS[DEFAULT_SKIN_ID], errors: [] };
  if (!isSkinId(id)) {
    return {
      skin: SKINS[DEFAULT_SKIN_ID],
      errors: [`未知皮肤 '${id}'，可用：wood（暖木纹）/ glass（清爽玻璃）；已回落 ${DEFAULT_SKIN_ID}`],
    };
  }
  return { skin: SKINS[id], errors: [] };
};

/** 当前启用的皮肤（create 出来默认暖木纹）。 */
export const activeSkin = (): SkinDefinition => resolveSkin(ACTIVE_SKIN_ID).skin;
