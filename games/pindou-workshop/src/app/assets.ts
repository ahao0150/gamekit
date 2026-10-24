/**
 * 美术资源接线的**唯一入口**：`virtual:mg-manifest`（构建期扫 `assets/` 生成）+
 * `virtual:mg-atlas`（图集清单）→ 一个 `AssetService`。
 *
 * 三条纪律：
 * 1. 业务侧不拼路径：manifest 里是 `assets/xxx.png`（三端都相对包根），`platform.loadImage`
 *    原样交给平台 → 游戏代码里没有平台分支（AGENTS §2-5）。
 * 2. **加载失败不抛错**：`loadAll` 把失败汇总在结果里，渲染层每帧 `get()` 拿不到就回退
 *    （回退画法是 `render-art.ts` 里的纯色分支，不是空白）。
 * 3. 不阻塞首帧：boot 里 `void loadAll(...)`，图没到就先画回退，下一帧自然换图。
 */

import { atlas } from 'virtual:mg-atlas';
import { manifest } from 'virtual:mg-manifest';
import { createAssets } from './deps';
import type { AssetService, ComponentAssets, PlatformAdapter } from './deps';

/** 本作**真要用**的资源。不进这个清单的图不能进 `assets/`（死资源，T68 的教训）。 */
export const ART_KEYS = [
  // 背景：1170×2532 > maxFrameSize，构建期自动排除在图集外（单独一张，cover 绘制）
  'bg/acrylic-desk',
  // 6 色珠子：64×64 同 mask，目标格 / 池子 / 拖拽共用
  'beads/red', 'beads/yellow', 'beads/green', 'beads/blue', 'beads/purple', 'beads/orange',
  // 图标：只留**有 UI 落点**的两个 —— 时钟画在盘面 HUD 左侧、温度计画在熨烫 HUD 左侧。
  // 镊子 / 熨烫板 / 灯泡 / 剪刀 / 播放没有落点，素材不进包（T68 死资源重演的教训）。
  'icons/clock', 'icons/thermometer',
  // 九宫格 / 三段胶囊
  // `ui/panel` 的落点是**结算/失败对话框底板**（`result.ui` 的 dialogBg 占位拿到 rect，
  // render.ts 用 drawNineSlice 画）——它一度因为没有落点被删，现在有落点了。
  'ui/panel', 'ui/hud-bar',
  'ui/btn-primary_normal', 'ui/btn-primary_disabled',
  'ui/btn-secondary_normal', 'ui/btn-secondary_disabled',
] as const;

export type ArtKey = (typeof ART_KEYS)[number];

/** 珠子色号 → 资源 key（`CELL_TINTS` 的下标顺序） */
export const BEAD_KEYS: readonly ArtKey[] = [
  'beads/red', 'beads/yellow', 'beads/green', 'beads/blue', 'beads/purple', 'beads/orange',
];

/** 建服务。`atlas === null`（图集未启用）时完全退回单图，行为与接线前一致。 */
export const createArt = (platform: PlatformAdapter): AssetService =>
  createAssets({
    loadImage: (src) => platform.loadImage(src),
    manifest,
    ...(atlas === null ? {} : { atlas }),
  });

/** 组件注册表只要一个同步 `get`；传 null 等价于「永远缺图」（测试与回退路径用）。 */
export const asComponentAssets = (art: AssetService | null): ComponentAssets => ({
  get: (key) => art?.get(key) ?? null,
});

export interface ArtStatus {
  readonly ready: number;
  readonly total: number;
  readonly failed: readonly string[];
}

/** 关键帧加载状态：验收脚本靠它断言「缺图回退真的发生过」，不能只看画面。 */
export const artStatus = (art: AssetService): ArtStatus => {
  let ready = 0;
  const failed: string[] = [];
  for (const key of ART_KEYS) {
    const st = art.status(key);
    if (st === 'ready') ready += 1;
    else if (st === 'failed') failed.push(key);
  }
  return { ready, total: ART_KEYS.length, failed };
};
