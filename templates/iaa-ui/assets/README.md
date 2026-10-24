# assets/ —— 占位图

模板里的两张图只是**占位**，用来证明资源管线跑通（清单只登记真打进包的文件）：

| 文件 | 用途 | 建议尺寸 |
|---|---|---|
| `ui/btn.png` | 主按钮底图 | 64×64（可做九宫格切片） |
| `ui/banner-slot.png` | banner 占位框 | 320×80 |

替换规则：

- 同名 `webp` 与 `png` 同时存在时，构建只打较小的那份（见 `@mg/vite` 资源择优规则）；
- 单张 ≤200KB，超了先压再进包；
- 业务侧通过 `core/assets` 的清单 key 取图（key = 相对 assets/ 去扩展名，如 `ui/btn`），
  不要写死文件路径。

生成命令示例（本机有 codex-image 时）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Claude-tools\codex-image\codex-image.ps1" -Prompt "扁平风格按钮底图，深色科技感" -OutDir "assets\ui" -Filename "btn.png"
```
