# v1 归档记录（历史，已被 v2 取代）

> **本仓库已于 2026-10-20 重启为 v2 开发中。**
> 下面的文字是 v1 归档时的原文，保留为**历史记录**，**不再是当前开发约束**。
> 当前规则见 [AGENTS.md](AGENTS.md)。

---

## v1 为什么被归档（2026-10-19）

本仓库是 2026-10-19 尝试自研一套「Vite + TypeScript → web / 微信小游戏 / 抖音小游戏」轻量框架的产物，
核心诉求是「适合 AI 理解、2D 方向、平台适配层可扩展」。

开发约 2 小时后用户叫停，判断是**重复造轮子**：团队本机已装 Cocos Creator 3.8.8，
三端构建、2D 物理（Box2D）、Spine / DragonBones、图集、帧动画、粒子、UI、音频、分包全部现成。

## v2 为什么重启（2026-10-20）

用户实际用 Cocos 走完一轮完整开发后（一个游戏从脚手架到三端构建到自动化测试），
判断 **Cocos 对 AI 不友好**，放弃该路线：

1. 场景是序列化 JSON，AI 只能手写，改一次错一次；
2. UI 全部要代码建（编辑器 GUI 点不了），等于没享受到编辑器；
3. CLI 构建返回固定 exit 36 这类非标准退出码，判断成败要靠日志；
4. 坐标系与 Canvas 相反（`camera.worldToScreen` 的 y 未翻转），测试踩坑。

重启决定：**以 v1 的契约为基础重写**，栈保持 Vite 8 + TypeScript strict，
平台范围 web / 微信 / 抖音 三端，适配器做成可扩展插件，新平台只加一个目录。

## v1 里被 v2 继承的部分

| 产物 | 状态 |
| --- | --- |
| `docs/DESIGN.md` | **继承**：分层、七条铁律、契约清单、构建三条硬约束 |
| `packages/runtime/src/platform/contract.ts` | **继承**：13 项能力 + `PlatformAdapter` + 注册表 |
| `packages/runtime/src/core/loop` | **继承**：实现 + 测试（固定步长 + 插值渲染） |
| `packages/runtime/src/core/stage` | **继承**：实现 + 测试（界面栈） |
| `packages/runtime/src/core/input` | **继承**：实现 + 测试（统一输入动作） |
| `packages/vite-plugin/src` | **重写**：v1 有 2 处类型错误，且未按老 `build.js` 的资源管线落地 |
| `packages/cli/src` | **重写**：v1 未写 |
| `templates/` | **重写**：v1 空的 |

## v1 留下的踩坑结论（v2 直接受益）

**Vite 8 / Rolldown（实测得出）**

- Vite 8.3.4 内核已换 Rolldown；
- `build.rollupOptions` 已 deprecated，改 `build.rolldownOptions`；
- `output.inlineDynamicImports` 已 deprecated，等价写法 `output.codeSplitting: false`；
- `minify` 默认 `'oxc'`；
- iife 单文件输出 + 虚拟模块 + `emitFile` 写 `index.html` 均实测可用。

**老框架（`build.js` 287 行）的资源管线结论**

- 资源绝不能交给 Vite 的 asset 管线：小游戏没有 `fetch` / `new URL`；
- 同名 `png`/`webp` 只打较小的那份，且要检测「png 比 webp 还小」的过期版本隐患；
- 清单只登记**真打进包**的文件，客户端永不 404；
- 分包规则要按素材类型算，空分包会被 wx/tt 构建报错；
- 主包红线 3MB（微信/抖音），超了要告警而不是静默构建。
