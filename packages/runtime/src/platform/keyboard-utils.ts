/**
 * 软键盘参数的归一（三端共用）。
 *
 * 为什么单独一个文件：`maxLength: 0 / 负数 / NaN` 与 `confirmType: '瞎写'`
 * 这三端都要判一遍。复制三份的结果一定是「微信端用 0 表示不限制、web 端用 0 表示
 * 一个字符都不许输」——同一个值两种语义，比不归一更糟。
 *
 * 口径（钉死）：
 * - `maxLength >= 0` 用原值（0 = 一个字符都不许输），否则**不限制**（-1）；
 * - `confirmType` 不在四个合法值里 → `'done'`；
 * - `defaultValue` 不是字符串 → 空串。
 */

import type { KeyboardOptions } from './contract';

/** 合法确认键类型。 */
export type ConfirmType = 'done' | 'next' | 'search' | 'send';

const CONFIRM_TYPES: readonly ConfirmType[] = ['done', 'next', 'search', 'send'];

/** 不限制长度（与 HTMLInputElement.maxLength 的约定一致）。 */
export const NO_MAX_LENGTH = -1;

export const normalizeMaxLength = (raw: number | undefined): number =>
  typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : NO_MAX_LENGTH;

export const normalizeConfirmType = (raw: unknown): ConfirmType =>
  typeof raw === 'string' && (CONFIRM_TYPES as readonly string[]).includes(raw)
    ? (raw as ConfirmType)
    : 'done';

export const normalizeDefaultValue = (raw: unknown): string => (typeof raw === 'string' ? raw : '');

/** 归一后的参数包（三端 open() 都从这里取，谁也不许自己再判一遍）。 */
export interface NormalizedKeyboardOptions {
  readonly defaultValue: string;
  readonly maxLength: number;
  readonly confirmType: ConfirmType;
}

export const normalizeKeyboardOptions = (opts?: KeyboardOptions): NormalizedKeyboardOptions => ({
  defaultValue: normalizeDefaultValue(opts?.defaultValue),
  maxLength: normalizeMaxLength(opts?.maxLength),
  confirmType: normalizeConfirmType(opts?.confirmType),
});
