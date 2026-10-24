# 扁平剧情脚本（@mg/story）

面向 AI：**只改** `*.story.tsv`（或 `.story`），**不要**手改嵌套 `demo.json`。JSON 是 `compile-story` 的编译产物，供运行时 `parseStoryScript` 加载。

## 1. 源格式（TSV，一行一条记录）

首行表头；可用 `# start: intro` 指定起点（默认取第一条 `line` 的 `id`）。

| 列 | 含义 |
|---|---|
| `id` | 节点 id（同一 id 多行会合并成一个节点） |
| `type` | `line` 对话行 / `choice` 选项 / `end` 结局 |
| `speaker` | 说话人（可选，会与 `text` 合成 `dialogue`） |
| `text` | 台词或选项文案 |
| `next` | `line` 上可写自动前进的下一节点（编译为「继续」选项） |
| `condition` | 选项显示条件，如 `vars.gold>=20` → `when` |
| `set` | `flags.x=true` 或 `vars.gold=20`，`;` 分隔 |

仓库示例真源：[`packages/story/examples/demo.story.tsv`](../packages/story/examples/demo.story.tsv)。

## 2. CLI

```bash
# 静态检查（优先读 .story.tsv / .story，兼容 .json）
node packages/story/bin/lint-story.mjs packages/story/examples/demo.story.tsv

# 编译为引擎 JSON
node packages/story/bin/compile-story.mjs packages/story/examples/demo.story.tsv --out /tmp/demo.json
```

## 3. 代码 API

```ts
import { createStoryRunner, lintStory, parseFlatStory, parseStoryScript } from '@mg/story';

const script = parseFlatStory(tsvText); // 或 parseStoryScript(jsonObject)
const report = lintStory(script);
const runner = createStoryRunner(script);
```

`lintStory` 检查：无效起点、死路、断链、不可达结局。

## 4. AI 检查清单

1. 改 `.story.tsv` → `lint-story.mjs` 必须 OK；
2. 需要给运行时打包时 → `compile-story.mjs` 生成 JSON；
3. 条件语法与 `@mg/story` 的 `evalCondition` 一致（`vars.` / `flags.`）。

更多数值配表见 [`ECONOMY-SAVE.md`](ECONOMY-SAVE.md)。
