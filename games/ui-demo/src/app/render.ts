/**
 * 绘制：纯色背景 + 按 `layout()` 给出的 `paintOrder` 正序逐个组件 `draw()`。
 *
 * 顺序不再由渲染层自己排（以前是 `Object.keys(components)` 的声明序）：
 * `paintOrder` 由 `.ui` 的 `layer`（base → overlay）+ 同层声明序推出，
 * 命中层用同一份顺序的逆序，所以「谁画在上面」和「谁先接点击」永远一致。
 *
 * T13d 起绘制依赖里带**游戏数据**（`ScreenLayout.data`）：通用 `list` / `grid` 组件从
 * `DrawDeps.data` 读 `items`，每项的内容由这里注入的 `renderItem` 画 ——
 * 组件不 import 任何游戏代码（AGENTS §7），游戏也不重复实现列表/网格布局。
 *
 * T27：`gallery` 的每一行**绕过 `.ui` 节点**，直接从注册表取组件定义调
 * `def.draw(ctx, rect, props, deps)`。这是「组件 draw 能独立调用」的验证：
 * 某个组件如果偷偷依赖 `.ui` 节点给它的东西（比如必须经过 bind 注入 measure），
 * 这里就会露出来（画不出来 / 抛错）。
 *
 * 渲染层不判定任何东西：命中与状态迁移在 `game.ts`，布局矩形在 `layout.ts`。
 * 这里只读 `ScreenLayout`，没有素材时组件自己回落纯色（demo 不引美术）。
 */

import { DEFAULT_THEME, drawCenteredText, fillRect } from './deps';
import type {
  ComponentAssets,
  ComponentRegistry,
  Ctx2D,
  DrawDeps,
  ListRenderItem,
  Rect,
  ScrollRenderContent,
  StyleProps,
  UiData,
} from './deps';
import { GALLERY_ENTRIES } from './gallery';
import type { GalleryEntry } from './gallery';
import type { ScreenLayout } from './layout';

/** 背景色：深底浅字，组件主题色压得住。 */
const BG = '#11181c';

/**
 * demo 主题：在默认主题上把 `ink` 调亮。
 *
 * 默认主题的 ink 是深墨（压浅色底用），但这张 demo 是深色底 ——
 * 深墨文字（coinBadge 的数值）在 #11181c 上几乎看不见。主题本来就该由游戏注入，
 * 这里正是注入的地方。
 */
const DEMO_THEME = { ...DEFAULT_THEME, ink: '#c8d8dc' };

/** 导出给测试：逐项调 `draw` 时要用同一套主题（不然断言的颜色对不上）。 */
export { DEMO_THEME };

/** 空资产源：这张 demo 不引美术，所有组件走纯色回落。 */
export const EMPTY_ASSETS: ComponentAssets = { get: () => null };

/** gallery 一行里「组件区」的宽度占比（右边留给组件名）。 */
const GALLERY_LEFT = 0.58;
/** 组件名的左边界占比。 */
const GALLERY_NAME_X = 0.62;
/** 行内左右留白（逻辑像素）。 */
const ROW_PAD = 8;

/** 读选中下标（数据缺失 / 非法都当「没有选中」）。 */
const selectedIndexOf = (data: UiData): number | null => {
  const raw = data['selectedIndex'];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
};

/** 一件物品的显示文字：名字 + 数量（数据形状不对时退化成序号，不崩）。 */
const itemTextOf = (item: unknown, index: number): string => {
  if (typeof item !== 'object' || item === null) return `#${index + 1}`;
  const record = item as Record<string, unknown>;
  const name = typeof record['name'] === 'string' ? record['name'] : `#${index + 1}`;
  const count = typeof record['count'] === 'number' ? record['count'] : 0;
  return `${name}  ×${count}`;
};

/** 只取物品名（网格格子小，放不下「名字 + 数量」两段）。 */
const itemNameOf = (item: unknown, index: number): string => {
  if (typeof item !== 'object' || item === null) return `#${index + 1}`;
  const name = (item as Record<string, unknown>)['name'];
  return typeof name === 'string' ? name : `#${index + 1}`;
};

