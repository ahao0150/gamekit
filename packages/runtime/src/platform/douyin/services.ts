/**
 * 抖音端的小服务：分包 / 分享 / 震动（从 index.ts 抽出来，让适配器主体只剩装配）。
 *
 * 为什么单独一个文件：`douyin/index.ts` 已经贴着单文件 300 行的上限，
 * 而这三个服务与「装配适配器」没有关系 —— 它们只是「把 tt 的 API 包成契约形状」。
 * 抽出来以后，index.ts 读起来就是契约本身：画布 / 触摸 / 存储 / 音频 / 广告 / 键盘。
 *
 * 抖音与微信的真实差异只有一条，写在下面 `share` 里：
 * **分享必须带 channel**，否则分享面板常常拉不起来。
 */

import type { ShareOptions } from '../contract';
import type { TtApi } from './api';

/** 分享渠道。抖音必须指定，默认用 'video'。 */
const readShareChannel = (extra: Record<string, unknown> | undefined): string => {
  const v = extra?.shareChannel;
  return typeof v === 'string' && v.length > 0 ? v : 'video';
};

export interface DouyinServices {
  readonly loadSubpackage: (name: string) => Promise<void>;
  readonly share: (opts: ShareOptions) => void;
  readonly vibrate: (kind: 'light' | 'medium' | 'heavy') => void;
}

export const createDouyinServices = (
  api: TtApi,
  extra: Record<string, unknown> | undefined,
): DouyinServices => {
  const loadSubpackage = (name: string): Promise<void> =>
    new Promise((resolve, reject) => {
      api.loadSubpackage({
        name,
        success: () => resolve(),
        fail: (err: unknown) => reject(new Error(`分包「${name}」加载失败：${String(err)}`)),
      });
    });

  const shareChannel = readShareChannel(extra);
  const share = (opts: ShareOptions): void => {
    // 差异：抖音必须带 channel，否则分享面板常常拉不起来
    api.shareAppMessage({
      title: opts.title,
      imageUrl: opts.imageUrl,
      query: opts.query,
      channel: shareChannel,
    });
  };

  const vibrate = (kind: 'light' | 'medium' | 'heavy'): void => {
    api.vibrateShort({ type: kind });
  };

  return { loadSubpackage, share, vibrate };
};
