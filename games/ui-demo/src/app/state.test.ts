import { expect, it } from 'vitest';
import { IDLE_PRESS } from './deps';
import { ITEMS } from './inventory';
import { ACTION_OF, gradeOf, INITIAL_STATE, reduce, TARGET, TIP_FRAMES } from './state';
import type { DemoState } from './state';

/** 造状态：只写关心的字段，其余取初始值（避免每个用例抄 5 个字段）。 */
const stateAt = (patch: Partial<DemoState>): DemoState => ({ ...INITIAL_STATE, ...patch });

it('初始状态：主菜单、0 命中、无按压/滚动/选中', () => {
  expect(INITIAL_STATE.screen).toBe('menu');
  expect(INITIAL_STATE.hits).toBe(0);
  expect(INITIAL_STATE.press).toEqual(IDLE_PRESS);
  expect(INITIAL_STATE.scrolls).toEqual({});
  expect(INITIAL_STATE.selected).toBeNull();
});

it('start：只有 menu 能进 play，重复 start 无效', () => {
  expect(reduce(INITIAL_STATE, { kind: 'start' })).toMatchObject({ screen: 'play', hits: 0 });
  expect(reduce(stateAt({ screen: 'play', hits: 1 }), { kind: 'start' })).toMatchObject({ screen: 'play', hits: 1 });
  expect(reduce(stateAt({ screen: 'result', hits: 3 }), { kind: 'start' })).toMatchObject({ screen: 'result', hits: 3 });
});

it('hit：play 时累计，满 TARGET 进结算；其他界面无效', () => {
  expect(reduce(stateAt({ screen: 'play', hits: 0 }), { kind: 'hit' })).toMatchObject({ screen: 'play', hits: 1 });
  expect(reduce(stateAt({ screen: 'play', hits: 1 }), { kind: 'hit' })).toMatchObject({ screen: 'play', hits: 2 });
  expect(reduce(stateAt({ screen: 'play', hits: 2 }), { kind: 'hit' })).toMatchObject({ screen: 'result', hits: TARGET });
  // 结算后再 hit 不动（防止连点穿透）
  expect(reduce(stateAt({ screen: 'result', hits: 3 }), { kind: 'hit' })).toMatchObject({ screen: 'result', hits: 3 });
  expect(reduce(INITIAL_STATE, { kind: 'hit' })).toEqual(INITIAL_STATE);
});

it('giveUp：只有 play 生效，回菜单且清零', () => {
  expect(reduce(stateAt({ screen: 'play', hits: 2 }), { kind: 'giveUp' })).toMatchObject({ screen: 'menu', hits: 0 });
  expect(reduce(INITIAL_STATE, { kind: 'giveUp' })).toEqual(INITIAL_STATE);
  expect(reduce(stateAt({ screen: 'result', hits: 3 }), { kind: 'giveUp' })).toMatchObject({ screen: 'result', hits: 3 });
});

it('restart：只有 result 生效，回菜单', () => {
  expect(reduce(stateAt({ screen: 'result', hits: 3 }), { kind: 'restart' })).toMatchObject({ screen: 'menu', hits: 0 });
  expect(reduce(stateAt({ screen: 'play', hits: 1 }), { kind: 'restart' })).toMatchObject({ screen: 'play', hits: 1 });
});

it('浮层：openPopup 只设 modal，screen 保持 menu；关闭只清 modal', () => {
  const opened = reduce(INITIAL_STATE, { kind: 'openPopup' });
  expect(opened).toMatchObject({ screen: 'menu', modal: 'popup', hits: 0 });
  expect(reduce(opened, { kind: 'closePopup' })).toMatchObject({ screen: 'menu', modal: null });
  // 关错浮层无效；没开浮层时关也是空操作
  expect(reduce(opened, { kind: 'closeSheet' })).toBe(opened);
  expect(reduce(INITIAL_STATE, { kind: 'closePopup' })).toEqual(INITIAL_STATE);
  // 不做叠层：已经开着浮层时再开无效
  expect(reduce(opened, { kind: 'openSheet' })).toBe(opened);
});

it('浮层：openSheet / openHalf 同样只设 modal，可从任意底层界面叠加', () => {
  expect(reduce(INITIAL_STATE, { kind: 'openSheet' })).toMatchObject({ screen: 'menu', modal: 'sheet' });
  expect(reduce(stateAt({ screen: 'play', hits: 2 }), { kind: 'openSheet' })).toMatchObject({
    screen: 'play',
    modal: 'sheet',
  });
  expect(reduce(stateAt({ screen: 'gallery' }), { kind: 'openSheet' })).toMatchObject({
    screen: 'gallery',
    modal: 'sheet',
  });
  const half = reduce(INITIAL_STATE, { kind: 'openHalf' });
  expect(half).toMatchObject({ screen: 'menu', modal: 'half' });
  expect(reduce(half, { kind: 'closeHalf' })).toMatchObject({ screen: 'menu', modal: null });
  expect(reduce(INITIAL_STATE, { kind: 'closeHalf' })).toEqual(INITIAL_STATE);
});

