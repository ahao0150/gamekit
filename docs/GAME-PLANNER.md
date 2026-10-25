# 游戏策划智能体流程（game-planner）

> 给 AI / 维护者：在**写代码之前**把玩法想清楚。方法论来自分层 GDD（Concept → Top → Architecture → Systems）+ 本仓库 [`GAME-WORKFLOW.md`](GAME-WORKFLOW.md)。  
> **真源只要扁平 Markdown / TSV**；禁止把深嵌套 JSON 当策划编辑面。数值进 `@mg/economy` TSV，剧情进 `@mg/story` `.story.tsv`。

空模板：[`docs/templates/game-planner/`](templates/game-planner/)。  
产出落在 `games/<name>/design/`（**不进小游戏包**）；工程交付物是 `PRD.md`、`ART-BRIEF.md`、可选 `assets/economy/*.tsv`、`assets/story/*.story.tsv`。

---

## 0. 两种模式

| 模式 | 何时用 | 跑到哪 | 出门交付 |
|---|---|---|---|
| **轻量（默认）** | 休闲短局、单循环、无挂机/无长对话（消消、叠塔、翻翻乐…） | `00_concept` → `01_top_design` | `PRD.md` + `ART-BRIEF.md` + `HANDOFF.md` |
| **完整** | 双循环、养成、Rogue、资源流、多系统依赖 | 再跑 `02_architecture` → `03_systems/S0x_*` | 同上 + design 全树 + 若需要则 economy/story TSV 骨架 |

轻量模式仍须有「不做清单」与验证标准；**不要**因为轻量就跳过 Concept。

纯调数值 / 换皮 / 修 bug：**不要**跑本流程。

---

## 1. 四阶段（由粗到细）

每阶段固定两份文件：

| 文件 | 角色 |
|---|---|
| `design.md` | **定稿**：定义、表、mermaid、边界、不做、验证 |
| `analysis.md` | **过程**：若干「问题」块 = 广度 → 深度 → 综合判断；状态如 `agent_proposal` |

规则：先 analysis 后 design；用户/维护者 **接受 design** 才进下一阶段。analysis 可改写，勿直接污染 design。

| 阶段 | 目录 | 只定什么 | 明确后置（本阶段不写） |
|---|---|---|---|
| Concept | `00_concept/` | 一句话、幻想、用户、体验、基调、非目标 | 数值、系统清单、MVP 量 |
| Top Design | `01_top_design/` | 循环单位、规模锚点、循环/资源流图、流程、系统范围、验证 | 表内容、UI 像素 |
| Architecture | `02_architecture/` | P0 目的/输入/输出、依赖图、MVP 闭环、风险 | 单系统内部规则 |
| Systems | `03_systems/S0x_*/` | 负责/不负责、状态字段、规则边界、P0 闭环、验证问题 | 具体数值、掉落率、美术像素 |

模板零件（复制即可）：一句话概念、不是什么表、规模锚点、mermaid 循环/资源流/依赖、系统范围表、P0 清单、负责/不负责、状态字段表、P0 闭环步骤、P1/P2 后置、验证标准、analysis 问题块。

---

## 2. 推荐工作流

工作目录：`games/<slug>/design/`（从 [`templates/game-planner`](templates/game-planner/) 拷入）。

```
0  收集输入 → design/_brief.md（原始需求，只增不改）
1  Concept     → 门：概念 OK
2  Top Design  → 门：循环能口头复述 + 验证表非空
   ※ 轻量模式：于此压缩出 PRD + ART-BRIEF + HANDOFF，停
3  Architecture→ 门：MVP 闭环 ≤ 7 步，每步有系统负责
4  Systems     → 门：每 P0 有验证问题；无混责
5  工程交付物  → 定稿 PRD / ART-BRIEF；按需 economy·story 骨架
6  交接        → 程序按 GAME-WORKFLOW §2 起跑；改规则回 design/，改曲线只改 TSV
```

### 出门闸门（编码前全部勾上）

轻量至少勾 Concept + Top + PRD + ART-BRIEF + HANDOFF；完整再勾 Architecture + Systems。

- [ ] Concept：一句话可复述；非目标 ≥ 4；核心幻想一句  
- [ ] Top Design：循环图（+ 若有则资源流）；验证标准非空；不做与 Concept 一致  
- [ ] Architecture（完整）：P0 均有输入/输出；MVP ≤ 7 步  
- [ ] Systems（完整）：每 P0 有负责/不负责 + P0 闭环 + 验证问题  
- [ ] `games/<name>/PRD.md` 满足 [`GAME-WORKFLOW.md`](GAME-WORKFLOW.md) §1  
- [ ] `PRD.md` 写了**视觉小节**（屏数 / 调色板 8 色 / 字号层级 / 桌面居中纸卷 / 反馈与禁用态 / 素材预算），
      格式见 [`VISUAL-SKELETON.md`](VISUAL-SKELETON.md) §3 —— **只写「国风」两个字不合格**  
