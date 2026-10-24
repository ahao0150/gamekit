/**
 * 测试替身：`virtual:mg-atlas` 由构建注入图集清单；Node 测试里没有图集，
 * 返回 null = 「图集未启用」，`createAssets` 走单图分支。
 */

import type { AtlasManifest } from './deps';

export const atlas: AtlasManifest | null = null;
export default atlas;
