/**
 * 第二轮动效的**状态层**：把「什么时候开始、现在到第几毫秒」算成一份只读快照，
 * 渲染层（render.ts）只按快照画，不自己数时间。
 *
 * 数值与时长都来自 `anim.ts`（纯数值层，spec 的出处标在那里）。
 *
 * 纪律：
 * - 没有全局可变状态，所有状态在 `createJuice()` 的闭包里（AGENTS 铁律 3）；
 * - 不碰 canvas、不读 DOM/平台 API，`update` 只吃 `dt` 与 `GameState`；
 * - 帧率无关：所有推进都用秒，脉冲相位用累计毫秒，换帧率观感不变。
 */

import { createSpring, sampleSpring } from './deps';
import {
  ALERT_DANGER_RATE,
  ALERT_DANGER_VIGNETTE,
  ALERT_WARN_RATE,
  ALERT_WARN_VIGNETTE,
  HILITE_FADE_MS,
  HILITE_HOVER,
  HILITE_HOVER_MS,
  HILITE_IDLE,
  LOCK_DOWN_MS,
  LOCK_UP_MS,
  PICK_SCALE,
  PLATE_SPRING,
  REJECT_CELL_ALPHA,
  REJECT_CELL_MS,
  REJECT_CHROMATIC_MS,
  REJECT_CHROMATIC_PX,
  REJECT_FLASH_ALPHA,
  REJECT_FLASH_MS,
  REJECT_MS,
  REJECT_SHAKE_MS,
  ALERT_SHAKE_PX,
  ALERT_SHAKE_ROT,
  REJECT_SHAKE_PX,
  TEMP_SMOOTH,
  lockIntensityAt,
} from './anim';
import { burntRate } from './iron';
import type { GameState } from './state';

import { EMPTY_FRAME, easeBack, smooth } from './juice-frame';
import type { JuiceFrame } from './juice-frame';

export type { JuiceFrame } from './juice-frame';

export interface Juice {
  /** 每帧推进（dt 秒）；返回本帧快照 */
  update(dt: number, state: GameState): JuiceFrame;
  /** ① 拿起：记下颜色，开始放大（位置不补间，立即贴指） */
  grab(color: number): void;
  /** ② 拖到某格：`matched` = 同色且空格才高亮 */
  dragTo(cell: number, matched: boolean): void;
  /** ③ 归位成功：连击 +1，目标格出高光与粒子 */
  place(cell: number): void;
  /** 拖拽结束但不产生特效（例如放进临时位）：只把拖拽态收掉 */
  endDrag(): void;
  /** ④ 落位错误：残影从 `from` 弹回 `to`，错误格闪红、色差、震屏、全屏闪 */
  reject(cell: number, from: { x: number; y: number }, to: { x: number; y: number }, s: number, color: number): void;
  /** 离开盘面（换屏 / 重开）时清掉瞬时状态 */
  reset(): void;
  readonly frame: JuiceFrame;
}

interface LockFx {
  cell: number;
  age: number;
  combo: number;
}

interface RejectFx {
  age: number;
  cell: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  s: number;
  color: number;
  seed: number;
}