/**
 * 列表单项绘制：选中项先盖一层主色，再画文字。
 *
 * `list` 组件只画每项的底色 + 分割线，内容（文字 / 图标）必须由游戏注入 ——
 * 这就是「组件复用」与「游戏业务」的分界。
 */
const makeInventoryItem = (selected: number | null): ListRenderItem => (ctx, item, rect, index) => {
  if (index === selected) fillRect(ctx, rect, DEMO_THEME.primary);
  drawCenteredText(ctx, rect, itemTextOf(item, index), DEMO_THEME.light, DEMO_THEME.fontFamily);
};

/** 网格背包的格子内容（T35）：选中格盖主色，再居中画物品名。 */
const makeBagItem = (selected: number | null): ListRenderItem => (ctx, item, rect, index) => {
  if (index === selected) fillRect(ctx, rect, DEMO_THEME.primary);
  drawCenteredText(ctx, rect, itemNameOf(item, index), DEMO_THEME.light, DEMO_THEME.fontFamily);
};

/** 嵌套滚动外层容器的横带高（内容总高 = 10 × 120 = 1200，与 `.ui` 的 contentH 一致）。 */
const NEST_BAND_H = 120;
/** 横带条数。 */
const NEST_BANDS = 10;

/**
 * 嵌套滚动外层容器的内容（T38）。
 *
 * `scroll` 组件不知道内容有多少，只负责「裁剪 + 按 scrollTop 平移」，
 * 所以内容必须由游戏按**内容坐标系**画（`box` 是未平移的原始矩形）。
 * 横向交替色带 + 编号：滚轮滚动时截图里能直接看出位移。
 */
const makeNestContent = (): ScrollRenderContent => (ctx, box) => {
  for (let index = 0; index < NEST_BANDS; index += 1) {
    const band: Rect = { x: box.x, y: box.y + index * NEST_BAND_H, w: box.w, h: NEST_BAND_H - 4 };
    fillRect(ctx, band, index % 2 === 0 ? '#1d2a30' : '#22343b');
    drawCenteredText(ctx, band, `外层内容 ${index + 1}`, DEMO_THEME.light, DEMO_THEME.fontFamily);
  }
};

/** 外层内容回调只建一次（每帧重画时不需要新闭包）。 */
const NEST_CONTENT: ScrollRenderContent = makeNestContent();

/** 在可用区域里居中放一个 `size` 框；超出可用区域时钳到区域内。 */
export const centerBox = (area: Rect, size: { readonly w: number; readonly h: number }): Rect => {
  const w = Math.max(1, Math.min(size.w, area.w - ROW_PAD * 2));
  const h = Math.max(1, Math.min(size.h, area.h - 8));
  return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
};

/**
 * 给这一项准备绘制依赖：`entry.data` 存在时**整体替换** data 快照。
 *
 * 为什么要替换而不是合并：行内展示的 `list` 如果继承 gallery 的 `items`（21 项），
 * 就会把 gallery 的 renderItem 再调一遍 → 无限递归。每项自带数据也顺便演示了
 * 「数据驱动组件怎么在别处复用」。
 */
export const entryDrawDeps = (entry: GalleryEntry, deps: DrawDeps): DrawDeps => {
  if (entry.data === undefined) return deps;
  let data: UiData = entry.data;
  // list / carousel / grid 都从 data.renderItem 取内容回调（签名一致：ctx, item, rect, index）。
  // 给它们画字符串项的最小实现（**不经过 gallery 自己的 renderItem**，否则会递归）。
  const needsRenderItem =
    (Array.isArray(data['items']) || Array.isArray(data['pages'])) && typeof data['renderItem'] !== 'function';
  if (needsRenderItem) {
    data = {
      ...data,
      renderItem: (ctx: Ctx2D, item: unknown, rect: Rect) => {
        drawCenteredText(ctx, rect, typeof item === 'string' ? item : '', deps.theme.light, deps.theme.fontFamily);
      },
    };
  }
  return { ...deps, data };
};

/**
 * gallery 的一行：左边组件本体（独立调 `draw`）、右边组件名（用 `label` 组件画）。
 *
 * 导出给测试直接逐项调用 —— 「21 项都画了东西」要能逐项断言，而不是靠整体截图猜。
 */
