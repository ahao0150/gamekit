# Coding-agent handoff（引擎无关 JSON）

输出给写逻辑 / 改 `.ui` 的 Agent，**不是** Cocos Prefab。

## 最小包形状

```json
{
  "schema": "gamekit-ui-handoff-v1",
  "gameId": "mukuai-xiaoxiao",
  "engine": "gamekit-canvas",
  "screens": [
    {
      "id": "home",
      "uiFile": "ui/home.ui",
      "nodes": [
        {
          "name": "primaryButton",
          "kind": "primaryButton",
          "assetKey": "ui/btn-primary_normal",
          "draw": "capsule",
          "capsule": { "w": 336, "h": 126, "cap": 63, "mid": 8 },
          "styleHint": "label 由 dynamicProps；勿把字烤进 PNG"
        },
        {
          "name": "panel",
          "kind": "panel",
          "assetKey": "ui/panel",
          "draw": "nineSlice",
          "nineSlice": { "left": 60, "top": 60, "right": 60, "bottom": 60 },
          "styleHint": "put panel … style image=\"ui/panel\" slice=60"
        }
      ]
    }
  ],
  "stateMachine": [
    { "screen": "home", "node": "primaryButton", "event": "tap", "action": "start" },
    { "screen": "home", "node": "secondaryButton", "event": "tap", "action": "endless" }
  ],
  "gates": {
    "assetsReady": false,
    "nineSliceMeasured": false,
    "wiredInUi": false
  }
}
```

## 字段约定

| 字段 | 含义 |
|---|---|
| `name` | 必须与 `.ui` 里 `put <name>` **完全一致**（一屏同名只一次） |
| `assetKey` | `core/assets` 清单 key（相对 assets/ 无扩展名） |
| `draw` | `capsule` \| `nineSlice` \| `stretch` \| `none` |
| `nineSlice` | left/top/right/bottom，源像素；与 `mini-game-ui-v1` 同构 |
| `capsule` | 对齐 `DEFAULT_CAPSULE`；尺寸不符则 runtime 回落纯色 |

## 与 `.ui` 接线

1. 把 `components/*.png` 拷到 `games/<id>/assets/ui/`，文件名与 key 对应（`btn-primary_normal.png` → key `ui/btn-primary_normal`）。
2. `panel`：在 `.ui` 增加 `image="ui/panel" slice=<N>`（可去掉纯色 `fillColor` 或留作缺图回落）。
3. `primaryButton`：**不用**改 style 的 image——内置件按 tone 自动取 `ui/btn-primary_normal` / `_disabled`。
4. 通用 `button`（如退出 chip）才用 `image=` / `pressedImage=`（stretch，非胶囊）。

## 门禁

未 `measure.passed` 的组件不得标 `gates.assetsReady=true`，不得推正式资源。
