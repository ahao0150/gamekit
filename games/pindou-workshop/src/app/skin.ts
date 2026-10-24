/**
 * **全部色值的单一来源 —— 浅底版（B 透明亚克力工坊）。**
 *
 * 唯一例外：`levels.ts` 的 `CELL_TINTS`（6 个珠色属于玩法数据，不是皮肤）。
 * 本文件之外，`src/app/` 里不许再出现颜色字面量。
 *
 * 纪律：这里**只放色值、不放数值**（时长 / 强度 / 像素幅度留在 `anim.ts`）。
 * 深底 → 浅底的对照与对比度换算见 `artifacts/art/pindou-art-integration-plan.md` §2。
 */

// ---------- 底 / 文字 ----------

/** 画布底：背景图缺图时的回退色（有图时由背景 cover 覆盖，见 render-art） */
export const BG = '#E7F2EE';
/** 主文字 / 图标墨色：on #F2F8F6 = 15.21:1 */
export const INK = '#1B211F';
/** 次文字（原深底时代的 55% 白）：on #F2F8F6 = 6.78:1 */
export const INK_DIM = '#4A5A54';
/** 未解锁缩略图的压暗蒙版（浅底上仍要压暗，保持） */
export const DIM_MASK = 'rgba(20,16,24,0.66)';
/** 关卡缩略图底 */
export const THUMB_BG = '#F2F8F6';
/** 缺图兜底色（`CELL_TINTS` 越界 / 素材 404 时用） */
export const FALLBACK_TINT = '#888';

// ---------- HUD / 面板 ----------

/** `.ui` 里 panel 的缺图回退底（磨砂白） */
export const PANEL_FILL = '#F2F8F6';
/** HUD 带顶部 1px 高光 */
export const HUD_EDGE_LIGHT = 'rgba(255,255,255,0.90)';
/** HUD 带底部 1px 分界线（没有它白条会糊进浅背景） */
export const HUD_EDGE_DARK = 'rgba(27,33,31,0.12)';

// ---------- 色块 / 凹槽 ----------

export const BEAN_STROKE = 'rgba(0,0,0,0.4)';
export const BEAN_HILIGHT = 'rgba(255,255,255,0.35)';
/** 目标格凹槽填充（浅底上「淡显」的替代：整格不上色，只压一层白） */
export const GROOVE_FILL = 'rgba(255,255,255,0.55)';
/** 目标格凹槽内描边 */
export const GROOVE_STROKE = 'rgba(27,33,31,0.25)';
/** 临时位虚线描边 */
export const SLOT_STROKE = 'rgba(27,33,31,0.18)';
/** 色点 / 珠子 rim 的混合基色（`mix(珠色, RIM_DARK, 0.5)`） */
export const RIM_DARK = '#14201C';
/** 盘面底板：浅底上格子需要一块板才有层次（叠在背景上 ≈ #EBF2EF） */
export const BOARD_PLATE = 'rgba(255,255,255,0.55)';
/** 盘面底板描边 / 格线 */
export const GRID_LINE = 'rgba(27,33,31,0.12)';

// ---------- 拖拽 / 锁定 / 落位错误 ----------

export const DRAG_SHADOW = 'rgba(0,0,0,0.30)';
/** 拖拽块高光描边：浅底上白描边不可见，改深墨 */
export const DRAG_STROKE = 'rgba(27,33,31,0.35)';
/** 弹回残影描边 */
export const GHOST_STROKE = 'rgba(0,0,0,0.45)';
/** 归位锁定高光（接线后改「深色双环」，见方案 §2.5） */
export const LOCK_GLOW = '#FFFFFF';
export const LOCK_PARTICLE = '#FFFFFF';
/** 落位错误：单格闪红（不是全屏） */
export const REJECT_CELL = '#C2543F';
/** 广告提示锁定格的金色描边：浅底上压深一档才看得见 */
export const HINT_STROKE = '#B8791F';

// ---------- 熨烫 ----------

/** 未烫格：浅底上不能再用深灰，改比背景略暗的浅灰 */
export const IRON_COLD = '#DCE8E4';
/** 已烫格过渡色（有图案色时以图案色为准） */
export const IRON_DONE = '#8B6A3F';
/** 烫糊格轮廓（浅底上纯焦褐太重，提亮一档） */
export const IRON_BURN = '#4A3A30';
/** 熨烫板暖光 / 描边：压深一档，否则糊进背景 */
export const PLATE_GLOW = '#B8791F';
/** 熨烫板本体（半透明灰） */
export const PLATE_BODY = 'rgba(184,184,184,0.40)';
/** 板下受热格叠加：浅底上白叠白不可见，改深墨低透明 */
export const HEAT_OVERLAY = 'rgba(27,33,31,0.08)';

// ---------- 温度条三段 ----------

export const TEMP_OK_COLOR = '#3E8E5C';
export const TEMP_WARN_COLOR = '#B8791F';
export const TEMP_HOT_COLOR = '#A8412F';
/** 温度条冷态指针 */
export const TEMP_COLD_COLOR = '#6B7B75';
/** 温度条轨道底（原本是白 12%，浅底上不可见） */
export const TRACK_BASE = 'rgba(27,33,31,0.10)';

// ---------- 全屏层 ----------

/** 全屏闪（放错） */
export const REJECT_FLASH_COLOR = '#C2543F';
/** 烫糊累积告警暗角：浅底上黑影显脏，换冷灰绿 */
export const ALERT_VIGNETTE = '#2A3B36';
/** 结算页遮罩：压暗背景让磨砂白面板跳出来（自绘而不是 `.ui` 的 panel：panel 有图就优先画图） */
export const RESULT_SCRIM = 'rgba(27,33,31,0.30)';
/** 结算对话框实底色 = 面板素材中心色（九宫格中心比边缘亮 2 级，先铺均匀底再叠图） */
export const DIALOG_FILL = '#F5FBF9';
/** 对话框描边（实底面板的边界） */
export const PANEL_EDGE = 'rgba(27,33,31,0.10)';

// ---------- 组件主题（DEFAULT_THEME 的浅底覆盖） ----------

/** 按钮 / 组件上的浅色字：白 on #2F6F63 = 5.87:1 */
export const THEME_LIGHT = '#FFFFFF';
/** 主按钮底（深绿，白字 5.87:1） */
export const THEME_PRIMARY = '#2F6F63';
/** 次按钮底：白字 4.98:1（组件把按钮文字写死用 light，不能改；见方案 §2.1 的偏离说明） */
export const THEME_SECONDARY = '#3E7A6F';
/** 面板底 */
export const THEME_PANEL = '#F2F8F6';
/** 网格线 */
export const THEME_GRID_LINE = '#B9CFC9';
/** 禁用态 */
export const THEME_DISABLED = '#9AA8A4';

