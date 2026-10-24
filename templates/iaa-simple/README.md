# iaa-simple —— 新游戏起点模板

一个 **约 360 行纯源码**（含测试约 540 行）的可跑 IAA 小游戏 demo：启动 → 一个界面 → 点按钮加分 →
自动存档（刷新后分数还在）→ 底部分数条（`ui` 纯函数布局）→ banner 占位 +
激励视频 no-op（`ads`）。

## 目录

```
templates/iaa-simple/
├── package.json          脚本：dev / build / check / test
├── tsconfig.json
├── game.config.json      设计分辨率 390×844（约定见 docs/CONVENTIONS.md）
├── vitest.config.ts      纯 Node 测试，不依赖浏览器
├── assets/               占位图（assets/README.md 说明怎么替换）
├── tools/                真浏览器验证脚本（见「平台适配门禁」）
└── src/
    ├── main.ts           入口：解析平台 → 建游戏 → 启动
    └── app/
        ├── deps.ts       runtime 依赖汇聚点（唯一直接 import runtime 的文件）
        ├── state.ts      游戏状态 + 存档结构（纯函数）
        ├── layout.ts     界面布局（纯函数，可脱离 canvas 单测）
        ├── game.ts       玩法与渲染
        ├── layout.test.ts 布局断言：屏型 × widget 不越界
        └── game.test.ts  真实点击路径 + 存档往返（用 platform/mock）
```

## 用法

**命令写法规则（全文同此口径，别背错）：**

- **仓库根**：只能写 `node packages/cli/bin/mg.mjs <命令>`。根 `package.json` 没有 `mg`
  script、根 `node_modules/.bin` 也没有 `mg`，裸 `mg` / `pnpm mg` 会报
  `Command "mg" not found`。
- **游戏目录内**：写 `pnpm <script>`（本模板 scripts 已绑好）或 `pnpm exec mg <命令>`。

```bash
# 1) 建项目（仓库根执行）
node packages/cli/bin/mg.mjs create my-game   # 复制本模板到 games/my-game 并改 package.json name
cd games/my-game

# 2) 游戏目录内的日常命令
pnpm dev              # = mg dev：web 保存即刷新；wx/tt 构建监听
pnpm build            # = mg build --all：三端产物 → build/{web,wx,tt}/
pnpm check            # = mg check：主包红线 / game.json / 资源清单一致性
pnpm test             # = vitest run：布局与存档往返（mock 平台，不需要浏览器）

# 等价写法：pnpm exec mg dev / pnpm exec mg build --all
```

## 平台适配门禁（真浏览器）

> ⚠ **前置条件：必须在 danger-full-access 会话里跑。** 这个门禁开真无头 Chrome；
> DSH 的 workspace-write 沙箱下 Chrome 的 crashpad 会 `OpenProcess: 拒绝访问 (0x5)` →
> `crash server failed to launch, self-terminating` → **浏览器启动即自杀**，
> `DevToolsActivePort` 永不出现。表现像「10 秒内没就绪 / 端口没监听 / 版本不对」，
> 极易误判；`--no-sandbox`、换 Edge、换 chrome-headless-shell 都救不了。
> 见 `docs/TEAM-TOOLS.md` §五-5。

`tools/verify-platform.mjs` 是框架层的**端到端回归门禁**：dpr 五档（1 / 1.25 / 1.5 / 2 / 3）
× 两种视口（390×844 设计尺寸、320×480 窄屏）× 两种模式（build 产物 / dev server）= 20 个组合。

```bash
# 在仓库根
pnpm -w verify-platform        # 等价于 node templates/iaa-simple/tools/verify-platform.mjs
```

它守的是两类真实缺陷：

| 缺陷 | 症状 | 门禁怎么抓 |
| --- | --- | --- |
| dpr 变换缺失 | backing 是 CSS×dpr 但没 `setTransform(dpr,…)` → 画面只占左上角 1/dpr²，点击与画面差 dpr 倍 | `ctx.getTransform().a/.d === dpr` + 整画布不透明率 > 0.9 |
| 窄视口裁切 | CSS 写死设计尺寸，视口比它小 → 画布被裁，底部按钮点不到 | 320×480 下 backing 仍等于 CSS×dpr，且点主按钮命中 |

每个组合跑四条断言：

1. `canvas.width === round(cssWidth × dpr)`（height 同理）—— backing 契约
2. `ctx.getTransform().a === dpr` 且 `.d === dpr` —— dpr bug 的直接守卫
3. 整画布不透明率 > 0.9 —— 整张画布真落笔，不是只剩左上角
4. 点主按钮命中（分数 0 → 1）—— 走浏览器原生输入，不走调试钩子

外加两层反例自检，防止门禁自己变成假阳性（团队踩过「RGB ≠ 背景色」判不出透明像素、
实现错了测试照样绿）：每个组合打掉 dpr 变换重绘一次，不透明率必须掉到 ≈ 1/dpr²；
末尾再跑一次**门禁自检**，坏状态下第 2、3 条断言必须同时报红。

每条结果都带实测数字（backing 尺寸、transform、不透明率、点击坐标），写在
`tools/out/verify-platform.json`。

**端口归属**：dev 模式走**真实 CLI 路径** —— `mg dev --port <探测到的空闲端口> --strict-port`。
`--strict-port` 是关键：端口被占用时 CLI 报错退出（exit 1），绝不静默顺延到别的端口。
静默换端口的后果是浏览器打到同机另一个服务上，dev 那半边矩阵在测别的游戏却全绿 ——
实测踩过：我的 `mg dev` 打印 5174，而 5174 的 IPv4 上是 kuaidi-load 的静态服务。
CLI 的 dev 固定绑 `127.0.0.1`（日志报**实际**绑定的 host:port），不用 `localhost`，
避开双栈机器上 IPv4/IPv6 各占一个端口的坑。
`mg dev --port 8080 --strict-port` 也可以直接手动用。

## 约定

- **平台差异只走 `platform.can()`**：`src/app/` 里不许出现 `wx.` / `tt.` / `window.`。
- **数据 / 逻辑 / 渲染三分**：`state.ts` 纯数据与纯函数，`layout.ts` 纯布局，
  `game.ts` 只做编排与绘制。
- 布局改动后先跑 `layout.test.ts`：它枚举 390×844、320×480、1024×768、1000×300
  四种屏型，断言每个 widget 都落在安全区内。
- 存档结构改动时要 `SAVE_VERSION + 1` 并给迁移（见 `core/save` 契约）。

## 当前临时接法（barrel 落地后改一处）

runtime 还没有根 barrel（`@mg/runtime` 的 `src/index.ts`），所以 `src/app/deps.ts`
用相对路径直接接 core 源码。barrel 就位后，把 `deps.ts` 的 import 换成
`from '@mg/runtime'` 即可，其余文件一行不用动。
