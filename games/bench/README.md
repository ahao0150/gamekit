# Canvas 2D 性能基准（T26，T30 起含离屏缓存对照）

回答一个问题：**Canvas 2D 到底能画多少，什么时候必须上 WebGL。**

这不是游戏、不产出三端包、不进任何产物。它是「一块 390×844 的 canvas + 合成负载 + 测量代码」，
跑完把数据写进 [`docs/perf-bench.md`](../../docs/perf-bench.md)（结论在那里，这里只放怎么跑）。

## 怎么手动打开

```bash
cd games/bench
node ../../node_modules/vite/bin/vite.js --port 5300
# 或
node ../../node_modules/vite/bin/vite.js --port 5300 --strictPort   # 端口被占直接失败
```

浏览器开 `http://127.0.0.1:5300/`：勾负载、填 N（逗号分隔）、点「开始」，页面里直接出表。
页面只能跑 1×（网页无法给自己上 CPU 节流），4× / 6× 必须走下面的自动脚本。

> 端口被占时换一个：`--port 5310`（自动脚本同理，它也会把端口传给 Vite）。
> 团队机器上常有别人的 `mg dev` 占着 51xx/5300，`--strictPort` 会直接失败而不是静默顺延。

## 怎么跑降频矩阵

```bash
cd games/bench
node tools/run-bench.mjs                              # 默认：1×/4×/6× × 4 负载 × N=50..1000
node tools/run-bench.mjs --rates 1,6 --kinds sprite   # 只跑精灵
node tools/run-bench.mjs --ns 100,1000 --frames 200   # 改 N / 帧数
node tools/run-bench.mjs --flush                      # 每帧强制光栅同步（含真实光栅成本）
node tools/run-bench.mjs --dpr 2                      # 高分屏（物理像素 ×4）
node tools/run-bench.mjs --software                   # 软件光栅（CPU 光栅，代表 GPU 极弱的下界）
node tools/run-bench.mjs --skip-ui                    # 跳过离屏对照
node tools/run-bench.mjs --ui-ns 100,200              # 离屏对照的元素数（默认 20/50/100/200）
node tools/run-bench.mjs --out out/matrix.json        # 原始数据落盘
node tools/run-bench.mjs --port 5310                  # 换端口（5300 被占时）
```

脚本自己起 Vite、自己开无头 Chrome、自己收尾（`finally` 里 `browser.close()` + `server.close()`），
**不残留进程**。stdout 是 markdown（可直接贴报告），进度在 stderr。

Chrome 路径可用 `CHROME_PATH` 覆盖；`puppeteer-core` 从 `PUPPETEER_PROJECT` 指定的项目里 require
（本机没有在 gamekit 装 puppeteer，复用已装好的那份）。

## 负载

| kind | 内容 |
|---|---|
| `sprite` | N 次 `drawImage`，64×64，从一次性生成的 512×512 图集取（带图案，不是纯色块） |
| `text` | N 次 `fillText`，14px 中英混排 |
| `rect` | N 次 `fillRect`，64×32 半透明 UI 块 |
| `glow` | N 个 `drawWithGlow` 包裹的 64×64 方块（3 层径向渐变，**真实现**：相对导入 `packages/runtime/src/core/fx/glow.ts`） |
| `ui-direct` | 静态 UI 层（面板 + 图标 + 文字，每个元素 3 次绘制）每帧全部重画 |
| `ui-cached` | 同一份静态 UI 层预先画到离屏 canvas，每帧只 `drawImage` 一次 |
| `ui-layer-cache` | 同一份 UI 层走**引擎实现** `core/render/cache.ts` 的 `createLayerCache`（T30） |

坐标在 `createScene` 时预计算（互质步长 97/131 平铺），`draw` 里只有绘制调用——
否则测出来的是「随机数 + 取模 + 绘制」。

## 测量口径

- **draw**：`performance.now()` 包住 `clearRect` + 场景绘制。不含浏览器合成、不含 rAF 等待。
- **interval**：相邻两次 `rAF` 时间戳差。真实帧间隔；`p95 > 16.7ms` 说明真的掉帧。
- **painted**：跑完读画布第一行与中间行，确认真的有非透明像素（防止「测了个空场景」）。
- 每配置预热 15 帧（丢弃，让 JIT/纹理就位）+ 采样 120 帧；报**中位数 + p95**。
- `--flush` 时每帧末尾 `getImageData(0,0,1,1)` 强制光栅同步，把 GPU 成本纳入 `draw`。
  主矩阵不开它（任务口径是「只算 draw 阶段」），它用于单独验证「提交之外还有多少光栅成本」。
