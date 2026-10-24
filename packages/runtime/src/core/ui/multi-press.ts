/**
 * 多点按压状态机（T48）：游戏虚拟按键的「同时按住」语义。
 *
 * 为什么要有这一层：`press.ts`（T17）是 **UI 按钮**语义 —— 一次只认一个指针，
 * 第二个手指按下会被忽略。这条规则对「点一下按钮」是对的（防双指误触），
 * 但对**游戏虚拟按键**是错的：按住 `←` 的同时按 `↑` 是正常操作，第一根手指
 * 不能被第二根打断。用户真机反馈「platformer 按住左移再按跳，左移被打断」，
 * 根因就是 `press.ts` 的这条单指针独占规则。
 *
 * 什么时候用哪个（两条语义并列，互不改动）：
 * - **UI 按钮**（菜单 / 确认框 / 结算页按钮，一次只该按一个）→ `press.ts`：
 *   单指针独占，第二个 `down` 一律忽略，`up` 必须 id 匹配；
 * - **游戏虚拟按键 / 需要同时按住的 HUD 控件** → 本模块：每个 `pointerId`
 *   独立绑定，互不打断，同一元素可被多根手指按住（元素名去重）。
 *
 * 规则（写死，单测逐条锁住）：
 * - 只有 `hit === 'self'` 的元素能被绑定；`block`（遮罩）吃掉这次按下但**不产生绑定**，
 *   `none` 由 `pickHit` 跳过、穿透到下面的元素（与 `press.ts` 同一套命中语义）；
 * - 每个 `pointerId` 最多绑定一个元素；不同 `pointerId` 互不影响（核心差异）；
 * - `multiMove` 移出原元素**只解绑这一个 pointer**，其他 pointer 原样保留；
 *   移出后再移回不恢复（标准按钮手感，与 `press.ts` 一致）；
 * - 同一 `pointerId` 重复 `down` 是幂等空操作，不产生重复绑定；
 * - `multiUp` 无论是否激活都会解绑该 pointer；「激活」= 松手点最上层仍是按下时的元素；
 * - 任何坏输入（空表 / NaN 坐标 / NaN pointerId / 元素从布局里消失）都不崩：
 *   要么原样返回，要么只解绑出问题的那个 pointer。
 *
 * 纯函数：不碰 canvas、不改入参、无全局状态。状态是 `ReadonlyMap<pointerId, 元素名>`。
 */

import type { HitEntry, HitPoint } from './hit';
import { pickHit } from './hit';

/**
 * 多点按压状态：`pointerId → 元素名`。
 *
 * 同一元素可以被多个 pointerId 同时按住（合法的双指同按），查询「元素是否被按着」
 * 用 `isPressed` / `pressedNames`（按元素名去重），不要直接看 map 条数。
 */
export type MultiPressState = ReadonlyMap<number, string>;

/** 空闲状态（没有任何 pointer 按着东西）。约定：调用方不得修改这个 Map。 */
export const EMPTY_MULTI_PRESS: MultiPressState = new Map();

/** 坐标可用（有限数）；NaN / Infinity 一律当成坏输入。 */
const finitePoint = (point: HitPoint): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

/** pointerId 可用（有限数）；NaN / Infinity 当成坏输入，`0` 是合法 id。 */
const validPointer = (pointerId: number): boolean => Number.isFinite(pointerId);

/** 该 pointer 当前绑定的元素名；未绑定或 pointerId 非法时返回 undefined。 */
const boundOf = (state: MultiPressState, pointerId: number): string | undefined =>
  validPointer(pointerId) ? state.get(pointerId) : undefined;

/** 解绑一个 pointer（复制后再删，不改入参）。 */
const without = (state: MultiPressState, pointerId: number): MultiPressState => {
  const next = new Map(state);
  next.delete(pointerId);
  return next;
};

/** 绑定一个 pointer（复制后再写，不改入参）。 */
const bind = (state: MultiPressState, pointerId: number, name: string): MultiPressState => {
  const next = new Map(state);
  next.set(pointerId, name);
  return next;
};

