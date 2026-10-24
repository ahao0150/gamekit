import type { StoryChoice, StoryNode, StoryRunner, StoryScript, StoryState } from './contract';
import { evalCondition } from './conditions';

const mergeState = (
  state: StoryState,
  node: StoryNode | null,
): { flags: Record<string, boolean>; vars: Record<string, number> } => {
  const flags = { ...state.flags };
  const vars = { ...state.vars };
  if (node?.set?.flags) {
    for (const [k, v] of Object.entries(node.set.flags)) flags[k] = v === true;
  }
  if (node?.set?.vars) {
    for (const [k, v] of Object.entries(node.set.vars)) {
      if (typeof v === 'number' && Number.isFinite(v)) vars[k] = v;
    }
  }
  return { flags, vars };
};

const visibleChoices = (node: StoryNode, state: StoryState): StoryChoice[] => {
  const list = node.choices ?? [];
  return list.filter((c) => evalCondition(c.when, state));
};

const buildRunner = (script: StoryScript, state: StoryState): StoryRunner => {
  const current = (): StoryNode | null => script.nodes[state.nodeId] ?? null;

  const choose = (index: number): StoryRunner => {
    if (state.ended) return buildRunner(script, state);
    const node = current();
    if (node === null) return buildRunner(script, { ...state, ended: true });
    const choices = visibleChoices(node, state);
    if (index < 0 || index >= choices.length) return buildRunner(script, state);
    const pick = choices[index];
    if (pick === undefined) return buildRunner(script, state);
    const merged = mergeState(state, node);
    const nextNode = script.nodes[pick.next];
    const ended = nextNode?.end === true;
    const nextState: StoryState = {
      nodeId: pick.next,
      flags: merged.flags,
      vars: merged.vars,
      ended,
    };
    const afterSet = mergeState(nextState, nextNode ?? null);
    return buildRunner(script, {
      ...nextState,
      flags: afterSet.flags,
      vars: afterSet.vars,
    });
  };

  return {
    state,
    choose,
    current,
    isEnded: () => state.ended || current()?.end === true,
  };
};

export const createStoryRunner = (script: StoryScript): StoryRunner => {
  const start = script.nodes[script.start];
  if (start === undefined) {
    return buildRunner(script, { nodeId: script.start, flags: {}, vars: {}, ended: true });
  }
  const merged = mergeState({ nodeId: script.start, flags: {}, vars: {}, ended: start.end === true }, start);
  return buildRunner(script, {
    nodeId: script.start,
    flags: merged.flags,
    vars: merged.vars,
    ended: start.end === true,
  });
};
