// @long-file 变高列表的「算高 → 建索引 → 开窗 → 绘制 → 命中」是一条链，拆开会让五处对不上同一份几何
/**
 * 聊天列表：变高虚拟列表，只读 `data.items`，项高由组件自己算。
 *
 * **不读 `data.itemHeights`**（与 `list` 的分工，见 `docs/CHAT-UI.md` §3.2）：
 * `list` 是泛型容器、原理上不知道一项多高，所以必须外部给高度；
 * `chatList` 的消息形状是自己定的，高度完全可由 `text / fontSize / bubbleRatio / box.w` 推出。
 *
 * 三条硬约束：
 * 1. **props 只有 8 个键**，没有 `itemH` / `itemHeights` / `lineHeight` 这类逃生口
 *    （有口子 AI 就会手填 56，然后和按文字算出来的 70 对不上，正是要避免的 bug 入口）；
 * 2. 几何全走 `bubbleParts`（`chat-bubble.ts`），本文件不另算气泡；
 * 3. 定位不重写 —— `chatListIndexAt` 是 `listIndexAtVariable` 的薄封装。
 */

import type { Ctx2D } from '../../../platform/contract';
import type { Rect } from '../contract';
import type { DefinedComponent, DrawDeps, UiData } from '../components';
import { boolProp, defineComponent, numberProp, stringProp } from '../components';
import type { StyleProps } from '../layout-spec';
import { buildVariableIndex, listIndexAtVariable, variableWindow } from '../variable-window';
import { TIME_H, bubbleHeight, bubbleParts, checkBubbleFit, drawBubble, singleLineHeight } from './chat-bubble';
import type { BubbleOptions, ChatMessage } from './chat-bubble';

const DEFAULT_FONT = 15;
const DEFAULT_RATIO = 0.72;
const DEFAULT_GAP = 8;

/** 列表侧需要的全部选项（`props` 换算一次，五处共用）。 */
export interface ChatListOptions {
  readonly itemGap: number;
  readonly bubbleRatio: number;
  readonly fontSize: number;
  readonly showTime: boolean;
  readonly showAvatar: boolean;
  readonly selfId: string;
}

export const chatListOptions = (props: StyleProps): ChatListOptions => ({
  itemGap: Math.max(0, numberProp(props, 'itemGap', DEFAULT_GAP)),
  bubbleRatio: numberProp(props, 'bubbleRatio', DEFAULT_RATIO),
  fontSize: Math.max(1, numberProp(props, 'fontSize', DEFAULT_FONT)),
  showTime: boolProp(props, 'showTime', true),
  showAvatar: boolProp(props, 'showAvatar', true),
  selfId: stringProp(props, 'selfId', 'me'),
});

const bubbleOptionsOf = (opts: ChatListOptions, who: string): BubbleOptions => ({
  side: who === opts.selfId ? 'right' : 'left',
  fontSize: opts.fontSize,
  showAvatar: opts.showAvatar,
  bubbleRatio: opts.bubbleRatio,
});

/** 是不是一条形状合法的消息（非法项仍占一行高度，见 §3.5 第 10 条）。 */
const isMessage = (value: unknown): value is ChatMessage =>
  typeof value === 'object'
  && value !== null
  && typeof (value as { readonly who?: unknown }).who === 'string'
  && typeof (value as { readonly text?: unknown }).text === 'string';

/** 读 `data.items`。 */
export const readMessages = (data: UiData | undefined): readonly ChatMessage[] => {
  const raw: unknown = data?.items;
  return Array.isArray(raw) ? (raw as readonly ChatMessage[]) : [];
};

/**
 * 该项要不要画时间分隔（同一分钟内不重复）。
 *
 * `at` 是可选字段：**缺失或 `<= 0` 一律不画**，同时 `chatListHeights` 也不计那 16px
 * —— 两处都走这一个判断，否则高度算多了会在气泡之间留 16px 空隙。
 */
const needsTime = (items: readonly ChatMessage[], index: number, opts: ChatListOptions): boolean => {
  if (!opts.showTime) return false;
  const current = items[index];
  if (current === undefined) return false;
  const at = current.at;
  if (at === undefined || !Number.isFinite(at) || at <= 0) return false;
  const prev = items[index - 1];
  if (prev === undefined) return true;
  const prevAt = prev.at;
  if (prevAt === undefined || !Number.isFinite(prevAt) || prevAt <= 0) return true;
  return Math.floor(prevAt / 60000) !== Math.floor(at / 60000);
};

