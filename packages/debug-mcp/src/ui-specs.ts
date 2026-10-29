/**
 * 五个离线 UI 工具的声明（`tools/list` 返回给 AI 的部分）。
 *
 * 单独成文件的原因：描述文本很长（每个字段都要解释清楚，AI 只看这份），
 * 和实现混在一个文件会顶到 300 行上限。
 */

import type { ToolSpec } from './contract';

/**
 * `ui.check` / `ui.layout` / `ui.preview` 共用的 `registry` 参数说明。
 *
 * 存在意义：默认注册表只含内置 31 个组件，工程自写组件（如 player-ui-lab 的 9 个）离线必报
 * 「未知组件」，只能等 `mg build`。传这个参数就把解析 / 参数校验 / `auto` 尺寸的 measure
 * 全部换成该模块的注册表。
 */
const REGISTRY_PARAM = {
  type: 'string',
  description:
    '组件注册表模块路径（相对仓库根或绝对路径），如 "games/player-ui-lab/src/app/ui-registry.ts"。'
    + '不传 = 内置 31 个组件；工程自写了组件时必须传，否则离线报「未知组件」。'
    + '模块导出注册表实例或无参 create* 工厂（createRegistry / createDefaultUiRegistry …）都认；'
    + '认不出（文件不存在 / import 失败 / 没有注册表）直接报错并列出该模块导出名，不回退内置。',
};

export const UI_TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: 'ui.check',
    description:
      '离线编译校验 `.ui`（不用启动游戏、不用连 WebSocket）：解析语法 → 布局 → L2 断言（越界 / 同区域重叠 / 0×0）。' +
      '返回 JSON { ok, errors, rects }；errors 格式与解析器一致（`file:line: 中文说明`）。' +
      '多个视口传 `viewports: ["390x844","320x568"]`，会返回 { ok, errors, results }。默认视口 390×844。',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: '.ui 源码全文（不是文件路径）' },
        viewport: { type: 'string', description: '视口，如 "390x844"；也可传 {width,height}' },
        viewports: { type: 'array', description: '多视口数组，如 ["390x844","320x568"]', items: { type: 'string' } },
        fileName: { type: 'string', description: '错误前缀用的文件名，默认 ui.ui' },
        registry: REGISTRY_PARAM,
      },
      required: ['source'],
    },
  },
  {
    name: 'ui.layout',
    description:
      '离线布局：返回纯 JSON { ok, viewport, regions, rects, errors }。regions 是区域矩形、rects 是元素矩形，单位逻辑像素。' +
      '只算不画，适合 AI 直接读数字做断言；要人读的概览用 ui.preview。',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: '.ui 源码全文' },
        viewport: { type: 'string', description: '视口，如 "390x844"；默认 390×844' },
        fileName: { type: 'string', description: '错误前缀用的文件名，默认 ui.ui' },
        registry: REGISTRY_PARAM,
      },
      required: ['source'],
    },
  },
  {
    name: 'ui.preview',
    description:
      '离线 ASCII 预览：每个区域给名字 + 实际高度，每个元素给名字 + 实际宽高。' +
      '出问题的块就地标 `⚠ <短原因>`（高度 0 / 越界 / 重叠），无归属问题标在框顶，框下是汇总行' +
      '（`共 N 块 / M 个元素 / K 处问题（按类别计数）`）与 ✗ 明细。' +
      '传 `viewports: ["390x844","320x568"]` 会输出多段（上下排列），用来确认「换分辨率会不会溢出」。' +
      '注意：preview 把「任一维为 0」也标出来（提示 measure 未注册），而 check 只在 0×0 时判错。',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: '.ui 源码全文' },
        viewport: { type: 'string', description: '视口，如 "390x844"；默认 390×844' },
        viewports: { type: 'array', description: '多视口数组', items: { type: 'string' } },
        fileName: { type: 'string', description: '错误前缀用的文件名，默认 ui.ui' },
        registry: REGISTRY_PARAM,
      },
      required: ['source'],
    },
  },
  {
    name: 'ui.grammar',
    description:
      '当前 `.ui` 语法（由解析器 grammar.ts 动态生成，单一真源，不是手写手册）：动词、区域边/方向/修饰词、' +
      'align 取值、尺寸与长度写法、style 值类型、百分比基数规则、错误格式。写 `.ui` 前先调一次。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ui.pattern',
    description:
      '取一份内置布局样例的 `.ui` 源码（可直接抄改）：hud / list / modal / result。' +
      '不传 name 会返回可用样例列表。',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: '样例名：hud / list / modal / result' } },
    },
  },
];
