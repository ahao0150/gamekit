/**
 * 游戏状态：纯数据 + 纯函数，不碰平台、不碰 canvas。
 *
 * 这个模板只有一个界面（`home`）：点按钮加分，进度条跟着走。
 * 加界面时同时改三处：`Screen` 联合类型、`UI_OF`（layout.ts）、`ACTION_OF`。
 */

export type Screen = 'home';

export interface GameState {
  readonly screen: Screen;
  readonly score: number;
  /** 底部提示文案（直接画在界面上） */
  readonly hint: string;
}

/** 进度条满格分数（只影响显示比例，不限制加分）。 */
export const SCORE_GOAL = 10;

export const INITIAL_STATE: GameState = { screen: 'home', score: 0, hint: '点按钮 +1 分' };

export type Action = { readonly kind: 'tap' };

/**
 * 状态迁移：纯函数，非法动作原样返回。
 *
 * pointer 事件可能来自任何时刻（切后台回来、连点），游戏不能因为一次早到的
 * 事件就崩 —— 所以这里不抛错。
 */
export const reduce = (state: GameState, action: Action): GameState => {
  switch (action.kind) {
    case 'tap': {
      const score = state.score + 1;
      return { ...state, score, hint: `+1 分（当前 ${score}）` };
    }
  }
};

/**
 * 界面里「可点组件 → 动作」的映射。
 *
 * 判定数据与界面描述分开：`.ui` 只管画，哪个组件能点、点了做什么由这里决定。
 * 键是 `.ui` 里 `put` 的组件名（本模板是 `button`）。
 */
export const ACTION_OF: Readonly<Record<Screen, Readonly<Record<string, Action>>>> = {
  home: { button: { kind: 'tap' } },
};
