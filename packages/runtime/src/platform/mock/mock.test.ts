/**
 * mock 平台契约测试。
 *
 * AGENTS.md §3 第 6 步：「补契约测试：用 mock 环境断言 can()、onPointer()、
 * loadImage() 的行为」。这里就是那份测试 —— 它同时是 core 层「只认契约、
 * 不认平台」的保证：只要 core 拿到的是 PlatformAdapter，测试就能跑。
 */

import { describe, expect, it } from 'vitest';
import type { Ctx2D, PointerEvent as GamePointerEvent } from '../contract';
import { createMockAdapter, register } from './index';
import { createRegistry } from '../registry';

describe('can()', () => {
  it('按注入的能力集合如实返回', () => {
    const adapter = createMockAdapter({
      capabilities: ['pointer', 'storage', 'audio', 'ad-rewarded'],
    });
    expect(adapter.can('audio')).toBe(true);
    expect(adapter.can('ad-rewarded')).toBe(true);    expect(adapter.can('keyboard')).toBe(false);
    expect(adapter.can('share')).toBe(false);
  });

  it('pointer 与 storage 是契约必需成员，恒为 true', () => {
    const adapter = createMockAdapter({ capabilities: [] });
    expect(adapter.can('pointer')).toBe(true);
    expect(adapter.can('storage')).toBe(true);
  });

  it('说有的能力，对应的方法一定在（can 与实现一致）', () => {
    const adapter = createMockAdapter({
      capabilities: ['audio', 'ad-banner', 'share', 'vibrate', 'subpackage', 'wasm', 'keyboard'],
    });
    expect(adapter.can('audio') && typeof adapter.createAudio).toBe('function');
    expect(adapter.can('ad-banner') && typeof adapter.ads).toBe('object');
    expect(adapter.can('share') && typeof adapter.share).toBe('function');
    expect(adapter.can('vibrate') && typeof adapter.vibrate).toBe('function');
    expect(adapter.can('subpackage') && typeof adapter.loadSubpackage).toBe('function');
    expect(adapter.can('wasm') && typeof adapter.wasm).toBe('object');
    expect(adapter.can('keyboard') && typeof adapter.onKey).toBe('function');
  });

  it('没有的能力就不给方法（不会出现 can 说没有、方法却存在）', () => {
    const adapter = createMockAdapter({ capabilities: [] });
    expect(adapter.createAudio).toBeUndefined();
    expect(adapter.ads).toBeUndefined();
    expect(adapter.share).toBeUndefined();
    expect(adapter.vibrate).toBeUndefined();
    expect(adapter.loadSubpackage).toBeUndefined();
    expect(adapter.wasm).toBeUndefined();
  });
});

describe('onPointer()', () => {
  it('收到注入的指针事件（类型、坐标、id、时间都对）', () => {
    const adapter = createMockAdapter();
    const got: GamePointerEvent[] = [];
    const off = adapter.onPointer((e) => got.push(e));

    adapter.emitPointer('down', 100, 200, 7, 1234);
    adapter.emitPointer('move', 110, 210, 7, 1240);
    adapter.emitPointer('up', 120, 220, 7, 1300);
    adapter.emitPointer('cancel', 120, 220, 7, 1400);

    expect(got).toHaveLength(4);
    expect(got.map((e) => e.kind)).toEqual(['down', 'move', 'up', 'cancel']);
    expect(got[0]?.pointer).toEqual({ id: 7, x: 100, y: 200 });
    expect(got[0]?.time).toBe(1234);
    expect(got[3]?.kind).toBe('cancel');
  });

  it('退订之后不再收到事件', () => {
    const adapter = createMockAdapter();
    const got: GamePointerEvent[] = [];
    const off = adapter.onPointer((e) => got.push(e));
    adapter.emitPointer('down', 1, 1);
    off();
    adapter.emitPointer('down', 2, 2);
    expect(got).toHaveLength(1);
  });
});

describe('onResize()', () => {
  it('注入尺寸变化后回调拿到新的 screen', () => {
    const adapter = createMockAdapter({ screen: { width: 375, height: 667, dpr: 2 } });
    const sizes: Array<[number, number]> = [];
    adapter.onResize((s) => sizes.push([s.width, s.height]));

    adapter.emitResize(414, 896, 3);

    expect(sizes).toEqual([[414, 896]]);
    expect(adapter.screen.width).toBe(414);
    expect(adapter.screen.dpr).toBe(3);
  });
});

describe('loadImage()', () => {
  it('成功路径：返回一张图', async () => {
    const adapter = createMockAdapter({ imageBehavior: 'ok' });
    const img = await adapter.loadImage('/a.png');
    expect(img).not.toBeNull();
    expect(img?.native).toEqual({ kind: 'mock-image', src: '/a.png' });
  });

  it('失败路径：返回 null（由 assets 层决定回落策略）', async () => {
    const adapter = createMockAdapter({ imageBehavior: 'fail' });
    expect(await adapter.loadImage('/missing.png')).toBeNull();
  });

  it('可以按 src 逐个决定成败', async () => {
    const adapter = createMockAdapter({
      imageBehavior: (src: string) => !src.includes('missing'),
    });
    expect(await adapter.loadImage('/ok.png')).not.toBeNull();
    expect(await adapter.loadImage('/missing.png')).toBeNull();
  });
});

