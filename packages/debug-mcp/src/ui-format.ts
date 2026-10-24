/**
 * 数字格式化：ASCII 预览与问题文案共用，避免出现 `167.60000000000002`。
 *
 * 单独成文件是为了打断 `ui-preview` ↔ `ui-issues` 的循环导入
 * （两边都要数字格式化，但预览要问题类型、问题清单要格式化）。
 */

/** 最多 1 位小数，整数不带 `.0`；非有限值当 0。 */
export const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};
