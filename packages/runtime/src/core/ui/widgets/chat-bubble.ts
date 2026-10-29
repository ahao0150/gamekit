// @long-file 气泡的几何（parts）/ 高度（height）/ 组件（measure+draw）必须同一份真源，拆开就会出现「画出来比占位大」
/**
 * 聊天气泡：既可作为组件单放（NPC 头顶一句台词），也是 `chatList` 的默认绘制单元。
 *
 * **几何唯一真源是 `bubbleParts(box, opts)`**：`measure()`（占位高）、`draw()`（实际绘制）、
 * `chatListIndexAt()`（子项命中）三处必须调同一个。两边各写一套 = 「画出来比占位大」，
 * 这是 `ui-authoring` 里 `partsOf` 那条硬规则的同一个理由。
 *
 * 尺寸依据 `docs/CHAT-UI.md` §3.2.2 的几何表（TDesign 4px 网格）：
 * 头像 32 / 头像间距 12 / 内边距 16×8 / 行高 fontSize×1.2 / 圆角 12（靠头像一侧 0）。
 */

import type { Ctx2D } from '../../../platform/contract';
import type { Rect } from '../contract';
import type { DefinedComponent, DrawDeps } from '../components';
import { boolProp, defineComponent, numberProp, stringProp } from '../components';
import { wrapText } from '../../render/wrap';
import { fillRoundRect, roundPath } from './draw-utils';

// ---------------------------------------------------------------------------
// 数据形状
// ---------------------------------------------------------------------------

/**
 * 一条消息。
 *
 * `who` 是**任意字符串 id**（不是 `'me' | 'other'` 枚举）：左右分流靠 `props.selfId` 判定，
 * 这样三人群聊只是多几个 id，不用改类型（枚举会让「多人」变成破坏性变更）。
 *
 * **必填只有 `who` + `text`** —— 与运行期 `chat-list.ts` 的 `isMessage()` 完全一致
 * （它也只查这两个字段是 string）。`id` / `at` 可选的理由：
 * - `id`：唯一潜在用途是稳定的逐项动效 key，而聊天只在末尾追加、`index` 已经稳定；
 *   强制它等于逼每条消息编一个无意义字符串。真要做进场动效时用 `id ?? index`。
 * - `at`：缺省即不画时间分隔行（也**不计**那 16px 行高），不显示时间的场景不必填 0。
 */
export interface ChatMessage {
  /** 消息标识；只有需要跨帧稳定的动效 key 时才填，缺省按 index */
  readonly id?: string;
  /** 发送者标识；自己由 `props.selfId` 判定 */
  readonly who: string;
  readonly text: string;
  /** 毫秒时间戳；缺省或 `<= 0` 即不画时间行 */
  readonly at?: number;
  readonly name?: string;
  /** 素材 key；缺省用主题色画占位圆 */
  readonly avatar?: string;
  readonly state?: 'sent' | 'sending' | 'failed';
}

// ---------------------------------------------------------------------------
// 几何常量（与 CHAT-UI.md §3.2.2 一一对应）
// ---------------------------------------------------------------------------

/** 头像边长 */
export const AVATAR_SIZE = 32;
/** 头像与气泡的间距 */
export const AVATAR_GAP = 12;
export const PAD_X = 16;
export const PAD_Y = 8;
/** 气泡圆角（靠头像那一侧为 0） */
export const BUBBLE_RADIUS = 12;
/** 时间分隔行高 */
export const TIME_H = 16;
/** 失败状态的颜色（主题只有 8 色、没有 error 位，与 motion.md 的警示色同源） */
export const FAIL_COLOR = '#C2543F';
const DEFAULT_FONT = 15;
const DEFAULT_RATIO = 0.72;

/** 行高：与 `TextStyle.lineHeight` 的默认口径一致（size × 1.2）。 */
export const bubbleLineHeight = (fontSize: number): number => fontSize * 1.2;

