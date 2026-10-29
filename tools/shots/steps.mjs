/**
 * 步骤配置：把「怎么开始、点哪里、断言什么」从代码里挪到 steps/<slug>.json。
 *
 * 配置里没有任何游戏分支；代码只认下面这套通用字段：
 *
 *   {
 *     "slug": "pindou-workshop",
 *     "screenPath": "state.screen",        // 期望/日志读的屏幕字段（默认 state.screen）
 *     "start": "primaryButton",            // 开始按钮的 layout key（--start 可覆盖）
 *     "maxSteps": 8,                       // 步骤上限，超过直接报配置错误
 *     "steps": [
 *       { "name": "play",                  // 截图名、报告名，唯一
 *         "tap":  { "start": true },       // 点一次（taps 可写多个，循环点）
 *         "taps": [{ "geom": "arrows" }],  // 目标：layout key / key+rel / point / geom
 *         "drag": { "from": …, "to": … },  // 或拖拽（pindou 这类拖放玩法）
 *         "expect": { "screen": "play", "assert": { … }, "any": [ … ], "all": [ … ] },
 *         "timeoutMs": 6000,               // 该步最多等多久
 *         "tapMs": 300,                    // 两次点击间隔
 *         "required": true,                // false = 没达成记 SKIP 而不是 FAIL
 *         "shot": true                     // false = 该步不截图
 *       }
 *     ],
 *     "resultButtons": ["primaryButton", "secondaryButton", "button"]  // 可选
 *   }
 *
 * 目标写法（四种，任选其一）：
 *   { "start": true }                       -> 配置里的 start（--start 覆盖）
 *   { "key": "infoPanel", "rel": [0.5, 0.5] } -> layout 矩形内相对点（默认中心）
 *   { "key": "cards", "index": 0 }          -> 数组矩形 cards[0] 的中心
 *   { "point": [0.5, 0.7] }                 -> 视口相对坐标（0..1）
 *   { "geom": "arrows" }                    -> __mg.geom.arrows 里所有矩形，循环逐个点
 *
 * 断言写法：
 *   { "path": "state.moves", "op": "gt", "value": 0 }
 *   { "path": "state.placed.length", "op": "gt", "value": 0 }
 *   { "path": "state.pieces", "op": "count", "where": { "path": "loc.t", "eq": "temp" }, "gte": 1 }
 *   { "path": "state.timeLeft", "op": "changed" }   // 与步骤开始时比较
 *
 * 配置缺失时返回通用默认流程（首页点开始 → 等结算），并给出明确提示；
 * 配置存在但字段写错时抛 ConfigError，错误里写清文件、步骤名、字段名。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

const TARGET_KEYS = ['start', 'key', 'point', 'geom'];
const ASSERT_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'changed', 'exists', 'count', 'contains'];
const EXPECT_KEYS = ['screen', 'assert', 'any', 'all'];
const STEP_KEYS = ['name', 'tap', 'taps', 'drag', 'expect', 'timeoutMs', 'tapMs', 'required', 'shot'];
const TOP_KEYS = ['slug', 'screenPath', 'start', 'maxSteps', 'steps', 'resultButtons'];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPositive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

const failConfig = (file, message) => {
  throw new ConfigError(`${file}：${message}`);
};

const checkTarget = (file, stepName, target, field) => {
  if (!isObject(target)) failConfig(file, `步骤 "${stepName}" 的 ${field} 必须是对象`);
  const keys = Object.keys(target);
  const hits = TARGET_KEYS.filter((key) => keys.includes(key));
  if (hits.length !== 1) {
    failConfig(
      file,
      `步骤 "${stepName}" 的 ${field} 必须且只能有 start / key / point / geom 之一，收到键：${keys.join(', ') || '（空）'}`,
    );
  }
  if (target.start !== undefined && target.start !== true) {
    failConfig(file, `步骤 "${stepName}" 的 ${field}.start 只能是 true`);
  }
  if (target.key !== undefined && (typeof target.key !== 'string' || target.key === '')) {
    failConfig(file, `步骤 "${stepName}" 的 ${field}.key 必须是非空字符串`);
  }
  if (target.index !== undefined && !Number.isInteger(target.index)) {
    failConfig(file, `步骤 "${stepName}" 的 ${field}.index 必须是整数`);
  }
  if (target.rel !== undefined) {
    if (!Array.isArray(target.rel) || target.rel.length !== 2 || !target.rel.every((n) => typeof n === 'number' && n >= 0 && n <= 1)) {
      failConfig(file, `步骤 "${stepName}" 的 ${field}.rel 必须是 [x, y] 两个 0..1 的数`);
    }
  }
  if (target.point !== undefined) {
    if (!Array.isArray(target.point) || target.point.length !== 2 || !target.point.every((n) => typeof n === 'number' && n >= 0 && n <= 1)) {
      failConfig(file, `步骤 "${stepName}" 的 ${field}.point 必须是 [x, y] 两个 0..1 的数`);
    }
  }
  if (target.geom !== undefined && (typeof target.geom !== 'string' || target.geom === '')) {
    failConfig(file, `步骤 "${stepName}" 的 ${field}.geom 必须是非空字符串`);
  }
  const extra = keys.filter((key) => !TARGET_KEYS.includes(key) && !['rel', 'index'].includes(key));
  if (extra.length > 0) {
    failConfig(file, `步骤 "${stepName}" 的 ${field} 有未知字段：${extra.join(', ')}（可用：start/key/point/geom + rel/index）`);
  }
};

const checkAssertion = (file, stepName, assertion, field) => {
  if (!isObject(assertion)) failConfig(file, `步骤 "${stepName}" 的 ${field} 必须是对象`);
  if (typeof assertion.path !== 'string' || assertion.path === '') {
    failConfig(file, `步骤 "${stepName}" 的 ${field}.path 必须是非空字符串（点路径，如 state.moves）`);
  }
  const op = assertion.op ?? 'eq';
  if (!ASSERT_OPS.includes(op)) {
    failConfig(file, `步骤 "${stepName}" 的 ${field}.op 不认识：${op}（可用：${ASSERT_OPS.join(', ')}）`);
  }
  const boundKeys = ['gte', 'gt', 'lte', 'lt', 'eq', 'value'];
  const hasBound = boundKeys.some((key) => Object.hasOwn(assertion, key));
  if (op === 'count' && !hasBound) {
    failConfig(file, `步骤 "${stepName}" 的 ${field}（count）需要 gte / gt / lte / lt / eq / value 之一`);
  }
  if (!['exists', 'changed', 'count'].includes(op) && !Object.hasOwn(assertion, 'value')) {
    failConfig(file, `步骤 "${stepName}" 的 ${field}.value 缺失（op=${op} 需要比较值）`);
  }
  if (assertion.where !== undefined && !isObject(assertion.where)) {
    failConfig(file, `步骤 "${stepName}" 的 ${field}.where 必须是对象`);
  }
};

const checkExpect = (file, stepName, expect) => {
  if (!isObject(expect)) failConfig(file, `步骤 "${stepName}" 缺少 expect 对象（要断言什么）`);
  const extra = Object.keys(expect).filter((key) => !EXPECT_KEYS.includes(key));
  if (extra.length > 0) {
    failConfig(file, `步骤 "${stepName}" 的 expect 有未知字段：${extra.join(', ')}（可用：${EXPECT_KEYS.join(', ')}）`);
  }
  if (expect.screen !== undefined && (typeof expect.screen !== 'string' || expect.screen === '')) {
    failConfig(file, `步骤 "${stepName}" 的 expect.screen 必须是非空字符串`);
  }
  if (expect.assert !== undefined) checkAssertion(file, stepName, expect.assert, 'expect.assert');
  for (const key of ['any', 'all']) {
    if (expect[key] === undefined) continue;
    if (!Array.isArray(expect[key]) || expect[key].length === 0) {
      failConfig(file, `步骤 "${stepName}" 的 expect.${key} 必须是非空数组`);
    }
    expect[key].forEach((item, index) => checkAssertion(file, stepName, item, `expect.${key}[${index}]`));
  }
  if (expect.screen === undefined && expect.assert === undefined && expect.any === undefined && expect.all === undefined) {
    failConfig(file, `步骤 "${stepName}" 的 expect 是空的（至少写 screen / assert / any / all 之一）`);
  }
};

const checkStep = (file, step, names) => {
  if (!isObject(step)) failConfig(file, 'steps 里每一项都必须是对象');
  const extra = Object.keys(step).filter((key) => !STEP_KEYS.includes(key));
  if (extra.length > 0) {
    failConfig(file, `步骤里有未知字段：${extra.join(', ')}（可用：${STEP_KEYS.join(', ')}）`);
  }
  if (typeof step.name !== 'string' || step.name === '') {
    failConfig(file, '步骤缺少 name（用于报告与截图文件名）');
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(step.name)) {
    failConfig(file, `步骤 "${step.name}" 的 name 只能用 a-z 0-9 -`);
  }
  if (names.has(step.name)) failConfig(file, `步骤 name 重复：${step.name}`);
  names.add(step.name);
  if (step.timeoutMs !== undefined && !isPositive(step.timeoutMs)) {
    failConfig(file, `步骤 "${step.name}" 的 timeoutMs 必须是正数`);
  }
  if (step.tapMs !== undefined && !isPositive(step.tapMs)) {
    failConfig(file, `步骤 "${step.name}" 的 tapMs 必须是正数`);
  }
  for (const key of ['required', 'shot']) {
    if (step[key] !== undefined && typeof step[key] !== 'boolean') {
      failConfig(file, `步骤 "${step.name}" 的 ${key} 必须是 true/false`);
    }
  }
  if (step.tap !== undefined) checkTarget(file, step.name, step.tap, 'tap');
  if (step.taps !== undefined) {
    if (!Array.isArray(step.taps) || step.taps.length === 0) {
      failConfig(file, `步骤 "${step.name}" 的 taps 必须是非空数组`);
    }
    step.taps.forEach((target, index) => checkTarget(file, step.name, target, `taps[${index}]`));
  }
  if (step.drag !== undefined) {
    if (!isObject(step.drag)) failConfig(file, `步骤 "${step.name}" 的 drag 必须是对象`);
    checkTarget(file, step.name, step.drag.from, 'drag.from');
    checkTarget(file, step.name, step.drag.to, 'drag.to');
  }
  const actions = [step.tap, step.taps, step.drag].filter((value) => value !== undefined).length;
  if (actions > 1) failConfig(file, `步骤 "${step.name}" 的 tap / taps / drag 只能写一种`);
  checkExpect(file, step.name, step.expect);
};

/** 通用默认流程：首页点开始 → 等结算。都可缺省，缺 key 记 SKIP。 */
const defaultConfig = (startOverride) => ({
  source: null,
  screenPath: 'state.screen',
  start: startOverride ?? 'startButton',
  maxSteps: 2,
  steps: [
    { name: 'play', tap: { start: true }, expect: { screen: 'play' }, timeoutMs: 5000, required: false },
    { name: 'result', expect: { screen: 'result' }, timeoutMs: 20000, required: false },
  ],
  // 默认流程不猜结算按钮：按钮键因游戏而异，交给 steps/<slug>.json 声明。
  resultButtons: [],
});

