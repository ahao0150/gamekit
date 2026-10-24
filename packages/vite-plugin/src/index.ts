/**
 * `@mg/vite` 三端构建插件：产物 + 资源 + 包体报告。
 * 资源不进 Vite asset 管线（小游戏没有 fetch/new URL）；禁止 code splitting（唯一产物 game.js）；
 * Vite 8 用 rolldownOptions / codeSplitting:false。
 * 构建期注入 `virtual:mg-manifest`（只含真进包的文件）与 `virtual:mg-config`。
 */
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';
import { buildManifest, declaredSubpackages, manifestCode, outPathOf, pickAssets } from './assets';
import { buildAtlas, atlasOutPath } from './atlas/build';
import type { AtlasResult } from './atlas/build';
import { ATLAS_JSON_NAME, atlasManifestFor, createAtlasDevServer } from './atlas/dev';
import { compileEconomyDir } from './economy';
import { resolveOptions } from './options';
import { computeReport, formatReport, listFiles } from './report';
import { buildOptions, indexHtml, platformFiles } from './targets';
import type { AssetFile, MgPluginOptions, MgTarget, ResolvedOptions } from './types';
export const MANIFEST_ID = 'virtual:mg-manifest';
export const CONFIG_ID = 'virtual:mg-config';
export const ATLAS_ID = 'virtual:mg-atlas';
export const MANIFEST_FILE = 'asset-manifest.json';
const MANIFEST_RESOLVED = `\0${MANIFEST_ID}`;
const CONFIG_RESOLVED = `\0${CONFIG_ID}`;
const ATLAS_RESOLVED = `\0${ATLAS_ID}`;
const STUB_ID = '\0mg:platform-stub';
/** 每个 target 保留的平台实现；其余平台代码不进包。 */
const KEEP: Readonly<Record<MgTarget, string>> = { web: './web', wx: './wechat', tt: './douyin' };
const PLATFORMS: readonly string[] = ['./web', './wechat', './douyin', './mock'];
const configCode = (o: ResolvedOptions): string =>
  `export const target = ${JSON.stringify(o.target)};\n` +
  `export const design = ${JSON.stringify(o.design)};\n` +
  `export const fit = ${JSON.stringify(o.fit)};\n` +
  'export const assetsBase = "assets/";\n';
