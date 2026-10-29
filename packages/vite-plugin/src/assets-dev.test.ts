import { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { mgPlugin } from './index';

it.each(['assets', 'media'])('真实dev服务：%s目录的增删、压缩覆盖会更新清单且可通过发布路径读取', async assetsDir => {
  const root = mkdtempSync(join(tmpdir(), 'mg-assets-dev-'));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, assetsDir));
  mkdirSync(join(root, 'assets-pack'));
  writeFileSync(join(root, 'src/main.ts'), "import { manifest } from 'virtual:mg-manifest'; console.log(manifest);");
  const server = await createServer({
    configFile: false, root, logLevel: 'silent',
    plugins: [mgPlugin({ root, target: 'web', assetsDir, design: { width: 390, height: 844 } })],
    server: { host: '127.0.0.1', port: 0, watch: { usePolling: true, interval: 50 } },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('测试服务未监听');
    const url = `http://127.0.0.1:${address.port}`;
    const code = async (): Promise<string> => (await server.transformRequest('virtual:mg-manifest'))?.code ?? '';
    expect(await code()).not.toContain('arena');
    writeFileSync(join(root, assetsDir, 'arena.jpg'), Buffer.alloc(100, 1));
    await expect.poll(code, { timeout: 5000 }).toContain('assets/arena.jpg');
    writeFileSync(join(root, 'assets-pack/arena.webp'), Buffer.alloc(20, 1));
    await expect.poll(code, { timeout: 5000 }).toContain('assets/arena.webp');
    const packed = await fetch(`${url}/assets/arena.webp`);
    expect(packed.status).toBe(200);
    expect(packed.headers.get('content-type')).toBe('image/webp');
    expect((await packed.arrayBuffer()).byteLength).toBe(20);
    unlinkSync(join(root, 'assets-pack/arena.webp'));
    await expect.poll(code, { timeout: 5000 }).toContain('assets/arena.jpg');
    unlinkSync(join(root, assetsDir, 'arena.jpg'));
    await expect.poll(code, { timeout: 5000 }).not.toContain('arena');
    expect((await fetch(`${url}/assets/arena.jpg`)).status).toBe(404);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
