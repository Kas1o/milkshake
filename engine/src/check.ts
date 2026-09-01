import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { Engine, makeContext } from './engine/engine.js';
import { coreMacros, splitTopSemicolons } from './engine/macros.js';
import { parseNodes, splitArgs } from './engine/parser.js';
import { walk, parsePassageFile, loadVars, isSpecialScript, importTsFile, resolveStoryDir } from './engine/story.js';
import type { Node, PassageSource } from './types.js';

export interface CheckIssue {
  passage: string;
  message: string;
  /** File containing the passage header (absolute path). */
  file?: string;
  /** 0-based line of the passage `::` header within `file`. */
  line?: number;
}

interface ExprSnippet {
  /** 'expr' wraps as return (...); 'stmt' is used as a function body. */
  mode: 'expr' | 'stmt';
  code: string;
  locals: ReadonlySet<string>;
}

const CORE_BLOCK_MACROS = new Set(coreMacros.filter(m => m.block).map(m => m.name));
const CORE_MACRO_NAMES = new Set(coreMacros.map(m => m.name));
/** Names the engine always injects into scope; they shadow same-named vars. */
export const BUILTIN_HELPER_NAMES = [
  'vars', 'state', 'engine', 'passage', 'turns', 'history', 'visited',
  'random', 'dice', 'set', 'get', 'has', 'str',
];

export async function checkStory(dir: string): Promise<CheckIssue[]> {
  const issues: CheckIssue[] = [];
  const passageFiles = await walk(dir, p => /\.mksk$/i.test(p));
  const sources: PassageSource[] = [];
  for (const f of passageFiles) {
    sources.push(...parsePassageFile(await readFile(f, 'utf8'), f));
  }
  const titles = new Set(sources.map(s => s.title));
  const locations = passageLocations(sources);

  // Duplicate passage titles silently overwrite each other at load time.
  const seen = new Set<string>();
  for (const s of sources) {
    if (seen.has(s.title)) {
      issues.push({ passage: s.title, message: `段落「${s.title}」重复定义，后面的会覆盖前面的` });
    }
    seen.add(s.title);
  }

  // Install story scripts against a throwaway engine to learn helper names
  // and script-registered block macros (e.g. <<enemy>>) before parsing.
  const scriptInfo = await cachedScriptInfo(dir);
  const blockMacros = new Set([...CORE_BLOCK_MACROS, ...scriptInfo.blockMacros]);

  const parsed = new Map<string, Node[]>();
  for (const s of sources) {
    try {
      parsed.set(s.title, parseNodes(s.source, { blockMacros }));
    } catch (err) {
      issues.push({ passage: s.title, message: `解析失败：${msg(err)}` });
    }
  }

  // Locate <<widget>> definitions for arity checks and param scoping.
  const widgets = new Map<string, string[]>();
  for (const [title, nodes] of parsed) {
    for (const n of nodes) {
      if (n.kind === 'macro' && n.name === 'widget') {
        const w = widgetDef(n);
        if (!w) {
          issues.push({ passage: title, message: '<<widget>> 缺少名称' });
          continue;
        }
        widgets.set(w.name, w.params);
      }
    }
  }
  const knownMacros = new Set([...CORE_MACRO_NAMES, ...widgets.keys(), ...scriptInfo.macros]);

  const varsPath = join(dir, 'vars.ts');
  const hasVars = existsSync(varsPath);
  const vars = hasVars ? await loadVars(dir) : undefined;

  const snippets = new Map<string, ExprSnippet[]>();
  const addExpr = (passage: string, mode: 'expr' | 'stmt', code: string, locals: ReadonlySet<string>) => {
    if (!code.trim()) return;
    let list = snippets.get(passage);
    if (!list) snippets.set(passage, (list = []));
    list.push({ mode, code, locals });
  };

  const checkMacro = (passage: string, n: Extract<Node, { kind: 'macro' }>, locals: Set<string>) => {
    if (n.name === 'widget') return;
    if (n.name === 'if') return; // Branch tests are checked during traversal.
    if (n.name === 'goto' || n.name === 'display') {
      const lit = stringLiteral(n.args);
      if (lit !== null && !titles.has(lit)) {
        issues.push({ passage, message: `<<${n.name}>> 目标「${lit}」不存在` });
      }
      return;
    }
    if (n.name === 'for') {
      const a = n.args.trim();
      const m = a.match(/^\w+\s+(?:of|in)\s+(.+)$/);
      if (m) addExpr(passage, 'expr', m[1], locals);
      else {
        const m2 = a.match(/^\w+\s+(?:from|upto|until|to|downto)\s+(.+)$/);
        if (m2) addExpr(passage, 'expr', m2[1], locals);
        else {
          const parts = splitTopSemicolons(a);
          if (parts[1]?.trim()) addExpr(passage, 'expr', parts[1], locals);
        }
      }
      return;
    }
    if (n.name === 'button' || n.name === 'script') {
      // Raw content becomes link setup / inline code at runtime.
      const code = (n.content ?? []).map(x => (x.kind === 'text' ? x.text : '')).join('');
      addExpr(passage, 'stmt', code, locals);
      return;
    }
    if (knownMacros.has(n.name)) {
      const params = widgets.get(n.name);
      if (params) {
        const given = splitArgs(n.args).length;
        if (given !== params.length) {
          issues.push({
            passage,
            message: `<<${n.name}>> 需要 ${params.length} 个参数，实际给了 ${given} 个`,
          });
        }
      }
      return;
    }
    // Mirrors runtime behavior: unknown <<name args>> is executed as code.
    addExpr(passage, 'stmt', n.args ? `${n.name} ${n.args}` : n.name, locals);
  };

  const visit = (passage: string, nodes: Node[], locals: Set<string>) => {
    for (const n of nodes) {
      switch (n.kind) {
        case 'interp':
          addExpr(passage, 'expr', n.expr, locals);
          break;
        case 'link': {
          if (!titles.has(n.target)) {
            issues.push({ passage, message: `链接目标「${n.target}」不存在（[[${n.label}->${n.target}]]）` });
          }
          if (n.setup) addExpr(passage, 'stmt', n.setup, locals);
          break;
        }
        case 'macro': {
          checkMacro(passage, n, locals);
          const inner = new Set(locals);
          if (n.name === 'for') {
            const lv = forLoopVar(n.args);
            if (lv) inner.add(lv);
          }
          if (n.content) visit(passage, n.content, inner);
          for (const b of n.branches ?? []) {
            if (b.test !== undefined) addExpr(passage, 'expr', b.test, inner);
            visit(passage, b.nodes, inner);
          }
          break;
        }
      }
    }
  };

  for (const [title, nodes] of parsed) {
    // Widget params declared passage-wide: looser than true scoping, but
    // keeps the checker free of false positives.
    const locals = new Set<string>([...widgets.values()].flat());
    visit(title, nodes, locals);
  }

  // Expression type checking requires typed vars; skip it otherwise.
  if (hasVars && vars) {
    // Runtime scope order: helpers/engine built-ins shadow same-named vars.
    const shadowed = new Set([...scriptInfo.helpers, ...BUILTIN_HELPER_NAMES]);
    issues.push(
      ...typeCheckSnippets({
        varNames: Object.keys(vars).filter(k => !shadowed.has(k)),
        helperNames: [...scriptInfo.helpers],
        varsSource: readFileSync(varsPath, 'utf8'),
        snippets,
      }),
    );
  }
  for (const i of issues) {
    const loc = locations.get(i.passage);
    if (loc) {
      i.file = loc.file;
      i.line = loc.line;
    }
  }
  return issues;
}