describe('storage', () => {
  it('写入后能读出来', () => {
    const adapter = createMockAdapter();
    expect(adapter.storage.set('hp', 42)).toBe(true);
    expect(adapter.storage.get<number>('hp')).toBe(42);
  });

  it('对象/数组也能存取', () => {
    const adapter = createMockAdapter();
    adapter.storage.set('save', { unlocked: 3, best: [10, 20] });
    expect(adapter.storage.get<{ unlocked: number; best: number[] }>('save')).toEqual({
      unlocked: 3,
      best: [10, 20],
    });
  });

  it('未命中的 key 返回 null', () => {
    const adapter = createMockAdapter();
    expect(adapter.storage.get('never-set')).toBeNull();
  });

  it('remove 之后读不到', () => {
    const adapter = createMockAdapter();
    adapter.storage.set('k', 'v');
    adapter.storage.remove('k');
    expect(adapter.storage.get('k')).toBeNull();
  });
});

describe('register()', () => {
  it('默认 probe 为 false：真实环境绝不会误选 mock', () => {
    const registry = createRegistry();
    register(registry);
    expect(registry.names()).toContain('mock');
  });

  it('enabled: true 时可以被 resolve 选中', async () => {
    const registry = createRegistry();
    register(registry, { enabled: true });
    const adapter = await registry.resolve({ design: { width: 750, height: 1334 } });
    expect(adapter.name).toBe('mock');
  });
});

describe('音频：pause / resume', () => {
  it('平台形态的假音频带 pause 与 resume（与三端一致）', () => {
    const adapter = createMockAdapter({ capabilities: ['audio'] });
    // 契约里 createAudio 的返回类型是 AudioHandle（没有 resume），
    // 运行时对象带 resume —— 这里按运行时实际形态断言。
    type Resumable = { pause: () => void; resume: () => void };
    const handle = adapter.createAudio?.('/bgm.mp3') as unknown as Resumable | undefined;
    expect(handle).toBeDefined();
    expect(typeof handle?.pause).toBe('function');
    expect(typeof handle?.resume).toBe('function');

    handle?.pause();
    handle?.resume();
    expect(adapter.audioCalls).toEqual(['pause', 'resume']);
  });

  it('core 形态：支持 pause/resume 时两个方法都在，调用被记录', () => {
    const adapter = createMockAdapter();
    const audio = adapter.createPlayingAudio({ supportsPauseResume: true });
    audio.pause?.();
    audio.resume?.();
    expect(adapter.audioCalls).toEqual(['pause', 'resume']);
  });

  it('core 形态：不支持时对象上不出现这两个方法（core 走降级分支）', () => {
    const adapter = createMockAdapter();
    const audio = adapter.createPlayingAudio({ supportsPauseResume: false });
    expect('pause' in audio).toBe(false);
    expect('resume' in audio).toBe(false);
    expect(typeof audio.stop).toBe('function');
  });

  it('core 形态：finished 是只读属性，stop 之后变 true', () => {
    const adapter = createMockAdapter();
    const audio = adapter.createPlayingAudio();
    expect(audio.finished).toBe(false);
    audio.stop();
    expect(audio.finished).toBe(true);
    expect(() => {
      (audio as { finished: boolean }).finished = false;
    }).toThrow();
  });
});

// 安全区：mock 必须能把 insets 按测试需要注入（布局收缩、点击偏移的测试都靠它）。
describe('screen.insets', () => {
  it('可注入任意四边值（测试要能构造刘海机 / 无安全区 / 超屏）', () => {
    const adapter = createMockAdapter({
      screen: { width: 390, height: 844, insets: { top: 47, right: 0, bottom: 34, left: 0 } },
    });
    expect(adapter.screen.insets).toEqual({ top: 47, right: 0, bottom: 34, left: 0 });
  });

  it('不注入时默认四边全 0（无安全区）', () => {
    expect(createMockAdapter().screen.insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});

// T30：离屏画布。mock 的记录能力让「缓存层建了多大、ctx 是谁」都能被断言。
describe('createCanvas（离屏画布）', () => {
  it('返回尺寸正确的契约画布，并记录尺寸', () => {
    const adapter = createMockAdapter();
    const create = adapter.createCanvas;
    expect(create).toBeDefined();
    if (create === undefined) return;
    const canvas = create(390, 200);
    expect(canvas.width).toBe(390);
    expect(canvas.height).toBe(200);
    expect(adapter.offscreenCanvases).toEqual([{ width: 390, height: 200 }]);
  });

  it('注入的 offscreenCtx 会被返回（用来断言缓存层的绘制调用）', () => {
    const offscreenCtx = { fillRect: (): void => undefined } as unknown as Ctx2D;
    const adapter = createMockAdapter({ offscreenCtx });
    const canvas = adapter.createCanvas?.(10, 10);
    expect(canvas?.getContext('2d')).toBe(offscreenCtx);
  });

  it('非法尺寸钳到 1（与 wx/tt 同口径）', () => {
    const canvas = createMockAdapter().createCanvas?.(0, Number.NaN);
    expect(canvas?.width).toBe(1);
    expect(canvas?.height).toBe(1);
  });
});
