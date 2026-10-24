# 交互 · 屏与状态（扁平）

game_id: mukuai-xiaoxiao

## screens.tsv

```tsv
screen	file	purpose	key_components
home	ui/home.ui	标题+闯关/无尽入口+金币行	panel,primaryButton,secondaryButton,statusText,label,toast
play	ui/play.ui	HUD+棋盘区+托盘+退出	panel,label,toast,boardArea,trayArea,button
result	ui/result.ui	胜负结算+广告入口	panel,label,statusText,primaryButton,secondaryButton,button
```

## states.tsv

```tsv
screen	component	state_or_prop	source
home	primaryButton	label=开始闯关·第N关	layout dynamicProps
home	secondaryButton	label=无尽模式	layout
home	statusText	金币 / 无尽最佳	layout
play	label	关卡与分数	layout
play	button	text=退出	overlay exitLayer
result	primaryButton	下一关 / 复活…	layout（胜负分支）
result	secondaryButton	双倍金币 / …	layout；广告异步在 game.ts
result	panel	backdrop hit=block	.ui
```

## gate

- [ ] prd + interaction 已对齐现网 `.ui` 节点名（勿改组件名，改贴图）
- [ ] style 契约批准后再批量生图
- [ ] 单组件实测通过才写入 asset-manifest 的 `ready: true`
