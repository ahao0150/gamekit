declare module 'virtual:mg-manifest' {
  const manifest: Readonly<Record<string, readonly string[]>>;
  export default manifest;
  export { manifest };
}
declare module 'virtual:mg-config' {
  export const target: 'web' | 'wx' | 'tt';
  export const design: { readonly width: number; readonly height: number };
  export const fit: 'height' | 'width' | 'contain' | 'fill';
  export const assetsBase: string;
}
declare module 'virtual:mg-atlas' {
  /** 图集清单；未启用图集时为 null */
  const atlas: {
    readonly version: number;
    readonly atlases: Readonly<Record<string, { readonly w: number; readonly h: number }>>;
    readonly frames: Readonly<Record<string, {
      readonly atlas: string;
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    }>>;
  } | null;
  export default atlas;
  export { atlas };
}