/** 读 steps/<slug>.json；不存在时返回默认流程（带提示文案）。 */
export const loadSteps = ({ root, slug, startOverride, stepsPath }) => {
  const file = stepsPath ?? join(root, 'tools', 'shots', 'steps', `${slug}.json`);
  if (!existsSync(file)) {
    const hint =
      `没有步骤配置 ${relative(root, file)}，改用通用默认流程（首页点开始 → 等结算）。\n` +
      `  要精确断言请新建该文件；格式见 tools/shots/steps/README.md，或用 --start <layoutKey> 指定开始按钮。`;
    return { config: defaultConfig(startOverride), file: null, warning: hint };
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ConfigError(`${relative(root, file)} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isObject(raw)) failConfig(relative(root, file), '顶层必须是对象');
  const display = relative(root, file);
  const extra = Object.keys(raw).filter((key) => !TOP_KEYS.includes(key));
  if (extra.length > 0) {
    failConfig(display, `顶层有未知字段：${extra.join(', ')}（可用：${TOP_KEYS.join(', ')}）`);
  }
  if (raw.screenPath !== undefined && (typeof raw.screenPath !== 'string' || raw.screenPath === '')) {
    failConfig(display, 'screenPath 必须是非空字符串（如 state.screen / state.phase）');
  }
  if (raw.start !== undefined && (typeof raw.start !== 'string' || raw.start === '')) {
    failConfig(display, 'start 必须是非空字符串（开始按钮的 layout key）');
  }
  if (raw.maxSteps !== undefined && !(Number.isInteger(raw.maxSteps) && raw.maxSteps > 0)) {
    failConfig(display, 'maxSteps 必须是正整数');
  }
  if (raw.resultButtons !== undefined) {
    if (!Array.isArray(raw.resultButtons) || !raw.resultButtons.every((key) => typeof key === 'string' && key !== '')) {
      failConfig(display, 'resultButtons 必须是字符串数组');
    }
  }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    failConfig(display, 'steps 必须是非空数组（没有步骤就无法断言）');
  }
  const maxSteps = raw.maxSteps ?? 8;
  if (raw.steps.length > maxSteps) {
    failConfig(display, `步骤数 ${raw.steps.length} 超过 maxSteps=${maxSteps}`);
  }
  const names = new Set();
  raw.steps.forEach((step) => checkStep(display, step, names));

  return {
    config: {
      source: display,
      screenPath: raw.screenPath ?? 'state.screen',
      start: startOverride ?? raw.start ?? 'startButton',
      maxSteps,
      steps: raw.steps.map((step) => ({
        timeoutMs: 8000,
        tapMs: 300,
        required: true,
        shot: true,
        ...step,
      })),
      resultButtons: raw.resultButtons ?? [],
    },
    file: display,
    warning: null,
  };
};

/** 缺 key 时的统一错误文案：写清缺哪个、当前有哪些。 */
const missingKeyMessage = (key, snapshot) => {
  const available = Object.keys(snapshot.layout).sort();
  const shown = available.length === 0 ? '（空）' : available.slice(0, 24).join(', ');
  const more = available.length > 24 ? ` …共 ${available.length} 个` : '';
  return `layout 里没有 key "${key}"，当前界面可用 key：${shown}${more}`;
};

/** 解析一个目标为「逻辑坐标点」数组；strict=false 时缺 key 返回空数组（默认流程用）。 */
export const resolveTargets = (snapshot, target, context) => {
  const { file, stepName, strict, config } = context;
  const fail = (message) => {
    if (strict) throw new ConfigError(`${file ?? '（默认流程）'} 步骤 "${stepName}"：${message}`);
    return { points: [], label: message };
  };
  const platform = snapshot.platform ?? { width: 390, height: 844 };
  const width = platform.width ?? 390;
  const height = platform.height ?? 844;

  if (target.start === true) {
    const key = config.start;
    const rect = snapshot.layout[key];
    if (rect === undefined) return fail(missingKeyMessage(key, snapshot));
    return { points: [{ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }], label: `start ${key}` };
  }
  if (target.geom !== undefined) {
    const value = snapshot.geom === null ? undefined : snapshot.geom[target.geom];
    if (!Array.isArray(value)) return fail(`__mg.geom.${target.geom} 不是数组（实际：${value === undefined ? '缺失' : typeof value}）`);
    const points = [];
    for (const item of value) {
      const rect = isObject(item) && isObject(item.rect) ? item.rect : item;
      if (!isObject(rect)) continue;
      const { x, y, w, h } = rect;
      if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n)) || w <= 0 || h <= 0) continue;
      points.push({ x: x + w / 2, y: y + h / 2 });
    }
    // 列表合法但当前为空（例如关卡已清空）不算配置错：执行器会改为等待期望达成。
    return { points, label: `geom.${target.geom}（${points.length} 个）` };
  }
  if (target.point !== undefined) {
    return {
      points: [{ x: target.point[0] * width, y: target.point[1] * height }],
      label: `point ${Math.round(target.point[0] * 100)}%,${Math.round(target.point[1] * 100)}%`,
    };
  }

  const key = target.index === undefined ? target.key : `${target.key}[${target.index}]`;
  const rect = snapshot.layout[key];
  if (rect === undefined) return fail(missingKeyMessage(key, snapshot));
  const [rx, ry] = target.rel ?? [0.5, 0.5];
  return {
    points: [{ x: rect.x + rect.w * rx, y: rect.y + rect.h * ry }],
    label: `key ${key}${target.rel === undefined ? '' : ` rel ${rx},${ry}`}`,
  };
};
