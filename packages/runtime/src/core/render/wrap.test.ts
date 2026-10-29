/**
 * `wrapText` 的七条契约（逐条对应任务书 A.1–A.7）。
 *
 * 全部用 `estimateTextWidth` 作为 measure（CJK = 1 字宽、ASCII = 0.55 字宽），
 * 于是每行能放几个字是**可算出来的**，断言不用猜。
 */

import { describe, expect, it } from 'vitest';
import { estimateTextWidth } from '../ui/components';
import { measureItemHeights, wrapText } from './wrap';
import type { TextStyle } from './contract';

const FONT = 10;
const STYLE: TextStyle = { size: FONT };
/** 与默认测量同口径，显式传进来便于断言「每行宽度」 */
const measure = (text: string): number => estimateTextWidth(text, FONT);
/** 3 个汉字宽 */
const W = 30;

describe('wrapText', () => {
  it('A.1 measure 可注入（不传则用估算；传了就必须用传的那个）', () => {
    // 自定义「每字符 100px」：maxWidth 150 时每行只能放 1 个字符
    const wide = (text: string): number => [...text].length * 100;
    expect(wrapText('abc', 150, undefined, wide)).toEqual(['a', 'b', 'c']);
    // 同一文本用估算则一行放得下
    expect(wrapText('abc', 150, STYLE, measure)).toEqual(['abc']);
  });

  it('A.2 空串返回 []（不是 [\'\']）', () => {
    expect(wrapText('', W, STYLE, measure)).toEqual([]);
  });

  it('A.3 显式 \\n 强制断行', () => {
    expect(wrapText('a\nb', W, STYLE, measure)).toEqual(['a', 'b']);
    expect(wrapText('ab\n\ncd', W, STYLE, measure)).toEqual(['ab', '', 'cd']);
  });

  it('A.4a 中日韩按字符边界断（不劈开半个汉字）', () => {
    expect(wrapText('一二三四五六七', W, STYLE, measure)).toEqual(['一二三', '四五六', '七']);
  });

  it('A.4b 西文优先在空格处断（不会出现「半个单词」开头的行）', () => {
    // 'aaa bbb'：每字符 5.5px，maxWidth 30 能放 5 个字符。
    // 硬断会得到 ['aaa b', 'bb']（单词 bbb 被劈开）；按空格断才是 ['aaa', 'bbb']。
    expect(wrapText('aaa bbb', W, STYLE, measure)).toEqual(['aaa', 'bbb']);
  });

  it('A.4c 中英混排：不丢字，且拼接回来等于原文（除被 trim 的行尾空格）', () => {
    const text = '中文english混排 with spaces 和汉字';
    const out = wrapText(text, W, STYLE, measure);
    expect(out.length).toBeGreaterThan(1);
    expect(out.join('').replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
  });

  it('A.5 每一行宽度都 ≤ maxWidth（用同一个 measure 验）', () => {
    const samples = [
      '中文english混排测试with spaces and 汉字',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '短',
      '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸',
    ];
    for (const text of samples) {
      for (const line of wrapText(text, W, STYLE, measure)) {
        expect(measure(line), `「${line}」超宽`).toBeLessThanOrEqual(W);
      }
    }
  });

  it('A.6 单个字符就超宽：独占一行，不丢字、不死循环', () => {
    // 字宽 100px，maxWidth 只给 5px
    const out = wrapText('中a', 5, { size: 100 }, undefined);
    expect(out).toEqual(['中', 'a']);
  });

  it('A.7 maxWidth <= 0：按 \\n 切原样行，不折行', () => {
    expect(wrapText('abc\ndef', 0, STYLE, measure)).toEqual(['abc', 'def']);
    expect(wrapText('很长的中文一行', -5, STYLE, measure)).toEqual(['很长的中文一行']);
    expect(wrapText('abc', Number.NaN, STYLE, measure)).toEqual(['abc']);
  });
});

describe('measureItemHeights', () => {
  it('行数 × 行高 + 上下内边距；一行文本就是一行高', () => {
    const heights = measureItemHeights(['abc', '一二三四五六七'], W, {
      paddingX: 0,
      paddingY: 8,
      style: STYLE,
      lineHeight: 12,
      measure,
    });
    expect(heights).toEqual([12 + 8, 12 * 3 + 8]);
  });

  it('paddingX 扣掉可用宽度（同样的文字，内边距越大行数越多）', () => {
    const tight = measureItemHeights(['一二三四五六'], W, { paddingX: 0, lineHeight: 12, style: STYLE, measure });
    const loose = measureItemHeights(['一二三四五六'], W, { paddingX: 20, lineHeight: 12, style: STYLE, measure });
    expect(loose[0]).toBeGreaterThan(tight[0] as number);
  });

  it('空文本按 minLines（默认 1 行）算，不会得到 0 高', () => {
    expect(measureItemHeights([''], W, { lineHeight: 12, style: STYLE, measure })).toEqual([12]);
    expect(measureItemHeights([''], W, { lineHeight: 12, minLines: 2, style: STYLE, measure })).toEqual([24]);
  });

  it('默认从对象项取 text 字段；自定义 textOf 可覆盖', () => {
    const items = [{ text: '中文' }, { msg: '英文' }];
    const byDefault = measureItemHeights(items, W, { lineHeight: 12, style: STYLE, measure });
    expect(byDefault[0]).toBe(12);
    expect(byDefault[1]).toBe(12); // 没有 text 字段 → 空文本 → minLines

    const custom = measureItemHeights(items, W, {
      lineHeight: 12,
      style: STYLE,
      measure,
      textOf: (item) => (item as { readonly msg?: string }).msg ?? '',
    });
    expect(custom[1]).toBe(12);
  });
});
