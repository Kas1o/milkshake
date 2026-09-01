import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { Engine, makeContext } from './engine/engine.js';
import { coreMacros, splitTopSemicolons, type MacroSignature, type MacroParam } from './engine/macros.js';
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
  /** 'expr' wraps as return (...); 'stmt' is used as a function body;
   * 'checktype' asserts the expression is assignable to `expected`. */
  mode: 'expr' | 'stmt' | 'checktype';
  code: string;
  locals: ReadonlySet<string>;
  /** For 'checktype': the TS type the expression must be assignable to. */
  expected?: string;
}

const CORE_BLOCK_MACROS = new Set(coreMacros.filter(m => m.block).map(m => m.name));
const CORE_MACRO_NAMES = new Set(coreMacros.map(m => m.name));
/** Names the engine always injects into scope; they shadow same-named vars. */
export const BUILTIN_HELPER_NAMES = [
  'vars', 'state', 'engine', 'passage', 'turns', 'history', 'visited',
  'random', 'dice', 'set', 'get', 'has', 'str',
];

export interface CheckOptions {
  /** Optional in-memory override for a file path (e.g. the LSP's open, unsaved
   * document). Return the text to use, or `undefined` to fall back to disk. */
  read?: (path: string) => string | undefined;
}

export async function checkStory(dir: string, opts: CheckOptions = {}): Promise<CheckIssue[]> {
  const issues: CheckIssue[] = [];
  const passageFiles = await walk(dir, p => /\.mksk$/i.test(p));
  const sources: PassageSource[] = [];
  for (const f of passageFiles) {
    const content = opts.read?.(f) ?? (await readFile(f, 'utf8'));
    sources.push(...parsePassageFile(content, f));
  }
  const titles = new Set(sources.map(s => s.title));
  const locations = passageLocations(sources);

  // Duplicate passage titles silently overwrite each other at load time.
  const seen = new Set<string>();
  for (const s of sources) {
    if (seen.has(s.title)) {
      issues.push({ passage: s.title, message: `「${s.title}」重复定义，后面的会覆盖前面的` });
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
  const widgets = new Map<string, MacroParam[]>();
  const widgetParamNames = new Map<string, string[]>();
  for (const [title, nodes] of parsed) {
    for (const n of allNodes(nodes)) {
      if (n.kind !== 'macro' || n.name !== 'widget') continue;
      const w = widgetDef(n);
      if (!w) {
        issues.push({ passage: title, message: '<<widget>> 缺少名称' });
        continue;
      }
      widgets.set(w.name, w.params);
      widgetParamNames.set(w.name, w.params.map(p => p.name));
    }
  }
  // Unified call signatures: core macros + story-registered macros + widgets.
  const macroSigs = new Map<string, MacroSignature>();
  for (const m of coreMacros) if (m.signature) macroSigs.set(m.name, m.signature);
  for (const [n, s] of scriptInfo.macroSigs) macroSigs.set(n, s);
  for (const [name, params] of widgets) {
    macroSigs.set(name, { params });
  }
  const knownMacros = new Set([...CORE_MACRO_NAMES, ...widgets.keys(), ...scriptInfo.macros]);

  const varsPath = join(dir, 'vars.ts');
  const hasVars = existsSync(varsPath);
  const vars = hasVars ? await loadVars(dir) : undefined;

  const snippets = new Map<string, ExprSnippet[]>();
  const addExpr = (
    passage: string,
    mode: 'expr' | 'stmt' | 'checktype',
    code: string,
    locals: ReadonlySet<string>,
    expected?: string,
  ) => {
    if (!code.trim()) return;
    let list = snippets.get(passage);
    if (!list) snippets.set(passage, (list = []));
    list.push({ mode, code, locals, expected });
  };

  /** Validate a macro call's arity and, when types are declared, type-check
   * each argument so mistakes surface at compile time, not runtime. */
  const checkSignature = (
    passage: string,
    n: Extract<Node, { kind: 'macro' }>,
    sig: MacroSignature,
    locals: Set<string>,
  ) => {
    if (!sig.params?.length && !sig.rest) return;
    const args = splitArgs(n.args);
    const fixed = sig.params ?? [];
    const minRequired = fixed.filter(p => !p.optional).length;

    if (args.length < minRequired) {
      issues.push({
        passage,
        message: `<<${n.name}>> 需要至少 ${minRequired} 个参数，实际给了 ${args.length} 个`,
      });
    } else if (!sig.rest && args.length > fixed.length) {
      issues.push({
        passage,
        message: `<<${n.name}>> 最多接受 ${fixed.length} 个参数，实际给了 ${args.length} 个`,
      });
    }

    for (let i = 0; i < args.length; i++) {
      const p = fixed[i] ?? sig.rest;
      if (!p?.type || p.type === 'unknown' || p.type === 'any') continue;
      addExpr(passage, 'checktype', args[i], locals, p.type);
    }
  };

  const checkMacro = (passage: string, n: Extract<Node, { kind: 'macro' }>, locals: Set<string>) => {
    if (n.name === 'if') return; // Branch tests are checked during traversal.
    if (n.name === 'for') {
      const a = n.args.trim();
      const m = a.match(/^\w+\s+(?:of|in)\s+(.+)$/);
      if (m) addExpr(passage, 'expr', m[1], locals);
      else {
        // `from A (upto|until|to|downto) B`, or shorthand `(upto|until|to|downto) B`.
        const bounds = forRangeBounds(a);
        if (bounds.from) addExpr(passage, 'expr', bounds.from, locals);
        if (bounds.to) addExpr(passage, 'expr', bounds.to, locals);
        if (!bounds.from && !bounds.to) {
          // C-style: `i = 0; i < n; i++`. The loop var is declared as a local
          // at runtime, so the cond / step / init snippets must see it too.
          const parts = splitTopSemicolons(a);
          const lv = forLoopVar(a);
          const loopLocals = lv ? new Set<string>(locals).add(lv) : locals;
          if (parts[1]?.trim()) addExpr(passage, 'expr', parts[1], loopLocals);
          if (parts[2]?.trim()) addExpr(passage, 'expr', parts[2], loopLocals);
          if (parts[0]?.trim() && !/^\s*[A-Za-z_$][\w$]*\s*=/.test(parts[0])) {
            // init with real logic (e.g. `i = seed()`), not a bare decl.
            addExpr(passage, 'expr', parts[0], loopLocals);
          }
        }
      }
      return;
    }
    if (n.name === 'script') {
      // Raw content becomes inline code at runtime.
      const code = (n.content ?? []).map(x => (x.kind === 'text' ? x.text : '')).join('');
      addExpr(passage, 'stmt', code, locals);
      return;
    }
    // goto / display / link / button also carry a signature; check the args,
    // and additionally validate literal navigation targets.
    const sig = macroSigs.get(n.name);
    if (sig) checkSignature(passage, n, sig, locals);
    if (n.name === 'goto' || n.name === 'display') {
      const lit = stringLiteral(n.args);
      if (lit !== null && !titles.has(lit)) {
        issues.push({ passage, message: `<<${n.name}>> 目标「${lit}」不存在` });
      }
      return;
    }
    if (n.name === 'link') {
      // <<link "label">>Target<</link>>: the rendered content is the target.
      const target = linkBlockTarget(n);
      if (target !== null && !titles.has(target)) {
        issues.push({ passage, message: `<<link>> 目标「${target}」不存在` });
      }
      return;
    }
    if (n.name === 'button') {
      // Raw content becomes link setup at runtime.
      const code = (n.content ?? []).map(x => (x.kind === 'text' ? x.text : '')).join('');
      addExpr(passage, 'stmt', code, locals);
      return;
    }
    if (knownMacros.has(n.name)) return;
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
    const locals = new Set<string>([...widgetParamNames.values()].flat());
    visit(title, nodes, locals);
  }

  // Expression type checking requires typed vars; skip it otherwise.
  if (hasVars && vars) {
    // Runtime scope order: helpers/engine built-ins shadow same-named vars.
    const shadowed = new Set([...scriptInfo.helpers, ...BUILTIN_HELPER_NAMES]);
    issues.push(
      ...typeCheckSnippets({
        root: dir,
        varNames: Object.keys(vars).filter(k => !shadowed.has(k)),
        helperNames: [...scriptInfo.helpers],
        varsSource: opts.read?.(varsPath) ?? readFileSync(varsPath, 'utf8'),
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

function widgetDef(n: Node): { name: string; params: MacroParam[] } | null {
  if (n.kind !== 'macro' || n.name !== 'widget') return null;
  const toks = splitArgs(n.args);
  const name = toks[0] ? stripQuotes(toks[0]) : '';
  if (!name) return null;
  const params: MacroParam[] = toks.slice(1).map(tok => {
    // `name` or `name:type` (type resolved against vars.ts, defaults to any).
    const colon = tok.indexOf(':');
    const [rawName, type] =
      colon > 0 ? [tok.slice(0, colon), tok.slice(colon + 1)] : [tok, ''];
    return { name: rawName, type: type || 'unknown' };
  });
  return { name, params };
}

/** Depth-first visit of every node in a tree, including block bodies. */
function* allNodes(nodes: Node[]): Generator<Node, void, undefined> {
  for (const n of nodes) {
    yield n;
    if (n.kind === 'macro') {
      if (n.content) yield* allNodes(n.content);
      for (const b of n.branches ?? []) yield* allNodes(b.nodes);
    }
  }
}

/** Knowledge about a story project, gathered once for editor tooling (LSP). */
export interface StoryInfo {
  titles: Set<string>;
  locations: Map<string, PassageLocation>;
  widgets: Map<string, MacroParam[]>;
  /** Core macros + widgets + script-registered macros. */
  knownMacros: Set<string>;
  /** Compile-time call signatures for macros (core + story + widgets). */
  macroSigs: Map<string, MacroSignature>;
  /** Helpers registered by story scripts. */
  helpers: Set<string>;
  varNames: string[];
}

export async function collectStoryInfo(dir: string, opts: CheckOptions = {}): Promise<StoryInfo> {
  const passageFiles = await walk(dir, p => /\.mksk$/i.test(p));
  const sources: PassageSource[] = [];
  for (const f of passageFiles) {
    const content = opts.read?.(f) ?? (await readFile(f, 'utf8'));
    sources.push(...parsePassageFile(content, f));
  }
  const titles = new Set(sources.map(s => s.title));
  const locations = passageLocations(sources);
  const scriptInfo = await cachedScriptInfo(dir);
  const blockMacros = new Set([...CORE_BLOCK_MACROS, ...scriptInfo.blockMacros]);
  const widgets = new Map<string, MacroParam[]>();
  for (const s of sources) {
    try {
      for (const n of allNodes(parseNodes(s.source, { blockMacros }))) {
        const w = widgetDef(n);
        if (w) widgets.set(w.name, w.params);
      }
    } catch {
      // Parse errors are reported by checkStory, not here.
    }
  }
  const knownMacros = new Set([...CORE_MACRO_NAMES, ...widgets.keys(), ...scriptInfo.macros]);
  const macroSigs = new Map<string, MacroSignature>();
  for (const m of coreMacros) if (m.signature) macroSigs.set(m.name, m.signature);
  for (const [n, s] of scriptInfo.macroSigs) macroSigs.set(n, s);
  for (const [name, params] of widgets) macroSigs.set(name, { params });
  const vars = existsSync(join(dir, 'vars.ts')) ? await loadVars(dir) : undefined;
  return {
    titles,
    locations,
    widgets,
    knownMacros,
    macroSigs,
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

/** For `<<link "label">>Target<</link>>`, return the trimmed target text when
 * it's a plain literal (single text node), or null when it's dynamic. */
function linkBlockTarget(n: Extract<Node, { kind: 'macro' }>): string | null {
  const c = n.content;
  if (!c || c.length !== 1 || c[0].kind !== 'text') return null;
  const t = c[0].text.trim();
  return t ? t : null;
}

function forLoopVar(args: string): string | undefined {
  const a = args.trim();
  const m = a.match(/^(\w+)\s+(?:of|in)\s+/) ?? a.match(/^(\w+)\s+(?:from|upto|until|to|downto)\s+/);
  if (m) return m[1];
  const init = splitTopSemicolons(a)[0] ?? '';
  const m2 = init.match(/^\s*(?:let\s+|const\s+|var\s+)?([A-Za-z_$][\w$]*)\s*=/);
  return m2 ? m2[1] : undefined;
}

/** Split a `for` range into the `from` / `to` sub-expressions (mirrors the
 * runtime grammar in macros.ts), or `{}` if it isn't a range form. */
function forRangeBounds(args: string): { from?: string; to?: string } {
  const a = args.trim();
  const m = a.match(/^\w+\s+(?:from|upto|until|to|downto)\s+(.+)$/);
  if (!m) return {};
  const kind = /^\w+\s+(from)\s/.test(a) ? 'from' : 'shorthand';
  if (kind === 'from') {
    const mm = m[1].match(/^(.+?)\s+(upto|until|to|downto)\s+(.+)$/);
    if (!mm) return {};
    return { from: mm[1].trim(), to: mm[3].trim() };
  }
  // Shorthand `(upto|until|to|downto) B` — from is implied 1.
  return { to: m[1].trim() };
}

interface CollectedScriptInfo {
  helpers: Set<string>;
  macros: Set<string>;
  blockMacros: Set<string>;
  macroSigs: Map<string, MacroSignature>;
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
  const macroSigs = new Map<string, MacroSignature>();
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
    for (const [n, def] of (engine as any).macros as Map<string, { block?: boolean; signature?: MacroSignature }>) {
      macros.add(n);
      if (def.block) blockMacros.add(n);
      if (def.signature) macroSigs.set(n, def.signature);
    }
  } catch {
    // No scripts: nothing to collect.
  }
  return { helpers, macros, blockMacros, macroSigs };
}

interface TypeCheckInput {
  /** Story root, used to key the persistent (incremental) TS session. */
  root: string;
  varNames: string[];
  helperNames: string[];
  varsSource: string;
  snippets: Map<string, ExprSnippet[]>;
}

/** A persistent TypeScript LanguageService per story root. The language
 * service keeps incremental per-file caches, so re-checking just the edited
 * passage's snippets is ~10ms instead of re-analyzing the whole project. */
interface TypeCheckSession {
  files: Map<string, { text: string; version: number }>;
  service: ts.LanguageService;
  options: ts.CompilerOptions;
}
const typeCheckSessions = new Map<string, TypeCheckSession>();

function createTypeCheckSession(): TypeCheckSession {
  const files = new Map<string, { text: string; version: number }>();
  const options = makeOptions();
  const read = (f: string): string | undefined => {
    const e = files.get(f);
    if (e) return e.text;
    const libPath = ts.getDefaultLibFilePath(options);
    if (f === libPath || f.endsWith('.d.ts')) {
      try {
        return readFileSync(require_.resolve(`typescript/lib/${f.split('/').pop()}`), 'utf8');
      } catch {
        return undefined;
      }
    }
    return undefined;
  };
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: f => String(files.get(f)?.version ?? 0),
    getScriptSnapshot: f => {
      const t = read(f);
      return t === undefined ? undefined : ts.ScriptSnapshot.fromString(t);
    },
    getCurrentDirectory: () => '/check',
    getDefaultLibFileName: o => ts.getDefaultLibFilePath(o),
    fileExists: f => read(f) !== undefined,
    readFile: f => read(f),
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  return { files, service, options };
}

/** Write `text` to the session's virtual file, bumping the version only when
 * the content actually changed (so unchanged snippets keep cached results). */
function setVirtualFile(files: Map<string, { text: string; version: number }>, name: string, text: string) {
  const prev = files.get(name);
  if (prev && prev.text === text) return;
  files.set(name, { text, version: (prev?.version ?? 0) + 1 });
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
    // The remaining built-ins are plain values / engine handles, typed loosely
    // so `vars.gold`, `state.current`, `engine.options.name` all type-check.
    '  declare const vars: typeof __vars;',
    `  declare const state: {
      variables: typeof __vars; history: string[]; turns: number;
      current?: string; previous?: string; visits: Map<string, number>;
      visited(name: string): number;
    };`,
    '  declare const engine: { options: { name: string; start: string; uid?: string } };',
  );
  for (const h of input.helperNames) env.push(`  declare function ${h}(...args: any[]): any;`);
  const reserved = new Set([...input.varNames, ...input.helperNames, ...BUILTIN_HELPER_NAMES]);
  const exportedTypes = exportedTypeNames(input.varsSource);

  // Reuse a persistent LanguageService session per root so only the edited
  // passage's snippets are re-analyzed (much faster than a fresh program).
  let session = typeCheckSessions.get(input.root);
  if (!session) {
    session = createTypeCheckSession();
    typeCheckSessions.set(input.root, session);
  }
  const { files, service } = session;

  setVirtualFile(files, varsPath, input.varsSource);
  // Each passage maps to ONE virtual file (all its snippets as namespaces), so
  // editing expressions inside an existing passage is a content change to an
  // existing file → the language service re-checks it incrementally (~10ms).
  // Only adding/removing an entire passage forces a program rebuild.
  const passageFiles = new Map<string, { passage: string; ranges: { start: number; end: number; code: string }[] }>();
  const currentNames = new Set<string>();

  for (const [passage, list] of input.snippets) {
    const name = `/check/${sanitizeFileName(passage)}.ts`;
    let content = '';
    const ranges: { start: number; end: number; code: string }[] = [];
    let idx = 0;
    for (const s of list) {
      const locals = [...new Set(s.locals)]
        .filter(l => !reserved.has(l))
        .map(l => `  let ${l}: any;`)
        .join('\n');
      let checkDecl = '';
      let body: string;
      if (s.mode === 'checktype') {
        // `__checktype(arg)` asserts the argument is assignable to the macro's
        // declared param type. Story type names resolve against vars.ts.
        const type = resolveType(s.expected ?? 'unknown', exportedTypes);
        checkDecl = `  declare function __checktype(p: ${type}): void;\n`;
        body = `    __checktype(${s.code});`;
      } else {
        body = s.mode === 'expr' ? `    return (${s.code});` : indent(s.code);
      }
      const start = content.length;
      content += `namespace __s${idx} {\n${env.join('\n')}\n${locals}\n${checkDecl}  function __check() {\n${body}\n  }\n}\n`;
      ranges.push({ start, end: content.length, code: s.code });
      idx++;
    }
    setVirtualFile(files, name, content);
    currentNames.add(name);
    passageFiles.set(name, { passage, ranges });
  }
  // Drop virtual files whose passage no longer has expressions.
  for (const key of [...files.keys()]) {
    if (key !== varsPath && !currentNames.has(key)) files.delete(key);
  }
  if (!passageFiles.size) return issues;

  for (const [name, pf] of passageFiles) {
    const diags = [
      ...service.getSyntacticDiagnostics(name),
      ...service.getSemanticDiagnostics(name),
    ];
    for (const d of diags) {
      const range =
        (d.start !== undefined ? pf.ranges.find(r => d.start! >= r.start && d.start! < r.end) : undefined) ??
        pf.ranges[0] ??
        null;
      let where = '';
      if (d.file && d.start !== undefined && d.length !== undefined) {
        const near = d.file.getFullText().slice(d.start, d.start + d.length);
        if (near.trim()) where = `（靠近 "${truncate(near)}"）`;
      }
      issues.push({
        passage: pf.passage,
        message:
          `类型错误${where}：${ts.flattenDiagnosticMessageText(d.messageText, ' ')}` +
          `\n    代码：${truncate(range?.code ?? '', 120)}`,
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

function truncate(s: string, max = 60): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/** Passage titles can contain spaces / CJK / symbols; map to a stable, safe
 * file-name stem so snippet files stay stable across edits to other passages. */
function sanitizeFileName(title: string): string {
  const t = title.replace(/[^A-Za-z0-9_]/g, '_');
  return t || 'passage';
}

function indent(code: string): string {
  return code
    .split('\n')
    .map(l => (l.trim() ? '  ' + l : l))
    .join('\n');
}

/** Names of `interface` / `type` exported from vars.ts, so macro signature
 * types can reference them (e.g. `Drink`). */
function exportedTypeNames(source: string): Set<string> {
  const names = new Set<string>();
  try {
    const sf = ts.createSourceFile('vars.ts', source, ts.ScriptTarget.Latest, true);
    for (const st of sf.statements) {
      const mods = (st as ts.InterfaceDeclaration).modifiers;
      if (mods?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) {
          names.add(st.name.text);
        }
      }
    }
  } catch {
    // Fall back to no named types.
  }
  return names;
}

/** Turn a macro-signature type string into one that resolves in the snippet:
 * bare story types (e.g. `Drink`) become `import('./story-vars').Drink`. */
function resolveType(t: string, exported: Set<string>): string {
  if (!exported.size) return t;
  const re = new RegExp(`\\b(${[...exported].join('|')})\\b`, 'g');
  return t.replace(re, `import('./story-vars').$1`);
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
      for (const i of issues) {
        const loc = i.file ? ` (${i.file}${i.line !== undefined ? ':' + (i.line + 1) : ''})` : '';
        console.error(`✗ 段落「${i.passage}」：${i.message}${loc}`);
      }
      console.error(`\n共发现 ${issues.length} 个问题。`);
      process.exit(1);
    })
    .catch(err => {
      console.error('\n' + msg(err));
      process.exit(1);
    });
}