it('T42 核心：打开 / 关闭浮层不清底层状态（screen / scrolls / selected / hits 全保留）', () => {
  const base = stateAt({ screen: 'gallery', hits: 2, scrolls: { list: 300 }, selected: 4 });
  const opened = reduce(base, { kind: 'openSheet' });
  expect(opened.screen).toBe('gallery');
  expect(opened.modal).toBe('sheet');
  expect(opened.scrolls).toEqual({ list: 300 });
  expect(opened.selected).toBe(4);
  expect(opened.hits).toBe(2);
  // 关闭后底层继续原样（滚动位不被 goTo 清掉）
  expect(reduce(opened, { kind: 'closeSheet' })).toMatchObject({
    screen: 'gallery',
    modal: null,
    scrolls: { list: 300 },
    selected: 4,
  });
});

it('openTip / tick：tip 倒计时结束只清 modal，底层 screen 一直是 menu', () => {
  const opened = reduce(INITIAL_STATE, { kind: 'openTip' });
  expect(opened).toMatchObject({ screen: 'menu', modal: 'tip', tipFrames: TIP_FRAMES });
  let state = opened;
  for (let i = 0; i < TIP_FRAMES - 1; i += 1) state = reduce(state, { kind: 'tick' });
  expect(state.modal, '第 59 帧还不该消失').toBe('tip');
  state = reduce(state, { kind: 'tick' });
  expect(state).toMatchObject({ screen: 'menu', modal: null, tipFrames: 0 });
  // 非 tip 浮层 tick 是空操作；没有浮层更不动
  const sheet = reduce(INITIAL_STATE, { kind: 'openSheet' });
  expect(reduce(sheet, { kind: 'tick' })).toBe(sheet);
  expect(reduce(INITIAL_STATE, { kind: 'tick' })).toBe(INITIAL_STATE);
});

it('openInventory / backToMenu：menu ⇄ inventory，其他界面无效', () => {
  expect(reduce(INITIAL_STATE, { kind: 'openInventory' })).toMatchObject({ screen: 'inventory', hits: 0 });
  expect(reduce(stateAt({ screen: 'inventory' }), { kind: 'backToMenu' })).toMatchObject({ screen: 'menu', hits: 0 });
  // play 上不能打开背包；浮层开着时底层也不响应（遮罩本来就点不到）
  expect(reduce(stateAt({ screen: 'play' }), { kind: 'openInventory' })).toMatchObject({ screen: 'play' });
  expect(reduce(stateAt({ screen: 'menu', modal: 'popup' }), { kind: 'openInventory' })).toMatchObject({
    screen: 'menu',
    modal: 'popup',
  });
  expect(reduce(INITIAL_STATE, { kind: 'backToMenu' })).toEqual(INITIAL_STATE);
});

it('openGallery / backToMenu：menu ⇄ gallery，其他界面无效', () => {
  expect(reduce(INITIAL_STATE, { kind: 'openGallery' })).toMatchObject({ screen: 'gallery', hits: 0 });
  expect(reduce(stateAt({ screen: 'gallery' }), { kind: 'backToMenu' })).toMatchObject({ screen: 'menu', hits: 0 });
  // 只有 menu 能进 gallery（背包 / play 上无效）
  expect(reduce(stateAt({ screen: 'inventory' }), { kind: 'openGallery' })).toMatchObject({ screen: 'inventory' });
  expect(reduce(stateAt({ screen: 'play' }), { kind: 'openGallery' })).toMatchObject({ screen: 'play' });
});

it('切换界面会清空交互状态（按压 / 滚动 / 选中都不跨屏残留）', () => {
  const dirty = stateAt({
    screen: 'inventory',
    press: { pressed: 'button', pointerId: 1 },
    scrolls: { list: 200 },
    selected: 3,
  });
  const back = reduce(dirty, { kind: 'backToMenu' });
  expect(back.press).toEqual(IDLE_PRESS);
  expect(back.scrolls).toEqual({});
  expect(back.selected).toBeNull();
  // openInventory 同理：进来是干净的
  const opened = reduce(INITIAL_STATE, { kind: 'openInventory' });
  expect(opened.press).toEqual(IDLE_PRESS);
  expect(opened.scrolls).toEqual({});
  expect(opened.selected).toBeNull();
});

it('press：任意界面都能更新按压态（事件可能比界面切换早到）', () => {
  const pressed = { pressed: 'button', pointerId: 7 };
  expect(reduce(INITIAL_STATE, { kind: 'press', state: pressed }).press).toEqual(pressed);
  expect(reduce(stateAt({ screen: 'play' }), { kind: 'press', state: pressed }).press).toEqual(pressed);
  expect(reduce(stateAt({ screen: 'menu' }), { kind: 'press', state: IDLE_PRESS }).press).toEqual(IDLE_PRESS);
});

