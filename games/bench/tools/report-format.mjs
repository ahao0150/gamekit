/**
 * markdown 表格格式化（T26）。
 *
 * 抽出来单独一个文件，是为了让 `run-bench.mjs` 只留「驱动 Vite + Chrome + 测量」，
 * 守住仓库「单文件 ≤ 300 行」的铁律。
 */

export const fixed2 = (value) => (Number.isFinite(value) ? value.toFixed(2) : '—');

/** 一张表：行 = 降频，列 = N，格子 = 中位数 / p95。 */
export const tableMarkdown = (title, rows, ns) => {
  const head = ['| 降频 |', ...ns.map((n) => ` N=${n} |`)].join(' ');
  const sep = ['|---|', ...ns.map(() => '---|')].join(' ');
  const body = rows.map((row) => {
    const cells = ns.map((n) => {
      const result = row.byN.get(n);
      if (result === undefined) return ' — |';
      return ` ${fixed2(result.draw.median)} / ${fixed2(result.draw.p95)} |`;
    });
    return `| ${row.rate}× |${cells.join('')}`;
  });
  return [`### ${title}`, '', head, sep, ...body, ''].join('\n');
};

/**
 * 帧间隔表：`draw` 只测 JS 提交，测不到 GPU 光栅；
 * 这张表（相邻 rAF 时间戳差）才是「真的掉没掉帧」的证据。
 */
export const intervalMarkdown = (rows, ns) => {
  const head = ['| 负载 |', ...ns.map((n) => ` N=${n} |`)].join(' ');
  const sep = ['|---|', ...ns.map(() => '---|')].join(' ');
  const body = rows.map((row) => {
    const cells = ns.map((n) => {
      const result = row.byN.get(n);
      if (result === undefined) return ' — |';
      const p95 = result.interval.p95;
      return ` ${fixed2(result.interval.median)} / ${fixed2(p95)}${p95 > 20 ? ' ⚠' : ''} |`;
    });
    return `| ${row.label} |${cells.join('')}`;
  });
  return [
    '### 帧间隔（rAF，毫秒；中位数 / p95，> 16.7 = 掉帧，⚠ = p95 > 20ms）',
    '',
    head,
    sep,
    ...body,
    '',
  ].join('\n');
};

/** 离屏对照表：同一 UI 层三种画法的差值（每帧重画 / 手写离屏 / 引擎 createLayerCache）。 */
export const offscreenMarkdown = (rows, ns) => {
  const head = ['| 降频 |', ...ns.map((n) => ` N=${n} |`)].join(' ');
  const sep = ['|---|', ...ns.map(() => '---|')].join(' ');
  const body = rows.map((row) => {
    const cells = ns.map((n) => {
      const direct = row.direct.get(n);
      const cached = row.cached.get(n);
      const layered = row.layer.get(n);
      if (direct === undefined || cached === undefined || layered === undefined) return ' — |';
      const savedHand = direct.draw.median - cached.draw.median;
      const savedLayer = direct.draw.median - layered.draw.median;
      return ` ${fixed2(direct.draw.median)} / ${fixed2(cached.draw.median)} / ${fixed2(layered.draw.median)}（省 ${fixed2(savedHand)} / ${fixed2(savedLayer)}） |`;
    });
    return `| ${row.rate}× |${cells.join('')}`;
  });
  return [
    '### 离屏缓存对照（中位数：每帧重画 / 手写离屏 / createLayerCache；括号 = 相对每帧重画省多少）',
    '',
    head,
    sep,
    ...body,
    '',
  ].join('\n');
};
