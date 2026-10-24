/**
 * 基准页面（T26）：手动跑 + 给自动脚本用的 `window.__bench` API。
 *
 * 页面自己对页面做的是 1× CPU（浏览器不允许网页给自己上 CDP 节流），
 * 4× / 6× 的降频矩阵由 `tools/run-bench.mjs` 通过 DevTools 协议驱动。
 */
import { createAtlas } from './atlas';
import type { Atlas } from './atlas';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, configureStage, runScene } from './bench';
import type { RunResult, Stage } from './bench';
import { fixed2 } from './stats';
import { SCENE_KINDS, SCENE_LABELS, createScene } from './scenes';
import type { SceneKind } from './scenes';

/** 给 puppeteer 的任务书：跑一个「负载 × 数量」配置。 */
export interface BenchRunRequest {
  readonly kind: SceneKind;
  readonly n: number;
  readonly frames?: number;
  readonly warmup?: number;
  readonly flush?: boolean;
  readonly dpr?: number;
}

/** 页面运行环境（写进报告，证明数据出自哪台机器 / 哪个渲染后端）。 */
export interface BenchEnv {
  readonly ua: string;
  readonly renderer: string;
  readonly dpr: number;
  readonly viewport: string;
}

/** 挂在 `window.__bench` 上的能力。 */
export interface BenchApi {
  readonly ready: true;
  readonly env: BenchEnv;
  run: (request: BenchRunRequest) => Promise<RunResult>;
  setDpr: (dpr: number) => void;
}

declare global {
  interface Window {
    __bench?: BenchApi;
  }
}

interface RendererInfoExtension {
  readonly UNMASKED_RENDERER_WEBGL: number;
}

const isRendererInfo = (value: unknown): value is RendererInfoExtension =>
  typeof value === 'object' && value !== null && 'UNMASKED_RENDERER_WEBGL' in value;

const collectEnv = (): BenchEnv => {
  let renderer = 'unknown';
  const probeCanvas = document.createElement('canvas');
  const gl = probeCanvas.getContext('webgl');
  if (gl !== null) {
    const ext: unknown = gl.getExtension('WEBGL_debug_renderer_info');
    if (isRendererInfo(ext)) {
      renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    }
  }
  return {
    ua: navigator.userAgent,
    renderer,
    dpr: window.devicePixelRatio,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
  };
};

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
if (canvas === null) throw new Error('页面缺少 #stage 画布');

let currentDpr = 1;
let stage: Stage = configureStage(canvas, currentDpr);
const atlas: Atlas = createAtlas();

const buildSceneEnv = (dpr: number) => ({
  width: LOGICAL_WIDTH,
  height: LOGICAL_HEIGHT,
  dpr,
  atlas,
});

let cancelled = false;

const runOne = async (request: BenchRunRequest): Promise<RunResult> => {
  const dpr = request.dpr ?? currentDpr;
  if (dpr !== currentDpr) {
    currentDpr = dpr;
    stage = configureStage(canvas, dpr);
  }
  const scene = createScene(request.kind, request.n, buildSceneEnv(dpr));
  return runScene(stage, scene, {
    frames: request.frames ?? 120,
    warmup: request.warmup ?? 15,
    flush: request.flush ?? false,
    shouldStop: () => cancelled,
  });
};

// ---- 页面 UI ----

const kindsBox = document.querySelector<HTMLElement>('#kinds');
const nsInput = document.querySelector<HTMLInputElement>('#ns');
const framesInput = document.querySelector<HTMLInputElement>('#frames');
const dprInput = document.querySelector<HTMLInputElement>('#dpr');
const runButton = document.querySelector<HTMLButtonElement>('#run');
const stopButton = document.querySelector<HTMLButtonElement>('#stop');
const statusBox = document.querySelector<HTMLElement>('#status');
const resultsBox = document.querySelector<HTMLElement>('#results');
const envBox = document.querySelector<HTMLElement>('#env');

const setStatus = (text: string): void => {
  if (statusBox !== null) statusBox.textContent = text;
};

const selectedKinds = new Set<SceneKind>();
if (kindsBox !== null) {
  for (const kind of SCENE_KINDS) {
    const label = document.createElement('label');
    label.className = 'chk';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.addEventListener('change', () => {
      if (box.checked) selectedKinds.add(kind);
      else selectedKinds.delete(kind);
    });
    selectedKinds.add(kind);
    label.append(box, document.createTextNode(SCENE_LABELS[kind]));
    kindsBox.append(label);
  }
}

const parseNs = (raw: string): number[] => {
  const out: number[] = [];
  for (const part of raw.split(',')) {
    const value = Number(part.trim());
    if (Number.isFinite(value) && value >= 0) out.push(Math.floor(value));
  }
  return out;
};

