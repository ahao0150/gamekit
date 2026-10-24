# gamekit UI 流水线（视觉先行 · MVP）

薄包装：对齐 workflows `mini-game-ui-kit` + 上游 Spec-Kit 目录习惯，**不** `./install.sh` 装上游全仓。

```
tools/ui-pipeline/
  DECISION.md          # 为何选这款游戏
  MVP-RUNBOOK.md       # 步骤 ↔ 命令 / bot
  handoff/             # coding-agent 交接包形状（引擎无关 JSON）
  specs/<game-id>/
    prd.md             # 轻量 PRD（默认只写顶层）
    interaction.md     # 屏 + 状态（扁平）
    contracts/         # style / screen
    asset-manifest.yaml
    prompts/           # 生图提示词（待 codex / gen-image）
    components/        # 产出 png + json（先落这里，再拷进 games/.../assets/ui）
    handoff/           # 本游戏交接实例
```

正式进包路径：`games/<id>/assets/ui/<name>.png`（资源 key = 相对 `assets/` 去扩展名，如 `ui/btn-primary_normal`）。

`primaryButton` / `secondaryButton` 走 **胶囊三段**（336×126，cap=63, mid=8），不是九宫格。  
`panel` 走 **九宫格**（`image` + `slice`，默认 slice=60 源像素）。
