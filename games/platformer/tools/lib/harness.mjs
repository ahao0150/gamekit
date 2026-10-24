/**
 * M5 验证用的三个工具：静态服务、headless Chrome、CDP 客户端。
 *
 * 为什么零依赖：
 * 仓库里没有 puppeteer，而 puppeteer-core 也要 NODE_PATH 绕。Node 24 自带
 * WebSocket，直接说 CDP 协议反而更可控 —— 每一条命令都看得见，
 * 「真点击」就是 Input.dispatchMouseEvent，不存在「框架替我们模拟了点击」的可能。
 *
 * 生命周期纪律：
 * - 静态服务与 Chrome 都由本文件启动、由本文件关闭；
 * - 端口用 listen(0) 随机分配，绝不占用 8123/3000/8080 这类公共端口；
 * - Chrome 用临时 profile 目录，跑完整个删掉，不留残留进程与缓存。
 */

import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
};

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
];

/** 找 Chrome。找不到就抛中文错误，别让调用方猜。 */
export const findChrome = () => {
  for (const p of CHROME_CANDIDATES) {
    if (p && existsSync(p)) return p;
  }
  throw new Error('找不到 Chrome，试过：' + CHROME_CANDIDATES.join(' / '));
};

/** 起一个静态服务（随机端口）。返回 { url, close }。 */
export const startStaticServer = async (dir) => {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const file = resolve(root, rel);
    if (!file.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    readFile(file)
      .then((buf) => {
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
        res.end(buf);
      })
      .catch(() => {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    // 关闭必须**有超时兜底**：浏览器可能还留着 keep-alive 连接，
    // server.close() 会一直等它们结束 → 整个验证卡在收尾。
    close: () =>
      new Promise((ok) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          ok();
        };
        server.close(finish);
        server.closeAllConnections?.();
        setTimeout(finish, 2000);
      }),
  };
};

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * 清掉之前遗留的临时 profile 目录。
 *
 * 收尾时删目录常常删得掉（Chrome 的 crashpad-handler 还没退，文件还锁着），
 * 但**下次启动时一定删得掉**（进程都没了）。所以启动先扫一遍，
 * 目录就不会越积越多。
 */
export const purgeStaleProfiles = () => {
  const base = tmpdir();
  let names = [];
  try {
    names = readdirSync(base);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith('mg-m5-chrome-')) continue;
    try {
      rmSync(join(base, name), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      // 删不掉就留着，下次再试
    }
  }
};

/** 本进程创建过的 Chrome 临时 profile 目录。 */
const createdProfiles = [];

/**
 * 统一清理临时 profile 目录。
 * 单独删一个目录时，Chrome 的子进程可能还没放手（Windows 文件锁）→ 删不掉。
 * 等所有 Chrome 都退出后再统一删一遍，锁就释放了。
 */
export const cleanupProfiles = async () => {
  // 等 Chrome 及其 crashpad-handler 子进程彻底退出，文件锁才会释放
  await sleep(1500);
  for (const dir of createdProfiles) {
    for (let i = 0; i < 8; i += 1) {
      try {
        await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        break;
      } catch {
        await sleep(500);
      }
    }
  }
  createdProfiles.length = 0;
};

/** 起 headless Chrome，等 DevTools 端口就绪。返回 { port, kill }。 */
export const startChrome = async ({ width = 390, height = 844 } = {}) => {
  const chromePath = findChrome();
  const profile = join(tmpdir(), `mg-m5-chrome-${Date.now()}-${process.pid}`);
  createdProfiles.push(profile);
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--mute-audio',
      '--disable-extensions',
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const portFile = join(profile, 'DevToolsActivePort');
  let port = 0;
  for (let i = 0; i < 100 && port === 0; i += 1) {
    await sleep(100);
    if (!existsSync(portFile)) continue;
    let text = '';
    try {
      text = readFileSync(portFile, 'utf8');
    } catch {
      // Windows 上 Chrome 正在写这个文件时是独占锁 → readFileSync 报 EBUSY。
      // 这是时序竞争不是故障，下一轮再读就行（100 轮 × 100ms = 10 秒上限）。
      continue;
    }
    const first = text.split('\n')[0]?.trim();
    if (first && /^\d+$/.test(first)) port = Number(first);
  }
  if (port === 0) {
    child.kill();
    throw new Error('Chrome 没有在 10 秒内就绪（DevToolsActivePort 没出现）');
  }

  const kill = async () => {
    // Windows 上 Chrome 是一棵进程树（gpu / utility / renderer / crashpad）。
    // 只 kill 父进程的话，子进程还占着 profile 目录 → 删目录卡住、进程残留。
    // 所以先 taskkill /T 杀整棵树，再删目录，两步都带兜底。
    if (process.platform === 'win32') {
      try {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        // 杀不掉就交给下面的 child.kill
      }
    }
    try {
      child.kill();
    } catch {
      // 已经退出
    }
    await sleep(400);
    // 这里**不删目录**：Chrome 的 crashpad-handler 子进程退出得慢，
    // 此刻文件还锁着，删不掉。目录统一交给 cleanupProfiles，
    // 等所有 Chrome 都退了再删（那时锁已释放）。
  };
  return { port, kill, profile };
};

/** CDP 客户端：一条命令一个 Promise，事件进队列。 */
export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.events = [];
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((ok, bad) => {
      ws.onopen = () => ok();
      ws.onerror = () => bad(new Error('CDP WebSocket 连接失败：' + url));
    });
    const cdp = new Cdp(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && cdp.pending.has(msg.id)) {
        const { ok, bad } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
        if (msg.error) bad(new Error(`${msg.error.message}（${msg.error.code ?? ''}）`));
        else ok(msg.result);
        return;
      }
      cdp.events.push(msg);
    };
    return cdp;
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((ok, bad) => {
      this.pending.set(id, { ok, bad });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        bad(new Error(`CDP 超时：${method}`));
      }, 30000);
    });
  }

  /** 在页面里求值并取回 JSON 值。 */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text;
      throw new Error('页面脚本异常：' + d);
    }
    return r.result.value;
  }

  /** 轮询直到表达式为真。 */
  async waitFor(expression, { timeoutMs = 15000, label = expression } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const v = await this.eval(`(() => { try { return ${expression}; } catch { return false; } })()`);
      if (v) return v;
      if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
      await sleep(120);
    }
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // 已关闭
    }
  }
}

/** 找到第一个 page target 并连上它。 */
export const connectToPage = async (port) => {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) throw new Error('Chrome 里找不到 page target');
  return Cdp.connect(page.webSocketDebuggerUrl);
};