- [ ] `PRD.md` 写清了**主界面是一个什么场景**（不是「一个页面」）：玩家站在哪、有哪些物件、
      物件之间什么关系、操作就地还是切屏。判据见 [`VISUAL-SKELETON.md`](VISUAL-SKELETON.md) §0，
      **主界面是卡片列表 = 未过门**  
- [ ] `ART-BRIEF.md` 有文件名与尺寸；标明缺图回落  
- [ ] 若有数值：`levels` / `production` / `prices` TSV 骨架 + 计划 `simulate.mjs --days N`  
- [ ] 若有剧情：`.story.tsv` 能过 `lint-story`  
- [ ] `HANDOFF.md`：模板、竖横屏、是否 economy/story/physics  

**未过门：禁止 `mg create` 写玩法、禁止玩法实现 PR。** 只许改 `design/` 与 PRD 草稿。

---

## 3. 接到工程交付物

```
策划层                              工程层
────────                            ──────
00+01 (+02+03) ──► PRD.md ────────► mg create / 占位可玩
               ──► ART-BRIEF.md ──► 美术并行（artifacts/，勿塞 assets 样张）
               ──► economy/*.tsv ─► @mg/economy（simulate / compile）
               ──► *.story.tsv ───► @mg/story（lint-story / compile-story）
               ──► HANDOFF.md ────► 程序阅读顺序与选项
```

| 策划产出 | 喂给谁 | 怎么用 |
|---|---|---|
| Concept 一句话 / 非目标 | `PRD.md` | 防 scope 膨胀 |
| Top 循环 / 失败 / 计分 / 难度 | `PRD.md` | 纯模块规则 |
| Top 资源流 / 长期主轴 | economy 表设计 | 列含义与优先级；见 [`ECONOMY-SAVE.md`](ECONOMY-SAVE.md) |
| Architecture 界面 / 信息 | `PRD` 界面表 + `ART-BRIEF` | `.ui` 与出图清单 |
| Systems 状态字段 | HANDOFF → 存档字段说明 | `createSave` 迁移由程序写，策划只列字段 |
| 对话节点 / 条件 | `.story.tsv` | 见 [`STORY.md`](STORY.md) |
| 验证标准 | 验收截图断言点 | GAME-WORKFLOW §5 |

### 3.1 `@mg/economy` TSV

1. 在 Top/Architecture 标清：升级曲线、小时产出、购买解锁各自服务哪条长期主轴。  
2. 拷贝模板 `economy/*.tsv` → `games/<name>/assets/economy/`（或项目约定目录）。  
3. **只改 TSV**；JSON 是 `compile.mjs` 产物，禁止当编辑面。  
4. 改完跑：`node packages/economy/bin/simulate.mjs --table <dir> --days 7`。

### 3.2 `@mg/story` `.story.tsv`

1. Systems 里对话系统定节点意图与条件字段后，再写表。  
2. 拷贝 `story/main.story.tsv` → `games/<name>/assets/story/`。  
3. 跑：`node packages/story/bin/lint-story.mjs <file>`；需要引擎 JSON 时再 `compile-story.mjs`。

### 3.3 PRD

用模板 [`PRD.snippet.md`](templates/game-planner/PRD.snippet.md) 填到 `games/<name>/PRD.md`。  
PRD 是**一屏压缩**，不是把 design 全文粘贴进去。

---

## 4. 文件纪律

- 只写 `.md` / `.tsv` / `.csv`；mermaid 画在 md 里。  
- `design/` 与 `artifacts/` 不进包；`assets/` 只放运行时需要的图或编译后的表。  
- 策划 agent：**只改** `design/` + PRD + ART-BRIEF + 表骨架；禁止直接实现 `src/app`、禁止改 runtime 契约。

---

## 5. 与现有文档

| 文档 | 关系 |
|---|---|
| [`GAME-WORKFLOW.md`](GAME-WORKFLOW.md) | §0 策划 → 再进 §1 PRD |
| [`VISUAL-SKELETON.md`](VISUAL-SKELETON.md) | **PRD 的视觉部分怎么写 + 代码怎么落**（三层分工、8 色板、字号层级、验收判据、真实反例） |
| [`START-HERE.md`](START-HERE.md) | 从零工程上手；策划先看本文 |
| [`AGENTS.md`](../AGENTS.md) | 硬规则入口列出 planner |
| [`ECONOMY-SAVE.md`](ECONOMY-SAVE.md) / [`STORY.md`](STORY.md) | 表与剧情真源格式 |

样本方法论对照（内容勿抄进项目）：研究区 `game-planner-skill-design.md` 与解压样例四阶段 GDD。