export interface PassageLocation {
  file: string;
  line: number;
}

function passageLocations(sources: PassageSource[]): Map<string, PassageLocation> {
  const map = new Map<string, PassageLocation>();
  for (const s of sources) {
    if (s.file && s.line !== undefined) map.set(s.title, { file: s.file, line: s.line });
  }
  return map;
}

function widgetDef(n: Node): { name: string; params: string[] } | null {
  if (n.kind !== 'macro' || n.name !== 'widget') return null;
  const toks = splitArgs(n.args);
  const name = toks[0] ? stripQuotes(toks[0]) : '';
  return name ? { name, params: toks.slice(1) } : null;
}

/** Knowledge about a story project, gathered once for editor tooling (LSP). */
export interface StoryInfo {
  titles: Set<string>;
  locations: Map<string, PassageLocation>;
  widgets: Map<string, string[]>;
  /** Core macros + widgets + script-registered macros. */
  knownMacros: Set<string>;
  /** Helpers registered by story scripts. */
  helpers: Set<string>;
  varNames: string[];
}

export async function collectStoryInfo(dir: string): Promise<StoryInfo> {
  const passageFiles = await walk(dir, p => /\.mksk$/i.test(p));
  const sources: PassageSource[] = [];
  for (const f of passageFiles) {
    sources.push(...parsePassageFile(await readFile(f, 'utf8'), f));
  }
  const titles = new Set(sources.map(s => s.title));
  const locations = passageLocations(sources);
  const scriptInfo = await cachedScriptInfo(dir);
  const blockMacros = new Set([...CORE_BLOCK_MACROS, ...scriptInfo.blockMacros]);
  const widgets = new Map<string, string[]>();
  for (const s of sources) {
    try {
      for (const n of parseNodes(s.source, { blockMacros })) {
        const w = widgetDef(n);
        if (w) widgets.set(w.name, w.params);
      }
    } catch {
      // Parse errors are reported by checkStory, not here.
    }
  }
  const knownMacros = new Set([...CORE_MACRO_NAMES, ...widgets.keys(), ...scriptInfo.macros]);
  const vars = existsSync(join(dir, 'vars.ts')) ? await loadVars(dir) : undefined;
  return {
    titles,
    locations,
    widgets,
    knownMacros,
    helpers: scriptInfo.helpers,
    varNames: vars ? Object.keys(vars) : [],
  };
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function stripQuotes(tok: string): string {
  return /^['"`]/.test(tok) ? tok.slice(1, -1) : tok;
}

function stringLiteral(args: string): string | null {
  const m = args.trim().match(/^(['"])(.*)\1$/);
  return m ? m[2] : null;
}

function forLoopVar(args: string): string | undefined {
  const a = args.trim();
  const m = a.match(/^(\w+)\s+(?:of|in)\s+/) ?? a.match(/^(\w+)\s+(?:from|upto|until|to|downto)\s+/);
  if (m) return m[1];
  const init = splitTopSemicolons(a)[0] ?? '';
  const m2 = init.match(/^\s*(?:let\s+|const\s+|var\s+)?([A-Za-z_$][\w$]*)\s*=/);
  return m2 ? m2[1] : undefined;
}

interface CollectedScriptInfo {
  helpers: Set<string>;
  macros: Set<string>;
  blockMacros: Set<string>;
}

/** Importing + executing every story script is expensive (transpile + data-URL
 * import + module side effects). Scripts rarely change while editing `.mksk`,
 * so cache the result keyed by a fingerprint of the relevant TS files' mtimes. */
const scriptInfoCache = new Map<string, { key: string; info: CollectedScriptInfo }>();

async function cachedScriptInfo(dir: string): Promise<CollectedScriptInfo> {
  let key = '';
  try {
    const files = await walk(dir, p => /\.ts$/i.test(p) && !isSpecialScript(p));
    const mtimes = await Promise.all(
      files.map(async f => {
        try {
          const st = await stat(f);
          return `${f}:${st.mtimeMs}`;
        } catch {
          return `${f}:missing`;
        }
      }),
    );
    key = mtimes.sort().join('|');
  } catch {
    // Fall back to a stable key so the cache is simply never reused.
    key = `${dir}:unreadable`;
  }
  const hit = scriptInfoCache.get(dir);
  if (hit && hit.key === key) return hit.info;
  const info = await collectScriptInfo(dir);
  scriptInfoCache.set(dir, { key, info });
  return info;
}

/** Install story scripts against a throwaway engine to learn helper names
 * and script-registered macros (block ones affect parsing, e.g. <<enemy>>). */
async function collectScriptInfo(dir: string): Promise<CollectedScriptInfo> {
  const helpers = new Set<string>();
  const macros = new Set<string>();
  const blockMacros = new Set<string>();
  try {
    const scriptFiles = await walk(dir, p => /\.ts$/i.test(p) && !isSpecialScript(p));
    const engine = new Engine();
    for (const f of scriptFiles) {
      try {
        const mod = await importTsFile(f);
        if (typeof mod.install === 'function') await mod.install(makeContext(engine));
      } catch {
        // Scripts that need runtime state shouldn't block static checking.
      }
    }
    for (const n of (engine as any).helpers.keys() as Iterable<string>) helpers.add(n);
    for (const [n, def] of (engine as any).macros as Map<string, { block?: boolean }>) {
      macros.add(n);
      if (def.block) blockMacros.add(n);
    }
  } catch {
    // No scripts: nothing to collect.
  }
  return { helpers, macros, blockMacros };
}

interface TypeCheckInput {
  varNames: string[];
  helperNames: string[];
  varsSource: string;
  snippets: Map<string, ExprSnippet[]>;
}

function typeCheckSnippets(input: TypeCheckInput): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const varsPath = '/check/story-vars.ts';

  // Ambient declarations live inside each snippet's namespace so they shadow
  // lib.dom globals (name, status, ...) instead of colliding with them.
  // default export is a value, so its type needs `typeof import(...)`.
  const env: string[] = [`  declare const __vars: typeof import('./story-vars').default;`];
  for (const k of input.varNames) {
    env.push(`  declare var ${k}: typeof __vars[${JSON.stringify(k)}];`);
  }
  env.push(
    '  declare function passage(): string;',
    '  declare function turns(): number;',
    '  declare function history(): string[];',
    '  declare function visited(name: string): number;',
    '  declare function random(min?: number, max?: number): number;',
    '  declare function dice(n?: number): number;',
    '  declare function set(key: string, value: unknown): void;',
    '  declare function get(key: string): unknown;',
    '  declare function has(key: string): boolean;',
    '  declare function str(value: unknown): string;',
  );
  for (const h of input.helperNames) env.push(`  declare function ${h}(...args: any[]): any;`);
  const reserved = new Set([...input.varNames, ...input.helperNames, ...BUILTIN_HELPER_NAMES]);

  const files = new Map<string, string>([[varsPath, input.varsSource]]);
  const origin = new Map<string, { passage: string; code: string }>();

  let seq = 0;
  for (const [passage, list] of input.snippets) {
    for (const s of list) {
      const name = `/check/snippet-${seq++}.ts`;
      // Namespace per snippet: locals and __check never collide across files,
      // and locals shadowing a var/helper must not redeclare it.
      const locals = [...new Set(s.locals)]
        .filter(l => !reserved.has(l))
        .map(l => `  let ${l}: any;`)
        .join('\n');
      const body = s.mode === 'expr' ? `    return (${s.code});` : indent(s.code);
      files.set(
        name,
        `namespace __s${seq} {\n${env.join('\n')}\n${locals}\n  function __check() {\n${body}\n  }\n}\n`,
      );
      origin.set(name, { passage, code: s.code });
    }
  }
  if (!seq) return issues;

  const options = makeOptions();
  const program = ts.createProgram([...files.keys()], options, makeHost(files, options));
  for (const [name, info] of origin) {
    const sf = program.getSourceFile(name);
    if (!sf) continue;
    const diags = [
      ...program.getSyntacticDiagnostics(sf),
      ...program.getSemanticDiagnostics(sf),
    ];
    for (const d of diags) {
      let where = '';
      if (d.file && d.start !== undefined && d.length !== undefined) {
        const near = d.file.getFullText().slice(d.start, d.start + d.length);
        if (near.trim()) where = `（靠近 "${truncate(near)}"）`;
      }
      issues.push({
        passage: info.passage,
        message:
          `类型错误${where}：${ts.flattenDiagnosticMessageText(d.messageText, ' ')}` +
          `\n    代码：${truncate(info.code, 120)}`,
      });
    }
  }
  return issues;
}

function makeOptions(): ts.CompilerOptions {
  return {
    target: ts.ScriptTarget.ES2020,
    // ESM keeps `export default` as a real default export for import('./story-vars').default.
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noImplicitAny: false,
    esModuleInterop: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  };
}

// Works under both ESM (tsx) and CJS (esbuild bundle for the LSP server).
const require_ = createRequire(
  typeof __filename !== 'undefined' ? __filename : import.meta.url,
);

function makeHost(files: Map<string, string>, options: ts.CompilerOptions): ts.CompilerHost {
  const libPath = ts.getDefaultLibFilePath(options);
  const libText = readFileSync(libPath, 'utf8');
  const read = (f: string): string | undefined => {
    if (files.has(f)) return files.get(f);
    if (f === libPath || f.endsWith('.d.ts')) {
      // Resolve lib files relative to the bundled typescript package.
      try {
        return readFileSync(require_.resolve(`typescript/lib/${f.split('/').pop()}`), 'utf8');
      } catch {
        return f === libPath ? libText : undefined;
      }
    }
    return undefined;
  };
  return {
    getSourceFile: (fileName, languageVersion) => {
      const text = read(fileName);
      return text !== undefined ? ts.createSourceFile(fileName, text, languageVersion, true) : undefined;
    },
    getDefaultLibFileName: () => libPath,
    writeFile: () => {},
    getCurrentDirectory: () => '/check',
    getCanonicalFileName: f => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: f => read(f) !== undefined,
    readFile: read,
    getDirectories: () => [],
    directoryExists: () => true,
  };
}

function truncate(s: string, max = 60): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

function indent(code: string): string {
  return code
    .split('\n')
    .map(l => (l.trim() ? '  ' + l : l))
    .join('\n');
}

// ---------------------------------------------------------------------------
// CLI entry: tsx src/check.ts [故事目录]
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const dir = resolveStoryDir(process.cwd(), process.argv[2]);
  checkStory(dir)
    .then(issues => {
      if (!issues.length) {
        console.log('静态检查通过：未发现问题。');
        return;
      }
      for (const i of issues) console.error(`✗ 段落「${i.passage}」：${i.message}`);
      console.error(`\n共发现 ${issues.length} 个问题。`);
      process.exit(1);
    })
    .catch(err => {
      console.error('\n' + msg(err));
      process.exit(1);
    });
}