/** 气泡内可用文字宽 = 气泡宽 − 左右内边距。 */
/**
 * 气泡内可用文字宽 = 气泡宽 − 左右内边距。
 *
 * **钳到 ≥ 1**：`TextStyle.maxWidth <= 0` 时 `render/index.ts` 不透传第四参，等于没有兜底，
 * 文字会溢出气泡。容器窄或 `bubbleRatio` 被写成 0.25 时原始值会算成负数，
 * 钳到 1 只会让文字被压得极窄，不会溢出。
 */
export const bubbleTextWidth = (bubbleW: number): number => Math.max(1, bubbleW - PAD_X * 2);

/** 未钳制的文字宽（`checkBubbleFit` 用它判断「这个尺寸根本放不下文字」）。 */
export const rawBubbleTextWidth = (bubbleW: number): number => bubbleW - PAD_X * 2;

/**
 * `assert` 用：这个尺寸下气泡还放得下文字吗？放不下返回中文错误，能放下返回 `null`。
 *
 * 与 `bubbleParts` **同一套算式**（不各算一套），并把各项扣减都报出来 ——
 * 只说「bubbleRatio 太小」没法让人判断该改哪个量。
 */
export const checkBubbleFit = (box: Rect, opts: BubbleOptions): string | null => {
  const parts = bubbleParts(box, opts);
  const raw = rawBubbleTextWidth(parts.bubble.w);
  if (raw > 0) return null;
  const avatarSlot = opts.showAvatar ? AVATAR_SIZE + AVATAR_GAP : 0;
  const usable = Math.max(0, box.w - avatarSlot);
  const limit = Math.max(0, box.w * (Number.isFinite(opts.bubbleRatio) ? opts.bubbleRatio : DEFAULT_RATIO));
  return `气泡文字宽算成 ${raw.toFixed(1)}px（放不下文字）：容器宽 ${box.w.toFixed(1)}px，`
    + `气泡宽 ${parts.bubble.w.toFixed(1)}px = min(可用宽 ${usable.toFixed(1)}, 容器宽×bubbleRatio ${limit.toFixed(1)})，`
    + `再减左右内边距 ${PAD_X * 2}px。`
    + '把 bubbleRatio 调到 0.5 以上，或给容器加宽（绘制时文字宽会被钳到 1px 兜底：不会溢出，但只剩一个字宽）';
};

// ---------------------------------------------------------------------------
// 唯一几何真源
// ---------------------------------------------------------------------------

export interface BubbleOptions {
  readonly side: 'left' | 'right';
  readonly fontSize: number;
  readonly showAvatar: boolean;
  /** 气泡宽上限 = min(可用宽, bubbleRatio × 行宽) */
  readonly bubbleRatio: number;
}

export interface BubbleParts {
  readonly side: 'left' | 'right';
  /** 头像槽（`showAvatar=false` 时为 null） */
  readonly avatar: Rect | null;
  readonly bubble: Rect;
  /** 气泡内的文字区（已扣内边距） */
  readonly text: Rect;
}

/**
 * 算一项的几何。**`measure` / `draw` / 命中三处共用这一个函数。**
 *
 * `box` 是**整行**矩形（宽度 = 列表宽），气泡在行内按 `side` 靠左/靠右。
 * 气泡宽度口径按 `CHAT-UI.md` §3.4「上限 = bubbleRatio × box.w」，再与可用宽取小。
 */
export const bubbleParts = (box: Rect, opts: BubbleOptions): BubbleParts => {
  const avatarSlot = opts.showAvatar ? AVATAR_SIZE + AVATAR_GAP : 0;
  const usable = Math.max(0, box.w - avatarSlot);
  const ratio = Math.max(0, Math.min(1, Number.isFinite(opts.bubbleRatio) ? opts.bubbleRatio : DEFAULT_RATIO));
  const bubbleW = Math.min(usable, Math.max(0, box.w * ratio));
  const bubbleH = Math.max(0, box.h);

  const avatar: Rect | null = opts.showAvatar
    ? {
      x: opts.side === 'left' ? box.x : box.x + box.w - AVATAR_SIZE,
      y: box.y,
      w: AVATAR_SIZE,
      h: AVATAR_SIZE,
    }
    : null;

  const bubbleX = opts.side === 'left'
    ? box.x + avatarSlot
    : box.x + box.w - avatarSlot - bubbleW;

  const bubble: Rect = { x: bubbleX, y: box.y, w: bubbleW, h: bubbleH };
  const text: Rect = {
    x: bubble.x + PAD_X,
    y: bubble.y + PAD_Y,
    w: bubbleTextWidth(bubbleW),
    h: Math.max(0, bubbleH - PAD_Y * 2),
  };
  return { side: opts.side, avatar, bubble, text };
};

