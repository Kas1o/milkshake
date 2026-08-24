import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../src/web/init.js';
import { isSpecialScript, isStoryRoot, resolveStoryDir } from '../src/engine/story.js';

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

test('isStoryRoot detects flat standalone projects', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-root-'));
  try {
    assert.equal(isStoryRoot(dir), false);
    await mkdir(join(dir, 'passages'));
    assert.equal(isStoryRoot(dir), true);
    assert.equal(isStoryRoot(join(dir, 'passages')), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveStoryDir: explicit dirArg wins', async () => {
  const base = await mkdtemp(join(tmpdir(), 'milkshake-res-'));
  const sub = join(base, 'sub');
  await mkdir(sub);
  try {
    assert.equal(resolveStoryDir(base, 'sub'), sub);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('resolveStoryDir: flat project resolves to cwd', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-res-'));
  await mkdir(join(dir, 'passages'));
  try {
    assert.equal(resolveStoryDir(dir), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveStoryDir: prefers story/ subdir over ../story', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-res-'));
  try {
    await mkdir(join(dir, 'story', 'passages'), { recursive: true });
    assert.equal(resolveStoryDir(dir), join(dir, 'story'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveStoryDir: falls back to ../story (engine-repo layout)', async () => {
  const base = await mkdtemp(join(tmpdir(), 'milkshake-res-'));
  try {
    const parent = join(base, 'engine');
    await mkdir(parent);
    await mkdir(join(base, 'story', 'passages'), { recursive: true });
    assert.equal(resolveStoryDir(parent), join(base, 'story'));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('resolveStoryDir: throws when no story root is found', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-res-'));
  try {
    assert.throws(() => resolveStoryDir(dir), /找不到故事目录/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
