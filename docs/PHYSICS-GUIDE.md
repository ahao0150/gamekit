# @mg/physics-2d 使用指南

包：`packages/physics-2d`。契约与 API 表见 [`ENGINE-API.md`](ENGINE-API.md#packagesphysics-2d--2d-物理planck-薄封装)。

## 何时用 / 何时不用

| 用 | 不用 |
|---|---|
| 重力下落、跳跃、被撞飞 | 纯格子移动、三消、卡牌 |
| 需要连续碰撞与速度积分 | 只要 AABB 点选 / `pickHit` |
| 少量刚体（玩家 + 地形 + 道具） | 大量粒子（用自研或简化运动学） |

物理是**可选依赖**：`import` 才进包。不 import 就不要加 `planck` 依赖。

## 像素与「米」：100px = 1m

- **对外契约全是像素**：`BodyDef.x/y`、`pose.vx/vy`、重力 `{ y: 1800 }` 都是像素单位。
- **planck 内部按米仿真**：`PIXELS_PER_UNIT = 100`，换算在包内完成。
- **maxTranslation 坑**：Box2D 每步最大平移约 2「单位」。若把像素当米，跳跃速度 620px/s、步长 1/60 → 每步 ~10 单位会被钳到 2 单位，表现为**跳不起来**。本包已换算，你只要继续用像素 API。

渲染：`pose.x/y` 是**质心**，画矩形要 `x - w/2`, `y - h/2`。快照**不含宽高**，尺寸自己记一份（见 `games/platformer`）。

## 固定步长 1/60

每帧只调 `physics.step(dt)`，传真实 `dt`。内部累积到 `1/60` 才 step，单帧最多追 **5 步**（卡顿不会一次补算几百步穿墙）。

## 刚体类型与已知坑

| 类型 | 用途 | 碰撞 |
|---|---|---|
| `static` | 地形、墙 | 与 dynamic 碰撞；**不与 static/kinematic 互撞** |
| `dynamic` | 玩家、可受力物体 | 与 static、dynamic 碰撞 |
| `kinematic` | 平台、移动障碍（代码设速度） | **不与 static/kinematic 碰撞**；用 `setVelocity` 移动 |

常见错误：

1. **移动平台用 kinematic + 玩家站上面**：kinematic 与 static 地面不碰撞，要单独用 `setPosition` 同步玩家，或改 dynamic 平台方案。
2. **static 叠 static 想挡路**：不会互相碰撞，合并成一个 static 或改用 dynamic。
3. **碰撞回调**：`onContact` 只在**接触开始**触发，不是持续接触；落地检测 often 用 `pose.vy` + 高度阈值辅助。

## 最小抄作业路径（官方示例 `games/platformer`）

完整说明见 [`games/platformer/README.md`](../games/platformer/README.md)。按文件抄这四步：

| 步骤 | 代码意图 | 打开这里 |
|---|---|---|
| 1. 建世界 | `createPhysicsWorld({ gravity: { x: 0, y: 1800 } })` | [`games/platformer/src/app/game.ts`](../games/platformer/src/app/game.ts)（约 L43）；重力 [`level.ts`](../games/platformer/src/app/level.ts) `MOVE.gravity` |
| 2. static 地面 | `addBody({ type: 'static', shape: { kind: 'box', … } })`，**质心坐标** | 同文件约 L49–54；地形列表 `level.ts` → `SOLIDS` |
| 3. dynamic 玩家 | `type: 'dynamic'` + `fixedRotation: true` | 同文件约 L55–59 |
| 4. 跳跃 | 着地：`setVelocity(player, vx, -jumpSpeed)`（约 -620）；每帧再设横向速度并 `step(dt)` | `tryJump` 约 L110–114；移动约 L151–161 |

导入：[`games/platformer/src/app/deps.ts`](../games/platformer/src/app/deps.ts)。单元测试与契约注释：`packages/physics-2d/src/index.test.ts`。

缩略版（语义与上表一致，正式代码以 platformer 为准）：

```ts
import { createPhysicsWorld } from '@mg/physics-2d';

const physics = createPhysicsWorld({ gravity: { x: 0, y: 1800 } });
physics.addBody({ type: 'static', shape: { kind: 'box', w: 1200, h: 40 }, x: 600, y: 700 });
const player = physics.addBody({
  type: 'dynamic',
  shape: { kind: 'box', w: 28, h: 40 },
  x: 120,
  y: 500,
  friction: 0,
  fixedRotation: true,
});
// 着地跳跃（y 向下为正，向上跳给负 vy）
physics.setVelocity(player, 0, -620);
physics.step(dt);
const pose = physics.poseOf(player);
```

## 验收检查项

- [ ] 质心坐标：关卡数据若是左上角，加 `w/2`、`h/2` 再 `addBody`
- [ ] 跳跃高度在 390×844 视口目测合理（调 `setVelocity` 的 vy，典型 -500～-700 量级像素/秒）
- [ ] 30fps 与 60fps 下起跳落点差 < 几像素（固定步长契约）
- [ ] 没有 import `planck` 到游戏玩法模块（只读 `BodyPose`）
- [ ] 休眠：`setActive(false)` 的离屏物体唤醒后位置不变
- [ ] 窄屏 / 高 dpr：`verify-platform` 通过（点击与画面一致）

更细的七条坑见 [`START-HERE.md`](START-HERE.md) §8。
