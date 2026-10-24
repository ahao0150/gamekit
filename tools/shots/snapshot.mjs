/**
 * 只读快照与断言求值：不含任何游戏专属字段名。
 *
 * 快照来源是游戏自带的只读调试钩子 `globalThis.__mg`：
 *   - `state`   运行时状态（字段由各游戏自定，断言用配置里的点路径读取）
 *   - `layout`  已求解的 UI 矩形（对象或数组都会被摊平成 `key` / `key[i]`）
 *   - `geom`    可选的自绘区几何（只做深拷贝，结构由各游戏自定）
 *   - `platform` { width, height }（逻辑尺寸，换算点击坐标用）
 *
 * 脚本只读，不提供任何写状态的入口。
 */

/** 页内执行：把 __mg 变成 JSON 安全的普通对象。 */
const readSnapshotInPage = () => {
  const mg = globalThis.__mg;
  if (mg === null || mg === undefined) return null;
  const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const json = (value) => {
    if (value === null || value === undefined) return null;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  };
  const asRect = (value) => {
    if (value === null || typeof value !== 'object') return null;
    const x = number(value.x);
    const y = number(value.y);
    const w = number(value.w);
    const h = number(value.h);
    if (x === null || y === null || w === null || h === null) return null;
    return { x, y, w, h };
  };

  const layout = {};
  const rects = mg.layout !== null && typeof mg.layout === 'object' ? mg.layout : {};
  for (const [key, value] of Object.entries(rects)) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const rect = asRect(item);
        if (rect !== null) layout[`${key}[${index}]`] = rect;
      });
      continue;
    }
    const rect = asRect(value);
    if (rect !== null) layout[key] = rect;
  }

  const platform = mg.platform !== null && typeof mg.platform === 'object' ? mg.platform : null;
  return {
    state: json(mg.state) ?? {},
    geom: json(mg.geom),
    layout,
    platform:
      platform === null ? null : { width: number(platform.width), height: number(platform.height) },
  };
};

export const readSnapshot = (page) => page.evaluate(readSnapshotInPage);

/** 点路径读取：支持 `a.b`、`a[0].b`、`arr.length`。缺失返回 undefined。 */
export const getPath = (object, path) => {
  if (typeof path !== 'string' || path === '') return undefined;
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((part) => part !== '');
  let cursor = object;
  for (const part of parts) {
    if (cursor === null || cursor === undefined) return undefined;
    cursor = cursor[part];
  }
  return cursor;
};

const formatValue = (value) => {
  if (value === undefined) return '（缺失）';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
};

/** 屏幕名匹配：精确比较；`result` 额外兼容 win/won/lost/fail/over。 */
export const matchesScreen = (value, wanted) => {
  if (value === undefined || value === null) return false;
  const text = String(value).toLowerCase();
  const target = String(wanted).toLowerCase();
  if (text === target) return true;
  if (target === 'result') {
    return ['result', 'over', 'win', 'won', 'fail', 'lost'].some((word) => text.includes(word));
  }
  if (target === 'play') return text.includes('play') || text.includes('running');
  return false;
};

const compare = (value, assertion) => {
  const has = (key) => Object.hasOwn(assertion, key);
  if (has('gte') && !(value >= assertion.gte)) return false;
  if (has('gt') && !(value > assertion.gt)) return false;
  if (has('lte') && !(value <= assertion.lte)) return false;
  if (has('lt') && !(value < assertion.lt)) return false;
  if (has('eq') && !(value === assertion.eq)) return false;
  if (has('value') && !(value === assertion.value)) return false;
  return true;
};

/** 求值一条断言。`context.baseline` 是步骤开始时的快照（供 changed 用）。 */
export const evalAssertion = (assertion, snapshot, context = {}) => {
  if (assertion === null || typeof assertion !== 'object') return false;
  const value = getPath(snapshot, assertion.path);
  const op = assertion.op ?? 'eq';
  if (op === 'exists') return value !== undefined && value !== null;
  if (op === 'changed') {
    const before = context.baseline === null || context.baseline === undefined ? undefined : getPath(context.baseline, assertion.path);
    if (value === undefined || before === undefined) return false;
    return JSON.stringify(value) !== JSON.stringify(before);
  }
  if (op === 'count') {
    if (!Array.isArray(value)) return false;
    const where = assertion.where;
    const filtered =
      where === undefined || where === null
        ? value
        : value.filter((item) => getPath(item, where.path) === where.eq);
    return compare(filtered.length, assertion);
  }
  if (op === 'contains') {
    if (typeof value === 'string') return value.includes(String(assertion.value));
    if (Array.isArray(value)) return value.includes(assertion.value);
    return false;
  }
  if (op === 'eq') return value !== undefined && compare(value, { value: assertion.value });
  if (op === 'neq') return value !== undefined && value !== assertion.value;
  if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
    if (typeof value !== 'number') return false;
    return compare(value, { [op]: assertion.value });
  }
  return false;
};

/** 断言的中文描述（写进报告的 detail）。 */
export const describeAssertion = (assertion) => {
  if (assertion === null || typeof assertion !== 'object') return '无效断言';
  const op = assertion.op ?? 'eq';
  if (op === 'count') {
    const where = assertion.where === undefined ? '' : `（${assertion.where.path} == ${formatValue(assertion.where.eq)}）`;
    const bound = ['gte', 'gt', 'lte', 'lt', 'eq', 'value']
      .filter((key) => Object.hasOwn(assertion, key))
      .map((key) => `${key} ${formatValue(assertion[key])}`)
      .join(', ');
    return `${assertion.path} 计数${where} ${bound}`;
  }
  if (op === 'changed') return `${assertion.path} 发生变化`;
  if (op === 'exists') return `${assertion.path} 存在`;
  if (op === 'contains') return `${assertion.path} 包含 ${formatValue(assertion.value)}`;
  return `${assertion.path} ${op} ${formatValue(assertion.value)}`;
};

/** 期望块：{ screen } / { assert } / { any } / { all } 可组合（同时满足）。 */
export const matchesExpect = (expect, snapshot, context = {}) => {
  if (expect === null || expect === undefined) return true;
  if (typeof expect.screen === 'string') {
    const screen = getPath(snapshot, context.screenPath ?? 'state.screen');
    if (!matchesScreen(screen, expect.screen)) return false;
  }
  if (expect.assert !== undefined && !evalAssertion(expect.assert, snapshot, context)) return false;
  if (Array.isArray(expect.all) && !expect.all.every((item) => evalAssertion(item, snapshot, context))) {
    return false;
  }
  if (Array.isArray(expect.any) && !expect.any.some((item) => evalAssertion(item, snapshot, context))) {
    return false;
  }
  return true;
};

/** 期望块的描述（超时报告用）。 */
export const describeExpect = (expect, context = {}) => {
  if (expect === null || expect === undefined) return '无期望';
  const parts = [];
  if (typeof expect.screen === 'string') {
    const path = context.screenPath ?? 'state.screen';
    parts.push(`${path} == ${expect.screen}`);
  }
  if (expect.assert !== undefined) parts.push(describeAssertion(expect.assert));
  if (Array.isArray(expect.any)) parts.push(`任一：${expect.any.map(describeAssertion).join('；')}`);
  if (Array.isArray(expect.all)) parts.push(`全部：${expect.all.map(describeAssertion).join('；')}`);
  return parts.join('，');
};

export const screenOf = (snapshot, screenPath) => getPath(snapshot, screenPath ?? 'state.screen');

export { formatValue };
