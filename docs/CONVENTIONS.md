# gamekit 约定

> 本文是**跨模块契约之外**的工程约定：项目配置、产物结构、命令行语义、红线数字。
> 契约（`**/contract.ts`）见各包源码；本文只写「谁在什么位置放什么、哪个数字是哪条线」。

## 1. `game.config.json`（游戏项目配置）

每个游戏项目根目录一份；`@mg/cli` 的 `build` / `dev` 从这里读选项。

| 字段 | 必填 | 类型 | 默认 | 说明 |
|---|---|---|---|---|
| `design` | ✅ | `{ width, height }` | — | 设计分辨率（逻辑像素，正整数）。决定 `game.json` 的 `deviceOrientation` 与 web 的 canvas/viewport |
| `fit` | | `'height' \| 'width' \| 'contain' \| 'fill'` | `contain` | 适配策略，传给平台层计算逻辑尺寸。`fill` = 画布铺满视口（v2 布局引擎推荐，配合 region 百分比） |
| `assetsDir` | | `string` | `assets` | 资源源目录（相对项目根） |
| `subpackages` | | `Record<string, string[]>` | `{}` | 分包名 → 资源相对路径前缀列表；命中前缀的资源进对应分包 |
| `title` | | `string` | `package.json` 的 `name` | web 页面标题 / 微信 `projectname`。包名是英文 kebab-case，这里写中文名 |
| `atlas` | | `{ enabled?, maxTextureSize?, maxFrameSize?, padding?, compress? }` | 不启用 | 图集打包。`{"enabled": true}` 即启用；`maxTextureSize` 2048 / `maxFrameSize` 512 / `padding` 2 / `compress: 'auto' \| 'none'`（默认 auto） |

```json
{
  "design": { "width": 390, "height": 844 },
  "fit": "contain",
  "assetsDir": "assets",
  "subpackages": { "level2": ["bg/level2", "ui/level2"] }
}
```

读取顺序：**`game.config.json` 优先**；没有该文件时退回 `package.json` 的 `mg` 字段（字段结构相同）。
两种写法只允许选一种，不要同时维护两处。

`design` 缺失时 `mg build` / `mg dev` 直接报错退出——不做「猜一个分辨率」的兜底。

## 2. 产物结构（`mg build`）

输出目录：`<项目根>/build/<target>/`，`target ∈ {web, wx, tt}`。

| target | 必需文件 | 资源 |
|---|---|---|
| `web` | `index.html`、`game.js`（单文件 iife） | `assets/` |
| `wx` / `tt` | `game.js`、`game.json`、`project.config.json` | 主包 `assets/`；分包 `subpackages/<name>/` |

额外两份元数据（所有 target 都有）：

- `asset-manifest.json`：`key → 候选路径数组`。`key` = 相对 `assetsDir`、去掉扩展名的稳定标识（如 `ui/btn`）；
  只登记**真打进包**的文件——清单里有而产物里没有，`mg check` 直接判失败（客户端会 404）。
- ⚠ `build-report.json`：**规划中，当前未实现**（仓库里 grep 不到这个文件名，产物里也没有）。
  包体统计目前只**打印在构建日志里**，不落文件，文案形如：
  `mg 包体（wx）：主包 610.9 KB / 合计 610.9 KB，17 个文件`（web 无主包限制，只报合计）。
  需要机读包体数字时，自己遍历 `build/<target>/` 算，或等这个文件落地。

## 3. 命令行语义

| 命令 | 作用 | 默认 | 退出码 |
|---|---|---|---|
| `mg create <name> [--template iaa-simple]` | 复制 `templates/<tpl>` 到 `games/<name>`，改 `package.json` 的 `name` | 模板 `iaa-simple` | 0 成功 / 1 失败 |
| `mg dev [--target web\|wx\|tt] [--port <n>] [--host <addr>] [--strict-port]` | web 起 dev server；wx/tt 走 `build --watch` | `web`；host `127.0.0.1` | 0 / 1 |
| `mg build [--target ...] [--all]` | 三端产物 | `web`（`--all` 出三端） | 0 / 1 |
| `mg check [--target ...] [--all] [--out-dir <dir>]` | 包体红线、`game.json` 与产物目录一致、清单与产物一致 | 检查已存在的全部产物 | 0 通过 / 1 有不通过项 |
| `mg pack [--write]` | 美术资源统计（压缩流水线未接入，`--write` 报未实现） | dry-run | 0 / 1 |
| `mg doctor` | 环境与仓库体检（node / pnpm / 包目录 / 契约文件 / 模板 / 产物） | — | 0 无 error / 1 有 error。**warning 不影响退出码**（⚠ 只提示，别看到 ⚠ 就以为 exit 1） |

