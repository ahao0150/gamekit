/**
 * UI 数据通道：布局期 `MeasureEnv.data` 与绘制期 `DrawDeps.data` 必须同源。
 *
 * 历史坑：只喂布局期 → 「状态全对、画面全空」。本模块提供合并 + 漏传报错，
 * 推荐模板把 data 挂在 `ScreenLayout.data` 上，绘制直接读这一份（单通道）。
 */

import type { UiData } from './components';

export interface ResolvedUiData {
  /** 合并后的数据（draw 覆盖 measure 同名键） */
  readonly data: UiData;
  /** 中文问题；空数组表示两边一致或都为空 */
  readonly errors: readonly string[];
}

/**
 * 合并布局期 / 绘制期 data；漏传或缺键时写入 errors（不抛错，一次看全）。
 *
 * - 绘制期未传且布局期非空 → 报漏传
 * - 两边都有但布局期的键绘制期没有 → 报缺键
 * - 都空或绘制期覆盖齐全 → 无错误
 */
export const resolveUiData = (measureData: UiData, drawData: UiData | undefined): ResolvedUiData => {
  const measureKeys = Object.keys(measureData);
  if (drawData === undefined) {
    if (measureKeys.length === 0) return { data: measureData, errors: [] };
    return {
      data: measureData,
      errors: [
        '绘制期未传入 data，但布局期有数据。数据组件会「状态对、画面空」——请把同一份 data 交给 DrawDeps.data，或只用 ScreenLayout.data 单通道',
      ],
    };
  }
  const missing = measureKeys.filter((key) => !(key in drawData));
  const errors =
    missing.length === 0
      ? []
      : [
          `绘制期 data 缺少布局期已有的键：${missing.join(' / ')}。两边必须同源，否则量出来的框和画出来的对不上`,
        ];
  return { data: { ...measureData, ...drawData }, errors };
};
