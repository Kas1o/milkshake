import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine, loadProject, importTsFile, walk, parseHeader } from '../src/index.js';

test('parseHeader extracts tags anywhere and trailing metadata', () => {
  assert.deepEqual(parseHeader('Start {start} meta:key=val'), {
    title: 'Start',
    tags: ['start'],
    metadata: { meta: 'key=val' },
  });
  assert.deepEqual(parseHeader('My Title {a} {b} x:1 y:2'), {
    title: 'My Title',
    tags: ['a', 'b'],
    metadata: { x: '1', y: '2' },
  });
  assert.deepEqual(parseHeader('Plain Title'), {
    title: 'Plain Title',
    tags: [],
    metadata: {},
  });
});

test('walk skips node_modules / web-dist / .git', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-'));
  try {
    await mkdir(join(dir, 'passages'));
    await mkdir(join(dir, 'node_modules', 'pkg', 'src'), { recursive: true });
    await mkdir(join(dir, 'web-dist'));
    await mkdir(join(dir, '.git'));
    await writeFile(join(dir, 'passages', 'a.mksk'), ':: A\n');
    await writeFile(join(dir, 'node_modules', 'pkg', 'src', 'skip.mksk'), ':: Skip\n');
    await writeFile(join(dir, 'web-dist', 'skip.mksk'), ':: Skip\n');
    await writeFile(join(dir, '.git', 'skip.mksk'), ':: Skip\n');
    await writeFile(join(dir, 'scripts.ts'), 'export const x = 1;\n');
    const files = await walk(dir, p => /\.(mksk|ts)$/.test(p));
    const rel = files.map(f => f.replace(dir, '').replace(/\\/g, '/'));
    assert.ok(rel.some(f => f.endsWith('passages/a.mksk')));
    assert.ok(rel.some(f => f.endsWith('scripts.ts')));
    assert.ok(!rel.some(f => f.includes('node_modules')));
    assert.ok(!rel.some(f => f.includes('web-dist')));
    assert.ok(!rel.some(f => f.includes('.git')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

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