/**
 * 一项占多高（含上下内边距）。
 *
 * **不注入 measure**：两期都走 `wrapText` 的默认估算。用真 `measureText` 折行会让布局期折 2 行、
 * 绘制期折 3 行 → 高度按 2 行算、文字画 3 行 → 压住下一条。真实字宽偏差由绘制期
 * `TextStyle.maxWidth`（透传 `fillText` 第四参）横向压缩兜住。
 */
export const bubbleHeight = (item: ChatMessage, boxW: number, opts: BubbleOptions): number => {
  const parts = bubbleParts({ x: 0, y: 0, w: boxW, h: 0 }, opts);
  const lines = wrapText(item.text, parts.text.w, { size: opts.fontSize });
  const count = Math.max(1, lines.length);
  return count * bubbleLineHeight(opts.fontSize) + PAD_Y * 2;
};

/** 一行小字的高度（非法项占位、「格式错误」提示用）。 */
export const singleLineHeight = (fontSize: number): number => bubbleLineHeight(fontSize) + PAD_Y * 2;

/** 单侧直角、其余圆角的气泡底（靠头像那一侧是直边）。 */
const bubblePath = (ctx: Ctx2D, rect: Rect, radius: number, side: 'left' | 'right'): void => {
  const r = Math.max(0, Math.min(radius, Math.min(rect.w, rect.h) / 2));
  const x = rect.x;
  const y = rect.y;
  const w = rect.w;
  const h = rect.h;
  ctx.beginPath();
  if (side === 'left') {
    // 左侧贴头像 → 左边两角直角
    ctx.moveTo(x, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x, y + h);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
  }
  ctx.closePath();
};

