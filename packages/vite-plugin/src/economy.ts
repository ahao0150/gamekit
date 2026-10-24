/** build 前将游戏 assets 下的扁平配表编译为 JSON。 */
import { compileTablesFromDir } from '@mg/economy';

export const compileEconomyDir = (absEconomyDir: string): void => {
  compileTablesFromDir(absEconomyDir, absEconomyDir);
};
