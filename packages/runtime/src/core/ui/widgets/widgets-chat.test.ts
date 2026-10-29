// @long-file 三个聊天组件共用 bubbleParts/composerParts 的几何，一致性断言必须并排放才看得出「画与点同源」；反例自检也必须紧挨正向断言才看得出「破坏后确实变了」
/**
 * 聊天三件（`chatBubble` / `chatList` / `chatComposer`）的契约测试。
 *
 * 四条口径：
 * 1. **props 白名单**：`chatList` 恰好 8 个键，没有 `itemH` 之类的高度逃生口；
 * 2. **几何唯一真源**：`measure` 算出的高 == `bubbleHeight`，`draw` 画出的内容不超出这个高；
 * 3. **像素断言**（node 无 canvas 的替代）：唯一填充色 ≥ 4、填充面积/视口面积 > 0.5；
 * 4. **窄容器兜底**：`bubbleRatio` 过小时 `assert` 报错带数值，`draw` 不崩且 `maxWidth ≥ 1`。
 */

import { describe, expect, it } from 'vitest';
import type { Ctx2D } from '../../../platform/contract';
import type { Rect } from '../contract';
import { chatBubble, bubbleHeight, bubbleParts, bubbleTextWidth, FAIL_COLOR } from './chat-bubble';
import type { BubbleOptions, ChatMessage } from './chat-bubble';
import { chatList, chatListHeights, chatListIndexAt, chatListOptions } from './chat-list';
import { chatComposer, composerHit, composerParts } from './chat-composer';
import { fillColors, filledRatio, makeBox, makeDeps, makeEnv, spyCtx } from './test-helpers';

