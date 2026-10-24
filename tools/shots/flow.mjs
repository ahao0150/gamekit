/**
 * 流程执行器：按步骤配置点 / 拖 / 等 / 断言 / 截图。
 *
 * 这里没有游戏名，也没有游戏专属按钮名：目标来自配置，断言来自配置，
 * 屏幕字段名来自配置（默认 state.screen）。工具只负责
 * 「把逻辑坐标换算成页面坐标 → 发真实输入 → 轮询只读快照 → 截图」。
 */

import { join, relative } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  matchesExpect,
  readSnapshot,
  screenOf,
  describeExpect,
  formatValue,
} from './snapshot.mjs';
import { resolveTargets } from './steps.mjs';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const createTapper = (page, mobile) => {
  const canvasMetrics = () =>
    page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const mg = globalThis.__mg;
      if (canvas === null) return null;
      const rect = canvas.getBoundingClientRect();
      const width = mg?.platform?.width;
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        platformWidth: typeof width === 'number' && width > 0 ? width : null,
      };
    });

  /** 逻辑坐标 → 页面坐标（canvas 显示宽 / platform.width 换算）。 */
  const toPage = async (x, y) => {
    const metrics = await canvasMetrics();
    if (metrics === null || metrics.width <= 0) throw new Error('找不到可见的 canvas');
    const scale = metrics.platformWidth === null ? 1 : metrics.width / metrics.platformWidth;
    const view = page.viewport();
    return {
      x: Math.max(0, Math.min(view.width - 1, metrics.left + x * scale)),
      y: Math.max(0, Math.min(view.height - 1, metrics.top + y * scale)),
    };
  };

  const tap = async (x, y) => {
    const point = await toPage(x, y);
    if (mobile) {
      await page.touchscreen.tap(point.x, point.y);
    } else {
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await sleep(60);
      await page.mouse.up();
    }
    return point;
  };

  /** 拖拽：移动端用 touchStart/Move/End，桌面用 mouse；两条都是真实输入事件。 */
  const drag = async (from, to) => {
    const start = await toPage(from.x, from.y);
    const end = await toPage(to.x, to.y);
    if (mobile) {
      await page.touchscreen.touchStart(start.x, start.y);
      await sleep(60);
      for (let index = 1; index <= 10; index += 1) {
        const t = index / 10;
        await page.touchscreen.touchMove(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t);
        await sleep(35);
      }
      await page.touchscreen.touchEnd();
    } else {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await sleep(60);
      for (let index = 1; index <= 10; index += 1) {
        const t = index / 10;
        await page.mouse.move(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t);
        await sleep(35);
      }
      await page.mouse.up();
    }
    return { start, end };
  };

  return { tap, drag };
};

