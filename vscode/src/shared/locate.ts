import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Walk up from a file until a story root (vars.ts or story.config.ts) is found. */
export function findStoryRoot(fromFile: string): string | undefined {
  let dir = dirname(fromFile);
  for (;;) {
    if (existsSync(join(dir, 'vars.ts')) || existsSync(join(dir, 'story.config.ts'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** Character length of the 0-based `line` in `file` (0 when the line is missing). */
export async function lineLength(file: string, line: number): Promise<number> {
  const text = await readFile(file, 'utf8');
  const ls = text.split(/\r?\n/);
  const l = ls[line];
  return l === undefined ? 0 : l.length;
}
