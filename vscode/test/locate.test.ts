import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findStoryRoot } from '../src/shared/locate.js';

test('findStoryRoot walks up to the directory containing vars.ts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-lsp-'));
  try {
    const passages = join(dir, 'passages');
    await mkdir(passages);
    await writeFile(join(dir, 'vars.ts'), 'export default {};\n');
    assert.equal(findStoryRoot(join(passages, 'a.mksk')), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findStoryRoot finds the story.config.ts marker too', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-lsp-'));
  try {
    await writeFile(join(dir, 'story.config.ts'), 'export default {};\n');
    assert.equal(findStoryRoot(join(dir, 'a.mksk')), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findStoryRoot returns undefined without markers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-lsp-'));
  try {
    assert.equal(findStoryRoot(join(dir, 'a.mksk')), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