it('scrollTo：按容器名各写各的滚动位，脏值（NaN / 负数）一律忽略', () => {
  const scrolled = reduce(stateAt({ screen: 'nest' }), { kind: 'scrollTo', name: 'list', offset: 200 });
  expect(scrolled.scrolls).toEqual({ list: 200 });
  // 内层滚了不影响外层：两个键互相独立（嵌套用例的数据基础）
  const both = reduce(scrolled, { kind: 'scrollTo', name: 'scroll', offset: 120 });
  expect(both.scrolls).toEqual({ list: 200, scroll: 120 });
  // 脏值：状态原样返回（不写 NaN / 负数进渲染链）
  const clean = stateAt({ screen: 'nest' });
  expect(reduce(clean, { kind: 'scrollTo', name: 'list', offset: Number.NaN })).toBe(clean);
  expect(reduce(clean, { kind: 'scrollTo', name: 'list', offset: -1 })).toBe(clean);
});

it('select：只有 inventory 能选，下标非法一律忽略', () => {
  expect(reduce(stateAt({ screen: 'inventory' }), { kind: 'select', index: 2 }).selected).toBe(2);
  expect(reduce(stateAt({ screen: 'inventory' }), { kind: 'select', index: 0 }).selected).toBe(0);
  // 越界 / 负数 / NaN / 非 inventory：原样返回
  expect(reduce(stateAt({ screen: 'inventory' }), { kind: 'select', index: ITEMS.length })).toEqual(
    stateAt({ screen: 'inventory' }),
  );
  expect(reduce(stateAt({ screen: 'inventory' }), { kind: 'select', index: -1 })).toEqual(stateAt({ screen: 'inventory' }));
  expect(reduce(stateAt({ screen: 'inventory' }), { kind: 'select', index: Number.NaN })).toEqual(
    stateAt({ screen: 'inventory' }),
  );
  expect(reduce(stateAt({ screen: 'menu' }), { kind: 'select', index: 2 })).toEqual(stateAt({ screen: 'menu' }));
});

it('reduce 是纯函数：不修改入参', () => {
  const before = stateAt({ screen: 'play', hits: 1 });
  const copy = { ...before };
  reduce(before, { kind: 'hit' });
  expect(before).toEqual(copy);
});

it('gradeOf：满命中是完美', () => {
  expect(gradeOf(TARGET)).toBe('完美');
  expect(gradeOf(2)).toBe('不错');
  expect(gradeOf(0)).toBe('再练练');
});

it('ACTION_OF：每个界面的可点组件都指向合法动作（含 popup 底层按钮的陷阱）', () => {
  expect(ACTION_OF.menu).toEqual({
    button: { kind: 'start' },
    primaryButton: { kind: 'openInventory' },
    secondaryButton: { kind: 'openPopup' },
    card0: { kind: 'openGallery' },
    card1: { kind: 'openSheet' },
    infoPanel: { kind: 'openHalf' },
    // T35：提示入口（toast 画成提示条，点它进 tip 屏）
    toast: { kind: 'openTip' },
    // T35：网格背包入口
    parcelGrid: { kind: 'openBag' },
    // T38：嵌套滚动入口（菜单右上角的小条）
    coinBadge: { kind: 'openNest' },
  });
  expect(ACTION_OF.play).toEqual({ tapTarget: { kind: 'hit' }, secondaryButton: { kind: 'giveUp' } });
  expect(ACTION_OF.result).toEqual({ primaryButton: { kind: 'restart' } });
  // 浮层：只有面板里的按钮能关；遮罩只 hit block（T42：点遮罩不关，靠这条证明没穿透）
  expect(ACTION_OF.popup).toEqual({ primaryButton: { kind: 'closePopup' } });
  expect(ACTION_OF.sheet).toEqual({ primaryButton: { kind: 'closeSheet' } });
  expect(ACTION_OF.half).toEqual({ primaryButton: { kind: 'closeHalf' } });
  // 背包：返回按钮；列表项点击不走 ACTION_OF（几何换算后发 select）
  expect(ACTION_OF.inventory).toEqual({ button: { kind: 'backToMenu' } });
  // 组件总览：返回 + 弹窗入口（T42 验收第 3 条要在 gallery 里开/关浮层）
  expect(ACTION_OF.gallery).toEqual({ button: { kind: 'backToMenu' }, secondaryButton: { kind: 'openSheet' } });
  // 网格背包：返回按钮；格子点击走 gridIndexAt 后发 select（不进 ACTION_OF）
  expect(ACTION_OF.bag).toEqual({ button: { kind: 'closeBag' } });
  // 嵌套滚动：只有返回按钮（滚动走滚轮/拖动，不是点击动作）
  expect(ACTION_OF.nest).toEqual({ button: { kind: 'backToMenu' } });
  // 任意位置提示：纯展示界面，倒计时结束自己回菜单
  expect(ACTION_OF.tip).toEqual({});
});
