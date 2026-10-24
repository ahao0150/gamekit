/**
 * 静态服务 + 本机 Chrome 探测：与游戏无关的基础设施。
 *
 * 只负责「把 build/web 用 http 端出去」和「找到可用的 Chrome」，
 * 不含任何流程 / 断言语义（那部分在 steps.mjs / flow.mjs）。
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);

/** 起一个只读静态服务，根目录 = games/<slug>/build/web，返回 { server, url }。 */
export const startStaticServer = (root) =>
  new Promise((done, reject) => {
    const server = createServer((request, response) => {
      try {
        const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
        if (pathname === '/favicon.ico') {
          response.writeHead(204);
          response.end();
          return;
        }
        const filePath = resolve(root, pathname.replace(/^\/+/, ''));
        if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
          response.writeHead(403);
          response.end('forbidden');
          return;
        }
        let target = filePath;
        if (!existsSync(target) || statSync(target).isDirectory()) {
          const indexFile = join(target, 'index.html');
          if (existsSync(indexFile) && statSync(indexFile).isFile()) target = indexFile;
          else if (extname(target) === '') target = join(root, 'index.html');
        }
        if (!existsSync(target) || !statSync(target).isFile()) {
          response.writeHead(404);
          response.end('not found');
          return;
        }
        const stat = statSync(target);
        response.writeHead(200, {
          'Content-Type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
          'Content-Length': stat.size,
          'Cache-Control': 'no-store',
        });
        createReadStream(target).pipe(response);
      } catch {
        response.writeHead(500);
        response.end('server error');
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      done({ server, url: `http://127.0.0.1:${port}/` });
    });
  });

/** --chrome > CHROME_PATH > 常见安装路径。找不到就报明确错误。 */
export const resolveChrome = (explicit) => {
  if (explicit !== undefined) {
    if (!existsSync(explicit)) throw new Error(`--chrome 指向的文件不存在：${explicit}`);
    return explicit;
  }
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error('找不到 Chrome/Chromium。用 --chrome <path> 或环境变量 CHROME_PATH 指定。');
  }
  return found;
};
