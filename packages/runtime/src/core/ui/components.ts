/**
 * UI 组件注册表（T7）。
 *
 * 为什么需要它：`.ui` 只描述「哪块在哪、多大」，但 `parcelGrid` 该画几个格子、
 * 按钮该用什么素材、文字会不会溢出 —— 这些是**组件自己的知识**。把这部分收进
 * 注册表，布局语言才能保持「只管占位」，组件才能跨游戏复用。
 *
 * 三条边界（写死，别扩散）：
 * 1. `measure` / `assert` 是**纯函数**：只读入参，不碰 canvas、不读写全局状态；
 * 2. `draw` 只读状态、只画，做判定一律打回；
 * 3. 组件不 import 游戏代码（assets / theme 由 `DrawDeps` 注入）。
 */

import type { Rect } from './contract';
import type { LayoutViewport, StyleProps, StyleValue } from './layout-spec';
import type { Ctx2D } from '../../platform/contract';
import type { ImageAsset } from '../assets/contract';

// ---------------------------------------------------------------------------
// 参数声明
// ---------------------------------------------------------------------------

/**
 * 参数类型声明，三种写法：
 * - `'string'` / `'number'` / `'boolean'`：类型校验；
 * - `'primary|secondary'`：枚举（值必须落在列表里）。
 *
 * 声明既用于 `style k=v` 的**键**校验（喂 `parse()` 的 `componentProps`），
 * 也用于**值**校验（绑定期）和向 AI 报错时列可用参数。
 */
export type PropType = string;

/** 组件参数声明表：参数名 → 类型声明。 */
export type PropDecls = Readonly<Record<string, PropType>>;

/** 校验一个 style 值是否符合声明的类型；合法返回 null，否则返回中文说明。 */
export const checkPropValue = (type: PropType, value: StyleValue): string | null => {
  const allowed = type.split('|');
  if (allowed.length > 1) {
    return allowed.includes(String(value)) ? null : `只能是 ${allowed.join(' / ')}，收到 '${String(value)}'`;
  }
  if (type === 'string') return typeof value === 'string' ? null : `需要字符串，收到 '${String(value)}'`;
  if (type === 'number') return typeof value === 'number' ? null : `需要数字，收到 '${String(value)}'`;
  if (type === 'boolean') return typeof value === 'boolean' ? null : `需要 true / false，收到 '${String(value)}'`;
  return null; // 未识别的声明不做校验（宽松兜底，不把组件作者卡死）
};

// ---------------------------------------------------------------------------
// 环境与依赖
// ---------------------------------------------------------------------------

/** 布局期环境：组件读屏型和游戏数据的地方（纯数据，不碰 canvas）。 */
export interface MeasureEnv {
  /** 视口逻辑尺寸。`parcelGrid` 的 `min(W*.84/cols, H*.32/rows)` 用它当 W / H。 */
  readonly viewport: LayoutViewport;
  /** 游戏侧注入的只读数据（如 `{ cols, rows }`）；组件自己解释。 */
  readonly data: Readonly<Record<string, unknown>>;
}

/** 组件可读的游戏数据快照（与 {@link MeasureEnv.data} 同源）。 */
export type UiData = Readonly<Record<string, unknown>>;

/** 资产查询（`AssetService` 的结构子集，测试可直接塞假对象）。 */
export interface ComponentAssets {
  get(key: string): ImageAsset | null;
}

/** 主题：颜色与字体由游戏注入，组件里不写死美术风格。 */
export interface ComponentTheme {
  readonly fontFamily: string;
  /** 深墨（压浅色底） */
  readonly ink: string;
  /** 浅色（压深色底） */
  readonly light: string;
  readonly primary: string;
  readonly secondary: string;
  readonly panel: string;
  readonly gridLine: string;
  readonly disabled: string;
}

/** 默认主题：沿用《快递装车员》的深墨 / 浅字口径。 */
export const DEFAULT_THEME: ComponentTheme = {
  fontFamily: 'sans-serif',
  ink: '#1B211F',
  light: '#edf4ee',
  primary: '#315963',
  secondary: '#315963',
  panel: '#2b4a52',
  gridLine: '#284751',
  disabled: '#687780',
};

/** 绘制期依赖：**由游戏注入**，组件不 import 游戏资源。 */
export interface DrawDeps {
  readonly assets: ComponentAssets;
  readonly theme: ComponentTheme;
  /**
   * 可选：游戏数据快照（与 `MeasureEnv.data` 同源）。
   *
   * `parcelGrid` 的 draw 要知道 cols/rows 才能画对格子数；布局期的 measure 读的是
   * 同一份数据，两边必须同源，否则会「量出来的框和画出来的格子对不上」。
   */
  readonly data?: UiData;
}

// ---------------------------------------------------------------------------
// 组件定义
// ---------------------------------------------------------------------------

/** 内容尺寸。 */
export interface ComponentSize {
  readonly w: number;
  readonly h: number;
}

