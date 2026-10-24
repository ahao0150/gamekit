/**
 * 仓库静态检查（`pnpm lint`）。
 *
 * 把 AGENTS.md 的铁律变成可执行判据，而不是靠人记：
 *
 * 1. 单文件行数软限制（测试与数据文件同样计入，别拿「这是数据」当豁免）：
 *    超过 300 行打印 notice（提醒线），超过 500 行打印 warning（警告线）；
 *    二者都不进 violations、不影响退出码。确需长文件时在文件前 5 行内写
 *    `// @long-file <原因>` 豁免（原因必须非空，没写原因不豁免并报 warning）。
 * 2. 禁止用 `any` 绕过类型（需要时用 `unknown` 再收窄）
 * 3. 禁止动态 `import()`（小游戏不支持代码分割）
 * 4. 平台黑名单：`wx.` / `tt.` / `window.` / `navigator.` / `document.`
 *    只允许出现在 `packages/runtime/src/platform/` 下
 * 5. 游戏内自绘禁止魔法数：`viewport.width` / `viewport.height` 不得与裸数字做加减，
 *    也不得在 `Math.min/max/clamp` 里与裸数字夹取
 *
 * 扫描范围：
 * - 规则 1–4：`packages/<name>/src/**\/*.ts`，跳过 `.d.ts` 与 `__fixtures__/`
 * - 规则 5：`games/<name>/src/app/**\/*.ts` 与 `templates/<name>/src/app/**\/*.ts`，
 *   跳过 `.test.ts` —— 游戏代码原本完全不在 lint 范围内，于是自绘里写
 *   `Math.min((vp.width - 24) / GRID, 30)`、`Math.max(90, vp.height * 0.16)` 全部合法，
 *   320×568 下直接溢出被裁（实测：《拼豆工坊》顶部 HUD 带只占左边 43%、底部色块行被切）。
 *
 * 规则 5 的正解不是「一个 px 都不许写」，而是：
 * - 位置与容器尺寸走 `.ui` 约束，自绘只从 `rects` 拿矩形、在矩形内按比例均分
 * - 确实必须固定的物理量（触摸目标下限、描边、字号、圆角）提到常量文件，
 *   并在该行用 `// @fixed-layout <原因>` 显式豁免 —— 让「写死」变成需要解释的决策
 *
 * 注释行不参与平台黑名单与规则 5 检查（规范文档里出现 `wx.` 是在讲「禁止 wx.」）。
 *
 * 退出码：0 = 无违规（可能有行数提醒/警告）；1 = 有违规（逐条打印 violations）。
 * 行数提醒/警告只打印、不改变退出码。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLineLimit } from './line-limit.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLATFORM_DIR = path.join('packages', 'runtime', 'src', 'platform');
const PLATFORM_PATTERN = /\b(?:wx|tt|window|navigator|document)\s*\./;
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(/;
const ANY_PATTERN = /(?::\s*any\b|<any>|as\s+any\b|\bany\[\])/;

/** 规则 5：viewport 尺寸在源码里的常见别名。 */
const VP_SIZE_SRC = String.raw`(?:viewport|vp)\.(?:width|height)`;
const VP_SIZE = new RegExp(String.raw`\b${VP_SIZE_SRC}\b`);
/** viewport 尺寸 ± 裸数字 */
const HARDCODE_SUM = new RegExp(String.raw`\b${VP_SIZE_SRC}\s*[-+]\s*\d`);
/** 括号配对的 Math.min/max/clamp 调用起点 */
const MATH_CLAMP_CALL = /Math\.(?:min|max|clamp)\(/g;
/** 参数是否为纯数字字面量 */
const NUMERIC_LITERAL = /^\s*-?\d+(?:\.\d+)?\s*$/;
/** 0 与 1 是边界常量（`Math.max(0, …)` 防负、`Math.min(1, …)` 钳比例），不算魔法数 */
const BOUNDARY_CONSTS = new Set([0, 1]);
/** 显式豁免：「这个值确实是固定的物理量」 */
const FIXED_LAYOUT_EXEMPT = '@fixed-layout';

/**
 * 取 `(` 之后的顶层参数列表（自己数括号深度，`[^)]*` 遇到嵌套会截断）。
 * 返回 null 表示这一行里调用没有闭合。
 */
function topLevelArgs(line, from) {
  let depth = 1;
  let cur = '';
  const args = [];
  for (let i = from; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '(') {
      depth += 1;
      cur += ch;
    } else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        args.push(cur);
        return args;
      }
      cur += ch;
    } else if (ch === ',' && depth === 1) {
      args.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  return null;
}