const norm = (path: string): string => path.replace(/\\/g, '/');
export const mgPlugin = (options: MgPluginOptions): Plugin => {
  const resolved = resolveOptions(options);
  let assets: readonly AssetFile[] = [];
  /** 图集结果：懒构建 + 缓存（dev 首次请求才打，build 在 load/writeBundle 时打） */
  let atlas: AtlasResult | null = null;
  /** Vite 命令：dev 下图集页走 `/__atlas/` 中间件，manifest 路径要改写（否则 404） */
  let command: 'serve' | 'build' = 'build';
  /**
   * 确保图集已构建。**dev 与 build 都走这里 → 同一个 `buildAtlas` → 同一份形状**。
   * 未启用图集时返回 null，所有调用点都必须能处理 null。
   */
  const ensureAtlas = (): AtlasResult | null => {
    if (resolved.atlas === null) return null;
    if (atlas === null) {
      atlas = buildAtlas(assets, resolved.atlas);
      for (const warning of atlas.warnings) console.warn(`[mg atlas] ${warning}`);
    }
    return atlas;
  };
  return {
    name: 'gamekit:mg',
    enforce: 'pre',
    config() {
      return {
        root: resolved.root,
        build: {
          outDir: resolved.outDir, emptyOutDir: true, copyPublicDir: false,
          assetsInlineLimit: 0, cssCodeSplit: false, modulePreload: false,
          reportCompressedSize: false, rolldownOptions: buildOptions(resolved),
        },
      };
    },
    /** 记下命令：`load(MANIFEST_ID)` 要按 dev/build 给不同的图集路径。 */
    configResolved(config) {
      command = config.command === 'serve' ? 'serve' : 'build';
    },
    /**
     * dev server 的 HTML 入口。
     *
     * 为什么需要这段：web 的 index.html 只在 `generateBundle` 里产出，游戏目录本身
     * 没有这个文件。所以 `mg dev`（Vite dev server）在 web 端会直接 404 ——
     * 根目录没有 index.html 可服务。这里在 dev 请求 `/` 时按同一份模板现场生成
     * HTML，再交给 Vite 的 `transformIndexHtml`（它会注入 HMR 客户端与模块重写），
     * 于是保存即刷新、模块热更新都能用。
     *
     * 只对 web 生效：wx/tt 的 `mg dev` 走的是 `build --watch`，不需要 HTML。
     */
    configureServer(server) {
      // 图集中间件先挂：`/__atlas/*` 与 HTML 无关，且 dev 与 build 走同一个 pack()
      if (resolved.atlas !== null) {
        const dev = createAtlasDevServer(() => {
          const result = ensureAtlas();
          if (result === null) throw new Error('图集未启用');
          return result;
        });
        server.middlewares.use(dev.middleware);
        // assets/ 变化 → 标脏 + 强制整页重载（canvas 已加载的纹理不会自己换）
        server.watcher.add(resolved.assetsDir);
        server.watcher.on('all', (_event, file) => {
          if (!file.startsWith(resolved.assetsDir)) return;
          atlas = null;
          dev.invalidate();
          server.ws.send({ type: 'full-reload' });
        });
      }
      if (resolved.target !== 'web') return;
      const devEntry = relative(resolved.root, resolved.entry).split(sep).join('/');
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '/').split('?')[0] ?? '/';
        if (url !== '/' && url !== '/index.html') {
          next();
          return;
        }
        void (async () => {
          try {
            const html = indexHtml(devEntry, resolved, 'dev');
            const out = await server.transformIndexHtml(url, html);
            res.statusCode = 200;
            res.setHeader('content-type', 'text/html; charset=utf-8');
            res.end(out);
          } catch (error) {
            next(error as Error);
          }
        })();
      });
    },
    buildStart() {
      if (resolved.economyDir !== null) {
        compileEconomyDir(resolved.economyDir);
      }
      const picked = pickAssets(resolved); // watch 模式每次重建都重新择优
      assets = picked.assets;
      atlas = null; // 资源变了，图集必须重建
      for (const warning of picked.warnings) this.warn(warning);
    },
    resolveId(id, importer) {
      if (id === MANIFEST_ID) return MANIFEST_RESOLVED;
      if (id === CONFIG_ID) return CONFIG_RESOLVED;
      if (id === ATLAS_ID) return ATLAS_RESOLVED;
      if (id === STUB_ID) return STUB_ID;
      if (importer === undefined || !PLATFORMS.includes(id)) return null;
      // 只裁剪 platform/index.ts 的平台注册 import，其他相对 import 不碰
      if (!norm(importer).endsWith('/platform/index.ts')) return null;
      return id === KEEP[resolved.target] ? null : STUB_ID;
    },
    load(id) {
      if (id === MANIFEST_RESOLVED) {
        // 清单里要带图集页条目（`@atlas/atlas-0.png`），否则运行时找不到图集图。
        // dev 下那个文件不存在，必须把候选路径改成 `/__atlas/*`（见 atlas/dev.ts）。
        return manifestCode(assets, atlasManifestFor(ensureAtlas()?.manifest ?? {}, command));
      }
      if (id === ATLAS_RESOLVED) {
        // 结构：{ version, atlases, frames }；未启用图集时为 null
        return `export const atlas = ${JSON.stringify(ensureAtlas()?.build.atlas ?? null)};\nexport default atlas;\n`;
      }
      if (id === CONFIG_RESOLVED) return configCode(resolved);
      if (id === STUB_ID) return 'export const register = () => {};\n';
      return null;
    },
    generateBundle(_output, bundle) {
      if (resolved.target !== 'web') return;
      const entry = Object.values(bundle).find((file) => file.type === 'chunk' && file.isEntry);
      if (entry === undefined) return;
      const source = indexHtml(entry.fileName, resolved);
      this.emitFile({ type: 'asset', fileName: 'index.html', source });
    },
    writeBundle() {
      const { outDir } = resolved;
      const built = ensureAtlas();
      const packed = built?.packedKeys ?? new Set<string>();
      // 进了图集的图**不再当单图拷贝**：否则同一张图在包里出现两份
      const singles = assets.filter((asset) => !packed.has(asset.key));
      for (const asset of singles) {
        const target = join(outDir, outPathOf(asset));
        mkdirSync(dirname(target), { recursive: true });
        cpSync(asset.from, target);
      }
      if (built !== null) {
        for (const page of built.build.pages) {
          const target = join(outDir, atlasOutPath(page.name));
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, page.png);
        }
        // 落一份给人看的 atlas.json（运行时读的是 virtual:mg-atlas）
        writeFileSync(join(outDir, 'assets', ATLAS_JSON_NAME), `${JSON.stringify(built.build.atlas, null, 2)}\n`);
      }
      const subs = declaredSubpackages(singles, resolved.subpackages);
      writeFileSync(
        join(outDir, MANIFEST_FILE),
        `${JSON.stringify(buildManifest(singles, built?.manifest ?? {}), null, 2)}\n`,
      );
      for (const [name, content] of Object.entries(platformFiles(resolved, subs))) {
        writeFileSync(join(outDir, name), content);
      }
      const report = computeReport(listFiles(outDir), subs);
      console.log(formatReport(report, resolved.target));
    },
  };
};
export { pickAssets, buildManifest, declaredSubpackages, outPathOf, baseOf } from './assets';
export { resolveOptions, orientationOf } from './options';
export { computeReport, formatReport, listFiles, kb } from './report';
export { platformFiles, indexHtml, buildOptions } from './targets';
export type { FileSize } from './report';
export type {
  AssetFile, BundleReport, MgAtlasOptions, MgDesign, MgFit, MgManifest,
  MgPluginOptions, MgSubpackages, MgTarget, ResolvedAtlas, ResolvedOptions,
} from './types';