`mg dev --host 0.0.0.0` 会监听全部网卡，可在同网段设备的浏览器里用本机局域网 IP 访问，
做手机 / 平板上的局域网预览（默认 `127.0.0.1` 只允许本机访问）。

**项目根 vs 仓库根**（重要）：

- `build` / `dev` / `check` / `pack` 作用于**游戏项目根**，默认 `cwd`，`--root <dir>` 覆盖；
- `create` / `doctor` 需要**仓库根**（要访问 `templates/`、`packages/`），自动从 `cwd` 向上找 `pnpm-workspace.yaml`。

## 4. 两条包体红线（别混用）

| 数字 | 归属 | 行为 |
|---|---|---|
| **4MB** | 微信 / 抖音主包**平台硬限** | `@mg/vite` 构建时统计并在超标时打红字**告警**，不中断构建 |
| **3MB** | 团队**发布保守线** | `mg check` 判 **error** 并退出 1，给后续迭代与平台差异留 1MB 余量 |

改任何一个数之前先想清楚改的是哪条线；两处出现不同数字是**有意设计**，不是 bug。

## 5. 游戏项目约定（模板与新建项目）

```
games/<name>/
├── package.json        脚本：dev / build / check / test
├── game.config.json    见 §1
├── tsconfig.json
├── assets/             游戏运行时要加载的资源（**只放这些**，见下）
├── artifacts/          样张 / 原图 / 中间产物（**不进包**）
└── src/
    ├── main.ts         入口（@mg/vite 默认查找 src/main.ts | src/main.js | src/index.ts）
    └── app/            玩法与界面；测试与源码同目录
```

### `assets/` 里放什么

**`assets/` 下只放游戏真正要加载的资源。** 样张、AI 原始输出、预览图、中间产物
一律放 `artifacts/`，它们不参与打包。

为什么这么严：打包规则是「`assets/` 下一切媒体文件都进包」，没有排除目录的开关。
微信/抖音主包平台硬限 4MB、团队发布线 3MB（§4），而样张动辄几 MB。实测事故：
美术样张放在 `assets/samples/`（35 个文件 / 3.86MB，含 5 张 400–500KB 的 AI 原始
输出）被整包打进 wx 主包 → **3922.9KB，离 4MB 只剩 120KB**，那个产物直接不能上架。
把样张移到 `artifacts/samples/` 后，主包回到 147.9KB。

推论：**每次接完素材先 `mg build --all` + `mg check` 看包体**，别等上线前才发现。

- **平台差异只走 `platform.can('xxx')`**：`src/app/` 里不许出现 `wx.` / `tt.` / `window.` / `navigator.`。
- 数据 / 逻辑 / 渲染三分：状态与存档结构、布局都是纯函数，可脱离 canvas 单测。
- 每个公开函数至少一条契约测试；纯函数（布局、经济、状态迁移）必须可脱离 DOM 测试。
- 单文件 ≤300 行、无全局可变状态；超了就拆，不要豁免。

## 6. 游戏代码怎么 import runtime

游戏代码只从 `@mg/runtime`（包名）导入，不写跨包相对路径。

> 临时状态：`@mg/runtime` 的根 barrel（`src/index.ts`）尚未落地，当前模板在
> `src/app/deps.ts` 里用相对路径接 core 源码，**这是唯一允许出现相对路径的位置**。
> barrel 落地后把 `deps.ts` 的 import 换成包名即可，其余业务代码零改动。

## 7. 存档命名空间

`createSave` 默认命名空间 `mg.save.`，实际键：

- 主槽：`mg.save.data`
- 待提交槽：`mg.save.data.pending`

多存档 / 多账号用 `namespace` 区分（如 `mg.save.slot2.`），不要在一个游戏里手拼 key。