/** 规则 5 的 clamp 分支：Math.min/max/clamp 里同时有 viewport 尺寸与「非 0/1 裸数字」。 */
function matchesClampHardcode(line) {
  MATH_CLAMP_CALL.lastIndex = 0;
  let m = MATH_CLAMP_CALL.exec(line);
  while (m !== null) {
    const args = topLevelArgs(line, m.index + m[0].length);
    if (args !== null && args.some((a) => VP_SIZE.test(a))) {
      for (const arg of args) {
        if (NUMERIC_LITERAL.test(arg)) {
          const v = Math.abs(Number(arg));
          if (!BOUNDARY_CONSTS.has(v)) return true;
        }
      }
    }
    m = MATH_CLAMP_CALL.exec(line);
  }
  return false;
}

function matchesHardcode(line) {
  return HARDCODE_SUM.test(line) || matchesClampHardcode(line);
}

/**
 * 门禁自检：规则 5 必须能判红、也不能误伤合法的相对写法。
 * 门禁自己变成假阳性比没有门禁更糟（verify-platform 已有同样的反例自检先例）。
 * 这两组样例曾经真的抓出过一个 bug：最初的实现只覆盖「viewport 在前、数字在后」，
 * `Math.max(90, vp.height * 0.16)` 这种反序写法被整条放过了。
 */
const SELF_TEST_FAIL = [
  'const cell = Math.min((vp.width - 24) / GRID, 30);',
  'const by = Math.max(90, vp.height * 0.16);',
  'py = vp.height - 92 + row * step;',
  'const sw = Math.min((viewport.width - 24) / 8, 34);',
  'const w = Math.min(vp.width, 390);',
];
const SELF_TEST_PASS = [
  'const cell = vp.width / GRID;',
  'const by = vp.height * 0.16;',
  'const bx = (vp.width - bw) / 2;',
  'const slotY = by + bw + 10;',
  'const gap = 8;',
  'const x = Math.max(0, Math.min(vp.width, w));',
  'const k = Math.abs(Number(arg));',
];

function selfTest() {
  const errs = [];
  for (const sample of SELF_TEST_FAIL) {
    if (!matchesHardcode(sample)) errs.push(`应判红却放行：${sample}`);
  }
  for (const sample of SELF_TEST_PASS) {
    if (matchesHardcode(sample)) errs.push(`应放行却判红：${sample}`);
  }
  return errs;
}

/** 递归收集待检查文件。 */
function collect(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__fixtures__' || entry.name === 'node_modules') continue;
      collect(full, acc);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

/** 收集 games/<name>/src/app 与 templates/<name>/src/app（规则 5 的扫描范围）。 */
function collectGame(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__fixtures__' || entry.name === 'node_modules' || entry.name === 'build') continue;
      collectGame(full, acc);
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.d.ts') &&
      !entry.name.endsWith('.test.ts')
    ) {
      acc.push(full);
    }
  }
  return acc;
}

/** 判断一行是否纯注释（避免把规范文字里的 `wx.` 当违规）。 */
function isCommentLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

// ---------- 门禁自检（先跑，自己坏了就不要去判别人） ----------
const selfErrors = selfTest();
if (selfErrors.length > 0) {
  for (const e of selfErrors) console.error('✗ lint 自检失败：' + e);
  console.error('\nlint: 规则 5 的自检未通过，拒绝执行（门禁本身有问题）');
  process.exit(1);
}

// ---------- 收集 ----------
const packagesDir = path.join(repoRoot, 'packages');
const engineFiles = [];
if (fs.existsSync(packagesDir)) {
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (entry.isDirectory()) collect(path.join(packagesDir, entry.name, 'src'), engineFiles);
  }
}

const gameFiles = [];
for (const scope of ['games', 'templates']) {
  const base = path.join(repoRoot, scope);
  if (!fs.existsSync(base)) continue;
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    collectGame(path.join(base, entry.name, 'src', 'app'), gameFiles);
  }
}

