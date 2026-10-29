# 一个开源框架，多个独立游戏

维护入口统一到开源gamekit：共享UI（含chatBubble/chatList/chatComposer）、运行时、构建器、CLI与模板只在这里修改。私有仓库保留历史和业务，不再作为第二套框架持续双写。不要把私有游戏、素材、服务配置或存档上传到开源仓库。

## 创建独立游戏

先在框架根执行`pnpm install`。然后运行：

```powershell
# 在框架根；--dir是最终项目目录，不是父目录。
pnpm mg -- create my-game --dir 'D:\games\my-game'
Set-Location 'D:\games\my-game'
pnpm install
pnpm dev
pnpm test
pnpm build
pnpm check
pnpm exec mg doctor
```

默认模板为iaa-ui；极简单屏可加`--template iaa-simple`。目录支持空格、跨盘与非英文名称；包名仍使用小写字母、数字和连字符。目标已存在时拒绝覆盖。

也可以在任意目录用框架CLI的绝对路径调用：

```powershell
node 'C:\Users\Administrator\gamekit\packages\cli\bin\mg.mjs' create my-game --dir '.\my-game'
```

此时相对--dir按调用目录解析，默认使用CLI所属框架。显式`--root <框架根>`可选择另一个框架检出。未传--dir时仍使用原来的games/<name>，旧项目兼容不变。

## 外部项目的配置

- `@mg/*`使用link依赖，直接引用所选框架，不复制引擎，不修改框架工作区或锁文件。
- Vite、Vitest、TypeScript与Node类型使用创建时框架已安装的工具版本，在游戏目录单独安装并保存自己的锁文件。
- `gamekit.config.json`记录本地框架位置，供doctor等工具定位。`game.config.json`继续只管理游戏配置。
- 独立pnpm-workspace.yaml阻止上层工作区意外接管游戏。tsconfig、Vite/Vitest配置中的框架路径在创建时重定位；跨盘导入使用file URL，避免Windows盘符和空格解析问题。
- 无须把外部目录加入框架pnpm-workspace.yaml。游戏有自己的Git仓库、依赖、测试和构建产物；根pnpm test仍只覆盖框架和模板。
- 本地链接是开发模式；迁移电脑或框架目录时需重新配置链接和构建路径。最稳妥的迁移方式是在新位置生成骨架，再复制业务源码、.ui与资源，核对配置差异后重新验收。

## 已有游戏的迁移

不自动移动已有游戏。先在仓库外生成同模板骨架，再把src/app、ui、正式assets与游戏配置复制过去；保留新生成的依赖和框架路径配置，按差异合入自定义注册表。业务验证完成后再由维护者决定旧目录如何归档。

不要递归移动带pnpm链接的node_modules目录；源码、资源、截图可单独复制，依赖通过pnpm install重建。

## 版本与发布

框架只维护一份公开源代码，功能在短期分支验证后合并main。游戏发布记录所用框架提交标识；升级框架前在独立工作树测试游戏，再切换项目链接。这样能共享修复，又能保留可复现的旧版本。

三端构建通过不等于小游戏宿主已验收，继续执行[PLATFORM-ACCEPTANCE.md](PLATFORM-ACCEPTANCE.md)。
