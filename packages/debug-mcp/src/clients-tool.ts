/**
 * `clients` 工具（T24）：列出当前连上的游戏客户端。
 *
 * 为什么单独一个工具而不是塞进 `snapshotList`：它是「找谁可用」的入口，
 * 而 `snapshotList` 是快照磁盘列表；放一起会让 AI 分不清「客户端」和「快照」。
 */

import type { ToolResult, ToolSpec } from './contract';
import type { ClientPicker } from './client-picker';

/** 工具名（`mg.clients` 与 `clients` 等价，与其它工具同口径）。 */
export const CLIENTS_TOOL_NAME = 'clients';

export interface ClientsTool {
  readonly specs: readonly ToolSpec[];
  readonly call: (name: string, params: Record<string, unknown>) => Promise<ToolResult>;
  readonly handles: (name: string) => boolean;
}

export const createClientsTool = (picker: ClientPicker): ClientsTool => {
  const canonical = (name: string): string => (name.startsWith('mg.') ? name.slice(3) : name);
  const specs: readonly ToolSpec[] = [
    {
      name: CLIENTS_TOOL_NAME,
      description:
        '列出当前连上调试服务端的游戏客户端：连接 id（c1/c2…）、平台、画面尺寸/dpr、连接时间。' +
        '运行时工具（canvas/tree/state/screenshot/click/snapshot/diff/checkRender）默认打最新连上的那个；' +
        '多客户端并存时用 client 参数指定，例如 { "client": "c1" }。',
      inputSchema: { type: 'object', properties: {} },
    },
  ];

  return {
    specs,
    handles: (name: string): boolean => canonical(name) === CLIENTS_TOOL_NAME,
    async call(): Promise<ToolResult> {
      const clients = picker.list();
      return {
        text: JSON.stringify(
          {
            count: clients.length,
            clients,
            note:
              clients.length === 0
                ? '当前没有客户端连接：先 mg dev 并打开页面。'
                : '运行时工具默认打最新连上的那个；用 client 参数指定其它连接。',
          },
          null,
          2,
        ),
      };
    },
  };
};
