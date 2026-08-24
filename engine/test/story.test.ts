import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine, loadProject, importTsFile } from '../src/index.js';

test('loadProject reads passages and TS scripts from a directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-'));
  const scriptsDir = join(dir, 'scripts');
  await mkdir(scriptsDir);
  const indexPath = new URL('../src/index.ts', import.meta.url).href;
  try {
    await writeFile(join(dir, 'start.mksk'), ':: Start\n<<greet>>\n');    await writeFile(
      join(scriptsDir, 'macros.ts'),
      `import type { StoryContext } from ${JSON.stringify(indexPath)};\n` +
        `export function install(ctx: StoryContext) {\n` +
        `  ctx.registerMacro({ name: 'greet', run: () => 'hi-from-ts' });\n` +
        `  ctx.registerHelper('magic', () => 7);\n` +
        `}\n`,
    );
    await writeFile(
      join(dir, 'magic.mksk'),
      ':: Magic\n${magic()}\n',
    );
    await writeFile(join(dir, 'vars.ts'), `export default { gold: 7 };\n`);
    await writeFile(join(dir, 'gold.mksk'), ':: Gold\n${gold}\n');
    const e = createEngine({ start: 'Start' });
    await loadProject(e, dir);
    const r1 = await e.start();
    assert.equal(r1.text, 'hi-from-ts');
    const r2 = await e.transition('Magic');
    assert.equal(r2.text, '7');
    const r3 = await e.transition('Gold');
    assert.equal(r3.text, '7');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('importTsFile transpiles and imports a TS module without tsx', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-'));
  try {
    await writeFile(
      join(dir, 'mod.ts'),
      'export const n: number = 41;\nexport default function inc(x: number): number { return x + 1; }\n',
    );
    const mod = await importTsFile(join(dir, 'mod.ts'));
    assert.equal(mod.n, 41);
    assert.equal(mod.default(1), 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('importTsFile rewrites relative imports so sibling TS modules load', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-'));
  try {
    await writeFile(join(dir, 'package.json'), '{ "type": "module" }\n');
    await writeFile(
      join(dir, 'a.ts'),
      'export const n: number = 40;\nexport default function add(x: number): number { return x + 2; }\n',
    );
    await writeFile(
      join(dir, 'b.ts'),
      "import add, { n } from './a.js';\nimport './c.js';\nexport const total = add(n);\n",
    );
    await writeFile(join(dir, 'c.ts'), 'globalThis.__milkshakeSideEffect = true;\n');
    const mod = await importTsFile(join(dir, 'b.ts'));
    assert.equal(mod.total, 42);
    assert.equal((globalThis as any).__milkshakeSideEffect, true);
  } finally {
    delete (globalThis as any).__milkshakeSideEffect;
    await rm(dir, { recursive: true, force: true });
  }
});