export const createGalleryItemRenderer = (
  registry: ComponentRegistry,
  deps: DrawDeps,
): ListRenderItem => (ctx, item, rect) => {
  const entry = item as GalleryEntry;
  const name = typeof entry.name === 'string' ? entry.name : '';
  const def = name === '' ? null : registry.get(name);

  if (def !== null && entry.size !== undefined) {
    const box = centerBox(
      { x: rect.x, y: rect.y, w: rect.w * GALLERY_LEFT, h: rect.h },
      entry.size,
    );
    const props: StyleProps = entry.props ?? {};
    // save/restore：组件可能改 globalAlpha / transform / clip，别传染下一行
    ctx.save();
    def.draw(ctx, box, props, entryDrawDeps(entry, deps));
    ctx.restore();
  }

  // 组件名用 label 组件画（顺便验证 label 也能独立调 draw）
  const nameArea: Rect = {
    x: rect.x + rect.w * GALLERY_NAME_X,
    y: rect.y,
    w: rect.w * (1 - GALLERY_NAME_X) - ROW_PAD,
    h: rect.h,
  };
  const labelDef = registry.get('label');
  if (labelDef !== null) {
    labelDef.draw(ctx, nameArea, { text: name, fontSize: 13, align: 'left' }, deps);
  } else {
    drawCenteredText(ctx, nameArea, name, deps.theme.light, deps.theme.fontFamily);
  }
};

export interface Renderer {
  /**
   * 画一帧：先底层、再浮层。
   *
   * T42 起浮层是**叠加**而不是替换：`base` 永远完整画一遍，`modal` 非 null 时
   * 再画上去（半透明遮罩把它压暗，底层元素仍然可见、可辨认）。
   */
  draw(ctx: Ctx2D, base: ScreenLayout, modal?: ScreenLayout | null): void;
}

/**
 * 创建渲染器。
 *
 * `registry` 只有 gallery 需要（要按名字取组件定义独立调 draw）；其它界面传 null
 * 也能正常画。`game.ts` 传的是 `layoutEngine.registry` —— 与构建期同一份。
 */
export const createRenderer = (
  deps: DrawDeps = { assets: EMPTY_ASSETS, theme: DEMO_THEME },
  registry: ComponentRegistry | null = null,
): Renderer => {
  const galleryItem = registry === null ? null : createGalleryItemRenderer(registry, deps);

  /** 画一份布局（底层或浮层都用这一套，数据注入按界面决定）。 */
  const paint = (ctx: Ctx2D, view: ScreenLayout): void => {
    // 每帧把 renderItem / renderContent 挂进数据快照：容器组件从 deps.data 读它们
    const selected = selectedIndexOf(view.data);
    const renderItem =
      view.screen === 'gallery'
        ? galleryItem
        : view.screen === 'bag'
          ? makeBagItem(selected)
          : makeInventoryItem(selected);
    // 嵌套滚动：外层 scroll 的内容是游戏回调（横带），内层 list 用同一个 renderItem 画物品
    const extra: UiData = view.screen === 'nest' ? { renderContent: NEST_CONTENT } : {};
    const data: UiData =
      renderItem === null ? { ...view.data, ...extra } : { ...view.data, ...extra, renderItem };
    const drawDeps: DrawDeps = { ...deps, data };
    // paintOrder 正序：base 先、overlay 后，同层按声明序（后声明的盖在上面）
    for (const name of view.paintOrder) {
      const def = view.components[name];
      const rect = view.rects[name];
      if (def === undefined || rect === undefined) continue;
      def.draw(ctx, rect, view.props[name] ?? {}, drawDeps);
    }
  };

  return {
    draw(ctx, base, modal = null) {
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, base.viewport.width, base.viewport.height);
      paint(ctx, base);
      // 浮层最后画：它的遮罩是半透明的，底层刚画完的画面会透出来
      if (modal !== null) paint(ctx, modal);
    },
  };
};

/** gallery 的 21 项（渲染层与测试共用同一份清单）。 */
export { GALLERY_ENTRIES };
