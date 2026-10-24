/**
 * 单张图加载的公共工具：`LoadedImage` 形状与超时包装。
 *
 * 为什么单独一个文件：图集加载（`atlas.ts`）与单图加载（`index.ts`）都要用，
 * 放在任何一个里都会让另一个反向依赖它。
 */

/** 平台 `loadImage` 的返回形状（只有尺寸与底层对象，没有 key/矩形）。 */
export interface LoadedImage {
  readonly width: number;
  readonly height: number;
  readonly native: unknown;
}

/** 给一次加载套上超时；超时按失败处理，由调用方决定试下一个候选。 */
export const withTimeout = <T>(task: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`加载超时（${ms}ms）`));
    }, ms);
    task.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
