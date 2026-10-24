import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { filterOrphans, formatOrphanUiError, listProjectUiFiles } from './orphan-ui';

const made: string[] = [];
afterEach(() => {
  while (made.length > 0) rmSync(made.pop() ?? '', { recursive: true, force: true });
});

describe('listProjectUiFiles', () => {
  it('只收 ui/ 下的 .ui，含子目录', () => {
    const root = mkdtempSync(join(tmpdir(), 'mg-orphan-'));
    made.push(root);
    mkdirSync(join(root, 'ui', 'nested'), { recursive: true });
    writeFileSync(join(root, 'ui', 'home.ui'), '');
    writeFileSync(join(root, 'ui', 'nested', 'bag.ui'), '');
    writeFileSync(join(root, 'other.ui'), '');
    expect(listProjectUiFiles(root)).toEqual(['ui/home.ui', 'ui/nested/bag.ui']);
  });
});

describe('formatOrphanUiError', () => {
  it('列出文件并提示必须 import', () => {
    const text = formatOrphanUiError(['ui/a.ui', 'ui/b.ui']);
    expect(text).toContain('ui/a.ui');
    expect(text).toContain('bindComponents');
  });
});

describe('filterOrphans', () => {
  const discovered = ['ui/a.ui', 'ui/b.ui', 'ui/widgets.ui'];

  it('扣掉已被 import 的', () => {
    expect(filterOrphans(discovered, new Set(['ui/a.ui']))).toEqual(['ui/b.ui', 'ui/widgets.ui']);
  });

  it('扣掉显式豁免的（有意不接线）', () => {
    expect(filterOrphans(discovered, new Set(['ui/a.ui']), ['ui/widgets.ui'])).toEqual(['ui/b.ui']);
  });

  it('豁免清单为空时与不传等价（不误伤正常孤儿）', () => {
    expect(filterOrphans(discovered, new Set<string>())).toEqual(discovered);
    expect(filterOrphans(discovered, new Set<string>(), [])).toEqual(discovered);
  });
});
