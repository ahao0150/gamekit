/**
 * 平台跳跃 · 第一关（batch 2：敌人巡逻+踩杀、金币、终点、通关）。
 *
 * 技术骨架：
 * - 玩家是 **dynamic + fixedRotation** 刚体（Box2D 的 kinematic 与 static 不碰撞，
 *   平台跳跃必须落在地面上），横向速度手动控制，脚下用地形顶面探测。
 * - 相机用 core/camera（死区 120 / 前瞻 60 / 平滑 0.12 / 边界钳制），纵向固定。
 * - 剔除只用**渲染**：敌人/金币/终点逻辑全量 update，与是否可见无关 ——
 *   离屏冻结会让怪停在边界外、行为断档（2026-10-20 修订）。
 * - 物理靠 planck 自己的步进与自动睡眠，不手动 setActive 冻结任何 body。
 *
 * T45：HUD 与通关 / 失败面板改成 `.ui` 浮层（`ui.ts` + `ui/*.ui`），渲染变成三层：
 * 世界（canvas）→ HUD（`.ui`）→ 浮层（`.ui`，通关/失败时）。浮层不清屏，
 * 底层游戏画面被半透明遮罩压暗但**仍然可见** —— 这就是「浮层」和「切屏」的分界线。
 */

import { createCamera, createLoop, createPhysicsWorld } from './deps';
import type { BodyHandle, Camera, Ctx2D, PlatformAdapter } from './deps';
import { buildDebugInfo } from './debug-info';
import type { DebugInfo } from './debug-info';
import { createEntities, interact, patrol } from './entities';
import type { Entities } from './entities';
import { createInput } from './input';
import { CAMERA, MOVE, PLAYER, SOLIDS, SPAWN, WORLD, feetOn } from './level';
import { createFrameTiming } from './perf';
import { partitionScene, render } from './render';
import {
  createInitialState, isFallen, onFall, onRespawned, setPlayer, tickInvulnerable,
} from './state';
import type { GameState } from './state';
import { createUiEngine, hitLayer, hudOffsetFor, uiLayerNames } from './ui';

import type { Game, GameOptions } from './game-contract';
export type { Game, GameOptions } from './game-contract';

const KEY_LEFT = new Set(['ArrowLeft', 'a', 'A']);
const KEY_RIGHT = new Set(['ArrowRight', 'd', 'D']);
const KEY_JUMP = new Set([' ', 'ArrowUp', 'w', 'W']);
const STOMP_BOUNCE = 420;

