import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { collectStoryInfo, type StoryInfo } from '../../../engine/src/check.js';
import type { OpenTextSource } from './diagnostics.js';

/**
 * collectStoryInfo walks + parses every `.mksk` and re-collects script info,
 * which is expensive. Completion fires on every keystroke, so cache the result
 * per story root; the cache is kept fresh by the disk mtime fingerprint plus a
 * key of the open (unsaved) documents, so edits invalidate it too.
 */
const cache = new Map<string, { key: string; info: StoryInfo }>();

export async function cachedStoryInfo(root: string, open?: OpenTextSource): Promise<StoryInfo> {
  const mkskKey = await fingerprint(root, /\.mksk$/i);
  const varsKey = await fingerprint(root, /vars\.ts$/i);
  const openKey = open ? open.openKey() : '';
  const key = `${mkskKey}|${varsKey}|${openKey}`;
  const hit = cache.get(root);
  if (hit && hit.key === key) return hit.info;
  const info = await collectStoryInfo(root, open ? { read: open.read } : undefined);
  cache.set(root, { key, info });
  return info;
}

async function fingerprint(dir: string, pattern: RegExp): Promise<string> {
  async function walk(d: string, out: string[]): Promise<void> {
    const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p, out);
      else if (pattern.test(p)) out.push(p);
    }
  }
  const files: string[] = [];
  await walk(dir, files);
  const mtimes = await Promise.all(
    files.map(async f => {
      try {
        return `${f}:${(await stat(f)).mtimeMs}`;
      } catch {
        return `${f}:missing`;
      }
    }),
  );
  return mtimes.sort().join('|');
}
