# 开箱皮肤（暖木纹 / 清爽玻璃）

`mg create` 用 iaa-ui 模板时，默认启用 **暖木纹**，界面是程序纹理 + 主题色，
**不会**出现灰底蓝问号（那是缺图未回落时的常见症状）。本目录皮肤**自包含**，
不引用任何本机绝对路径，外部团队 clone 仓库即可用。

## 两套皮肤

| id | 中文名 | 观感 |
|---|---|---|
| `wood` | 暖木纹（默认） | 暖棕竖纹 + 木色按钮/面板 |
| `glass` | 清爽玻璃 | 冷色渐变 + 高光边玻璃感 |

切换：改 `src/app/skins/choice.ts`：

```ts
export const ACTIVE_SKIN_ID: SkinId = 'glass'; // 或 'wood'
```

## 和牌面 / 实体图的关系

- **皮肤**：UI 底色、面板/按钮主题色、程序背景纹理（本包已带）。
- **牌面 / 角色 / 道具图**：各游戏自己放进 `assets/` 再生图；没有图时组件走
  `theme` 纯色回落，保证可玩。

若要让负责人转美术 bot 生正式贴图，建议清单（相对游戏根，勿写本机路径）：

1. `assets/ui/panel.png` — 九宫格面板（建议 2x，slice≈60）
2. `assets/ui/button_normal.png` / `button_pressed.png` / `button_disabled.png`
3. （可选）与玩法相关的牌面/棋子/道具 key，按游戏 `assets/` 约定命名

生图到位后，在 `ComponentAssets` 里按 key 提供即可，皮肤主题色仍可保留作缺图回落。

## 自己加第三套

1. 在 `src/app/skins/` 新增 `foo.ts`（`SkinDefinition`）
2. 挂进 `SKINS` 与 `SkinId`
3. `choice.ts` 改成新 id
4. 补一条 `skins.test.ts`
