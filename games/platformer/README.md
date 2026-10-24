# platformer —— `@mg/physics-2d` 官方示例

本目录是 **gamekit 2D 物理的官方可玩样例**，不是 `iaa-simple` 模板副本。  
玩法：横版平台跳跃（重力落地、左右移动、跳跃、踩怪、吃金币、到终点）。

物理包文档：[`docs/PHYSICS-GUIDE.md`](../../docs/PHYSICS-GUIDE.md) · API：[`docs/ENGINE-API.md`](../../docs/ENGINE-API.md)（physics-2d 段）。

## 最小抄作业路径（四步）

对照源码抄，不要从空文件猜：

| 步骤 | 做什么 | 文件 · 行号附近 |
|---|---|---|
| 1. 建世界 | `createPhysicsWorld({ gravity: { x: 0, y: MOVE.gravity } })` | [`src/app/game.ts`](src/app/game.ts) ≈43；重力常量 [`src/app/level.ts`](src/app/level.ts) `MOVE.gravity`（1800） |
| 2. static 地面 | 对每个地形矩形 `physics.addBody({ type: 'static', shape: { kind: 'box', … } })`；**x/y 是质心**（左上角 + w/2、h/2） | [`src/app/game.ts`](src/app/game.ts) ≈49–54；地形数据 [`src/app/level.ts`](src/app/level.ts) `SOLIDS` |
| 3. dynamic 玩家 | `type: 'dynamic'` + `fixedRotation: true`（否则会被撞得打转） | [`src/app/game.ts`](src/app/game.ts) ≈55–59 |
| 4. 跳跃 | 着地时 `physics.setVelocity(player, pose.vx, -MOVE.jumpSpeed)`（`jumpSpeed` 约 620） | [`src/app/game.ts`](src/app/game.ts) `tryJump` ≈110–114；每帧横向速度 ≈151–155；`physics.step(dt)` ≈161 |

导入入口：[`src/app/deps.ts`](src/app/deps.ts) 从 `@mg/physics-2d`（相对路径到 `packages/physics-2d`）取出 `createPhysicsWorld`。

**不要**用 `kinematic` 当平台跳跃玩家——kinematic 与 static **不碰撞**，会穿地。详见 PHYSICS-GUIDE。

## 目录（与物理相关的）

```
games/platformer/
├── README.md                 本文件
├── game.config.json
├── src/
│   ├── main.ts               入口
│   └── app/
│       ├── deps.ts           汇聚 createPhysicsWorld / createLoop / createCamera
│       ├── level.ts          WORLD / SOLIDS / SPAWN / PLAYER / MOVE（gravity、jumpSpeed）
│       ├── game.ts           建世界、加刚体、跳跃、步进、相机
│       ├── entities.ts       敌人/金币：纯逻辑，不挂刚体（刻意示范）
│       ├── state.ts          回合状态（命数、通关）
│       ├── render.ts         只读 pose / state 画世界
│       └── ui*.ts / ui/      HUD 与通关浮层（.ui）
└── …
```

## 怎么跑

在**仓库根**（有 `pnpm-workspace.yaml` 的那层）：

```bash
# 开发服务器
node packages/cli/bin/mg.mjs dev --root games/platformer

# 或进入游戏目录
cd games/platformer
pnpm test          # vitest：关卡/实体/输入等纯逻辑
pnpm exec mg dev
```

操作：←→ / A D 移动，空格 / W / ↑ 跳跃。

## 设计要点（读代码前先看）

1. **物理只管地形 + 玩家**；敌人巡逻、吃金币用矩形判定（`entities.ts`），避免给纯逻辑挂刚体。
2. **落地**用脚底与 `SOLIDS` 的几何探测（`feetOn`），不只靠 `onContact`（接触开始事件不够当「持续着地」）。
3. **剔除只影响渲染**：离屏敌人仍 `patrol`，避免怪冻在屏外。
4. 坐标：**像素、y 向下**；与画布一致。包内 `PIXELS_PER_UNIT = 100` 换算，调用方继续写像素。

新游戏若只要物理骨架：复制上表四步即可；完整 IAA 模板请用 `pnpm mg -- create` 的 `iaa-ui` / `iaa-simple`，不要复制本 README 的旧模板描述。
