import manifest from 'virtual:mg-manifest';
import { assetsBase, design, target } from 'virtual:mg-config';

interface Snapshot {
  readonly target: string;
  readonly design: { readonly width: number; readonly height: number };
  readonly assetsBase: string;
  readonly keys: readonly string[];
}

const snapshot: Snapshot = {
  target,
  design,
  assetsBase,
  keys: Object.keys(manifest),
};
(globalThis as unknown as { __mg?: Snapshot }).__mg = snapshot;
export default snapshot;