/** 跑完一整个模式（mobile / desktop），返回检查项与截图列表。 */
export const runFlow = async ({ page, mode, config, options, shotsDir, root, scope }) => {
  const { tap, drag } = createTapper(page, mode === 'mobile');
  mkdirSync(shotsDir, { recursive: true });

  const checks = [];
  const shots = [];
  const screens = [];
  const check = (label, ok, detail = '') => {
    checks.push({ label, ok, detail });
    const mark = ok === null ? 'SKIP' : ok ? 'OK' : 'FAIL';
    console.log(`[${mode}] ${mark} ${label}${detail ? `：${detail}` : ''}`);
  };
  const noteScreen = (snapshot) => {
    const screen = screenOf(snapshot, config.screenPath);
    if (screen === undefined || screen === null) return;
    const text = String(screen);
    if (screens[screens.length - 1] !== text) screens.push(text);
  };
  let shotIndex = 0;
  const shot = async (name) => {
    shotIndex += 1;
    const file = join(shotsDir, `${mode}-${shotIndex}-${name}.png`);
    await page.screenshot({ path: file });
    shots.push(file);
    console.log(`[${mode}] 截图 ${relative(root, file)}`);
    return file;
  };

  let snapshot = await readSnapshot(page);
  noteScreen(snapshot);
  await shot('home');
  if (snapshot === null) {
    check('调试钩子 __mg', false, '页面上没有 globalThis.__mg，无法读状态与布局');
    return { checks, shots, screens };
  }
  check('调试钩子 __mg', true, `屏幕字段 ${config.screenPath}`);

  for (const step of config.steps) {
    const baseline = snapshot;
    const context = { screenPath: config.screenPath, baseline, file: config.source, stepName: step.name, strict: config.source !== null, config };
    const timeoutMs = step.timeoutMs ?? 8000;
    const tapMs = step.tapMs ?? options.tapMs ?? 300;
    let reached = matchesExpect(step.expect, snapshot, context);
    const deadline = Date.now() + timeoutMs;
    let attempts = 0;
    let lastAction = '（只等待）';
    let warnedEmpty = false;

    while (!reached && Date.now() < deadline) {
      if (step.drag !== undefined) {
        const from = resolveTargets(snapshot, step.drag.from, context);
        const to = resolveTargets(snapshot, step.drag.to, context);
        if (from.points.length === 0 || to.points.length === 0) {
          if (!warnedEmpty) {
            console.log(`[${mode}] 提示：步骤 "${step.name}" 没有可拖的目标（${from.label} / ${to.label}），改为等待`);
            warnedEmpty = true;
          }
        } else {
          await drag(from.points[0], to.points[0]);
          attempts += 1;
          lastAction = `拖 ${from.label} → ${to.label}`;
        }
      } else {
        const specs = step.taps ?? (step.tap === undefined ? [] : [step.tap]);
        if (specs.length === 0) {
          lastAction = '（只等待）';
        } else {
          const spec = specs[attempts % specs.length];
          const { points, label } = resolveTargets(snapshot, spec, context);
          if (points.length === 0) {
            if (!warnedEmpty) {
              console.log(`[${mode}] 提示：步骤 "${step.name}" 没有可点的目标（${label}），改为等待`);
              warnedEmpty = true;
            }
          } else {
            const point = points[attempts % points.length];
            await tap(point.x, point.y);
            lastAction = points.length > 1 ? `${label} 第 ${(attempts % points.length) + 1} 个` : label;
          }
          attempts += 1;
        }
      }
      await sleep(tapMs);
      const next = await readSnapshot(page);
      if (next !== null) snapshot = next;
      noteScreen(snapshot);
      reached = matchesExpect(step.expect, snapshot, context);
    }

    const screen = screenOf(snapshot, config.screenPath);
    const detail = `${describeExpect(step.expect, context)}；实际 ${config.screenPath}=${formatValue(screen)}；尝试 ${attempts} 次（${lastAction}）`;
    if (step.shot !== false) await sleep(120);
    if (step.shot !== false) await shot(step.name);
    check(step.name, reached ? true : step.required === false ? null : false, detail);
  }

  const finalScreen = screenOf(snapshot, config.screenPath);
  if (config.resultButtons.length > 0 && matchesExpect({ screen: 'result' }, snapshot, { screenPath: config.screenPath })) {
    const button = config.resultButtons.find((key) => snapshot.layout[key] !== undefined);
    check('结算页有可点按钮', button !== undefined, button ?? `layout 里没有 ${config.resultButtons.join(' / ')}`);
  } else if (config.resultButtons.length > 0) {
    check('结算页有可点按钮', null, `未进入结算（${formatValue(finalScreen)}），跳过`);
  }

  if (screens.length > 0) console.log(`[${mode}] screen 流转：${screens.join(' → ')}`);
  const failed = checks.filter((item) => item.ok === false);
  if (failed.length > 0) {
    console.log(`[${mode}] 步骤失败 ${failed.length} 项：${failed.map((item) => item.label).join('、')}`);
  }
  return { checks, shots, screens, finalSnapshot: snapshot, screen: finalScreen };
};