/**
 * 落点最上层是否仍是 `name`，且它自己接点击。
 *
 * 用 `pickHit` 而不是「查原矩形」：指针滑到盖在上面的遮罩 / 另一个元素上时，
 * 已经不算「还在按这个元素」了；用原矩形判会漏掉浮层挡住的场景。
 */
const stillOn = (entries: readonly HitEntry[], point: HitPoint, name: string): boolean => {
  if (!finitePoint(point)) return false;
  const hit = pickHit(entries, point);
  return hit !== null && hit.hit === 'self' && hit.name === name;
};

/**
 * 按下：该 `pointerId` 绑定落点上最上层的 `self` 元素，返回新状态。
 *
 * - 同一 `pointerId` 已绑定过 → 原样返回（幂等，不产生重复绑定、不改绑）；
 * - 落在 `block` 遮罩 / 空白处 / `none` 穿透后无元素处 → 不产生绑定；
 * - 坏坐标 / 坏 pointerId → 原样返回（不产生半截状态）。
 *
 * 其他 pointer 的绑定一律原样保留 —— 这正是「按住 A 再按 B，A 不被打断」。
 */
export const multiDown = (
  state: MultiPressState,
  entries: readonly HitEntry[],
  point: HitPoint,
  pointerId: number,
): MultiPressState => {
  if (!validPointer(pointerId)) return state;
  if (state.has(pointerId)) return state;
  if (!finitePoint(point)) return state;
  const hit = pickHit(entries, point);
  // block：吃掉这次按下但没有动作，不产生绑定；none：pickHit 已跳过
  if (hit === null || hit.hit !== 'self') return state;
  return bind(state, pointerId, hit.name);
};

/**
 * 移动：移出原元素就解绑**这一个** pointer，其他 pointer 原样保留。
 *
 * - 未绑定的 pointer / 坏 pointerId → 原样返回（别人的 move 动不了我的绑定）；
 * - 坏坐标 → 只解绑该 pointer（指针状态不明，宁可按取消，别留半截状态）；
 * - 已绑定的 pointer 在元素内移动 → 原样返回。
 */
export const multiMove = (
  state: MultiPressState,
  entries: readonly HitEntry[],
  point: HitPoint,
  pointerId: number,
): MultiPressState => {
  const name = boundOf(state, pointerId);
  if (name === undefined) return state;
  if (!finitePoint(point)) return without(state, pointerId);
  return stillOn(entries, point, name) ? state : without(state, pointerId);
};

/**
 * 松开：解绑该 pointer，并返回「松手点是否仍在按下时那个元素」。
 *
 * - 激活 = 松手点最上层仍是按下时绑定的元素（空白 / 遮罩 / 别的元素上都不算）；
 * - 不管是否激活，本次 `up` 都会解绑该 pointer；其他 pointer 不受影响；
 * - 坏 pointerId / 未绑定的 pointer → 状态原样返回、`activated=null`；
 * - 绑定的元素从布局里消失 → 安全解绑、不激活（元素已不存在，不可能算按中）。
 */
export const multiUp = (
  state: MultiPressState,
  entries: readonly HitEntry[],
  point: HitPoint,
  pointerId: number,
): { readonly state: MultiPressState; readonly activated: string | null } => {
  const name = boundOf(state, pointerId);
  if (name === undefined) return { state, activated: null };
  const activated = stillOn(entries, point, name) ? name : null;
  return { state: without(state, pointerId), activated };
};

/**
 * 当前所有被按着的元素名，**按元素去重**、按 pointer 绑定先后排序。
 *
 * 同一元素被两根手指同时按住也只出现一次 —— 游戏里 `←` 的「按住」判定
 * 应该用 `isPressed(state, 'leftButton')`，不要拿 map 条数当按钮数。
 */
export const pressedNames = (state: MultiPressState): readonly string[] => {
  const names: string[] = [];
  for (const name of state.values()) {
    if (!names.includes(name)) names.push(name);
  }
  return names;
};

/** 某个元素当前是否被任意 pointer 按着。 */
export const isPressed = (state: MultiPressState, name: string): boolean => {
  for (const bound of state.values()) {
    if (bound === name) return true;
  }
  return false;
};
