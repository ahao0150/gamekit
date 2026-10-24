/**
 * @mg/story 契约。
 */

export interface StoryChoice {
  readonly text: string;
  readonly next: string;
  /** 简单条件表达式，如 flags.metNpc == true */
  readonly when?: string;
}

export interface StoryNode {
  readonly id: string;
  readonly dialogue: string;
  readonly choices?: readonly StoryChoice[];
  readonly set?: {
    readonly flags?: Readonly<Record<string, boolean>>;
    readonly vars?: Readonly<Record<string, number>>;
  };
  readonly end?: boolean;
}

export interface StoryScript {
  readonly start: string;
  readonly nodes: Readonly<Record<string, StoryNode>>;
}

export interface StoryState {
  readonly nodeId: string;
  readonly flags: Readonly<Record<string, boolean>>;
  readonly vars: Readonly<Record<string, number>>;
  readonly ended: boolean;
}

export interface StoryRunner {
  readonly state: StoryState;
  choose(index: number): StoryRunner;
  current(): StoryNode | null;
  isEnded(): boolean;
}

export interface LintIssue {
  readonly kind: 'dead-end' | 'broken-link' | 'unreachable-end' | 'invalid-start';
  readonly nodeId: string;
  readonly message: string;
}

export interface LintReport {
  readonly ok: boolean;
  readonly issues: readonly LintIssue[];
}