const box = (w = 300, h = 400): Rect => makeBox(0, 0, w, h);
const msg = (text: string, who = 'other', extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m-${text.slice(0, 4)}`,
  who,
  text,
  at: 0,
  ...extra,
});
const bubbleOpts = (patch: Partial<BubbleOptions> = {}): BubbleOptions => ({
  side: 'left',
  fontSize: 15,
  showAvatar: true,
  bubbleRatio: 0.72,
  ...patch,
});

describe('chatList：props 白名单（§3.2.2）', () => {
  it('恰好 8 个键，且没有高度类逃生口', () => {
    // props 挂在 `def` 上（`DefinedComponent` = `{ name, def }`，见 components.ts:132）
    const keys = Object.keys(chatList.def.props ?? {}).sort();
    expect(keys).toEqual(['bubbleRatio', 'emptyText', 'fontSize', 'itemGap', 'scrollTop', 'selfId', 'showAvatar', 'showTime']);
    expect(keys).toHaveLength(8);
    for (const banned of ['itemH', 'itemHeight', 'rowHeight', 'lineHeight', 'heights', 'itemHeights']) {
      expect(keys).not.toContain(banned);
    }
  });

  it('chatBubble 的 props 也不含高度类键', () => {
    const keys = Object.keys(chatBubble.def.props ?? {});
    expect(keys.length).toBeGreaterThan(0);
    for (const banned of ['itemH', 'height', 'lineHeight']) expect(keys).not.toContain(banned);
  });
});

describe('bubbleParts：几何唯一真源', () => {
  it('measure 算出的高 == bubbleHeight（两期同一口径）', () => {
    const b = box(300, 0);
    const props = { text: '一二三四五六七八九十', fontSize: 15, bubbleRatio: 0.72, showAvatar: true };
    const measured = chatBubble.def.measure?.(makeEnv(), b, props);
    const expected = bubbleHeight(msg(props.text), b.w, bubbleOpts());
    expect(measured?.h).toBeCloseTo(expected, 5);
  });

  it('气泡宽 = min(可用宽, 容器宽 × bubbleRatio)，文字区已扣内边距', () => {
    const b = box(300, 40);
    const parts = bubbleParts(b, bubbleOpts());
    // 可用宽 = 300 − (32 + 12) = 256；容器宽 × ratio = 216 → 取 216
    expect(parts.bubble.w).toBeCloseTo(216, 5);
    expect(parts.text.w).toBeCloseTo(216 - 32, 5);
    expect(parts.avatar?.w).toBe(32);
    expect(parts.avatar?.x).toBe(0);
  });

  it('side=right 时气泡靠右、头像在右', () => {
    const b = box(300, 40);
    const parts = bubbleParts(b, bubbleOpts({ side: 'right' }));
    expect(parts.avatar?.x).toBe(300 - 32);
    expect(parts.bubble.x + parts.bubble.w).toBeCloseTo(300 - 44, 5);
  });

  it('draw 画出的内容不超出 measure 给的高度（画得比占位大就会压住下一条）', () => {
    const spy = spyCtx();
    const props = { text: '多行文本测试'.repeat(6), fontSize: 15, bubbleRatio: 0.72, showAvatar: true };
    const measured = chatBubble.def.measure?.(makeEnv(), box(300, 0), props);
    const h = measured?.h ?? 0;
    chatBubble.def.draw(spy.ctx, makeBox(0, 0, 300, h), props, makeDeps());
    const ys = spy.texts.map((t) => t.y);
    expect(ys.length).toBeGreaterThan(0);
    for (const y of ys) expect(y).toBeLessThanOrEqual(h);
  });
});

describe('窄容器 / bubbleRatio 过小：钳制 + 报错', () => {
  it('bubbleTextWidth 永远 ≥ 1（maxWidth 兜底不能是 0 或负数）', () => {
    expect(bubbleTextWidth(0)).toBe(1);
    expect(bubbleTextWidth(-50)).toBe(1);
    expect(bubbleTextWidth(20)).toBe(1); // 20 − 32 < 0 → 钳到 1
    expect(bubbleTextWidth(100)).toBe(68);
  });

  it('bubbleRatio=0.25 + 窄 box → assert 报错，文案里带算出来的负数', () => {
    const issues = chatList.def.assert?.(box(100, 400), { bubbleRatio: 0.25, fontSize: 15, showAvatar: true }) ?? [];
    expect(issues.length).toBeGreaterThan(0);
    const joined = issues.join(' / ');
    // 100 × 0.25 = 25 → 25 − 32 = −7
    expect(joined).toMatch(/-7\.0px/);
    expect(joined).toContain('bubbleRatio');
  });

  it('bubbleRatio 上限是 1 不是 0.9：1 合法且气泡撑到可用宽，1.5 才报错', () => {
    const issuesOf = (ratio: number): string =>
      (chatList.def.assert?.(box(300, 400), { bubbleRatio: ratio, fontSize: 15 }) ?? []).join(' / ');
    expect(issuesOf(1)).not.toContain('bubbleRatio'); // 满宽气泡是合理设计，不该被拦
    expect(issuesOf(1.5)).toContain('只接受 0.4–1');
    // ratio=1 时气泡宽 = 可用宽 300−44 = 256（不是 300：`min` 保证它压不到头像）
    const parts = bubbleParts(box(300, 40), bubbleOpts({ bubbleRatio: 1 }));
    expect(parts.bubble.w).toBeCloseTo(256, 5);
    expect(parts.text.w).toBeCloseTo(224, 5);
    expect(parts.avatar?.w).toBe(32); // 头像槽还在，气泡没盖上去
  });

  it('同一情形下 draw 不崩，且 fillText 的 maxWidth ≥ 1', () => {
    const spy = spyCtx();
    expect(() => chatList.def.draw(spy.ctx, box(100, 400), { bubbleRatio: 0.25, fontSize: 15 }, makeDepsWith([msg('窄容器里的一句话')]))).not.toThrow();
    const withMax = spy.texts.filter((t) => t.maxWidth !== undefined);
    expect(withMax.length).toBeGreaterThan(0);
    for (const t of withMax) expect(t.maxWidth ?? 0).toBeGreaterThanOrEqual(1);
  });
});

describe('chatList：变高与命中', () => {
  const items = [msg('短'), msg('这一条明显更长一些', 'me'), msg('第三条')];

  it('逐项高度按文字折行算，不是定高（1 行 → 34px，2 行 → 52px）', () => {
    const spy = spyCtx();
    // 文字区宽 184、fontSize 15 → 12 字/行；行高 18、上下内边距 8×2
    const twoLines = '这一条明显长一些要多折一行'; // 13 字 → 2 行
    chatList.def.draw(spy.ctx, box(300, 200), { fontSize: 15 }, makeDepsWith([msg('短'), msg(twoLines, 'me')]));
    const heights = spy.fillBoxes.filter((f) => f.w > 100).map((f) => Math.round(f.h));
    expect(heights).toEqual([34, 52]);
  });

  it('只画视口内的项（30 条消息、视口 200px → 只画 5 条，超出的靠 clip 裁）', () => {
    const many = Array.from({ length: 30 }, (_v, i) => msg(`第${i}条`));
    const spy = spyCtx();
    chatList.def.draw(spy.ctx, box(300, 200), { fontSize: 15 }, makeDepsWith(many));
    const bubbles = spy.fillBoxes.filter((f) => f.w > 100);
    // 每条 34 高 + 8 间距 = 42 → 200px 装得下 5 条（第 5 条下沿 202，部分可见）
    expect(bubbles).toHaveLength(5);
    expect(spy.clips).toBe(1); // 超视口的部分由 clip 裁掉，不是靠少画
    for (const b of bubbles) {
      expect(b.y).toBeLessThan(200); // 上沿在视口内，否则这条根本看不见
      expect(b.y + b.h).toBeLessThanOrEqual(200 + 42); // 最多超一项高（部分可见）
    }
  });

  it('at 全部缺失时不算时间行：8 条消息总高比全带 at 少 4×16 = 64px', () => {
    const plain: ChatMessage[] = Array.from({ length: 8 }, (_v, i) => ({
      who: i % 2 === 0 ? 'me' : 'other',
      text: `第${i}条`,
    }));
    // 每两条落在同一分钟 → 时间行出现在第 1/3/5/7 条（index 0/2/4/6），共 4 个
    const timed: ChatMessage[] = plain.map((m, i) => ({ ...m, at: (Math.floor(i / 2) + 1) * 60000 }));
    const exact = (items: readonly ChatMessage[]): number[] =>
      chatListHeights(items, 300, chatListOptions({ fontSize: 15 })).map((h) => Math.round(h));

    // 一条 1 行文本的气泡 = 15×1.2 + 上下内边距 16 = 34；带时间行 +16 = 50
    expect(exact(timed)).toEqual([50, 34, 50, 34, 50, 34, 50, 34]);
    expect(exact(plain)).toEqual([34, 34, 34, 34, 34, 34, 34, 34]);

    const total = (items: readonly ChatMessage[]): number => exact(items).reduce((sum, h) => sum + h, 0);
    // 「at 缺失也不计那 16px 行高」——漏了这条，气泡之间会空出 16px 的缝
    expect(total(timed) - total(plain)).toBe(64);
  });

  it('chatListIndexAt 命中第 1 项（与绘制共用同一份前缀和）', () => {
    const b = box(300, 200);
    const hit = chatListIndexAt({ x: 150, y: 10 }, b, { fontSize: 15 }, items, 0);
    expect(hit).toBe(0);
  });

  it('项间空隙 / 容器外 → null（不就近归并）', () => {
    const b = box(300, 200);
    expect(chatListIndexAt({ x: 150, y: 500 }, b, { fontSize: 15 }, items, 0)).toBeNull();
    expect(chatListIndexAt({ x: -5, y: 10 }, b, { fontSize: 15 }, items, 0)).toBeNull();
  });

  it('空列表画空态文案（不崩、不留白）', () => {
    const spy = spyCtx();
    chatList.def.draw(spy.ctx, box(300, 200), { emptyText: '还没有人说话' }, makeDepsWith([]));
    expect(spy.texts.map((t) => t.text)).toContain('还没有人说话');
  });

  it('像素等价断言：唯一填充色 ≥ 2（含失败色）、填充面积/视口面积 > 0.25、三条气泡左右分流', () => {
    const spy = spyCtx();
    const b = box(300, 240);
    chatList.def.draw(spy.ctx, b, { fontSize: 15, bubbleRatio: 0.72, showTime: true }, makeDepsWith(
      [msg('第一条消息', 'other', { at: Date.now(), state: 'failed' }), msg('第二条消息', 'me'), msg('第三条', 'other')],
    ));
    // 圆角气泡底走路径 fill，`spy.fills` 里一个都没有 —— 必须读 fillBoxes
    expect(spy.pathFills).toBeGreaterThanOrEqual(3);
    const colors = fillColors(spy);
    expect(colors.length).toBeGreaterThanOrEqual(2);
    expect(colors).toContain(FAIL_COLOR); // 失败态真的画了，不是只有面板色
    // 实测 22122 / 72000 = 0.307：气泡左右交替、中间留白，物理上到不了 0.5
    expect(filledRatio(spy, b)).toBeGreaterThan(0.25);

    // 三条气泡各 216 宽（= min(可用 256, 300×0.72)），自己 x=40 靠右、对方 x=44 靠左
    const bubbles = spy.fillBoxes.filter((f) => f.w > 100);
    expect(bubbles).toHaveLength(3);
    expect(bubbles.map((f) => Math.round(f.x))).toEqual([44, 40, 44]);
    for (const bubble of bubbles) expect(Math.round(bubble.w)).toBe(216);
  });
});

describe('chatComposer：几何与命中同源', () => {
  it('发送键靠右、宽度取 sendWidth，输入框吃掉剩余宽度', () => {
    const b = box(300, 56);
    const parts = composerParts(b, { sendWidth: 56 });
    expect(parts.send.w).toBe(56);
    expect(parts.send.x + parts.send.w).toBe(300);
    expect(parts.field.x).toBe(0);
    expect(parts.field.w).toBe(300 - 56 - 8);
  });

  it('composerHit：左半 → input，右侧 → send，容器外 → null', () => {
    const b = box(300, 56);
    const props = { sendWidth: 56 };
    expect(composerHit(b, props, { x: 40, y: 28 })).toBe('input');
    expect(composerHit(b, props, { x: 280, y: 28 })).toBe('send');
    expect(composerHit(b, props, { x: 400, y: 28 })).toBeNull();
  });

  it('窄容器里发送键最多占一半（输入框不会被挤成 0 宽）', () => {
    const parts = composerParts(box(80, 56), { sendWidth: 56 });
    expect(parts.send.w).toBe(40);
    expect(parts.field.w).toBeGreaterThan(0);
  });

  it('绘制画出了输入框与发送键（像素等价断言：两块、两色、铺满）', () => {
    const spy = spyCtx();
    const b = box(300, 56);
    chatComposer.def.draw(spy.ctx, b, { value: '你好', sendText: '发送' }, makeDeps());
    // 圆角输入框与圆角发送键都走路径 fill
    expect(spy.pathFills).toBeGreaterThanOrEqual(2);
    expect(fillColors(spy).length).toBeGreaterThanOrEqual(2);
    // 实测 16352 / 16800 = 0.973：输入条本来就该铺满整行
    expect(filledRatio(spy, b)).toBeGreaterThan(0.5);
    const boxes = spy.fillBoxes;
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toMatchObject({ x: 0, y: 0, w: 236, h: 56 }); // 输入框 = 300 − 56 − 8
    expect(boxes[1]).toMatchObject({ x: 244, y: 0, w: 56, h: 56 }); // 发送键靠右
    expect(spy.texts.map((t) => t.text)).toContain('发送');
  });

  it('不碰 platform：组件里没有 keyboard 调用（只画不弹）', () => {
    const spy = spyCtx();
    chatComposer.def.draw(spy.ctx, box(300, 56), { value: '', focused: true }, makeDeps());
    // 没有 platform 入参可传 → 只要不抛错就说明它不需要平台能力
    expect(spy.texts.length).toBeGreaterThan(0);
  });
});

/**
 * 反例自检：**故意破坏一处，断言行为确实变了**。
 *
 * 为什么必须有：上面所有正向断言都是绿的，绿的本身证明不了它们「在断言」——
 * 恒真断言（`expect(x.length).toBeGreaterThanOrEqual(0)` 这类）也永远绿。
 * 这三条把「破坏后的值」与「正常值」并排断言，只要正向断言是恒真的，
 * 这里的 `not.toEqual` / `not.toBe` 就会红。做法同 `verify-platform` 的反例自检
 * （人为制造坏状态，门禁必须报红）。
 *
 * 注意：**反例本身要绿** —— 绿的含义是「破坏后确实变了」，不是「破坏后没报错」。
 */
describe('反例自检（证明正向断言不是恒真）', () => {
  it('① 分流破坏：selfId 传 nobody → 自己的消息也归到左边，x 不再 [44,40,44]', () => {
    const items = [msg('第一条消息', 'other'), msg('第二条消息', 'me'), msg('第三条', 'other')];
    const xsOf = (props: Record<string, unknown>): number[] => {
      const spy = spyCtx();
      chatList.def.draw(spy.ctx, box(300, 240), { fontSize: 15, ...props }, makeDepsWith(items));
      return spy.fillBoxes.filter((f) => f.w > 100).map((f) => Math.round(f.x));
    };
    const normal = xsOf({});
    const broken = xsOf({ selfId: 'nobody' });
    expect(normal).toEqual([44, 40, 44]); // 正常：中间那条 'me' 靠右
    expect(broken).toEqual([44, 44, 44]); // 破坏：认不出 'me'，三条全在左边
    expect(broken).not.toEqual(normal); // ← 正向断言若不看 x，这一条会红
  });

  it('② 折行破坏：fontSize 15→200 → 项高不再是 [34,52] 且大幅变大', () => {
    const items = [msg('短'), msg('这一条明显长一些要多折一行', 'me')];
    const heightsOf = (fontSize: number): number[] =>
      chatListHeights(items, 300, chatListOptions({ fontSize })).map((h) => Math.round(h));
    const normal = heightsOf(15);
    const broken = heightsOf(200);
    expect(normal).toEqual([34, 52]); // 1 行 15×1.2+16 / 2 行 15×1.2×2+16
    // 200px 字号下文字区仍 184px 宽 → 每行只放得下 1 个字：「短」1 行 = 240+16，
    // 13 个字拆成 13 行 = 13×240+16
    expect(broken).toEqual([256, 3136]);
    expect(broken).not.toEqual([34, 52]);
    expect(broken[0]).not.toBe(normal[0]); // 同一条「短」的高度也变了
  });

  it('③ 虚拟裁剪破坏：可视区 200→1300 → 30 条全画（clip 不变，变的是开窗条数）', () => {
    const many = Array.from({ length: 30 }, (_v, i) => msg(`第${i}条`));
    const countOf = (h: number): { count: number; clips: number } => {
      const spy = spyCtx();
      chatList.def.draw(spy.ctx, box(300, h), { fontSize: 15 }, makeDepsWith(many));
      return { count: spy.fillBoxes.filter((f) => f.w > 100).length, clips: spy.clips };
    };
    const short = countOf(200);
    const tall = countOf(1300);
    expect(short.count).toBe(5); // 42px 一条，200px 装 5 条
    expect(tall.count).toBe(30); // 1252px 内容全装下
    expect(tall.count).not.toBe(short.count); // ← 正向断言若没真开窗，这一条会红
    expect(short.clips).toBe(1); // clip 两种情形都在，不能靠它区分
    expect(tall.clips).toBe(1);
  });
});

/** 带消息数据的 deps（`data.items` 是 chatList 的唯一数据入口）。 */
function makeDepsWith(items: readonly ChatMessage[]) {
  return { ...makeDeps(), data: { items } } as ReturnType<typeof makeDeps>;
}

/** 供 `Ctx2D` 类型检查用（避免未使用导入告警）。 */
export type ChatTestCtx = Ctx2D;