export const createGame = (platform: PlatformAdapter, options: GameOptions = {}): Game => {
  const ctx: Ctx2D | null = platform.canvas.getContext('2d');
  const physics = createPhysicsWorld({ gravity: { x: 0, y: MOVE.gravity } });
  const timing = createFrameTiming();
  const ui = createUiEngine();
  let state = createInitialState();
  let entities: Entities = createEntities();

  for (const rect of SOLIDS) {
    physics.addBody({
      type: 'static', shape: { kind: 'box', w: rect.w, h: rect.h },
      x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, userData: 'solid',
    });
  }
  const player: BodyHandle = physics.addBody({
    type: 'dynamic', shape: { kind: 'box', w: PLAYER.w, h: PLAYER.h },
    x: SPAWN.x, y: SPAWN.y, friction: 0, restitution: 0, density: 1,
    fixedRotation: true, userData: 'player',
  });

  const camera: Camera = createCamera({
    viewport: { w: platform.screen.width, h: platform.screen.height },
    bounds: { x: 0, y: 0, w: WORLD.w, h: WORLD.h },
    deadzone: CAMERA.deadzone,
    smoothing: CAMERA.smoothing,
    lookAhead: CAMERA.lookAhead,
  });

  // 开场对准出生点：不 snap 的话相机初始中心是「边界中心」（1560 的一半 = 780），
  // 第一帧 follow 会从屏幕右侧平滑滑过来 —— 实测就是「进游戏时镜头回弹矫正」。
  camera.snap({ x: SPAWN.x, y: SPAWN.y });

  const keys = { left: false, right: false, jump: false };
  let jumpHeld = false;
  let respawnTimer = 0;
  let drawnEntities = 0;
  let totalEntities = 0;
  let lastStomp: { x: number; y: number; vy: number } | null = null;
  /** 最近一帧 `.ui` 绑定/布局的错误（空 = HUD 与浮层都干净） */
  let uiErrors: readonly string[] = [];
  /** 最近一帧的 `.ui` 矩形（只读调试：CDP 要点浮层按钮、断言 HUD 位置） */
  let uiRects: { hud: Readonly<Record<string, { x: number; y: number; w: number; h: number }>>; modal: Readonly<Record<string, { x: number; y: number; w: number; h: number }>> | null } = {
    hud: {},
    modal: null,
  };

  /** 逻辑视口（浮层布局 / 命中都用整屏） */
  const viewport = (): { width: number; height: number } => ({
    width: platform.screen.width,
    height: platform.screen.height,
  });

  /** HUD 整体偏移：宿主有系统胶囊（T47 `screen.menuButton`）时下移，web 无胶囊时为零 */
  const hudOffset = (): { readonly x: number; readonly y: number } => {
    const override = options.menuButtonOverride;
    return hudOffsetFor(override === undefined ? platform.screen : { ...platform.screen, menuButton: override });
  };

  const poseOf = (): { x: number; y: number; vx: number; vy: number } | null => {
    const pose = physics.poseOf(player);
    return pose === null ? null : { x: pose.x, y: pose.y, vx: pose.vx, vy: pose.vy };
  };

  const onGround = (): boolean => {
    const pose = poseOf();
    if (pose === null) return false;
    return SOLIDS.some((rect) => feetOn(rect, pose.x, pose.y));
  };

  const tryJump = (): void => {
    if (state.phase !== 'play') return;
    const pose = poseOf();
    if (pose === null || !onGround()) return;
    physics.setVelocity(player, pose.vx, -MOVE.jumpSpeed);
  };

  const releaseJump = (): void => {
    const pose = poseOf();
    if (pose === null) return;
    if (pose.vy < -MOVE.releaseSpeed) physics.setVelocity(player, pose.vx, -MOVE.releaseSpeed);
  };

  const setKey = (which: 'left' | 'right' | 'jump', down: boolean): void => {
    keys[which] = down;
    if (which !== 'jump') return;
    jumpHeld = down;
    if (down) tryJump();
    else releaseJump();
  };

  const teleportToSpawn = (): void => {
    physics.setPosition(player, SPAWN.x, SPAWN.y);
    // 瞬时定位：重置/开场用 follow 会让镜头从「边界中心」或当前位置滑过去
    camera.snap({ x: SPAWN.x, y: SPAWN.y });
  };

  const restart = (): void => {
    state = createInitialState();
    entities = createEntities();
    lastStomp = null;
    teleportToSpawn();
  };

  const update = (dt: number): void => {
    // 通关后整场冻结：不步进物理、不跑实体逻辑，画面停在终点那一帧
    if (state.phase === 'won') {
      camera.follow({ x: state.player.x, y: state.player.y }, { x: 0, y: 0 }, dt);
      return;
    }
    const pose = poseOf();
    if (pose !== null && state.phase === 'play') {
      const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      let vy = pose.vy;
      if (jumpHeld && vy < 0) vy -= MOVE.gravity * 0.5 * dt;
      physics.setVelocity(player, dir * MOVE.speed, vy);
      if (dir !== 0 && state.player.facing !== (dir > 0 ? 1 : -1)) {
        state = setPlayer(state, { ...state.player, facing: dir > 0 ? 1 : -1 });
      }
    }

    physics.step(dt);

    const next = poseOf();
    if (next !== null) {
      state = setPlayer(state, {
        x: next.x, y: next.y, vx: next.vx, vy: next.vy,
        onGround: onGround(), facing: state.player.facing,
      });
    }
    state = tickInvulnerable(state, dt);

    // 实体逻辑：**全量更新**（离屏也更新），不受剔除影响
    if (state.phase === 'play') {
      entities = patrol(entities, dt);
      const result = interact(entities, state);
      entities = result.entities;
      state = result.state;
      if (result.stomped) {
        const current = poseOf();
        // 记下踩到那一刻玩家是「下落中」（vy > 0），作为踩杀的直证（渲染/验收用）
        lastStomp = { x: state.player.x, y: state.player.y, vy: state.player.vy };
        physics.setVelocity(player, current?.vx ?? 0, -STOMP_BOUNCE);
        camera.shake(3);
      }
      if (result.hurt && state.invulnerable <= 0) {
        state = onFall(state);
        teleportToSpawn();
        respawnTimer = MOVE.respawnDelay;
        camera.shake(10);
      }
    }

    if (state.phase === 'play' && isFallen(state)) {
      state = onFall(state);
      teleportToSpawn();
      respawnTimer = MOVE.respawnDelay;
      camera.shake(6);
    } else if (state.phase === 'dead') {
      respawnTimer -= dt;
      if (respawnTimer <= 0) state = onRespawned(state, 0.8);
    }

    camera.follow({ x: state.player.x, y: state.player.y }, { x: state.player.vx, y: 0 }, dt);
  };

  const draw = (): void => {
    if (ctx === null) return;
    timing.startFrame();
    // 1) `.ui` 布局：HUD 恒有（按胶囊整体下移），浮层看 phase（won / gameover）。每帧成本记在 layoutMs
    const layoutStart = timing.now();
    const hud = ui.hud(viewport(), state, hudOffset());
    const modal = ui.modal(viewport(), state);
    uiErrors = [...hud.errors, ...(modal?.errors ?? [])];
    uiRects = { hud: hud.rects, modal: modal?.rects ?? null };
    timing.markLayout(layoutStart, timing.now());
    // 2) 世界层（canvas 手绘，不含 HUD / 结算面板）；剔除只影响绘制，逻辑仍全量更新
    const drawStart = timing.now();
    const scene = partitionScene(camera, entities);
    totalEntities = scene.total;
    drawnEntities = scene.drawn;
    render(ctx, {
      state, camera, screen: platform.screen, solids: scene.solids,
      entities: scene.entities,
      pressed: { left: keys.left, right: keys.right, jump: keys.jump },
    });
    // 3) 叠加层：不清屏 —— 世界刚画的画面原样保留，HUD / 浮层只画自己的元素
    ui.draw(ctx, hud);
    if (modal !== null) ui.draw(ctx, modal);
    timing.markDraw(drawStart, timing.now());
  };

  // 输入：键盘 + 多点触控合并成一个控制器，按键**只在生效状态变化时**才 setKey
  // （T49：这样第二根手指按下跳键不会把左键误发一次 false —— 真机 bug 的根因）
  const input = createInput((which, down) => setKey(which, down));

  const offKey = platform.onKey?.((key, down) => {
    // 通关 / 失败时没有触屏也能重开：空格 / ↑ / W
    if (down && KEY_JUMP.has(key) && (state.phase === 'won' || state.phase === 'gameover')) {
      restart();
      return;
    }
    if (KEY_LEFT.has(key)) input.handleKey('left', down);
    else if (KEY_RIGHT.has(key)) input.handleKey('right', down);
    else if (KEY_JUMP.has(key)) input.handleKey('jump', down);
  });

  const offPointer = platform.onPointer((event) => {
    const { x, y } = event.pointer;
    if (state.phase === 'gameover' || state.phase === 'won') {
      // 浮层：只有点在「再来一次 / 重新开始」按钮上才重开；点遮罩（hit block）不触发
      if (event.kind !== 'down') return;
      const modal = ui.modal(viewport(), state);
      if (modal !== null && hitLayer(modal, x, y) === 'primaryButton') restart();
      return;
    }
    // 每根手指独立绑定：down 绑定命中的按钮，move 滑出解绑，up / cancel 解绑
    input.handlePointer(event.kind, event.pointer, event.pointer.id);
  });

  const loop = createLoop({ update, render: draw });

  return {
    get state(): GameState {
      return state;
    },
    get debug(): DebugInfo {
      return buildDebugInfo({
        state,
        entities,
        cameraVisible: camera.visible,
        cull: { total: totalEntities, drawn: drawnEntities },
        lastStomp,
        keys: { left: keys.left, right: keys.right, jump: keys.jump },
        touch: input.pressedTouch,
        menuButton: options.menuButtonOverride ?? platform.screen.menuButton ?? null,
        timing: timing.snapshot(),
        layers: ['world', ...uiLayerNames(state)],
        uiErrors,
        uiRects,
      });
    },
    start(): void {
      loop.start();
    },
    stop(): void {
      loop.stop();
      offKey?.();
      offPointer();
    },
  };
};
