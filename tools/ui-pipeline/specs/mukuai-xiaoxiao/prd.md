# 木块消消 · UI 美化 PRD（轻量）

status: draft  
game_id: mukuai-xiaoxiao  
scope: UI 壳 only（不改玩法 / board-geom / 广告逻辑）

## 目标

把 home / play / result 三屏从「主题色纯色回落」换成「木纹暖色组件贴图」，文字仍由代码叠（素材无字）。

## 成功标准

1. `primaryButton` / `secondaryButton` 能吃到 `ui/btn-primary_*` / `ui/btn-secondary_*` 胶囊图，拉伸后帽不糊。
2. `panel`（HUD 底、结算遮罩底）能吃到 `ui/panel` 九宫格，≥2 种宽高预览角清晰。
3. 交接包 JSON 列出节点名、绘制模式（capsule|nineSlice）、状态机触点，coding-agent 可直接改 `.ui` style，无需猜边距。

## 非目标

- 棋盘木块 sprite、托盘块美术
- Skin-swap / 骨骼
- 部署 / 推 Gitee（需本人确认）

## 组件批次（MVP-1）

| id | 尺寸源 | 绘制 | 状态 | 输出文件 |
|---|---|---|---|---|
| btn-primary_normal | 336×126 | capsule | normal | btn-primary_normal.png + .json |
| btn-secondary_normal | 336×126 | capsule | normal | btn-secondary_normal.png + .json |
| panel | ≥480×320 | nineSlice | — | panel.png + .json |

可选后续：`_disabled`、结算 dialog 面板、HUD chip。
