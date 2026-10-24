/**
 * 内置布局样例（`mg.ui.pattern`）。
 *
 * 只放 `.ui` 源码字面量，不放逻辑——AI 写界面前先抄一份最接近的。
 * 每个样例都必须能通过 `mg.ui.check`（与构建同一份默认注册表，单测逐个跑）。
 * `put` 的名字必须是已注册组件（不能自造 pauseButton / title 这类别名）。
 */

const HUD = `# HUD：顶部信息条 + 底部操作条，中间留给游戏画面
region header top 8% row gap 8 pad-x 5% align center
put coinBadge  size fixed 28 cross fixed 28
put statusText size fill  cross fixed 24
put pause      size fixed 32 cross fixed 32

region body fill

# 底部操作条：两个按钮按比例分宽（gap 用像素，避免百分比基数不同带来溢出）
region footer bottom 10% row gap 8 pad-x 5% align center
put primaryButton   size 60% cross fixed 56
put secondaryButton size 36% cross fixed 44
`;

const LIST = `# 列表页：标题 + 列表区 + 底部主按钮
region header top 10% row pad-x 5% align center
put label size fill cross fixed 32 style text="标题" fontSize=18

region list fill column gap 8 pad 12
put panel size fill cross fixed 64
put list  size fill

region footer bottom 12% column pad 16
put primaryButton size fill cross fixed 56
`;

const MODAL = `# 弹窗：全屏遮罩，面板内容在纵向流里居中（无绝对坐标）
region backdrop fill column align center gap 12 pad 24
put label           size fixed 28  cross fixed 200 style text="标题" fontSize=18
put panel           size fixed 120 cross fixed 240
put primaryButton   size fixed 48  cross fixed 200
put secondaryButton size fixed 40  cross fixed 200
`;

const RESULT = `# 结算页：标题 + 成绩 + 底部两个操作按钮
region titleBand top 18% column align center
put label size fixed 40 cross fixed 280 style text="结算" fontSize=22

region scoreBand fill column align center gap 16
put statusText size fixed 48 cross fixed 240
put progress   size fixed 24 cross fixed 300 style value=80 max=100

region actions bottom 20% row gap 4% pad-x 5% align center
put primaryButton   size 47% cross fixed 52
put secondaryButton size 47% cross fixed 52
`;

export const PATTERNS: Readonly<Record<string, string>> = {
  hud: HUD,
  list: LIST,
  modal: MODAL,
  result: RESULT,
};

/** 样例名列表（按注册顺序）。 */
export const PATTERN_NAMES: readonly string[] = Object.keys(PATTERNS);

/** 取样例源码；名字不存在返回 undefined，由工具层拼中文错误。 */
export const getPattern = (name: string): string | undefined => PATTERNS[name];
