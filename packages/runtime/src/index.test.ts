/**
 * `@mg/runtime` barrel 的**对外导出**契约测试。
 *
 * 为什么要单测这个：core 内部的测试全部用相对路径 import（`./core/net/index`），
 * **不经过 barrel**。于是 `packages/runtime/src/index.ts` 少导出一个公开 API 时，
 * 68 条测试照样全绿、typecheck 也照过 —— 只有真正按包名用的调用方才会撞
 * `TS2305: Module has no exported member`。
 *
 * 真实事故（2026-10-27）：`createCancel` 在 `core/net/index.ts` 里导出了，
 * 却没进 `src/index.ts` 的 barrel。所有测试走包内路径，谁都没发现；
 * 最后是写文档的 Bot 拿包名跑 tsc 才抓出来。
 *
 * 所以这里断言的是「**业务代码从包名拿得到**」，不是「core 里有实现」。
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as runtime from './index';
import * as widgetsBarrel from './core/ui/widgets/index';
import * as renderBarrel from './core/render/index';
import * as uiBarrel from './core/ui/index';
import * as tweenBarrel from './core/tween/index';

/**
 * 二级 barrel 里导出了、但根 barrel 里没有的符号名。
 *
 * **这是本文件的核心防线，取代「手写白名单」**：手写 `expect(typeof runtime.x).toBe('function')`
 * 只能锁住「写测试的人想到的符号」，锁不住新模块进来的。2026-10-20 到 10-27 一周内 barrel
 * 漏了 5 次，全都是「二级导出了、根没转出」，而每次的防线都是手写清单 —— 于是第 6 次照样漏。
 *
 * 改成遍历对比后，任何模块只要在二级 barrel 导出，就必须同时进根 barrel（或进下面的
 * `BARREL_EXCLUDES` 并写明理由），否则这条直接报出符号名。
 */
const missingInRoot = (mod: Record<string, unknown>): string[] =>
  Object.keys(mod).filter((key) => !(key in runtime)).sort();

/**
 * 确实不该进根 barrel 的符号 → 理由。
 *
 * 原则：**默认全部转出**（导出多了没坏处，少了会让调用方去写引擎内部相对路径）。
 * 只有「纯内部工具、包名导出反而误导」的才进这里，且必须写清为什么。
 */
const BARREL_EXCLUDES: Record<string, string> = {};

