/**
 * assets 测试的公共夹具（`index.test.ts` 与 `atlas.test.ts` 共用）。
 *
 * 为什么抽出来：两个文件各写一份假加载器，断言迟早会各自漂移。
 */

export interface MockImage {
  readonly width: number;
  readonly height: number;
  readonly native: unknown;
}

export type Loader = (src: string) => Promise<MockImage | null>;

export const image = (width: number, height: number, native: unknown): MockImage => ({ width, height, native });

export function makeLoader(map: Record<string, () => Promise<MockImage | null>>): {
  loadImage: Loader;
  calls: string[];
} {
  const calls: string[] = [];
  const loadImage: Loader = (src) => {
    calls.push(src);
    const handler = map[src];
    return handler === undefined ? Promise.resolve(null) : handler();
  };
  return { loadImage, calls };
}

export const ok = (width = 32, height = 16, native: unknown = 'img'): (() => Promise<MockImage | null>) => () =>
  Promise.resolve(image(width, height, native));
