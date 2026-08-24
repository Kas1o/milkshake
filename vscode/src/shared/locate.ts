import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Walk up from a file until a story root (vars.ts or story.config.ts) is found. */
export function findStoryRoot(fromFile: string): string | undefined {
  let dir = dirname(fromFile);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'vars.ts')) || existsSync(join(dir, 'story.config.ts'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
