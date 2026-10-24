# 调试 MCP：存档与数值指令（草案）

> 状态：**协议草案**，`save_simulate_days` / `save_patch` 已在 `packages/debug-mcp` 注册为 stub，
> 调用会返回「未接线」说明，不破坏现有运行时工具。

## 目标

让 AI / 测试在真浏览器会话里：

1. 把存档时间快进 N 天，触发与 `computeOfflineReward` 一致的离线结算；
2. 定点改 `data.gold` / `data.level` 等字段，便于验收边界。

## 拟议 WebSocket 命令（游戏侧 `bridge.ts` 扩展）

| 命令 | 参数 | 响应 |
|---|---|---|
| `save.inspect` | — | `{ ok, envelope?, data? }` 只读，走 `createSave().inspect()` |
| `save.patch` | `{ path: string, value: unknown }` | 写回 `save.save()` 结果 |
| `save.simulateDays` | `{ days: number }` | 把 `lastSeenAt` 减 `days×86400000` 或调 economy 日结 |

路径 `path` 建议限定在 `data.*` 下，禁止改 `version` / `savedAt`。

## MCP 工具映射（待实现）

| MCP 名 | 游戏命令 |
|---|---|
| `save_simulate_days` | `save.simulateDays` |
| `save_patch` | `save.patch` |

## 本地替代（现在就能用）

```bash
# 数值曲线
node packages/economy/bin/simulate.mjs --table packages/economy/examples/idle-basic --days 7

# 改档：在 devtools 里读 localStorage 键（见 saveKeys），或游戏内加仅 dev 的 cheat 面板
```

完整存档流程见 [`ECONOMY-SAVE.md`](ECONOMY-SAVE.md)。