const cells = new Map<string, RunResult>();
const cellKey = (kind: SceneKind, n: number): string => `${kind}@${n}`;

const cellClass = (p95: number): string => (p95 > 16.7 ? 'bad' : p95 > 8 ? 'warn' : 'ok');

const renderTable = (ns: readonly number[]): void => {
  if (resultsBox === null) return;
  resultsBox.replaceChildren();
  if (cells.size === 0) return;

  const caption = document.createElement('h2');
  caption.textContent = '结果（中位数 / p95，毫秒）';
  const table = document.createElement('table');
  const head = document.createElement('tr');
  const kindHead = document.createElement('th');
  kindHead.className = 'kind';
  kindHead.textContent = '负载';
  head.append(kindHead);
  for (const n of ns) {
    const th = document.createElement('th');
    th.textContent = `N=${n}`;
    head.append(th);
  }
  table.append(head);

  for (const kind of SCENE_KINDS) {
    if (!ns.some((n) => cells.has(cellKey(kind, n)))) continue;
    const row = document.createElement('tr');
    const name = document.createElement('td');
    name.className = 'kind';
    name.textContent = SCENE_LABELS[kind];
    row.append(name);
    for (const n of ns) {
      const td = document.createElement('td');
      const result = cells.get(cellKey(kind, n));
      if (result === undefined) {
        td.textContent = '—';
      } else {
        td.className = cellClass(result.draw.p95);
        td.textContent = `${fixed2(result.draw.median)} / ${fixed2(result.draw.p95)}`;
        td.title = `帧间隔 p95 ${fixed2(result.interval.p95)}ms · 采样 ${result.frames} 帧 · ${result.painted ? '像素非空' : '像素为空'}`;
      }
      row.append(td);
    }
    table.append(row);
  }
  resultsBox.append(caption, table);

  const legend = document.createElement('p');
  legend.className = 'note';
  legend.textContent = '绿：p95 ≤ 8ms　黄：8–16.7ms　红：> 16.7ms（掉帧）。格子内的数值是 draw 中位数 / p95。';
  resultsBox.append(legend);
};

const renderEnv = (): void => {
  if (envBox === null) return;
  const env = collectEnv();
  envBox.replaceChildren();
  const title = document.createElement('h2');
  title.textContent = '运行环境';
  const pre = document.createElement('pre');
  pre.textContent = [
    `UA       ${env.ua}`,
    `Renderer ${env.renderer}`,
    `DPR      ${env.dpr}`,
    `Viewport ${env.viewport}`,
    `Canvas   ${LOGICAL_WIDTH}×${LOGICAL_HEIGHT} 逻辑像素（measure 画布）`,
  ].join('\n');
  envBox.append(title, pre);
};

const runSelected = async (): Promise<void> => {
  if (runButton === null || nsInput === null || framesInput === null) return;
  const ns = parseNs(nsInput.value);
  const frames = Math.max(20, Math.floor(Number(framesInput.value) || 120));
  const dpr = Number(dprInput?.value ?? 1) || 1;
  if (ns.length === 0 || selectedKinds.size === 0) {
    setStatus('至少选一个负载、一个 N');
    return;
  }
  if (dpr !== currentDpr) {
    currentDpr = dpr;
    stage = configureStage(canvas, dpr);
  }
  cancelled = false;
  runButton.disabled = true;
  if (stopButton !== null) stopButton.disabled = false;
  cells.clear();
  const startedAt = performance.now();
  let done = 0;
  const total = selectedKinds.size * ns.length;
  for (const kind of SCENE_KINDS) {
    if (!selectedKinds.has(kind)) continue;
    for (const n of ns) {
      setStatus(`跑 ${SCENE_LABELS[kind]} · N=${n}（${done + 1}/${total}）`);
      const result = await runOne({ kind, n, frames, warmup: 15, dpr });
      cells.set(cellKey(kind, n), result);
      done += 1;
      if (cancelled) break;
    }
    if (cancelled) break;
  }
  runButton.disabled = false;
  if (stopButton !== null) stopButton.disabled = true;
  renderTable(ns);
  const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
  setStatus(cancelled ? `已停止（完成 ${done}/${total}，${seconds}s）` : `完成 ${done}/${total}，耗时 ${seconds}s`);
};

runButton?.addEventListener('click', () => {
  void runSelected();
});
stopButton?.addEventListener('click', () => {
  cancelled = true;
  setStatus('正在停止…');
});

renderEnv();
window.__bench = {
  ready: true,
  env: collectEnv(),
  run: runOne,
  setDpr: (dpr: number) => {
    currentDpr = dpr;
    stage = configureStage(canvas, dpr);
  },
};
setStatus('就绪');
