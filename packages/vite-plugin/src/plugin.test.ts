import { describe, expect, it } from 'vitest';
import { mgPlugin } from './index';
import type { MgTarget } from './types';

const DESIGN = { width: 960, height: 640 };
/** platform/index.ts 的真实形态（Windows 反斜杠也要能认）。 */
const PLATFORM_INDEX = 'C:\\proj\\packages\\runtime\\src\\platform\\index.ts';

const resolveOf = (target: MgTarget) => {
  const hooks = mgPlugin({
    target,
    root: '/proj',
    design: DESIGN,
    entry: 'src/main.ts',
  }).resolveId;
  const fn = (typeof hooks === 'function' ? hooks : hooks?.handler) as unknown as (
    id: string,
    importer: string | undefined,
  ) => string | null;
  return (id: string, importer?: string): string | null => fn(id, importer);
};

const make = (target: MgTarget) =>
  mgPlugin({ target, root: '/proj', design: DESIGN, entry: 'src/main.ts' });

describe('平台裁剪', () => {
  it('wx 只保留 wechat，web/douyin/mock 都打成同一个空桩', () => {
    const resolve = resolveOf('wx');
    expect(resolve('./wechat', PLATFORM_INDEX)).toBeNull();
    const stub = resolve('./web', PLATFORM_INDEX);
    expect(stub).toContain('stub');
    expect(resolve('./douyin', PLATFORM_INDEX)).toBe(stub);
    expect(resolve('./mock', PLATFORM_INDEX)).toBe(stub);
  });

  it('web 只保留 web', () => {
    const resolve = resolveOf('web');
    expect(resolve('./web', PLATFORM_INDEX)).toBeNull();
    expect(resolve('./wechat', PLATFORM_INDEX)).toContain('stub');
    expect(resolve('./douyin', PLATFORM_INDEX)).toContain('stub');
  });

  it('tt 只保留 douyin', () => {
    const resolve = resolveOf('tt');
    expect(resolve('./douyin', PLATFORM_INDEX)).toBeNull();
    expect(resolve('./wechat', PLATFORM_INDEX)).toContain('stub');
  });

  it('不碰非 platform/index.ts 的相对 import（避免误伤业务代码）', () => {
    const resolve = resolveOf('web');
    expect(resolve('./web', 'C:/proj/src/app/main.ts')).toBeNull();
    expect(resolve('./wechat', 'C:/proj/src/app/main.ts')).toBeNull();
  });
});

describe('虚拟模块', () => {
  it('virtual:mg-manifest / virtual:mg-config 都能解析', () => {
    const resolve = resolveOf('wx');
    expect(resolve('virtual:mg-manifest')).toContain('mg-manifest');
    expect(resolve('virtual:mg-config')).toContain('mg-config');
  });

  it('空桩模块导出 register，平台注册入口不会因裁剪报错', () => {
    const plugin = make('web');
    const load = plugin.load as unknown as (id: string) => string | null;
    const stubId = resolveOf('web')('./wechat', PLATFORM_INDEX);
    expect(stubId).not.toBeNull();
    if (stubId) expect(load(stubId)).toContain('export const register');
  });
});

describe('插件基本约定', () => {
  it('name 固定、enforce 为 pre', () => {
    const plugin = make('web');
    expect(plugin.name).toBe('gamekit:mg');
    expect(plugin.enforce).toBe('pre');
  });
});
