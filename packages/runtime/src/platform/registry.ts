/**
 * 平台注册表实现。
 *
 * 为什么这样实现：
 * 1. **重名必须抛错**，不能静默覆盖。平台注册是「加一个目录 + 一次 register()」的
 *    手写动作，最常见的失误就是复制粘贴后忘改 name —— 静默覆盖会让新平台
 *    把旧平台顶掉，而且要等到运行时行为不对才被发现。宁可启动就炸。
 * 2. **按 priority 从大到小探测**。同一个运行环境可能同时满足多个 probe
 *    （例如浏览器里塞了 wx 的 polyfill），这时必须有一个确定的顺序，
 *    否则「哪个平台生效」取决于注册顺序，测试就不可复现。
 *    priority 相同的用注册顺序兜底，保证排序稳定。
 * 3. **probe 过了但 factory 抛错 → 继续试下一个**。工厂失败属于「这个平台在
 *    这个环境里起不来」（比如 web 拿到了却建不出 canvas），而不是「配置错了」，
 *    所以不该让一个更靠后的可用平台陪葬。
 * 4. **无全局可变状态**：所有状态在闭包里，每 createRegistry() 一份独立注册表，
 *    测试之间不会互相污染。
 */

import type {
  PlatformAdapter,
  PlatformBootOptions,
  PlatformRegistration,
  PlatformRegistry,
} from './contract';

/** 注册表内部条目。order 用于同优先级时的稳定排序。 */
interface Entry {
  readonly reg: PlatformRegistration;
  readonly priority: number;
  readonly order: number;
}

const errText = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  return String(err);
};

/**
 * 创建平台注册表。
 *
 * 调用方负责把各平台的 `register(registry)` 调进来；
 * `platform/index.ts` 的 `registerAll()` 就是干这件事的。
 */
export const createRegistry = (): PlatformRegistry => {
  const entries: Entry[] = [];
  const byName = new Map<string, Entry>();

  const register = (reg: PlatformRegistration): void => {
    if (byName.has(reg.name)) {
      throw new Error(
        `平台「${reg.name}」已经注册过了，不能重复注册。` +
          `重复注册会静默覆盖已有实现，请改平台名，或先确认没有别的模块注册了同名平台。`,
      );
    }
    const entry: Entry = { reg, priority: reg.priority ?? 0, order: entries.length };
    entries.push(entry);
    byName.set(reg.name, entry);
  };

  /** 探测顺序：priority 降序；同 priority 按注册先后。 */
  const ordered = (): Entry[] =>
    [...entries].sort((a, b) => b.priority - a.priority || a.order - b.order);

  const resolve = async (opts: PlatformBootOptions): Promise<PlatformAdapter> => {
    const candidates = ordered();
    if (candidates.length === 0) {
      throw new Error(
        '没有注册任何平台实现：请先调用 platform/index.ts 的 registerAll(registry) 再 resolve()。',
      );
    }

    const matched: string[] = [];
    const failed: string[] = [];

    for (const entry of candidates) {
      let ok = false;
      try {
        ok = entry.reg.probe();
      } catch (err) {
        failed.push(`${entry.reg.name}（探测抛错：${errText(err)}）`);
        continue;
      }
      if (!ok) continue;

      matched.push(entry.reg.name);
      try {
        return await entry.reg.factory(opts);
      } catch (err) {
        // 工厂失败不算致命：继续找下一个能起来的平台
        failed.push(`${entry.reg.name}（创建失败：${errText(err)}）`);
      }
    }

    const matchedText = matched.length > 0 ? matched.join('、') : '无';
    const failedText = failed.length > 0 ? `；失败详情：${failed.join('；')}` : '';
    // 候选平台名全部列出来：probe 全不命中时，排查的人需要知道「到底试了谁」
    // （例如宿主环境里 wx 变量名不对，光说"没找到平台"是查不动的）。
    const candidatesText = candidates.map((e) => e.reg.name).join('、');
    throw new Error(
      `没有找到可用的平台实现：已按优先级探测 ${candidates.length} 个平台（${candidatesText}），命中 ${matchedText}。` +
        `请确认当前运行环境是否被某个 probe 覆盖${failedText}`,
    );
  };

  const names = (): string[] => ordered().map((e) => e.reg.name);

  return { register, resolve, names };
};
