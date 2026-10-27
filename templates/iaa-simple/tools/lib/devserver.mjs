/**
 * 起 / 停 `mg dev`（web 端 Vite dev server），以及准备被测游戏项目。
 *
 * 为什么走 CLI 而不是自己调 Vite API
 * ---------------------------------
 * 门禁要测的是**真实 CLI 路径**（`mg dev` 怎么起 server、打印什么、绑哪里），
 * 自己起一份平行实现等于测了个影子 —— 影子绿了不代表 CLI 绿。
 *
 * 端口归属是这里的核心问题：`mg dev` 早期不接受 --port，Vite 只能自己往后
 * 找空闲端口，这台机器上常常还有别的项目在跑 dev server。实测踩过：我的
 * `mg dev` 打印 5174，而 5174 的 IPv4 上是**别的项目**的静态服务，浏览器
 * 拿到的根本不是被测页面，dev 那半边矩阵测了个寂寞还全绿。
 * 现在 CLI 有了 `--port` / `--strict-port`：端口我们自己挑，被占就直接失败
 * 换下一个，绝不静默顺延到别人的端口上。
 *
 * 收尾：dev server 是进程树（Vite + 子进程），停的时候用 taskkill /T 杀整棵，
 * 否则会留一堆孤儿进程占着端口。
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** 探一个当前空闲的端口（listen(0) 拿到端口号再关掉）。 */
const pickPort = async () => {
  const probe = createNetServer();
  await new Promise((ok, bad) => {
    probe.once('error', bad);
    probe.listen(0, '127.0.0.1', ok);
  });
  const address = probe.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise((ok) => probe.close(ok));
  if (port === 0) throw new Error('探不到空闲端口');
  return port;
};

/** 杀整棵进程树（Windows 上 Vite 有子进程）。 */
const killTree = (pid) => {
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // 杀不掉就退回 child.kill
    }
  }
};

/**
 * 起 `mg dev`，返回 { url, port, html, stop }。
 *
 * @param projectDir 游戏项目根（games/mg-m5）
 * @param repoRoot   仓库根（用来找 packages/cli/bin/mg.mjs）
 */
export const startMgDev = async (projectDir, repoRoot) => {
  const cli = join(repoRoot, 'packages', 'cli', 'bin', 'mg.mjs');
  const attempts = 8;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const port = await pickPort();
    const child = spawn(
      process.execPath,
      [cli, 'dev', '--target', 'web', '--port', String(port), '--strict-port'],
      { cwd: projectDir, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += String(d);
    });
    child.stderr.on('data', (d) => {
      err += String(d);
    });

    // mg dev 会打印 "mg dev: http://127.0.0.1:5173/"，从里面取实际 URL
    let url = '';
    for (let i = 0; i < 600 && url === ''; i += 1) {
      await sleep(100);
      const m = out.match(/mg dev:\s*(https?:\/\/\S+)/);
      if (m && m[1]) {
        url = m[1].replace(/\/$/, '');
        break;
      }
      if (child.exitCode !== null) break;
    }

    if (url === '') {
      const reason = err || out;
      killTree(child.pid);
      try {
        child.kill();
      } catch {
        // 已经退出
      }
      await sleep(200);
      // 端口在探测之后被别人抢走 → strict-port 让我们直接失败，换下一个候选
      if (/already in use|被占用|EADDRINUSE/i.test(reason)) {
        console.log(`  端口 ${port} 被占用，换下一个候选（第 ${attempt}/${attempts} 次）`);
        continue;
      }
      throw new Error(`mg dev 启动失败（端口 ${port}）：${reason.trim() || '(无输出)'}`);
    }

    // dev 模式守卫：首页必须是 vite-plugin 现场生成的 module 入口 + HMR 客户端
    const html = await (await fetch(`${url}/`)).text();
    if (!html.includes('type="module"') || !html.includes('/src/main.ts')) {
      await stopProcess(child);
      throw new Error(`dev 首页不像 dev 模式（缺 module 脚本或 /src/main.ts）：${html.slice(0, 200)}`);
    }
    if (!html.includes('/@vite/client')) {
      await stopProcess(child);
      throw new Error('dev 首页缺 HMR 客户端（/@vite/client），HMR 链路没生效');
    }

    const stop = async () => {
      await stopProcess(child);
    };
    return { url, port, html, stop };
  }

  throw new Error(`mg dev 试了 ${attempts} 个端口都没能起来`);
};

/** 停掉 dev server 进程树。 */
const stopProcess = async (child) => {
  killTree(child.pid);
  try {
    child.kill();
  } catch {
    // 已经退出
  }
  await sleep(300);
};

/**
 * 确保测试用的游戏项目存在且已构建。
 * 没有就现建现构建，保证「一条命令跑完」是自包含的。
 * @returns {{ projectDir: string, created: boolean }} created=本次是否新建的
 */
export const ensureProject = (repoRoot, { rebuild = false } = {}) => {
  const projectDir = join(repoRoot, 'games', 'mg-m5');
  const cli = join(repoRoot, 'packages', 'cli', 'bin', 'mg.mjs');
  const webOut = join(projectDir, 'build', 'web', 'index.html');
  const exists = (p) => existsSync(p);
  if (!rebuild && exists(webOut)) return { projectDir, created: false };
  const run = (args, cwd) => {
    const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
    if (r.status !== 0) {
      throw new Error(`mg ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
    }
    return r.stdout;
  };
  /**
   * 给新建的项目装依赖。
   *
   * 为什么必须：`pnpm-workspace.yaml` 的 packages 含 `games/*`，新项目只有在
   * `pnpm install` 之后才有指向 `packages/runtime` 的 node_modules 链接；
   * 少了这一步，`mg build` 的 typecheck 会报 `Cannot find module '@mg/runtime'`。
   * `mg create` 只是拷模板 + 打印下一步，不负责装依赖。
   */
  const installProject = () => {
    const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const r = spawnSync(pnpm, ['install'], {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: process.platform === 'win32', // .cmd 需要 shell 才能被 spawn
    });
    if (r.status !== 0) {
      throw new Error(`pnpm install 失败：${r.stderr || r.stdout}`);
    }
  };
  // create 要在仓库根跑（它去 templates/ 找模板），build 要在游戏项目根跑
  // （build 的默认 projectRoot 就是 cwd）。
  const created = !exists(join(projectDir, 'src'));
  if (created) {
    // **必须显式指定 iaa-simple**：本门禁读的是 `window.__mg.layout.tapButton`，
    // 那是手写布局链（iaa-simple）的字段；`mg create` 的默认模板是 iaa-ui，
    // 建错模板会让断言在 `layout.tapButton.x` 处崩，而且看起来像适配坏了。
    run(['create', 'mg-m5', '--template', 'iaa-simple'], repoRoot);
    installProject();
  }
  run(['build', '--all'], projectDir);
  return { projectDir, created };
};

/**
 * 删掉验证用的临时游戏项目。
 *
 * 为什么要脚本自己删：门禁是常驻自检，每次跑都现建现建三端产物；
 * 留一份在 games/ 里就是留垃圾，越积越多。删不掉就下次再删
 * （文件锁会随进程退出而释放）。
 */
export const removeProject = (repoRoot) => {
  const projectDir = join(repoRoot, 'games', 'mg-m5');
  for (let i = 0; i < 5; i += 1) {
    try {
      rmSync(projectDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      return true;
    } catch {
      // 锁没释放就再等一轮
    }
  }
  return false;
};
