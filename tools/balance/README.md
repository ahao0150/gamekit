# 平衡 bot（回归用）

用真实触摸事件打完整一局，给数值表做「能玩 / 不能玩」的回归。设计文档里的需求 DPS 是手算模型，
这里是对模型的实测校验（对应 PRD `A20` / `A21`）。

## 用法

```bash
# 两个 bot 各跑 3 局取中位（默认会先 mg build --all）
node tools/balance/run.mjs nuo-zhen

# 只跑弱 bot，1 局，跳过构建
node tools/balance/run.mjs nuo-zhen --bots weak --runs 1 --no-build

# 打已有服务（不启静态服务、不构建）
node tools/balance/run.mjs nuo-zhen --url http://127.0.0.1:5297/ --no-build
```

参数：`--bots weak,normal` / `--runs <n>` / `--seed <n>` / `--timeout <分钟>` / `--chrome <path>` /
`--out <dir>`。默认结果目录 `games/<slug>/artifacts/bots/`，每局一个 `<bot>-run<i>.json` +
`<bot>-median.json` + `result.json` 汇总。

退出码：任一 bot 的中位局不满足口径 → `1`（适合直接当回归门禁）。

## 口径（写死在 `games/<slug>.mjs` 的 `policies.*.judge`）

《挪阵》（`games/nuo-zhen.mjs`）：

| bot | 行为 | 判定 |
|---|---|---|
| `weak` | 只建飞剑阵、不移阵、不选卡（固定拿第一张），会升阶 | W6 结束累计漏 ≥8，且中位局 W8 之后败北 |
| `normal` | 按波次换克制阵、贪心升级、按压力搬阵、每波提前召唤 + 选卡 | 中位局打到 W12 通关且总漏 ≤5 |

## 设计约束（别破坏）

- **不写状态**：只读 `__mg.state / __mg.geom / __mg.layout`，输入走 CDP `Input.dispatchTouchEvent`。
- **固定种子**：`evaluateOnNewDocument` 在页面脚本之前覆写 `Math.random`（mulberry32），第 i 局种子 = `seed + i*7919`。
  注意：主循环按真实时间推进，帧率抖动仍会带来少量差异——所以跑 3 局取中位，不追求逐帧复现。
- **不加速时间**：不给游戏加时间倍速，否则「600ms 装配 / 40s 一波」这些手感判据会失真。
- **一局一个空白页**：每次 `browser.newPage()`，避免 localStorage 存档/卡池状态串局。

## 新增一个游戏

1. 新建 `tools/balance/games/<slug>.mjs`，导出 `policies = { weak, normal }`，
   每个 policy 形如 `{ create: () => ({ async step(ctx) {} }), judge(results, median) }`。
2. `ctx` 里有：`driver`（`tap/tapKey/drag/state/geom/layout/shot`）、`state`、`battle`、`stats`、`timeline`、`elapsed`。
3. `step` 每次调用只做一两个动作（runner 每 ~200ms 调一次），返回后 runner 读下一个快照。
