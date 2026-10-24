// 三端真构建用（.mts 后缀是刻意的：tsconfig 的 include 只收 *.ts，避免 tsc 检查这个文件，
// 因为 rolldown 打包 config 时要求 import 显式带 .ts 扩展名，而项目没开 allowImportingTsExtensions）。
// MG_TARGET=web|wx|tt node_modules/vite/bin/vite.js build --config 本文件
import { defineConfig } from 'vite';
import { mgPlugin } from '../../index.ts';

const target = process.env.MG_TARGET ?? 'web';

export default defineConfig({
  plugins: [
    mgPlugin({
      target,
      root: import.meta.dirname,
      design: { width: 960, height: 640 },
      subpackages: { city: ['bg/city_'] },
    }),
  ],
});
