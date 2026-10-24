/**
 * 存档 / 数值调试 MCP 工具草案（未接 WebSocket 游戏侧 handler）。
 */

import type { ToolResult, ToolSpec } from './contract';

const ok = (text: string): ToolResult => ({ text });

export const SAVE_STUB_SPECS: readonly ToolSpec[] = [
  {
    name: 'save_simulate_days',
    description: '【草案未接线】将存档时间快进 N 天并重算离线收益。详见 docs/DEBUG-SAVE-COMMANDS.md',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'number', description: '快进天数' } },
      required: ['days'],
    },
  },
  {
    name: 'save_patch',
    description: '【草案未接线】按 JSON Path 修改当前存档字段（调试用）。详见 docs/DEBUG-SAVE-COMMANDS.md',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '如 data.gold' },
        value: { description: '新值（JSON）' },
      },
      required: ['path', 'value'],
    },
  },
];

export const callSaveStub = (name: string): ToolResult | null => {
  if (name === 'save_simulate_days' || name === 'save_patch') {
    return ok(
      '该工具仍为草案：游戏侧尚未注册 save.* WebSocket 命令。请先用 @mg/economy 的 simulate CLI 或本地改档；协议见 docs/DEBUG-SAVE-COMMANDS.md。',
    );
  }
  return null;
};