/** 时间分隔行在项内占的高度。 */
const timeHeightOf = (withTime: boolean): number => (withTime ? TIME_H : 0);

/**
 * 每项高度（含时间分隔行）。
 *
 * 非法项不跳过 —— 它占**固定 1 行高度**（`singleLineHeight`），否则下面所有项会往上跳一格，
 * 用户看到的是「消息错位」而不是「一条消息坏了」。
 */
export const chatListHeights = (
  items: readonly ChatMessage[],
  boxW: number,
  opts: ChatListOptions,
): readonly number[] =>
  items.map((item, index) => {
    const time = timeHeightOf(needsTime(items, index, opts));
    if (!isMessage(item)) return time + singleLineHeight(opts.fontSize);
    const who = item.who;
    return time + bubbleHeight(item, boxW, bubbleOptionsOf(opts, who));
  });

/**
 * 索引缓存：键随 `items` 引用失效（`WeakMap` 不持有强引用，也不会跨数据集串味）。
 *
 * 为什么需要：1 万项每帧重折行会卡；只有 `(items 引用, box.w, fontSize, bubbleRatio, itemGap, showTime, showAvatar)`
 * 变化时才重建，其余帧 O(1) 取用。这不是「模块级可变单例」，是纯函数结果的记忆化。
 */
const cache = new WeakMap<readonly ChatMessage[], { readonly key: string; readonly index: ReturnType<typeof buildVariableIndex> }>();

const cachedIndex = (items: readonly ChatMessage[], boxW: number, opts: ChatListOptions): ReturnType<typeof buildVariableIndex> => {
  const key = `${boxW}|${opts.fontSize}|${opts.bubbleRatio}|${opts.itemGap}|${opts.showTime ? 1 : 0}|${opts.showAvatar ? 1 : 0}`;
  const hit = cache.get(items);
  if (hit !== undefined && hit.key === key) return hit.index;
  const index = buildVariableIndex(chatListHeights(items, boxW, opts), opts.itemGap);
  cache.set(items, { key, index });
  return index;
};

/**
 * 子项命中：屏幕点 → 消息下标。**`listIndexAtVariable` 的薄封装**，不重写定位逻辑。
 *
 * 语义与变高列表一致：容器外 / 项间空隙 / 超出内容 → `null`，不就近归并。
 */
export const chatListIndexAt = (
  point: { readonly x: number; readonly y: number },
  rect: Rect,
  props: StyleProps,
  items: readonly ChatMessage[],
  scrollTop = 0,
): number | null => {
  const opts = chatListOptions(props);
  return listIndexAtVariable(point, rect, scrollTop, cachedIndex(items, rect.w, opts), opts.itemGap);
};

