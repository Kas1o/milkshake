import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import type { Engine } from './engine.js';
import { makeContext } from './engine.js';
import type { PassageSource, Vars } from '../types.js';

const IGNORED_DIRS = new Set(['node_modules', 'web-dist', 'dist', '.git', '.svn', '.hg']);

export async function walk(dir: string, predicate: (f: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.isDirectory() && IGNORED_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, predicate)));
    else if (predicate(p)) out.push(p);
  }
  return out;
}

export function parseHeader(raw: string): {
  title: string;
  tags: string[];
  metadata: Record<string, string>;
} {
  let title = raw.trim();
  const tags: string[] = [];
  const metadata: Record<string, string> = {};
  let m: RegExpMatchArray | null;
  while ((m = title.match(/^(.*?)\s*[{\[]([^}\]\[]*)[}\]]\s*$/))) {
    tags.push(...m[2].split(/\s+/).filter(Boolean));
    title = m[1].trim();
  }
  const parts = title.split(/\s+/);
  while (parts.length > 1 && /^\w+:\S+$/.test(parts[parts.length - 1])) {
    const kv = parts.pop()!;
    const idx = kv.indexOf(':');
    metadata[kv.slice(0, idx)] = kv.slice(idx + 1);
  }
  return { title: parts.join(' ') || 'Untitled', tags, metadata };
}

export function parsePassageFile(text: string, file?: string): PassageSource[] {
  const passages: PassageSource[] = [];
  let current: { title: string; tags: string[]; metadata: Record<string, string>; source: string; file?: string; line?: number } | null = null;
  let body: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const m = raw.match(/^::\s*(.*?)\s*$/);
    if (m) {
      if (current) passages.push({ ...current, source: body.join('\n').trimEnd() });
      body = [];
      current = { ...parseHeader(m[1]), source: '', file, line: i };
      continue;
    }
    if (current) body.push(raw);
  }
  if (current) passages.push({ ...current, source: body.join('\n').trimEnd() });
  return passages;
}

/** Import a .ts file under plain Node (no tsx): transpile to ESM, load via
 * data URL. Relative import/export specifiers are rewritten to absolute file
 * URLs so sibling TS modules are reachable (tsx / esbuild transpile them on
 * the fly); bare specifiers and `import type` are left untouched. */
export async function importTsFile(file: string): Promise<any> {
  const source = await readFile(file, 'utf8');
  const out = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      esModuleInterop: true,
    },
  });
  const errors = (out.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    throw new Error(`${file}: ${errors.map(e => ts.flattenDiagnosticMessageText(e.messageText, ' ')).join('; ')}`);
  }
  const url =
    'data:text/javascript,' +
    encodeURIComponent(rewriteRelativeSpecifiers(out.outputText, file) + `\n//# sourceURL=${pathToFileURL(file).href}\n`);
  return await import(url);
}

/** Rewrite relative import/export specifiers in transpiled output to absolute
 * file URLs. Data: URL modules can't resolve `./sibling.js`, so point them at
 * the on-disk TS file (`.js` → `.ts` follows the NodeNext convention). */
function rewriteRelativeSpecifiers(output: string, file: string): string {
  const dir = dirname(file);
  const resolveSpec = (spec: string): string => {
    if (!spec.startsWith('./') && !spec.startsWith('../')) return spec;
    const base = resolve(dir, spec);
    const candidates = [
      base,
      base.replace(/\.js$/, '.ts'),
      base.replace(/\.jsx$/, '.tsx'),
      base.replace(/\.mjs$/, '.mts'),
    ];
    return pathToFileURL(candidates.find(c => existsSync(c)) ?? base).href;
  };

  // Static `... from "spec"` — only when it belongs to an import/export statement.
  output = output.replace(/\bfrom\s+(['"])([^'"]+)\1/g, (m, q, spec, off, full) => {
    const head = full.slice(0, off);
    const stmt = head.slice(Math.max(head.lastIndexOf(';'), head.lastIndexOf('\n')) + 1);
    if (!/\b(import|export)\b/.test(stmt)) return m;
    const abs = resolveSpec(spec);
    return abs === spec ? m : `from ${q}${abs}${q}`;
  });
  // Dynamic `import("spec")` and side-effect `import "spec"`.
  output = output.replace(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g, (m, q, spec) => {
    const abs = resolveSpec(spec);
    return abs === spec ? m : `import(${q}${abs}${q})`;
  });
  output = output.replace(/\bimport\s+(['"])([^'"]+)\1/g, (m, q, spec) => {
    const abs = resolveSpec(spec);
    return abs === spec ? m : `import ${q}${abs}${q}`;
  });
  return output;
}

export async function loadConfig(
  dir: string,
): Promise<{ name?: string; start?: string; uid?: string }> {
  try {
    const mod = await importTsFile(join(dir, 'story.config.ts'));
    return mod.default ?? {};
  } catch {
    return {};
  }
}

/** Load the typed variable defaults declared in `<dir>/vars.ts` (default export). */
export async function loadVars<T extends object = Vars>(dir: string): Promise<T | undefined> {
  try {
    const mod = await importTsFile(join(dir, 'vars.ts'));
    return mod.default as T | undefined;
  } catch {
    return undefined;
  }
}

export async function loadProject<T extends object = Vars>(
  engine: Engine<T>,
  dir: string,
): Promise<Engine<T>> {
  const vars = await loadVars<T>(dir);
  if (vars) engine.declareVars(vars);
  const passageFiles = await walk(dir, p => /\.mksk$/i.test(p));
  const scriptFiles = await walk(dir, p => /\.ts$/i.test(p) && !isSpecialScript(p));
  const sources: PassageSource[] = [];
  for (const f of passageFiles) {
    sources.push(...parsePassageFile(await readFile(f, 'utf8'), relative(dir, f)));
  }
  for (const f of scriptFiles) {
    const mod = await import(pathToFileURL(f).href);
    if (typeof mod.install === 'function') await mod.install(makeContext(engine));
  }
  engine.loadPassages(sources);
  return engine;
}

export function isSpecialScript(p: string): boolean {
  return (
    p.endsWith('story.config.ts') ||
    p.endsWith('vars.ts') ||
    p.endsWith('layout.ts')
  );
}

/** Whether `dir` looks like a story root: has a `passages/` dir, a
 * `story.config.ts`, or a `vars.ts`. These are exactly the files `npm run new`
 * drops into a standalone project (flat, no `story/` subdir). */
export function isStoryRoot(dir: string): boolean {
  return (
    existsSync(join(dir, 'passages')) ||
    existsSync(join(dir, 'story.config.ts')) ||
    existsSync(join(dir, 'vars.ts'))
  );
}

/**
 * Resolve a story root from a CLI directory argument.
 *   - an explicit `dirArg` always wins;
 *   - otherwise, if `cwd` is itself a story root (flat standalone project,
 *     e.g. created by `npm run new`), use `cwd`;
 *   - else prefer a `story/` subdir, then `../story` (the engine-repo layout
 *     where `check`/`build` run from `engine/`);
 *   - otherwise throw so the caller never silently scans an empty dir.
 */
export function resolveStoryDir(cwd: string, dirArg?: string): string {
  if (dirArg) return resolve(cwd, dirArg);
  if (isStoryRoot(cwd)) return cwd;
  if (isStoryRoot(join(cwd, 'story'))) return join(cwd, 'story');
  if (isStoryRoot(join(cwd, '..', 'story'))) return resolve(cwd, '..', 'story');
  throw new Error(`找不到故事目录：${cwd}（需要 passages/、story.config.ts 或 vars.ts）`);
}
