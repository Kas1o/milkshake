import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { definitionAt } from '../src/server/definition.js';

test('definition: jump from a story variable to vars.ts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'msk-def-'));
  try {
    await writeFile(
      join(dir, 'vars.ts'),
      'export interface Drink { name: string; price: number; }\nexport default {\n  gold: 7,\n  drinks: [] as Drink[],\n};\n',
    );
    await mkdir(join(dir, 'passages'));
    const text = ':: A\n${gold}\n<<heal 5>>\n';
    await writeFile(join(dir, 'passages', 'a.mksk'), text);
    const doc = TextDocument.create('file:///a.mksk', 'milkshake', 1, text);
    const loc = await definitionAt(dir, doc, { line: 1, character: 3 });
    assert.ok(loc, 'should find the gold declaration');
    assert.ok(loc.uri.endsWith('/vars.ts'), `expected vars.ts, got ${loc.uri}`);
    assert.equal(loc.range.start.line, 2, 'gold is declared on line 2 (0-based)');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('definition: jump from a macro call to its registration script', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'msk-def-'));
  try {
    await writeFile(join(dir, 'vars.ts'), 'export default { gold: 7 };\n');
    await mkdir(join(dir, 'scripts'));
    const script = [
      'export function install(ctx: any) {',
      "  ctx.registerMacro({ name: 'heal', signature: { params: [{ name: 'amount', type: 'number' }] }, run: () => '' });",
      '}',
    ].join('\n');
    await writeFile(join(dir, 'scripts', 'macros.ts'), script);
    await mkdir(join(dir, 'passages'));
    const text = ':: A\n<<heal 5>>\n';
    await writeFile(join(dir, 'passages', 'a.mksk'), text);
    const doc = TextDocument.create('file:///a.mksk', 'milkshake', 1, text);
    const loc = await definitionAt(dir, doc, { line: 1, character: 3 });
    assert.ok(loc, 'should find the macro registration');
    assert.ok(loc.uri.endsWith('/scripts/macros.ts'), `expected macros.ts, got ${loc.uri}`);
    assert.equal(loc.range.start.line, 1, 'heal is registered on line 1 (0-based)');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('definition: passage ref still jumps to the passage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'msk-def-'));
  try {
    await writeFile(join(dir, 'vars.ts'), 'export default { gold: 7 };\n');
    await mkdir(join(dir, 'passages'));
    await writeFile(join(dir, 'passages', 'a.mksk'), ':: A\n[[去->B]]\n');
    await writeFile(join(dir, 'passages', 'b.mksk'), ':: B\nhi\n');
    const text = ':: A\n[[去->B]]\n';
    const doc = TextDocument.create('file:///a.mksk', 'milkshake', 1, text);
    const loc = await definitionAt(dir, doc, { line: 1, character: 6 });
    assert.ok(loc, 'should find the passage');
    assert.ok(loc.uri.endsWith('/b.mksk'), `expected b.mksk, got ${loc.uri}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
