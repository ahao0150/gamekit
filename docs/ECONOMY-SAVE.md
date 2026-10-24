# 数值配表、模拟与存档（@mg/economy + createSave）

面向 AI：**只改扁平源**（`*.tsv` / `*.csv`），**禁止**把深嵌套 JSON 当编辑面。`levels.json` 等是 **compile 编译产物**（可进 dist / 运行时 fetch），手改会被下次编译覆盖。

剧情扁平源见 [`STORY.md`](STORY.md)。

## 1. 包与表格式（TSV 真源）

包路径：`packages/economy`（`@mg/economy`）。

| 文件（源） | 行类型 | 列 |
|---|---|---|
| `levels.tsv` | 升级曲线 | `level`, `expToNext`, `rewardGold?` |
| `production.tsv` | 产出 | `id`, `perHour`, `unlockLevel?` |
| `prices.tsv` | 购买解锁 | `id`, `costGold`, `unlockLevel?`（`id` 与产出表同名时表示先买再用） |

示例（制表符分隔，首行表头）：

```tsv
level	expToNext	rewardGold
1	80	25
2	120	50
```

仓库示例目录（真源为 `.tsv`）：`packages/economy/examples/idle-basic/`。

`loadTablesFromDir` **优先读 `.tsv` / `.csv`**，其次才是 `.json`（仅兼容或编译输出）。校验失败抛**中文**错误并指明表名与字段。

## 2. 编译与模拟 CLI

```bash
# 扁平源 → JSON（默认写到源目录，或 --out）
node packages/economy/bin/compile.mjs --table packages/economy/examples/idle-basic
node packages/economy/bin/compile.mjs --table packages/economy/examples/idle-basic --out /tmp/eco-out

# 成长曲线模拟（直接读扁平目录）
node packages/economy/bin/simulate.mjs --table packages/economy/examples/idle-basic --days 7
node packages/economy/bin/simulate.mjs --table packages/economy/examples/idle-basic --days 7 --json
```

```ts
import { compileTablesFromDir, loadTablesFromDir, loadTablesFromParts, simulate } from '@mg/economy';

compileTablesFromDir('assets/economy', 'assets/economy'); // 写出 JSON
const tables = loadTablesFromDir('packages/economy/examples/idle-basic');
const report = simulate(tables, {
  days: 7,
  startLevel: 1,
  startGold: 0,
  playHoursPerDay: 2,
  expPerPlayHour: 10,
  autoBuy: true,
});
```

### Vite / mg 构建

`@mg/vite-plugin` 可选 `economyDir: 'assets/economy'`：在 `buildStart` 自动对目录执行与 `compile.mjs` 相同的编译（写出同目录 JSON）。

## 3. 离线收益

```ts
import { computeOfflineReward } from '@mg/economy';

const { gold, elapsedMs, capped } = computeOfflineReward({
  lastSeenAt: saveData.lastSeenAt,
  now: Date.now(),
  productionTable: tables.production,
  prices: tables.prices,
  level: saveData.level,
  purchasedIds: saveData.purchased,
  caps: { maxHours: 12, maxGold: 50_000 },
});
```

规则与模拟一致：`hourlyGoldRate` × 离线小时；`caps.maxHours` / `maxGold` 触发 `capped: true`。

## 4. 与 createSave 配合（最小可复制示例）

存档 API 在 `@mg/runtime` 的 `createSave`（双槽、版本迁移）。**不要改 save 契约**；
业务数据放在 `envelope.data` 里。

```ts
import { createSave, type SaveMigration } from '@mg/runtime';
import { computeOfflineReward, loadTablesFromParts } from '@mg/economy';

const TABLES = loadTablesFromParts({
  levels: [/* 或运行时 fetch 编译后的 JSON */],
  production: [],
  prices: [],
});

interface IdleSaveV1 {
  level: number;
  gold: number;
  exp: number;
  purchased: string[];
  lastSeenAt: number;
}

const CURRENT = 1;

const migrations: SaveMigration[] = [];

const save = createSave({
  version: CURRENT,
  store: platform.storage,
  migrations,
});

const boot = (): IdleSaveV1 => {
  const now = Date.now();
  let data = save.load<IdleSaveV1>();
  if (data === null) {
    data = { level: 1, gold: 0, exp: 0, purchased: [], lastSeenAt: now };
  } else {
    const offline = computeOfflineReward({
      lastSeenAt: data.lastSeenAt,
      now,
      productionTable: TABLES.production,
      prices: TABLES.prices,
      level: data.level,
      purchasedIds: data.purchased,
      caps: { maxHours: 12 },
    });
    data = { ...data, gold: data.gold + offline.gold, lastSeenAt: now };
  }
  save.save(data);
  return data;
};
```

更完整的组合见 `packages/economy/examples/with-save.ts`（注释 import 路径）。

### SaveMigration 注意点

- 改 `IdleSave` 字段：**version +1**，在 `migrations` 里写 `from`/`to` 纯函数；
- `load()` 失败返回 `null`，用 `inspect()` 查 `corrupt` / `recovered`；
- `lastSeenAt` 应在**成功结算离线后**和**退出游戏时**更新，避免重复领取。

## 5. 调试 MCP（草案）

见 [`DEBUG-SAVE-COMMANDS.md`](DEBUG-SAVE-COMMANDS.md)。

## 6. AI 改表检查清单

1. 改 **TSV/CSV** → `simulate.mjs` 看 7/30 天曲线；
2. 需要 JSON 进包时 → `compile.mjs`；
3. `pnpm -w test` 跑 `packages/economy` 契约测试；
4. 动存档结构 → 补 migration + 游戏内单测；
5. 离线封顶与防刷：`maxHours` 与 `maxGold` 要和 PRD 一致。