export const createJuice = (): Juice => {
  const spring = createSpring({ ...PLATE_SPRING });
  let clockMs = 0;
  let frame: JuiceFrame = EMPTY_FRAME;

  // ① 拿起 / ② 跟手
  let dragging = false;
  let dragColor = -1;
  let pickScale = 1;
  let highlight = 0;
  let hoverCell = -1;

  // ③ 归位
  let combo = 0;
  let sincePlaceMs = 1e9;
  const locks: LockFx[] = [];

  // ④ 落位错误
  let rejectFx: RejectFx | null = null;

  // ⑤ 熨烫板弹簧
  let plateFrom = { x: 0, y: 0 };
  let plateTo = { x: 0, y: 0 };
  let plateT = 99;
  let hasPlate = false;

  // ⑥ 温度
  let tempView = 0;

  // ⑦ 累积告警
  let alert = 0;

  let lastScreen = '';

  const advMs = (dt: number): number => (dt > 0 && Number.isFinite(dt) ? dt * 1000 : 0);

  const update = (dt: number, state: GameState): JuiceFrame => {
    const step = dt > 0 && Number.isFinite(dt) ? dt : 0;
    const ms = advMs(step);
    clockMs += ms;

    // 只认「真的换屏」：首帧（lastScreen === ''）不能清，否则第一个 update 会吞掉
    // 还在同一屏里已经发生的拖拽/高光（真机上首帧在首页所以碰不到，但状态机不该靠运气）。
    const screenChanged = lastScreen !== '' && state.screen !== lastScreen;
    lastScreen = state.screen;
    if (screenChanged) {
      // 换屏：瞬时特效全部作废（否则残影会跟着结算页一起出现）
      dragging = false;
      dragColor = -1;
      hoverCell = -1;
      pickScale = 1;
      highlight = 0;
      locks.length = 0;
      rejectFx = null;
      combo = 0;
      alert = 0;
    }

    // ① 拿起放大：60ms out 逼近 1.25，松手回 1
    pickScale = smooth(pickScale, dragging ? PICK_SCALE : 1, dragging ? 0.35 : 0.28, step);

    // ② 高亮：悬停 90ms、常态 120ms → 用不同 perFrame 逼近
    const hTarget = dragging ? (hoverCell >= 0 ? HILITE_HOVER : HILITE_IDLE) : 0;
    const hRate = 1 - Math.pow(0.001, ms / (hoverCell >= 0 ? HILITE_HOVER_MS : HILITE_FADE_MS));
    highlight = highlight + (hTarget - highlight) * (ms > 0 ? hRate : 0);

    // ③ 锁定高光计时 + 连击空闲复位（1.5s 没放就算断连）
    sincePlaceMs += ms;
    if (sincePlaceMs > 1500) combo = 0;
    for (let i = locks.length - 1; i >= 0; i -= 1) {
      locks[i]!.age += ms;
      if (locks[i]!.age > LOCK_UP_MS + LOCK_DOWN_MS) locks.splice(i, 1);
    }

    // ④ 错误特效计时
    if (rejectFx !== null) {
      rejectFx.age += ms;
      if (rejectFx.age > Math.max(REJECT_MS, REJECT_CHROMATIC_MS, REJECT_SHAKE_MS, REJECT_CELL_MS)) rejectFx = null;
    }

    // ⑤ 熨烫板弹簧跟随：目标一变就从「当前视觉位置」重新起弹（打断时也连续）
    const ironPlate = state.screen === 'iron' ? state.iron.plate : null;
    if (ironPlate !== null) {
      const tx = ironPlate.gx;
      const ty = ironPlate.gy;
      if (!hasPlate) {
        hasPlate = true;
        plateFrom = { x: tx, y: ty };
        plateTo = { x: tx, y: ty };
        plateT = 99;
      } else if (Math.abs(tx - plateTo.x) > 1e-6 || Math.abs(ty - plateTo.y) > 1e-6) {
        const s0 = sampleSpring(spring, plateT);
        plateFrom = { x: plateFrom.x + (plateTo.x - plateFrom.x) * s0, y: plateFrom.y + (plateTo.y - plateFrom.y) * s0 };
        plateTo = { x: tx, y: ty };
        plateT = 0;
      }
      plateT += step;
      tempView = smooth(tempView, ironPlate.temp, TEMP_SMOOTH, step);
    } else if (hasPlate) {
      hasPlate = false;
    }

    // ⑦ 累积告警：18% 起预警、30% 起危险（30% 就是失败线，单档阈值永远看不见）
    const rate = state.screen === 'iron' ? burntRate(state.iron) : 0;
    let aTarget = 0;
    if (rate >= ALERT_DANGER_RATE) aTarget = ALERT_DANGER_VIGNETTE;
    else if (rate >= ALERT_WARN_RATE) aTarget = ALERT_WARN_VIGNETTE;
    alert = smooth(alert, aTarget, 0.12, step);

    const s = hasPlate ? sampleSpring(spring, plateT) : 0;
    const rejectAge = rejectFx === null ? 1e9 : rejectFx.age;
    const shakeOn = rejectFx !== null && rejectAge < REJECT_SHAKE_MS;
    const alertShake = rate >= ALERT_DANGER_RATE;

    const locksView = locks.map((l) => ({ cell: l.cell, intensity: lockIntensityAt(l.combo, l.age), combo: l.combo, ageMs: l.age }));

    let ghost: JuiceFrame['ghost'] = null;
    if (rejectFx !== null) {
      const t = easeBack(rejectFx.age / REJECT_MS);
      ghost = {
        x: rejectFx.from.x + (rejectFx.to.x - rejectFx.from.x) * t,
        y: rejectFx.from.y + (rejectFx.to.y - rejectFx.from.y) * t,
        s: rejectFx.s * (1 - 0.25 * Math.min(1, rejectFx.age / REJECT_MS)),
        color: rejectFx.color,
      };
    }

    frame = {
      pickScale,
      dragColor,
      highlight: highlight < 0 ? 0 : highlight,
      hoverCell,
      locks: locksView,
      ghost,
      rejectCell: rejectFx !== null && rejectAge < REJECT_CELL_MS ? rejectFx.cell : -1,
      rejectCellAlpha: rejectFx !== null && rejectAge < REJECT_CELL_MS ? REJECT_CELL_ALPHA * (1 - rejectAge / REJECT_CELL_MS) : 0,
      chromatic:
        rejectFx !== null && rejectAge < REJECT_CHROMATIC_MS
          ? REJECT_CHROMATIC_PX * (1 - Math.abs(rejectAge / REJECT_CHROMATIC_MS - 0.5) * 2)
          : 0,
      flash: rejectFx !== null && rejectAge < REJECT_FLASH_MS ? REJECT_FLASH_ALPHA * (1 - rejectAge / REJECT_FLASH_MS) : 0,
      shake: shakeOn ? REJECT_SHAKE_PX * (1 - rejectAge / REJECT_SHAKE_MS) : alertShake ? ALERT_SHAKE_PX : 0,
      shakeRot: alertShake ? ALERT_SHAKE_ROT : 0,
      shakeSeed: rejectFx === null ? 0 : rejectFx.seed,
      plate: hasPlate ? { gx: plateFrom.x + (plateTo.x - plateFrom.x) * s, gy: plateFrom.y + (plateTo.y - plateFrom.y) * s } : null,
      temp: tempView,
      alert,
      alertHot: rate >= ALERT_DANGER_RATE,
      clockMs,
    };
    return frame;
  };

  return {
    update,
    grab(color: number): void {
      dragging = true;
      dragColor = color;
      hoverCell = -1;
      pickScale = 1;
    },
    dragTo(cell: number, matched: boolean): void {
      if (!dragging) return;
      hoverCell = matched && cell >= 0 ? cell : -1;
    },
    endDrag(): void {
      dragging = false;
      dragColor = -1;
      hoverCell = -1;
      pickScale = 1;
    },
    place(cell: number): void {
      dragging = false;
      dragColor = -1;
      hoverCell = -1;
      combo += 1;
      sincePlaceMs = 0;
      if (cell >= 0 && Number.isFinite(cell)) locks.push({ cell, age: 0, combo });
    },
    reject(cell: number, from: { x: number; y: number }, to: { x: number; y: number }, s: number, color: number): void {
      dragging = false;
      dragColor = -1;
      hoverCell = -1;
      pickScale = 1;
      combo = 0;
      sincePlaceMs = 0;
      locks.length = 0;
      rejectFx = { age: 0, cell, from, to, s, color, seed: clockMs % 997 };
    },
    reset(): void {
      dragging = false;
      dragColor = -1;
      hoverCell = -1;
      pickScale = 1;
      highlight = 0;
      locks.length = 0;
      rejectFx = null;
      combo = 0;
      sincePlaceMs = 1e9;
      alert = 0;
    },
    get frame(): JuiceFrame {
      return frame;
    },
  };
};

