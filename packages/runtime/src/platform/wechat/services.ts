/**
 * 微信端的小服务：分包 / 分享 / 震动（从 index.ts 抽出来，让适配器主体只剩装配）。
 *
 * 为什么单独一个文件：`wechat/index.ts` 已经贴着单文件 300 行的上限
 * （AGENTS 铁律 2），而这三个服务与「装配适配器」无关 —— 它们只负责把 wx 的 API
 * 包成契约形状。抽出来之后 index.ts 读起来就是契约本身。
 *
 * 与抖音的差异：微信的 `shareAppMessage` **不需要** channel，抖音必须带
 * （不带常常拉不起分享面板）。所以这里是两个独立的文件，不是共用一份再 if。
 */

import type { ShareOptions } from '../contract';
import type { WxApi } from './api';

export interface WechatServices {
  readonly loadSubpackage: (name: string) => Promise<void>;
  readonly share: (opts: ShareOptions) => void;
  readonly vibrate: (kind: 'light' | 'medium' | 'heavy') => void;
}

export const createWechatServices = (api: WxApi): WechatServices => {
  const loadSubpackage = (name: string): Promise<void> =>
    new Promise((resolve, reject) => {
      api.loadSubpackage({
        name,
        success: () => resolve(),
        fail: (err: unknown) => reject(new Error(`分包「${name}」加载失败：${String(err)}`)),
      });
    });

  const share = (opts: ShareOptions): void => {
    api.shareAppMessage({
      title: opts.title,
      imageUrl: opts.imageUrl,
      query: opts.query,
    });
  };

  const vibrate = (kind: 'light' | 'medium' | 'heavy'): void => {
    api.vibrateShort({ type: kind });
  };

  return { loadSubpackage, share, vibrate };
};
