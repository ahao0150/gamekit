/**
 * 场景栈实现。
 *
 * 只有一个实例内的可变数组，没有模块级状态：每次 createStage() 都是独立栈。
 * update / render 都只作用于「活着的层」：从最上面一个模态层开始到底部。
 */

import type { Ctx2D } from '../../platform/contract';
import type { CreateStage, Screen, Stage } from './contract';

interface Entry {
  readonly screen: Screen;
  readonly modal: boolean;
}

export const createStage: CreateStage = (): Stage => {
  const stack: Entry[] = [];

  const enter = (screen: Screen): void => {
    screen.enter?.();
  };

  const exit = (screen: Screen): void => {
    screen.exit?.();
  };

  /**
   * 最上面一个模态层的下标。
   * 没有模态层返回 0（整栈都活着）；空栈返回 -1。
   */
  const activeFrom = (): number => {
    if (stack.length === 0) return -1;
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      if (stack[i]?.modal) return i;
    }
    return 0;
  };

  return {
    push(screen: Screen, opts?: { modal?: boolean }): void {
      stack.push({ screen, modal: opts?.modal ?? true });
      enter(screen);
    },

    pop(): Screen | null {
      const top = stack.pop();
      if (!top) return null;
      exit(top.screen);
      return top.screen;
    },

    replace(screen: Screen): void {
      const top = stack.pop();
      if (top) exit(top.screen);
      stack.push({ screen, modal: true });
      enter(screen);
    },

    get current(): Screen | null {
      const top = stack[stack.length - 1];
      return top ? top.screen : null;
    },

    get depth(): number {
      return stack.length;
    },

    update(dt: number): void {
      const from = activeFrom();
      if (from < 0) return;
      for (let i = from; i < stack.length; i += 1) {
        stack[i]?.screen.update?.(dt);
      }
    },

    render(ctx: Ctx2D, alpha: number): void {
      const from = activeFrom();
      if (from < 0) return;
      for (let i = from; i < stack.length; i += 1) {
        stack[i]?.screen.render?.(ctx, alpha);
      }
    },

    clear(): void {
      while (stack.length > 0) {
        const top = stack.pop();
        if (top) exit(top.screen);
      }
    },
  };
};
