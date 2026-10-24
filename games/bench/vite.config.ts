/**
 * bench 的 Vite 配置（T26）。
 *
 * 为什么不走 `mg dev`：bench 不是游戏、不产出三端包，它只是「一块 canvas + 测量代码」。
 * `mg dev` 会挂 `@mg/vite`（构建/资源管线），对基准来说是无关噪声；
 * 直接用裸 Vite 起，测的就是这一个页面。
 *
 * `fs.allow: ['../..']`：scenes 从 `packages/runtime/src/core/fx/` 相对导入真实的
 * `drawWithGlow`（测特效成本必须测真实现，不能抄一份近似）。该目录在 Vite root
 * （games/bench）之外，必须显式放行。
 */
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5300,
    strictPort: true,
    fs: { allow: ['../..'] },
  },
});
