import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../src/web/init.js';
import { isSpecialScript } from '../src/engine/story.js';

test('initProject copies the default project template', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-new-'));
  try {
    await initProject(dir);
    const files = (await readdir(dir)).sort();
    assert.deepEqual(files, [
      'index.html',
      'package.json',
      'passages',
      'scripts',
      'story.config.ts',
      'styles.css',
      'vars.ts',
    ]);
    assert.match(await readFile(join(dir, 'scripts', 'layout.ts'), 'utf8'), /export const layout/);
    assert.match(await readFile(join(dir, 'passages', '00_ui.mksk'), 'utf8'), /StoryTitle/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('initProject refuses a non-empty target directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-new-'));
  try {
    await writeFile(join(dir, 'existing.txt'), 'x');
    await assert.rejects(() => initProject(dir), /不为空/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('isSpecialScript excludes layout.ts', () => {
  assert.equal(isSpecialScript('/x/scripts/layout.ts'), true);
  assert.equal(isSpecialScript('/x/layout.ts'), true);
  assert.equal(isSpecialScript('/x/scripts/helpers.ts'), false);
});
