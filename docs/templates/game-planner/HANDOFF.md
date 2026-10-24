# HANDOFF：交给程序

## 阅读顺序

1. `PRD.md`（仓库 `games/<name>/PRD.md`）
2. `design/00_concept/design.md` → `01_top_design/design.md`
3. （完整模式）`02_architecture/design.md` → `03_systems/S0*/design.md`
4. `ART-BRIEF.md`
5. 若有：`assets/economy/*.tsv`、`assets/story/*.story.tsv`

## 工程选项

| 项 | 选择 |
|---|---|
| 模板 | iaa-ui / iaa-simple |
| 屏幕 | 竖屏 / 横屏 |
| `@mg/economy` | 是/否 |
| `@mg/story` | 是/否 |
| `@mg/physics-2d` | 是/否 |

## 编码前门禁（勾完才能 `mg create` / 写 `src/app`）

- [ ] Concept：一句话可复述；非目标 ≥ 4；核心幻想一句
- [ ] Top Design：循环图 + 验证标准；不做清单与 Concept 一致
- [ ] （完整）Architecture：P0 均有 I/O；MVP 闭环 ≤ 7 步
- [ ] （完整）Systems：每 P0 有负责/不负责 + 验证问题
- [ ] `PRD.md` 满足 GAME-WORKFLOW §1
- [ ] `ART-BRIEF.md` 有文件名与尺寸
- [ ] 若有数值：TSV 骨架 + 计划 `simulate.mjs --days N`
- [ ] 若有剧情：`.story.tsv` 能过 `lint-story`
- [ ] 本表工程选项已填

未过门：只改 `design/` 与 PRD 草稿，禁止玩法实现 PR。
