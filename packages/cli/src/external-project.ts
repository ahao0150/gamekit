/** 框架外项目：链接同一份本地框架，并重定位模板中的构建配置。 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isRecord, readJson } from './shared';

const slash = (path: string): string => path.replace(/\\/g, '/');
const localPath = (from: string, to: string): string => slash(relative(from, to));
const modulePath = (from: string, to: string): string => {
  const rel = relative(from, to);
  return isAbsolute(rel) ? pathToFileURL(to).href : (rel.startsWith('.') ? slash(rel) : `./${slash(rel)}`);
};
const writeJson = (file: string, data: unknown): void => writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

export const prepareExternalProject = (project: string, framework: string): void => {
  const pkgFile = join(project, 'package.json');
  const pkg = readJson(pkgFile);
  if (!isRecord(pkg)) throw new Error('框架外项目需要有效的package.json');
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const deps = pkg[section];
    if (!isRecord(deps)) continue;
    for (const [name, version] of Object.entries(deps)) {
      if (typeof version !== 'string' || !version.startsWith('workspace:')) continue;
      const target = name.startsWith('@mg/') ? join(framework, 'packages', name.slice(4)) : '';
      if (!target || !existsSync(join(target, 'package.json'))) throw new Error(`无法链接工作区依赖：${name}`);
      deps[name] = `link:${localPath(project, target)}`;
    }
  }
  const frameworkPkg = readJson(join(framework, 'package.json'));
  const toolVersions = isRecord(frameworkPkg) && isRecord(frameworkPkg['devDependencies']) ? frameworkPkg['devDependencies'] : {};
  const dev = isRecord(pkg['devDependencies']) ? pkg['devDependencies'] : {};
  for (const name of ['vite', 'vitest', 'typescript', '@types/node']) {
    const installed = readJson(join(framework, 'node_modules', name, 'package.json'));
    const version = isRecord(installed) ? installed['version'] : toolVersions[name];
    if (typeof version === 'string') dev[name] = version;
  }
  pkg['devDependencies'] = dev;
  writeJson(pkgFile, pkg);
  writeJson(join(project, 'gamekit.config.json'), { frameworkRoot: localPath(project, framework) });
  // 独立边界：不让上层目录的工作区把游戏依赖吸收进去。
  writeFileSync(join(project, 'pnpm-workspace.yaml'), "packages:\n  - '.'\n");
  const tsFile = join(project, 'tsconfig.json');
  const ts = readJson(tsFile);
  if (isRecord(ts)) {
    ts['extends'] = localPath(project, join(framework, 'tsconfig.base.json'));
    ts['include'] = ['src/**/*.ts', localPath(project, join(framework, 'packages/vite-plugin/src/virtual.d.ts')), localPath(project, join(framework, 'packages/runtime/src/debug/env.d.ts'))];
    writeJson(tsFile, ts);
  }
  for (const name of ['vite.config.ts', 'vitest.config.ts']) {
    const file = join(project, name);
    if (!existsSync(file)) continue;
    let source = readFileSync(file, 'utf8').replace(/(['"])\.\.\/\.\.\/packages\/([^'"]+)\1/g, (_all, _quote: string, suffix: string) => {
      // 配置中的源码导入显式带.ts；URL别名的目标本来就带.ts。
      const target = join(framework, 'packages', suffix.endsWith('.ts') ? suffix : `${suffix}.ts`);
      return JSON.stringify(modulePath(project, target));
    });
    const withUrl = source.replace(/new URL\((.*?)\)\s*\.pathname/gs, 'fileURLToPath(new URL($1))');
    if (withUrl !== source) source = `import { fileURLToPath } from 'node:url';\n${withUrl}`;
    source = source.replace("allow: ['../..']", `allow: ['.', ${JSON.stringify(localPath(project, framework))}]`);
    writeFileSync(file, source);
  }
  writeFileSync(join(project, 'AGENTS.md'), `# 独立gamekit游戏项目\n\n只修改本游戏；框架根记录在gamekit.config.json，不要复制或修改框架源码。\n先阅读框架docs/START-HERE.md、docs/ui-syntax.md和docs/ENGINE-API.md。\n界面使用.ui约束，逻辑与渲染分离，画与点共用布局矩形。\n在此目录执行pnpm install，然后pnpm dev/test/build/check。\n素材仅放assets，样张与报告放artifacts；至少验收390×844和320×568。\n需要迁移机器时，重新生成本地依赖链接与配置路径，不能依赖其他机器的绝对路径。\n`);
  writeFileSync(join(project, 'README.md'), `# ${String(pkg['name'])}\n\n这是框架外的独立游戏，业务源码与存档资源由自己的Git仓库管理。\n框架位置见gamekit.config.json；@mg依赖使用link协议，共用同一份框架源码。\n\n先在框架安装依赖，再在此目录执行：\n\n- pnpm install\n- pnpm dev\n- pnpm test\n- pnpm build\n- pnpm check\n\n框架不用复制到游戏里；更新框架前在功能分支验证本游戏。\n`);
};
