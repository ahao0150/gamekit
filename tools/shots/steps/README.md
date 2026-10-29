# 验收截图步骤配置

每款游戏一份 `steps/<slug>.json`。`tools/shots/shots.mjs` 里不再有任何游戏专属键名：
开始按钮、点击目标、屏幕字段、进度断言全部由这里的配置决定。

没有配置的游戏仍可跑：用通用默认流程（首页点开始 → 等结算），
并打印「没有步骤配置 …」的明确提示，缺 key 记 SKIP 而不是静默失败。

## 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `slug` | 否 | 游戏目录名（只做标注，不参与逻辑） |
| `screenPath` | 否 | 期望与日志读取的屏幕字段，默认 `state.screen`（如 `state.phase`） |
| `start` | 否 | 开始按钮的 layout key，默认 `startButton`；`--start` 可覆盖 |
| `maxSteps` | 否 | 步骤上限，默认 8；`steps.length` 超过直接报配置错误 |
| `steps` | **是** | 步骤数组，至少一步 |
| `resultButtons` | 否 | 结算页可点按钮的候选 key；若最终停在结算屏，至少命中一个才算通过 |

### 步骤

| 字段 | 默认 | 说明 |
|---|---|---|
| `name` | — | 必填，唯一；用于报告和截图文件名 `mobile-<序号>-<name>.png` |
| `tap` | — | 点一次的目标（只写一次） |
| `taps` | — | 多个目标，按顺序循环点，直到期望达成或超时 |
| `drag` | — | `{ "from": 目标, "to": 目标 }`，真实拖拽（移动端 touch，桌面 mouse） |
| `expect` | — | 必填。`screen` / `assert` / `any` / `all` 可组合（同时满足） |
| `timeoutMs` | 8000 | 该步最多等多久 |
| `tapMs` | 300（或 `--tap-ms`） | 两次操作之间的间隔 |
| `required` | true | `false` 时没达成记 SKIP，不算失败 |
| `shot` | true | 该步结束时是否截图 |

### 目标（tap / taps / drag.from / drag.to 通用）

```json
{ "start": true }                          // 配置里的 start（--start 覆盖）
{ "key": "primaryButton" }                 // layout 矩形中心
{ "key": "infoPanel", "rel": [0.5, 0.5] }  // layout 矩形内的相对点（0..1）
{ "key": "cards", "index": 0 }             // layout 数组元素的中心（同 cards[0]）
{ "point": [0.5, 0.7] }                    // 视口相对坐标（0..1）
{ "geom": "arrows" }                       // __mg.geom.arrows 里所有矩形，循环逐个点
```

`layout` 里的数组会被摊平成 `key[i]`（例如某款游戏的 `cards[0]`）。
`geom` 支持两种元素：直接是 `{x,y,w,h}`，或带 `rect: {x,y,w,h}` 的对象。

### 断言

```json
{ "path": "state.moves", "op": "gt", "value": 0 }
{ "path": "state.placed.length", "op": "gt", "value": 0 }
{ "path": "state.pieces", "op": "count", "where": { "path": "loc.t", "eq": "temp" }, "gte": 1 }
{ "path": "state.timeLeft", "op": "changed" }
```

支持 `op`：`eq` `neq` `gt` `gte` `lt` `lte` `changed` `exists` `count` `contains`。
`changed` 与「该步骤开始时」的值比较；`count` 统计数组（可带 `where` 过滤）后按
`gte/gt/lte/lt/eq/value` 判界。

### 期望值

- `expect.screen`：屏幕字段严格匹配；`result` 额外接受 `win/won/lost/fail/over`。
- `expect.any`：任一断言成立即可（用于「分数 / 步数 / 进度任一推进」）。
- `expect.all`：全部成立。

## 报错

- 配置文件不存在 → 打印明确提示，退回通用默认流程（不静默当失败）。
- 配置字段写错 / 步骤超上限 / 目标 key 在 layout 里不存在 → 直接报错并退出码 1，
  错误里带**配置文件名 + 步骤名 + 缺少的 key + 当前可用 key**。

## 现有配置

| 游戏 | 屏幕字段 | 开始按钮 | 推进断言 |
|---|---|---|---|
| `pindou-workshop` | `state.screen` | `primaryButton` | 拖色块进临时位后 `loc.t == temp` 计数 ≥ 1 |

结算屏不是每款都能在十几秒内到达：有的游戏一关一支箭，点掉即结算；
其余三款的结算步写成 `required: false`，没到记 SKIP，不影响退出码。
