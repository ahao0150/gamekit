/**
 * dev 端的图集服务：拦截 `/__atlas/*`。
 *
 * 为什么 dev 也要真图集：图集的风险不在 API 形状，在**切图对不对**
 * （排布算错、边缘差 1px、相邻图串色、超出纹理边界）。虚拟图集只统一了返回类型，
 * 这些永远测不出来，只会留到打包上线才暴露。所以 dev 与 build 走同一个 `pack()`。
 *
 * 缓存策略：懒打包（首次请求才打）+ 缓存；`assets/` 变化时由 index.ts 调
 * `invalidate()` 标脏，下次请求重建。重建后必须 **full reload** ——
 * canvas 上已经加载的纹理不会自己换。
 */

import type { Connect } from 'vite';
import type { AtlasResult } from './build';

/** dev 中间件挂载的前缀。 */
export const ATLAS_URL_PREFIX = '/__atlas/';

/**
 * 把图集清单里的**生产路径**改写成 dev 中间件路径。
 *
 * 为什么必须有：`buildAtlas` 给 manifest 登记的是 `assets/atlas-0.png`（打包后的真实路径），
 * 而 dev 模式下这个文件只存在于 build 产物里，Vite dev server 并不服务它 ——
 * 结果图集帧在 dev 下 100% 404，`atlas/dev.ts` 那句「dev 与 build 同一个 pack、
 * 切图问题不会留到上线」就成了假话。dev 下图集页由 {@link createAtlasDevServer} 的
 * `/__atlas/*` 中间件提供，所以这里把候选路径指过去。
 *
 * 纯函数（不读环境），dev/build 的差别由调用方按 `config.command` 决定。
 */
export const devAtlasPaths = (
  manifest: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, readonly string[]>> => {
  const out: Record<string, readonly string[]> = {};
  for (const [key, urls] of Object.entries(manifest)) {
    out[key] = urls.map((url) => `${ATLAS_URL_PREFIX}${url.slice(url.lastIndexOf('/') + 1)}`);
  }
  return out;
};

/** 按 Vite 命令决定清单：dev 走 `/__atlas/`，build 用打包后的真实路径。 */
export const atlasManifestFor = (
  manifest: Readonly<Record<string, readonly string[]>>,
  command: 'serve' | 'build',
): Readonly<Record<string, readonly string[]>> => (command === 'serve' ? devAtlasPaths(manifest) : manifest);

/** 供人查看的清单文件名（运行时读的是 `virtual:mg-atlas`，不读它）。 */
export const ATLAS_JSON_NAME = 'atlas.json';

export interface AtlasDevServer {
  readonly middleware: Connect.NextHandleFunction;
  /** 资源变化时标脏：下次请求重建 */
  invalidate(): void;
  /** 当前是否已有缓存（测试 / 日志用） */
  readonly hasCache: boolean;
}

export const createAtlasDevServer = (rebuild: () => AtlasResult): AtlasDevServer => {
  let cached: AtlasResult | null = null;

  const get = (): AtlasResult => {
    if (cached === null) cached = rebuild();
    return cached;
  };

  const send = (res: Parameters<Connect.NextHandleFunction>[1], status: number, type: string, body: Uint8Array | string): void => {
    res.statusCode = status;
    res.setHeader('content-type', type);
    res.setHeader('cache-control', 'no-store');
    res.end(body);
  };

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = (req.url ?? '').split('?')[0] ?? '';
    if (!url.startsWith(ATLAS_URL_PREFIX)) {
      next();
      return;
    }
    const name = url.slice(ATLAS_URL_PREFIX.length);
    try {
      const result = get();
      if (name === ATLAS_JSON_NAME) {
        send(res, 200, 'application/json; charset=utf-8', `${JSON.stringify(result.build.atlas, null, 2)}\n`);
        return;
      }
      const page = result.build.pages.find((item) => item.name === name);
      if (page === undefined) {
        send(res, 404, 'text/plain; charset=utf-8', `图集页不存在：${name}`);
        return;
      }
      send(res, 200, 'image/png', page.png);
    } catch (error) {
      send(res, 500, 'text/plain; charset=utf-8', `图集构建失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return {
    middleware,
    invalidate(): void {
      cached = null;
    },
    get hasCache(): boolean {
      return cached !== null;
    },
  };
};