/** 画一项（头像 + 气泡 + 文字 + 状态）。`chatList` 内部也直接调它。 */
export const drawBubble = (
  ctx: Ctx2D,
  item: ChatMessage,
  box: Rect,
  opts: BubbleOptions,
  deps: DrawDeps,
): void => {
  const parts = bubbleParts(box, opts);
  const font = opts.fontSize;
  const lh = bubbleLineHeight(font);

  // 头像：有素材画图，没有就用主题色画占位圆（不崩、不留白）
  if (parts.avatar !== null) {
    const asset = item.avatar === undefined ? null : deps.assets.get(item.avatar);
    if (asset !== null) {
      ctx.drawImage(asset.native as CanvasImageSource, asset.sx, asset.sy, asset.sw, asset.sh,
        parts.avatar.x, parts.avatar.y, parts.avatar.w, parts.avatar.h);
    } else {
      const cx = parts.avatar.x + parts.avatar.w / 2;
      const cy = parts.avatar.y + parts.avatar.h / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, parts.avatar.w / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = deps.theme.panel;
      ctx.fill();
      if (item.name !== undefined && item.name.length > 0) {
        ctx.fillStyle = deps.theme.disabled;
        ctx.font = `13px ${deps.theme.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.name.slice(0, 1), cx, cy);
      }
    }
  }

  // 气泡底
  const sending = item.state === 'sending';
  ctx.save();
  if (sending) ctx.globalAlpha = 0.6;
  bubblePath(ctx, parts.bubble, BUBBLE_RADIUS, parts.side);
  ctx.fillStyle = deps.theme.panel;
  ctx.fill();
  ctx.restore();

  // 失败：左缘 3px 竖条（气泡底色不改）
  if (item.state === 'failed') {
    const barX = parts.side === 'left' ? parts.bubble.x : parts.bubble.x + parts.bubble.w - 3;
    fillRoundRect(ctx, { x: barX, y: parts.bubble.y + 2, w: 3, h: Math.max(0, parts.bubble.h - 4) }, 1.5, FAIL_COLOR);
  }

  // 文字：折行 + 每行 maxWidth（同一份 bubbleTextW，不重测）
  const lines = wrapText(item.text, parts.text.w, { size: font });
  ctx.save();
  if (sending) ctx.globalAlpha = 0.6;
  ctx.fillStyle = deps.theme.light;
  ctx.font = `${font}px ${deps.theme.fontFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    ctx.fillText(line, parts.text.x, parts.text.y + i * lh, parts.text.w);
  }
  ctx.restore();

  // 昵称（对方才显示，画在气泡上方；空间不够就不画，不挤占气泡）
  if (item.name !== undefined && item.name.length > 0 && parts.side === 'left' && box.y >= 12) {
    ctx.fillStyle = deps.theme.disabled;
    ctx.font = `12px ${deps.theme.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(item.name, parts.bubble.x, box.y - 2, parts.bubble.w);
  }
};

// ---------------------------------------------------------------------------
// 组件：单放一句台词
// ---------------------------------------------------------------------------

export const chatBubble: DefinedComponent = defineComponent('chatBubble', {
  props: {
    text: 'string',
    name: 'string',
    avatar: 'string',
    side: 'left|right',
    fontSize: 'number',
    bubbleRatio: 'number',
    showAvatar: 'boolean',
    state: 'sent|sending|failed',
  },
  defaultSize: { w: 240, h: 40 },
  measure: (_env, box, props) => {
    const fontSize = numberProp(props, 'fontSize', DEFAULT_FONT);
    const opts: BubbleOptions = {
      side: stringProp(props, 'side', 'left') === 'right' ? 'right' : 'left',
      fontSize,
      showAvatar: boolProp(props, 'showAvatar', true),
      bubbleRatio: numberProp(props, 'bubbleRatio', DEFAULT_RATIO),
    };
    const item: ChatMessage = {
      id: 'preview',
      who: 'other',
      text: stringProp(props, 'text', ''),
      at: 0,
    };
    return { w: Math.max(0, box.w), h: bubbleHeight(item, box.w, opts) };
  },
  draw: (ctx, box, props, deps) => {
    const fontSize = numberProp(props, 'fontSize', DEFAULT_FONT);
    const opts: BubbleOptions = {
      side: stringProp(props, 'side', 'left') === 'right' ? 'right' : 'left',
      fontSize,
      showAvatar: boolProp(props, 'showAvatar', true),
      bubbleRatio: numberProp(props, 'bubbleRatio', DEFAULT_RATIO),
    };
    const stateRaw = stringProp(props, 'state', 'sent');
    const state = stateRaw === 'sending' || stateRaw === 'failed' ? stateRaw : 'sent';
    const name = stringProp(props, 'name', '');
    const avatar = stringProp(props, 'avatar', '');
    const item: ChatMessage = {
      id: 'preview',
      who: 'other',
      text: stringProp(props, 'text', ''),
      at: 0,
      ...(name.length > 0 ? { name } : {}),
      ...(avatar.length > 0 ? { avatar } : {}),
      ...(state === 'sent' ? {} : { state }),
    };
    drawBubble(ctx, item, box, opts, deps);
  },
  assert: (box, props) => {
    const issues: string[] = [];
    const fontSize = numberProp(props, 'fontSize', DEFAULT_FONT);
    if (!(fontSize > 0)) issues.push(`fontSize 必须大于 0，收到 ${fontSize}`);
    if (!(box.w > 0)) issues.push(`chatBubble 的宽度必须大于 0，收到 ${box.w}`);
    const fit = checkBubbleFit(box, {
      side: stringProp(props, 'side', 'left') === 'right' ? 'right' : 'left',
      fontSize,
      showAvatar: boolProp(props, 'showAvatar', true),
      bubbleRatio: numberProp(props, 'bubbleRatio', DEFAULT_RATIO),
    });
    if (fit !== null) issues.push(fit);
    return issues;
  },
});
