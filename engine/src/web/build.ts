import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { walk, parsePassageFile, loadConfig, isSpecialScript, importTsFile, resolveStoryDir } from '../engine/story.js';
import type { PassageSource } from '../types.js';

const DEFAULT_TEMPLATE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Milkshake Story</title>
</head>
<body>
<script src="./story.js"></script>
</body>
</html>
`;

function parseArgs(argv: string[]): { dir?: string; out?: string } {
  const args = { dir: undefined as string | undefined, out: undefined as string | undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-o') args.out = argv[++i];
    else args.dir = argv[i];
  }
  return args;
}

/** Locate the project-provided layout (default UI), if any. */
function findLayoutFile(dir: string): string | undefined {
  for (const p of [join(dir, 'scripts', 'layout.ts'), join(dir, 'layout.ts')]) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

/** A script is bundled as a macro/helper installer only when it exports
 * `install` (the same rule loadProject / collectScriptInfo use). Helper
 * modules like battle-window.ts are reached through those imports instead. */
async function exportsInstall(f: string): Promise<boolean> {
  try {
    const mod = await importTsFile(f);
    return typeof mod.install === 'function';
  } catch {
    return /\bexport\s+(?:async\s+)?function\s+install\b|\bexport\s+(?:const|let|var)\s+install\b/.test(
      await readFile(f, 'utf8'),
    );
  }
}

export async function exportWeb(dirArg?: string, outArg?: string): Promise<void> {
  const cwd = process.cwd();
  const dir = resolveStoryDir(cwd, dirArg);
  const out = resolve(cwd, outArg ?? join(dir, 'web-dist'));

  const passageFiles = await walk(dir, p => /\.mksk$/i.test(p));
  const scriptFiles: string[] = [];
  for (const f of await walk(dir, p => /\.ts$/i.test(p) && !isSpecialScript(p))) {
    if (await exportsInstall(f)) scriptFiles.push(f);
  }

  const passages: PassageSource[] = [];
  for (const f of passageFiles) {
    passages.push(...parsePassageFile(await readFile(f, 'utf8'), f));
  }

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const webAppPath = fileURLToPath(new URL('./app.js', import.meta.url));
  const entryPath = join(out, 'entry.ts');
  const scripts = scriptFiles.map(f => fileURLToPath(pathToFileURL(f)));
  const config = await loadConfig(dir);
  const hasVars = existsSync(join(dir, 'vars.ts'));
  const layoutFile = findLayoutFile(dir);

  const entry = [
    `import { runStory } from ${JSON.stringify(webAppPath)};`,
    ...(hasVars ? [`import __vars from ${JSON.stringify(join(dir, 'vars.ts'))};`] : []),
    ...(layoutFile
      ? [`import { layout as __layout } from ${JSON.stringify(fileURLToPath(pathToFileURL(layoutFile)))};`]
      : []),
    ...scripts.map((s, i) => `import { install as s${i} } from ${JSON.stringify(s)};`),
    `runStory({`,
    `  title: ${JSON.stringify(config.name ?? 'Milkshake Story')},`,
    `  start: ${JSON.stringify(config.start ?? 'Start')},`,
    ...(hasVars ? [`  vars: __vars,`] : []),
    ...(layoutFile ? [`  layout: __layout,`] : []),
    `  passages: ${JSON.stringify(passages)},`,
    `  install: async (ctx) => { for (const f of [${scripts.map((_, i) => `s${i}`).join(',')}]) await f(ctx); },`,
    `});`,
    ``,
  ].join('\n');
  await writeFile(entryPath, entry, 'utf8');

  await build({
    entryPoints: [entryPath],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    outfile: join(out, 'story.js'),
    minify: true,
    logLevel: 'info',
  });

  await rm(entryPath, { force: true });

  // The page shell is fully customizable:
  // - story/index.html: replaces the whole page template (must load ./story.js)
  // - story/styles.css: copied to story.css and linked from the page
  // - story/scripts/layout.ts: overrides the default UI (builds the DOM + rendering)
  let html = existsSync(join(dir, 'index.html'))
    ? await readFile(join(dir, 'index.html'), 'utf8')
    : DEFAULT_TEMPLATE;
  let cssTag = '';
  if (existsSync(join(dir, 'styles.css'))) {
    await writeFile(join(out, 'story.css'), await readFile(join(dir, 'styles.css'), 'utf8'), 'utf8');
    cssTag = '<link rel="stylesheet" href="./story.css">';
  }
  if (html.includes('<!--story-css-->')) html = html.replace('<!--story-css-->', cssTag);
  else if (cssTag) html = html.replace('</head>', `${cssTag}\n</head>`);
  await writeFile(join(out, 'index.html'), html, 'utf8');

  console.log(`已导出到：${out}`);
  console.log('打开 ' + join(out, 'index.html') + ' 即可在浏览器中游玩。');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const { dir, out } = parseArgs(process.argv.slice(2));
  exportWeb(dir, out).catch(err => {
    console.error('\n' + err.message);
    process.exit(1);
  });
}
