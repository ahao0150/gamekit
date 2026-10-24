/**
 * 组件读游戏数据的小工具（T19）。
 *
 * `tabs` / `segmented` / `keypad` 都是「数据驱动」的容器：值只能是 string/number/boolean
 * （`StyleProps`），装不了数组，所以标签文字 / 键位从 `DrawDeps.data` 拿。
 * 三个组件都要「取数组 + 过滤掉非字符串」，收一处避免三份各写一遍、口径漂移。
 */

import type { UiData } from '../components';

/** 读一个字符串数组；缺失 / 不是数组 / 元素不是字符串 → 跳过（不崩）。 */
export const readStringList = (data: UiData | undefined, key: string): readonly string[] => {
  const raw: unknown = data?.[key];
  if (!Array.isArray(raw)) return [];
  return (raw as readonly unknown[]).filter((item): item is string => typeof item === 'string');
};

/** 读一个任意数组（列表 / 轮播的页面数据）；缺失 / 不是数组 → 空数组。 */
export const readList = (data: UiData | undefined, key: string): readonly unknown[] => {
  const raw: unknown = data?.[key];
  return Array.isArray(raw) ? (raw as readonly unknown[]) : [];
};

/**
 * 读一个「下标」型 props：越界或非法一律回落 0。
 *
 * 口径统一为「越界 → 0」（而不是钳到最后一个）：下标来自游戏状态，越界说明状态坏了，
 * 回到第一个是安全的默认；静默钳到末尾会把「状态 bug」伪装成「正常选中了最后一项」。
 */
export const readIndex = (props: Readonly<Record<string, unknown>>, key: string, count: number): number => {
  const raw = props[key];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  const index = Math.floor(raw);
  return index >= 0 && index < count ? index : 0;
};
