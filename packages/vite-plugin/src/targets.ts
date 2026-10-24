/**
 * 三端产物：构建选项、平台配置文件、web 的 index.html。
 * Vite 8 / Rolldown：rolldownOptions（不是 rollupOptions）；codeSplitting:false 替代
 * inlineDynamicImports；format 固定 iife。
 */
import type { BuildEnvironmentOptions } from 'vite';
import { orientationOf } from './options';
import type { ResolvedOptions } from './types';
type RolldownOptions = NonNullable<BuildEnvironmentOptions['rolldownOptions']>;
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
/** 三端共用入口，唯一产物是单文件 game.js。 */
export const buildOptions = (options: ResolvedOptions): RolldownOptions => ({
  input: { game: options.entry },
  output: {
    format: 'iife', codeSplitting: false, name: 'GameBundle',
    entryFileNames: 'game.js', chunkFileNames: 'game.js',
    assetFileNames: 'assets/[name][extname]',
  },
});
/** project.config.json：微信 touristappid，抖音 testappid。 */
const projectConfig = (options: ResolvedOptions): Record<string, unknown> => {
  const common = {
    compileType: 'game', projectname: options.projectName,
    setting: { es6: true, urlCheck: false, minified: true, postcss: false, enhance: true },
    condition: {},
  };
  return options.target === 'wx'
    ? { ...common, appid: 'touristappid', description: 'gamekit 构建产物', libVersion: '3.0.0' }
    : { ...common, appid: 'testappid' };
};
/** wx/tt 平台文件；subpackageNames 只传真有文件的分包，不出现空分包。 */
export const platformFiles = (
  options: ResolvedOptions,
  subpackageNames: readonly string[],
): Record<string, string> => {
  if (options.target === 'web') return {};
  const game: Record<string, unknown> = {
    deviceOrientation: orientationOf(options), showStatusBar: false,
  };
  if (options.target === 'wx') game['networkTimeout'] = { request: 10000 };
  if (subpackageNames.length > 0) {
    game['subpackages'] = subpackageNames.map((name) => ({ name, root: `subpackages/${name}/` }));
  }
  return { 'game.json': json(game), 'project.config.json': json(projectConfig(options)) };
};
/**
 * web 的 index.html：一个 canvas + 一个 script。
 *
 * 画布尺寸的分工（E + F 的正解）：
 * - **backing store**（width/height 属性）在这里给出设计分辨率 —— 不给的话
 *   canvas 停在默认 300×150，画面被 CSS 拉伸变形，高 dpr 手机上更糊。
 * - **CSS 显示尺寸不在这里写死**。写死 `width:390px;height:844px` 的后果是
 *   视口比它小的时候画布被裁（真机 360×640 就中招），底部的按钮点不到。
 *   这里只给「不超过视口」的保底，真正的显示尺寸由平台按 design + fit
 *   算好后用 inline style 设上（web 平台知道视口与适配策略，插件不知道）。
 *
 * 两种模式（`mode`）：
 * - `build`（默认）：iife 单文件 `game.js`，小游戏端那套；
 * - `dev`：Vite dev server 的模块入口（`type="module"` + 相对项目根的 URL），
 *   这样 HMR 客户端会被注入、保存即刷新。dev 之前没有这个，`mg dev` 在 web 端
 *   直接 404 —— 因为游戏目录里本来就没有 index.html，它一直是构建时才生成的。
 */
export type IndexMode = 'build' | 'dev';

export const indexHtml = (
  script: string,
  o: ResolvedOptions,
  mode: IndexMode = 'build',
): string => {
  const style =
    'html,body{margin:0;height:100%;background:#2b241c;overflow:hidden;touch-action:none}' +
    'body{display:flex;align-items:center;justify-content:center}' +
    'canvas{display:block;max-width:100%;max-height:100%;touch-action:none}';
  const view = 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover';
  const tag =
    mode === 'dev'
      ? `<script type="module" src="/${script}"></script>`
      : `<script src="./${script}"></script>`;
  return [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />',
    `<meta name="viewport" content="${view}" /><title>${o.title}</title>`,
    `<link rel="icon" href="data:," /><style>${style}</style></head><body>`,
    `<canvas id="game" width="${o.design.width}" height="${o.design.height}"></canvas>${tag}`,
    '</body></html>',
  ].join('');
};