describe('@mg/runtime barrel 对外导出', () => {
  it('网络能力：三个入口都从包名可见', () => {
    // createCancel 是取消能力的唯一入口；漏了它 = 游戏里没法取消请求
    expect(typeof runtime.createCancel).toBe('function');
    expect(typeof runtime.request).toBe('function');
    expect(typeof runtime.openSocket).toBe('function');
  });

  it('网络常量与默认值可见', () => {
    expect(runtime.NET_DEFAULTS).toBeDefined();
    expect(runtime.NO_RETRY).toBeDefined();
    expect(typeof runtime.SOCKET_QUEUE_LIMIT).toBe('number');
  });

  it('createCancel 造出来的对象形状可用（不是只导出一个空壳）', () => {
    const cancel = runtime.createCancel();
    expect(cancel.signal.aborted).toBe(false);
    expect(typeof cancel.signal.onAbort).toBe('function');
    expect(typeof cancel.abort).toBe('function');
    cancel.abort();
    expect(cancel.signal.aborted).toBe(true);
  });

  it('缓动能力：整块从包名可见（此前 core/tween 完全没进 barrel）', () => {
    expect(typeof runtime.createTween).toBe('function');
    expect(typeof runtime.createTweenRunner).toBe('function');
    expect(typeof runtime.createTweenSystem).toBe('function');
    expect(typeof runtime.createSpring).toBe('function');
    expect(typeof runtime.sampleTimeline).toBe('function');
    expect(typeof runtime.easingAt).toBe('function');
    expect(runtime.MOTION).toBeDefined();
    expect(runtime.CURVES).toBeDefined();
  });

  it('MOTION 里是真实常量（不是空对象）', () => {
    // 取三个不同形状的真实值：数字 / 字符串 / 嵌套对象
    expect(runtime.MOTION.ms.instant).toBe(60);
    expect(typeof runtime.MOTION.ease.out).toBe('string');
    expect(runtime.MOTION.spring.tap.stiffness).toBeGreaterThan(0);
  });

  it('createTweenRunner 造出来的 runner 真能用（不是只导出一个空壳）', () => {
    const runner = runtime.createTweenRunner();
    expect(typeof runner.set).toBe('function');
    expect(typeof runner.get).toBe('function');
    expect(typeof runner.value).toBe('function');
    expect(typeof runner.advance).toBe('function');

    const tween = runner.set('demo', { from: 0, to: 100, duration: 300 });
    expect(runner.get('demo')).toBe(tween);
    expect(runner.value('demo')).toBe(0); // 起点
    runner.advance(300);
    expect(runner.value('demo')).toBe(100); // 走完 → 终点
  });

  it('滚动状态机：五个符号从包名可见，且 scrollTick 真的会推进', () => {
    expect(typeof runtime.scrollTick).toBe('function');
    expect(typeof runtime.scrollDragStart).toBe('function');
    expect(typeof runtime.scrollDragEnd).toBe('function');
    expect(typeof runtime.scrollClamp).toBe('function');
    expect(runtime.IDLE_SCROLL.offset).toBe(0);
    expect(runtime.IDLE_SCROLL.dragging).toBe(false);

    // 带速度滚一帧：位置必须朝正方向前进、速度必须衰减（不是恒等返回）
    const moving = { offset: 0, velocity: 600, dragging: false };
    const after = runtime.scrollTick(moving, 1 / 60, 2000, 400);
    expect(after.offset).toBeGreaterThan(0);
    expect(after.velocity).toBeLessThan(600);
  });

  it('scrollClamp 真的钳边界（不是恒等返回）', () => {
    expect(runtime.scrollClamp(-50, 2000, 400)).toBe(0);
    expect(runtime.scrollClamp(9999, 2000, 400)).toBe(1600); // 2000 - 400
  });

  it('文本折行 / 变高列表：五个符号从包名可见', () => {
    expect(typeof runtime.wrapText).toBe('function');
    expect(typeof runtime.measureItemHeights).toBe('function');
    expect(typeof runtime.buildVariableIndex).toBe('function');
    expect(typeof runtime.variableWindow).toBe('function');
    expect(typeof runtime.listIndexAtVariable).toBe('function');
  });

  it('wrapText / variableWindow 行为可用（不是只导出一个空壳）', () => {
    // '一二三四五六' 每字 16px、maxWidth 30 → 一行 1 个汉字，必然多行
    const lines = runtime.wrapText('一二三四五六', 30, { size: 16 });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('一二三四五六');

    // 变高窗口：heights [100,100,100] + gap 0，视口 250 → 覆盖 0/1/2 三项
    const index = runtime.buildVariableIndex([100, 100, 100], 0);
    const win = runtime.variableWindow(index, 0, 250);
    expect(win.start).toBe(0);
    expect(win.end).toBe(3);
    expect(win.totalH).toBe(300);
    expect(win.offsetY).toBe(0);

    // 命中共用同一份索引：y=150 → 第 1 项
    expect(runtime.listIndexAtVariable({ x: 10, y: 150 }, { x: 0, y: 0, w: 300, h: 250 }, 0, index)).toBe(1);
  });

  it('其余既有能力未被这次改动碰坏（抽样）', () => {
    expect(typeof runtime.createLoop).toBe('function');
    expect(typeof runtime.createSave).toBe('function');
    expect(typeof runtime.resolvePlatform).toBe('function');
    expect(typeof runtime.createDefaultUiRegistry).toBe('function');
  });

  it('聊天三件与几何从包名可用（类型 + 行为，不是只导出空壳）', () => {
    // ChatMessage 只要 who + text：id / at 都是可选。字段被谁改回必填，这里 tsc 会红
    const msg: runtime.ChatMessage = { who: 'npc', text: '你好' };
    const items: readonly runtime.ChatMessage[] = [msg, { who: 'me', text: '在' }];

    const opts: runtime.BubbleOptions = { side: 'left', fontSize: 15, showAvatar: true, bubbleRatio: 0.72 };
    const parts: runtime.BubbleParts = runtime.bubbleParts({ x: 0, y: 0, w: 300, h: 40 }, opts);
    expect(parts.bubble.w).toBeCloseTo(216, 5);
    expect(parts.text.w).toBeCloseTo(184, 5);
    expect(runtime.bubbleTextWidth(0)).toBe(1); // 钳制兜底
    expect(runtime.rawBubbleTextWidth(25)).toBe(-7); // 未钳制值：报错文案靠它算真实负数

    const listOpts: runtime.ChatListOptions = runtime.chatListOptions({ fontSize: 15 });
    // 两条都无 at，高度就是 1 行 × 15×1.2 + 内边距 16，不含时间行
    const heights: readonly number[] = runtime.chatListHeights(items, 300, listOpts);
    expect(heights).toEqual([34, 34]);

    expect(runtime.readMessages({ items })).toHaveLength(2);
    expect(runtime.chatListIndexAt({ x: 150, y: 5 }, { x: 0, y: 0, w: 300, h: 200 }, { fontSize: 15 }, items, 0)).toBe(0);

    const cparts: runtime.ComposerParts = runtime.composerParts({ x: 0, y: 0, w: 300, h: 56 }, { sendWidth: 56 });
    expect(cparts.send.w).toBe(56);
    expect(runtime.composerHit({ x: 0, y: 0, w: 300, h: 56 }, { sendWidth: 56 }, { x: 280, y: 28 })).toBe('send');

    // 窄容器：报错文案带真实负数（几何唯一真源 checkBubbleFit 与 bubbleParts 同算式）
    expect(runtime.checkBubbleFit({ x: 0, y: 0, w: 100, h: 40 }, { ...opts, bubbleRatio: 0.25 })).toContain('-7.0px');
    expect(typeof runtime.bubbleLineHeight).toBe('function');
    expect(runtime.AVATAR_SIZE).toBe(32);
  });
});