/** 组件定义。 */
export interface ComponentDef {
  /** 合法参数（用于 style 键/值校验与报错提示） */
  readonly props?: PropDecls;
  /** 不写 `size` 时的默认尺寸（布局里 `auto` 走 `measure`，这里给兜底） */
  readonly defaultSize?: { readonly w?: number; readonly h?: number };
  /** 布局期：返回自身内容尺寸。纯函数。 */
  readonly measure: (env: MeasureEnv, box: Rect, props: StyleProps) => ComponentSize;
  /** 绘制期：只读状态、只画。 */
  readonly draw: (ctx: Ctx2D, box: Rect, props: StyleProps, deps: DrawDeps) => void;
  /** 静态断言：返回中文问题列表（空数组 = 没问题）。 */
  readonly assert?: (box: Rect, props: StyleProps) => readonly string[];
}

/** 已命名、可注册的组件。 */
export interface DefinedComponent {
  readonly name: string;
  readonly def: ComponentDef;
}

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** 定义一个组件（只做命名校验，注册由注册表负责）。 */
export const defineComponent = (name: string, def: ComponentDef): DefinedComponent => {
  if (!NAME_RE.test(name)) {
    throw new Error(`组件名 '${name}' 不合法：必须是 [a-zA-Z_][a-zA-Z0-9_]*`);
  }
  if (def.props !== undefined) {
    for (const [key, type] of Object.entries(def.props)) {
      if (!NAME_RE.test(key)) throw new Error(`组件 '${name}' 的参数名 '${key}' 不合法`);
      if (typeof type !== 'string' || type.length === 0) {
        throw new Error(`组件 '${name}' 的参数 '${key}' 类型声明必须是非空字符串`);
      }
    }
  }
  return { name, def };
};

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------

export interface ComponentRegistry {
  /** 注册组件；同名重复注册直接抛错（静默覆盖会让「为什么画错了」永远查不出来）。 */
  register(comp: DefinedComponent): void;
  get(name: string): ComponentDef | null;
  has(name: string): boolean;
  /** 已注册组件名（注册顺序）。 */
  names(): readonly string[];
  /** 组件 → 参数键列表（喂 `parse()` 的 `componentProps`）。 */
  propKeys(): Readonly<Record<string, readonly string[]>>;
  /** 组件 → 参数类型声明（值校验用）。 */
  propDecls(): Readonly<Record<string, PropDecls>>;
}

export const createComponentRegistry = (): ComponentRegistry => {
  const map = new Map<string, ComponentDef>();
  return {
    register(comp: DefinedComponent): void {
      if (map.has(comp.name)) {
        throw new Error(`组件 '${comp.name}' 重复注册：先注册的那个会被静默覆盖，所以直接报错`);
      }
      map.set(comp.name, comp.def);
    },
    get: (name: string): ComponentDef | null => map.get(name) ?? null,
    has: (name: string): boolean => map.has(name),
    names: (): readonly string[] => [...map.keys()],
    propKeys: (): Readonly<Record<string, readonly string[]>> => {
      const out: Record<string, readonly string[]> = {};
      for (const [name, def] of map) out[name] = Object.keys(def.props ?? {});
      return out;
    },
    propDecls: (): Readonly<Record<string, PropDecls>> => {
      const out: Record<string, PropDecls> = {};
      for (const [name, def] of map) out[name] = def.props ?? {};
      return out;
    },
  };
};

/** 「未知组件」错误文案：列出已注册的名字，AI 拿到能自己改。 */
export const unknownComponentMessage = (name: string, registry: ComponentRegistry): string => {
  const names = registry.names();
  return `未知组件 '${name}'，已注册的有：${names.length > 0 ? names.join(' / ') : '（注册表为空）'}`;
};

// ---------------------------------------------------------------------------
// 小工具：读参数 / 估算文字
// ---------------------------------------------------------------------------

/** 读字符串参数。 */
export const stringProp = (props: StyleProps, key: string, fallback = ''): string => {
  const value = props[key];
  return typeof value === 'string' ? value : fallback;
};

/** 读数字参数。 */
export const numberProp = (props: StyleProps, key: string, fallback: number): number => {
  const value = props[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

/** 读布尔参数（字符串 'true' 也认，防手写 `.ui` 时漏了转换）。 */
export const boolProp = (props: StyleProps, key: string, fallback = false): boolean => {
  const value = props[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  return fallback;
};

/**
 * 估算文字像素宽：CJK 按 1 字宽、ASCII 按 0.55 字宽。
 *
 * 布局期不许碰 canvas（`layout()` 是纯函数），所以用估算而不是 `measureText`。
 * 口径与游戏 `draw.ts` 的 `textWidth` 一致 —— 两边不一样会让「测得下」和「画得下」
 * 出现偏差，那是溢出的经典来源。
 */
export const estimateTextWidth = (text: string, font: number): number => {
  let w = 0;
  for (const ch of text) w += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? font : font * 0.55;
  return w;
};
