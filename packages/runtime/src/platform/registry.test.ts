/**
 * 平台注册表测试。
 *
 * 覆盖 AGENTS.md §3 里的关键判据：重名必须抛错、按优先级探测、全失败要抛
 * 清晰的中文错误，以及「加一个平台不碰 core」这条扩展性承诺。
 */

import { describe, expect, it } from 'vitest';
import type {
  Capability,
  GameCanvas,
  KeyValueStore,
  PlatformAdapter,
  PlatformBootOptions,
  ScreenInfo,
} from './contract';
import { createRegistry } from './registry';

const BOOT: PlatformBootOptions = { design: { width: 750, height: 1334 } };

/** 造一个最小可用的适配器：测试只关心「选中了谁」，不关心它能干什么。 */
const fakeAdapter = (name: string): PlatformAdapter => {
  const canvas: GameCanvas = {
    width: 750,
    height: 1334,
    getContext: () => null,
    native: { name },
  };
  const screen: ScreenInfo = {
    width: 750,
    height: 1334,
    dpr: 2,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    orientation: 'portrait',
  };
  const storage: KeyValueStore = {
    get: () => null,
    set: () => true,
    remove: () => {
      // noop
    },
  };
  return {
    name,
    canvas,
    screen,
    can: (_cap: Capability) => false,
    onResize: () => () => {
      // noop
    },
    onPointer: () => () => {
      // noop
    },
    loadImage: () => Promise.resolve(null),
    storage,
  };
};

describe('register', () => {
  it('重名注册必须抛错（防止静默覆盖）', () => {
    const registry = createRegistry();
    registry.register({ name: 'web', probe: () => false, factory: () => fakeAdapter('web') });
    expect(() =>
      registry.register({ name: 'web', probe: () => false, factory: () => fakeAdapter('web-2') }),
    ).toThrow(/已经注册过/);
  });

  it('重名报错要说清是哪个平台', () => {
    const registry = createRegistry();
    registry.register({ name: 'douyin', probe: () => false, factory: () => fakeAdapter('douyin') });
    try {
      registry.register({ name: 'douyin', probe: () => false, factory: () => fakeAdapter('x') });
      throw new Error('本该抛错却没抛');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('douyin');
    }
  });

  it('注册了两个不同名字的平台不抛错', () => {
    const registry = createRegistry();
    registry.register({ name: 'a', probe: () => false, factory: () => fakeAdapter('a') });
    registry.register({ name: 'b', probe: () => false, factory: () => fakeAdapter('b') });
    expect(registry.names()).toHaveLength(2);
  });
});

describe('names', () => {
  it('返回已注册的平台名，按优先级从大到小', () => {
    const registry = createRegistry();
    registry.register({
      name: 'low',
      probe: () => false,
      factory: () => fakeAdapter('low'),
      priority: -10,
    });
    registry.register({
      name: 'high',
      probe: () => false,
      factory: () => fakeAdapter('high'),
      priority: 10,
    });
    registry.register({
      name: 'mid',
      probe: () => false,
      factory: () => fakeAdapter('mid'),
      priority: 0,
    });
    expect(registry.names()).toEqual(['high', 'mid', 'low']);
  });

  it('同优先级按注册先后排（排序稳定）', () => {
    const registry = createRegistry();
    registry.register({ name: 'first', probe: () => false, factory: () => fakeAdapter('first') });
    registry.register({ name: 'second', probe: () => false, factory: () => fakeAdapter('second') });
    expect(registry.names()).toEqual(['first', 'second']);
  });
});

describe('resolve', () => {
  it('按 priority 从大到小探测，命中即返回', async () => {
    const registry = createRegistry();
    const probed: string[] = [];

    registry.register({
      name: 'low',
      probe: () => {
        probed.push('low');
        return true;
      },
      factory: () => fakeAdapter('low'),
      priority: 1,
    });
    registry.register({
      name: 'high',
      probe: () => {
        probed.push('high');
        return true;
      },
      factory: () => fakeAdapter('high'),
      priority: 9,
    });

    const adapter = await registry.resolve(BOOT);
    expect(adapter.name).toBe('high');
    // 命中 high 就不再往下探
    expect(probed).toEqual(['high']);
  });

  it('注册顺序不能盖过 priority 顺序', async () => {
    const registry = createRegistry();
    registry.register({
      name: 'first-registered',
      probe: () => true,
      factory: () => fakeAdapter('first-registered'),
      priority: 1,
    });
    registry.register({
      name: 'last-registered',
      probe: () => true,
      factory: () => fakeAdapter('last-registered'),
      priority: 100,
    });
    const adapter = await registry.resolve(BOOT);
    expect(adapter.name).toBe('last-registered');
  });

  it('probe 不命中的平台被跳过', async () => {
    const registry = createRegistry();
    registry.register({
      name: 'never',
      probe: () => false,
      factory: () => fakeAdapter('never'),
      priority: 100,
    });
    registry.register({
      name: 'yes',
      probe: () => true,
      factory: () => fakeAdapter('yes'),
      priority: 1,
    });
    const adapter = await registry.resolve(BOOT);
    expect(adapter.name).toBe('yes');
  });

  it('factory 抛错时继续试下一个平台', async () => {
    const registry = createRegistry();
    registry.register({
      name: 'broken',
      probe: () => true,
      factory: () => {
        throw new Error('画布创建失败');
      },
      priority: 100,
    });
    registry.register({
      name: 'ok',
      probe: () => true,
      factory: () => fakeAdapter('ok'),
      priority: 1,
    });
    const adapter = await registry.resolve(BOOT);
    expect(adapter.name).toBe('ok');
  });

  it('全部 probe 失败时抛错，且错误信息里有中文说明和平台名', async () => {
    const registry = createRegistry();
    registry.register({ name: 'wx-like', probe: () => false, factory: () => fakeAdapter('wx-like') });
    registry.register({ name: 'tt-like', probe: () => false, factory: () => fakeAdapter('tt-like') });

    await expect(registry.resolve(BOOT)).rejects.toThrow(/没有找到可用的平台实现/);
    await expect(registry.resolve(BOOT)).rejects.toThrow(/wx-like/);
  });

  it('一个平台都没注册时抛错并提示先注册', async () => {
    const registry = createRegistry();
    await expect(registry.resolve(BOOT)).rejects.toThrow(/没有注册任何平台实现/);
  });
});

describe('扩展性验证：现场加第 5 个平台', () => {
  it('只注册一次就能被 resolve 选中，不需要改注册表也不需要碰 core', async () => {
    const registry = createRegistry();

    // 这就是「加一个平台」的全部动作：一个 registration 对象。
    // 真实场景对应的是 platform/bilibili/index.ts 里导出的 register()。
    registry.register({
      name: 'bilibili',
      probe: () => true,
      factory: () => fakeAdapter('bilibili'),
      priority: 100,
    });

    const adapter = await registry.resolve(BOOT);
    expect(adapter.name).toBe('bilibili');
    expect(registry.names()).toContain('bilibili');
  });

  it('第 5 个平台可以和已有平台共存，优先级最高的胜出', async () => {
    const registry = createRegistry();
    registry.register({
      name: 'web',
      probe: () => true,
      factory: () => fakeAdapter('web'),
      priority: -1,
    });
    registry.register({
      name: 'bilibili',
      probe: () => true,
      factory: () => fakeAdapter('bilibili'),
      priority: 5,
    });

    const adapter = await registry.resolve(BOOT);
    expect(adapter.name).toBe('bilibili');
    expect(registry.names()).toEqual(['bilibili', 'web']);
  });
});