/**
 * 二级 barrel ←→ 根 barrel 的**自动对比**，取代手写白名单。
 *
 * 为什么换写法：2026-10-20 起一周内 barrel 漏了 5 次，形态全是「二级导出了、根没转出」。
 * 前四次补的都是手写 `expect(typeof runtime.x)`，只能锁住当时想到的符号 —— 所以第 5 次
 * （聊天三件）照样漏。这里改成遍历二级 barrel 的全部运行时导出逐个比对，
 * 新模块一进来就会红，不需要有人想起来补测试。
 */
describe('二级 barrel ←→ 根 barrel 自动对比（治本防线）', () => {
  const missingOf = (mod: Record<string, unknown>): string[] =>
    missingInRoot(mod).filter((name) => !(name in BARREL_EXCLUDES));

  it('core/ui/widgets/index 的每个导出都能从包名拿到', () => {
    const missing = missingOf(widgetsBarrel as unknown as Record<string, unknown>);
    expect(missing, `core/ui/widgets/index 导出了这些，但根 barrel 没有：${missing.join(', ')}`).toEqual([]);
  });

  it('core/render/index 的每个导出都能从包名拿到', () => {
    const missing = missingOf(renderBarrel as unknown as Record<string, unknown>);
    expect(missing, `core/render/index 导出了这些，但根 barrel 没有：${missing.join(', ')}`).toEqual([]);
  });

  it('core/ui/index 的每个导出都能从包名拿到', () => {
    const missing = missingOf(uiBarrel as unknown as Record<string, unknown>);
    expect(missing, `core/ui/index 导出了这些，但根 barrel 没有：${missing.join(', ')}`).toEqual([]);
  });

  it('core/tween/index 的每个导出都能从包名拿到', () => {
    const missing = missingOf(tweenBarrel as unknown as Record<string, unknown>);
    expect(missing, `core/tween/index 导出了这些，但根 barrel 没有：${missing.join(', ')}`).toEqual([]);
  });

  it('排除清单里每一条都写了非空理由（不许留空绕过防线）', () => {
    const blank = Object.entries(BARREL_EXCLUDES)
      .filter(([, why]) => why.trim().length === 0)
      .map(([name]) => name);
    expect(blank, `这些符号进了排除清单却没写理由：${blank.join(', ')}`).toEqual([]);
  });
});

/**
 * `package.json` 的 `exports` 是**对外的第二张脸**，和 barrel 一样没有测试守着。
 *
 * 为什么不用「按包名 import 一下」来测：仓库内的测试**解析不了** `@mg/runtime/platform`
 * 这类 subpath（实测 3 个 `Cannot find package`，只有 `/mock` 因为 vitest alias 能过）。
 * 能按包名用它们的只有 `games/**`（workspace link）。所以这里改测**静态一致性**：
 * 声明出来的每个入口都指向真实存在的文件。游戏侧「真能 import」由各游戏的 tsc 兜住。
 */
describe('package.json exports 契约', () => {
  const pkgDir = new URL('..', import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    exports: Record<string, string>;
  };

  it('五个公开入口齐全（少一个 = 游戏侧 import 直接炸）', () => {
    expect(Object.keys(pkg.exports).sort()).toEqual([
      '.',
      './extension',
      './mock',
      './platform',
      './platform/adapters',
    ]);
  });

  it('每个入口都指向真实存在的文件', () => {
    const missing: string[] = [];
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      if (!existsSync(new URL(target, pkgDir))) missing.push(`${subpath} → ${target}`);
    }
    expect(missing).toEqual([]);
  });
});
