import { describe, expect, it } from 'vitest';
import type { Ctx2D } from '../../platform/contract';
import type { Screen } from './contract';
import { createStage } from './index';

const ctx = {} as unknown as Ctx2D;

interface Recorder extends Screen {
  readonly log: string[];
}

function makeScreen(name: string, log: string[]): Recorder {
  return {
    log,
    enter: () => log.push(`${name}:enter`),
    exit: () => log.push(`${name}:exit`),
    update: () => log.push(`${name}:update`),
    render: () => log.push(`${name}:render`),
  };
}

describe('stage 栈操作', () => {
  it('空栈 current 为 null、depth 0', () => {
    const stage = createStage();
    expect(stage.current).toBeNull();
    expect(stage.depth).toBe(0);
    expect(stage.pop()).toBeNull();
  });

  it('push 调 enter，current 指向栈顶', () => {
    const stage = createStage();
    const log: string[] = [];
    const a = makeScreen('a', log);
    stage.push(a);
    expect(stage.depth).toBe(1);
    expect(stage.current).toBe(a);
    expect(log).toEqual(['a:enter']);
  });

  it('pop 调 exit 并回到上一层', () => {
    const stage = createStage();
    const log: string[] = [];
    const a = makeScreen('a', log);
    const b = makeScreen('b', log);
    stage.push(a);
    stage.push(b);
    expect(stage.current).toBe(b);
    expect(stage.pop()).toBe(b);
    expect(stage.current).toBe(a);
    expect(log).toEqual(['a:enter', 'b:enter', 'b:exit']);
  });

  it('replace 只 exit 旧屏、enter 新屏', () => {
    const stage = createStage();
    const log: string[] = [];
    const a = makeScreen('a', log);
    const b = makeScreen('b', log);
    stage.push(a);
    stage.replace(b);
    expect(stage.depth).toBe(1);
    expect(stage.current).toBe(b);
    expect(log).toEqual(['a:enter', 'a:exit', 'b:enter']);
  });

  it('clear 从顶到底逐层 exit', () => {
    const stage = createStage();
    const log: string[] = [];
    stage.push(makeScreen('a', log));
    stage.push(makeScreen('b', log));
    stage.push(makeScreen('c', log));
    stage.clear();
    expect(stage.depth).toBe(0);
    expect(log).toEqual([
      'a:enter',
      'b:enter',
      'c:enter',
      'c:exit',
      'b:exit',
      'a:exit',
    ]);
  });

  it('缺方法的屏幕不崩（方法全可选）', () => {
    const stage = createStage();
    stage.push({});
    stage.update(0.016);
    stage.render(ctx, 0.5);
    expect(stage.pop()).toEqual({});
  });
});

describe('stage 模态语义', () => {
  it('模态层挡住下层：只更新/渲染栈顶', () => {
    const stage = createStage();
    const log: string[] = [];
    stage.push(makeScreen('game', log));
    stage.push(makeScreen('pause', log));
    log.length = 0;
    stage.update(0.016);
    stage.render(ctx, 0.5);
    expect(log).toEqual(['pause:update', 'pause:render']);
  });

  it('非模态叠加层：下层继续跑，两层都更新/渲染', () => {
    const stage = createStage();
    const log: string[] = [];
    stage.push(makeScreen('game', log));
    stage.push(makeScreen('hud', log), { modal: false });
    log.length = 0;
    stage.update(0.016);
    stage.render(ctx, 0.5);
    expect(log).toEqual(['game:update', 'hud:update', 'game:render', 'hud:render']);
  });

  it('模态层上方再叠非模态层：从模态层开始都活着', () => {
    const stage = createStage();
    const log: string[] = [];
    stage.push(makeScreen('game', log));
    stage.push(makeScreen('pause', log));
    stage.push(makeScreen('toast', log), { modal: false });
    log.length = 0;
    stage.update(0.016);
    expect(log).toEqual(['pause:update', 'toast:update']);
  });

  it('空栈 update / render 不崩', () => {
    const stage = createStage();
    expect(() => stage.update(0.016)).not.toThrow();
    expect(() => stage.render(ctx, 0)).not.toThrow();
  });
});
