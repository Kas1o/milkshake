import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { collectStoryInfo, type StoryInfo } from '../../../engine/src/check.js';

/**
 * collectStoryInfo walks + parses every `.mksk` and re-collects script info,
 * which is expensive. Completion fires on every keystroke, so cache the result
 * per story root; the cache is cheap to keep fresh because the engine caches
 * script collection by file mtimes, and story info only needs recomputing when
 * passages or vars change.
 */
const cache = new Map<string, { mkskKey: string; varsKey: string; info: StoryInfo }>();

export async function cachedStoryInfo(root: string): Promise<StoryInfo> {
  const hit = cache.get(root);
  const mkskKey = await fingerprint(root, /\.mksk$/i);
  const varsKey = await fingerprint(root, /vars\.ts$/i);
  if (hit && hit.mkskKey === mkskKey && hit.varsKey === varsKey) return hit.info;
  const info = await collectStoryInfo(root);
  cache.set(root, { mkskKey, varsKey, info });
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