/** 规则 5 只对这些文件生效。 */
const gameFileSet = new Set(gameFiles);
const files = [...engineFiles, ...gameFiles];

const violations = [];
/** 行数软限制的提醒/警告：只打印，不改变退出码。 */
const warnings = [];

// ---------- 规则 6：每个游戏必须有展示名（浏览器标签 / 分享卡片用） ----------
// 不设 title 时，`build/web/index.html` 的 <title> 会退化成英文目录名。
// 这个坑踩过两次：kuaidi-load 与 pindou-workshop 都是上线后才发现标签是英文 id。
const PLACEHOLDER_TITLE = '（改成本游戏的中文名）';
/** 外部探针产物：`.gitignore` 已排除、不进库，不是团队作品，不参与规则 6 */
const SKIP_GAME_DIRS = new Set(['color-pop', 'flip-pairs']);
const gamesRoot = path.join(repoRoot, 'games');
if (fs.existsSync(gamesRoot)) {
  for (const entry of fs.readdirSync(gamesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    if (SKIP_GAME_DIRS.has(entry.name)) continue;
    const relCfg = path.join('games', entry.name, 'game.config.json');
    const cfgPath = path.join(repoRoot, relCfg);
    if (!fs.existsSync(cfgPath)) continue; // 非游戏目录（如 games/bench）跳过
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch (err) {
      violations.push(`${relCfg} 不是合法 JSON：${err.message}`);
      continue;
    }
    const title = typeof cfg.title === 'string' ? cfg.title.trim() : '';
    if (title === '') {
      violations.push(
        `${relCfg} 缺 title —— 上线后浏览器标签与分享卡片会显示英文目录名`,
      );
    } else if (title === entry.name) {
      violations.push(`${relCfg} 的 title 等于目录名「${entry.name}」，等于没设`);
    } else if (title === PLACEHOLDER_TITLE) {
      violations.push(`${relCfg} 的 title 还是模板占位，改成真实中文名`);
    }
  }
}

for (const file of files) {
  const rel = path.relative(repoRoot, file);
  const isPlatformImpl = rel.startsWith(PLATFORM_DIR + path.sep);
  const isGameFile = gameFileSet.has(file);
  const rawLines = fs.readFileSync(file, 'utf8').split('\n');
  // 文件末尾的换行会 split 出一个空串，它不算一行；顺带去掉行尾 CR
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop();
  const lines = rawLines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));

  const lineLimit = checkLineLimit(rel, lines);
  if (lineLimit.level !== 'ok') {
    warnings.push({ level: lineLimit.level, message: lineLimit.message });
  }

  lines.forEach((line, index) => {
    if (isCommentLine(line)) return;
    const at = `${rel}:${index + 1}`;
    if (ANY_PATTERN.test(line)) violations.push(`${at} 使用了 any（改用 unknown + 收窄）`);
    if (DYNAMIC_IMPORT_PATTERN.test(line)) violations.push(`${at} 动态 import()（小游戏不支持）`);
    if (!isPlatformImpl && PLATFORM_PATTERN.test(line)) {
      violations.push(`${at} 平台黑名单命中（只允许出现在 platform/ 下）`);
    }
    if (isGameFile && matchesHardcode(line) && !line.includes(FIXED_LAYOUT_EXEMPT)) {
      violations.push(
        `${at} 自绘魔法数（viewport 尺寸与裸数字混算）。` +
          `布局交给 .ui 求解、自绘从 rects 拿矩形按比例均分；` +
          `确实必须固定的物理量提到常量文件并用 // ${FIXED_LAYOUT_EXEMPT} <原因> 豁免`,
      );
    }
  });
}

const noticeCount = warnings.filter((w) => w.level === 'notice').length;
const warningCount = warnings.filter((w) => w.level === 'warning').length;
const summary = `${files.length} 个文件，${violations.length} 处违规，${noticeCount} 条提醒，${warningCount} 条警告`;

for (const w of warnings) {
  console.warn((w.level === 'warning' ? '⚠ ' : 'ℹ ') + w.message);
}

if (violations.length === 0) {
  console.log(`lint: ${summary}`);
  process.exit(0);
}

for (const v of violations) console.error('✗ ' + v);
console.error(`\nlint: ${summary}`);
process.exit(1);