export const chatList: DefinedComponent = defineComponent('chatList', {
  // 恰好 8 个键。**明确不给** itemH / itemHeights / lineHeight / heights / rowHeight
  // （§3.2.2 白名单，测试锁死 `Object.keys(...).length`）。
  props: {
    itemGap: 'number',
    bubbleRatio: 'number',
    fontSize: 'number',
    showTime: 'boolean',
    showAvatar: 'boolean',
    emptyText: 'string',
    scrollTop: 'number',
    selfId: 'string',
  },
  defaultSize: { w: 296, h: 320 },
  measure: (_env, box) => {
    // 高度由外层 `size fill` 决定（与 `list` 同口径）：内容总高只影响滚动，不影响占位
    return { w: box.w, h: box.h };
  },
  draw: (ctx: Ctx2D, box, props, deps: DrawDeps) => {
    if (!(box.w > 0) || !(box.h > 0)) return;
    const opts = chatListOptions(props);
    const items = readMessages(deps.data);
    if (items.length === 0) {
      ctx.fillStyle = deps.theme.disabled;
      ctx.font = `14px ${deps.theme.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(stringProp(props, 'emptyText', '还没有人说话'), box.x + box.w / 2, box.y + box.h / 2, box.w);
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();

    const index = cachedIndex(items, box.w, opts);
    const scrollTop = numberProp(props, 'scrollTop', 0);
    const win = variableWindow(index, scrollTop, box.h);
    const scrolled = Math.min(Math.max(scrollTop, 0), Math.max(0, win.totalH - box.h));
    const top = box.y - scrolled;

    for (let i = win.start; i < win.end; i += 1) {
      const y = top + (index.offsets[i] as number);
      const h = index.heights[i] as number;
      if (h <= 0) continue;
      const item = items[i];

      // 时间分隔
      if (needsTime(items, i, opts)) {
        const at = item === undefined ? 0 : (item.at ?? 0);
        ctx.fillStyle = deps.theme.disabled;
        ctx.font = `12px ${deps.theme.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatTime(at), box.x + box.w / 2, y + TIME_H / 2, box.w);
      }

      const rowY = y + timeHeightOf(needsTime(items, i, opts));
      const rowBox: Rect = { x: box.x, y: rowY, w: box.w, h: h - timeHeightOf(needsTime(items, i, opts)) };

      if (!isMessage(item)) {
        // 非法项：画虚线占位框 + 一行小字，让画面自己说明哪里坏了（不静默跳过、不画成空）
        ctx.save();
        ctx.setLineDash?.([3, 3]);
        ctx.strokeStyle = deps.theme.disabled;
        ctx.lineWidth = 1;
        ctx.strokeRect(rowBox.x + 4, rowBox.y + 4, rowBox.w - 8, rowBox.h - 8);
        ctx.restore();
        ctx.fillStyle = deps.theme.disabled;
        ctx.font = `12px ${deps.theme.fontFamily}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('格式错误（见控制台）', rowBox.x + 12, rowBox.y + rowBox.h / 2, rowBox.w - 24);
        continue;
      }

      drawBubble(ctx, item, rowBox, bubbleOptionsOf(opts, item.who), deps);
    }
    ctx.restore();
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const opts = chatListOptions(props);
    // 上限是 1 而不是 0.9：气泡宽 = min(可用宽 box.w−44, 容器宽×bubbleRatio)，`min` 本身
    // 就是真约束——ratio 再大也超不出可用宽，不可能顶到对侧头像。>1 由 `bubbleParts` 钳到 1，
    // 所以这里只拦明显写错的量级。0.9 那条限制会误杀「公告/系统频道要满宽气泡」这类合理设计。
    if (!(opts.bubbleRatio >= 0.4 && opts.bubbleRatio <= 1)) {
      issues.push(`bubbleRatio 收到 ${opts.bubbleRatio}，只接受 0.4–1。默认 0.72；大于 1 会被钳到 1（气泡宽 = min(可用宽, 容器宽×bubbleRatio)），小于 0.4 一句话要折 4 行`);
    }
    if (!(opts.fontSize > 0)) issues.push(`fontSize 必须大于 0，收到 ${opts.fontSize}`);
    // 真算一遍：气泡文字宽 <= 0 时 maxWidth 兜底失效（render 不透传非正数），文字会溢出气泡
    const fit = checkBubbleFit(box, {
      side: 'left',
      fontSize: opts.fontSize,
      showAvatar: opts.showAvatar,
      bubbleRatio: opts.bubbleRatio,
    });
    if (fit !== null) issues.push(`chatList: ${fit}`);
    // 视口装不下 2 行气泡：不报错也不改行为，只提示（§3.5 的静态断言之一）
    const oneLine = singleLineHeight(opts.fontSize);
    if (box.h > 0 && box.h < oneLine * 2) {
      issues.push(`列表视口高 ${Math.round(box.h)}px < 一条气泡 ${Math.round(oneLine)}px 的 2 倍，最多只能看到 1 条`);
    }
    // 高度类 props 是白名单外的东西：写进 .ui 会在 checkPropValue 处报「不是合法参数」，
    // 这里再兜一层，把「为什么会这样」说清楚。
    for (const bad of ['itemH', 'itemHeight', 'rowHeight', 'lineHeight', 'heights', 'itemHeights']) {
      if (Object.prototype.hasOwnProperty.call(props, bad)) {
        issues.push(`chatList 的 props 出现 '${bad}'：高度由组件按文字算，不接受手填（可用：itemGap / bubbleRatio / fontSize / showTime / showAvatar / emptyText / scrollTop / selfId）`);
      }
    }
    return issues;
  },
});

/** 时间显示：同一天只给 HH:MM（跨天信息在聊天里价值低，省宽度）。 */
export const formatTime = (at: number): string => {
  if (!Number.isFinite(at) || at <= 0) return '';
  const d = new Date(at);
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  return `${hh}:${mm}`;
};
