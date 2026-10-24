import { describe, expect, it } from 'vitest';
import { ACTIVE_SKIN_ID, DEFAULT_SKIN_ID, SKINS, activeSkin, isSkinId, resolveSkin } from './index';

describe('skins catalog', () => {
  it('内置 wood / glass 两套，默认暖木纹', () => {
    expect(Object.keys(SKINS).sort()).toEqual(['glass', 'wood']);
    expect(DEFAULT_SKIN_ID).toBe('wood');
    expect(ACTIVE_SKIN_ID).toBe('wood');
    expect(activeSkin().id).toBe('wood');
    expect(activeSkin().label).toBe('暖木纹');
  });

  it('每套都有完整 theme 色板（缺图时靠它，不灰底蓝问号）', () => {
    for (const skin of Object.values(SKINS)) {
      expect(skin.theme.primary.length).toBeGreaterThan(0);
      expect(skin.theme.panel.length).toBeGreaterThan(0);
      expect(skin.theme.light.length).toBeGreaterThan(0);
      expect(typeof skin.paint.background).toBe('function');
    }
  });

  it('resolveSkin：未知 id 回落并报错', () => {
    const out = resolveSkin('neon');
    expect(out.skin.id).toBe('wood');
    expect(out.errors[0]).toContain('neon');
  });

  it('isSkinId', () => {
    expect(isSkinId('wood')).toBe(true);
    expect(isSkinId('glass')).toBe(true);
    expect(isSkinId('neon')).toBe(false);
  });
});
