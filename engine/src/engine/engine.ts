import { StoryState } from './state.js';
import { createScope, evalExpression, runStatements } from './expr.js';
import { parseNodes, splitArgs } from './parser.js';
import { coreMacros, type MacroContext, type MacroDef } from './macros.js';
import { Passage } from './passage.js';
import type { Embed, Link, Node, PassageSource, RenderResult, StoryOptions, Vars } from '../types.js';

export interface StoryContext<T extends object = Vars> {
  engine: Engine<T>;
  on(event: string, fn: (...args: any[]) => unknown): void;
  registerMacro(def: MacroDef): void;
  registerHelper(name: string, fn: unknown): void;
  addFilter(fn: (text: string) => string): void;
  variables: T;
}

export function random(min?: number, max?: number): number {
  if (min === undefined) return Math.random();
  if (max === undefined) return Math.floor(Math.random() * min) + 1;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function makeContext<T extends object = Vars>(engine: Engine<T>): StoryContext<T> {
  return {
    engine,
    on: (event, fn) => engine.on(event, fn),
    registerMacro: def => engine.registerMacro(def),
    registerHelper: (name, fn) => engine.registerHelper(name, fn),
    addFilter: fn => engine.addFilter(fn),
    // Live view: reset() replaces the whole state object.
    get variables() {
      return engine.state.variables;
    },
  };
}

/** Inline link placeholder markers, replaced with anchors by the layout. */
export const LINK_OPEN = '\uE000';
export const LINK_END = '\uE001';
/** Matches an inline link placeholder: LINK_OPEN + id + LINK_END. */
export const LINK_SENTINEL_RE = /[\uE000](L\d+)[\uE001]/g;
export function linkSentinel(id: string): string {
  return `${LINK_OPEN}${id}${LINK_END}`;
}

/** Inline raw-HTML embed placeholder markers (distinct PUA range from links). */
export const EMBED_OPEN = '\uE010';
export const EMBED_END = '\uE011';
/** Matches an inline embed placeholder: EMBED_OPEN + id + EMBED_END. */
export const EMBED_SENTINEL_RE = /[\uE010](E\d+)[\uE011]/g;
export function embedSentinel(id: string): string {
  return `${EMBED_OPEN}${id}${EMBED_END}`;
}

interface RendCollector {
  links: Link[];
  embeds: Embed[];
  stopped: boolean;
}

type MacroNode = Extract<Node, { kind: 'macro' }>;

export class Engine<T extends object = Vars> {
  readonly options: { name: string; start: string; transpile: boolean; uid?: string };
  state: StoryState<T>;
  pendingNav: string | null = null;
  ask?: (prompt: string) => Promise<string>;

  private rerenderRequested = false;
  private defaultVars?: T;
  private passages = new Map<string, Passage>();
  private macros = new Map<string, MacroDef>();
  private helpers = new Map<string, unknown>();
  private hooks: Record<string, Array<(...args: any[]) => unknown>> = {};
  private filters: Array<(t: string) => string> = [];
  private parseCache = new Map<string, Node[]>();
  private lastRender: RenderResult | null = null;
  private started = false;
  private renderTarget: Record<string, unknown> = {};

  constructor(options: StoryOptions<T> = {}) {
    this.options = {
      name: options.name ?? 'Milkshake Story',
      start: options.start ?? 'Start',
      transpile: options.transpile ?? true,
      uid: options.uid,
    };
    this.defaultVars = options.vars;
    this.state = new StoryState<T>(this.freshVars());
    for (const m of coreMacros) this.registerMacro(m);
  }

  /** Declare the typed variable defaults (usually loaded from story/vars.ts). */
  declareVars(vars: T): void {
    this.defaultVars = vars;
    this.state.variables = this.freshVars();
  }

  get declaredVarNames(): ReadonlySet<string> | undefined {
    return this.defaultVars ? new Set(Object.keys(this.defaultVars)) : undefined;
  }

  private freshVars(): T {
    return (this.defaultVars ? structuredClone(this.defaultVars) : {}) as T;
  }

  registerMacro(def: MacroDef) {
    this.macros.set(def.name, def);
    this.parseCache.clear();
  }

  registerHelper(name: string, fn: unknown) {
    this.helpers.set(name, fn);
  }

  addFilter(fn: (t: string) => string) {
    this.filters.push(fn);
  }

  on(event: string, fn: (...args: any[]) => unknown) {
    (this.hooks[event] ??= []).push(fn);
  }

  private async emit(event: string, data: Record<string, unknown>): Promise<unknown> {
    let last: unknown;
    for (const h of this.hooks[event] ?? []) last = await h(data);
    return last;
  }

  loadPassages(sources: PassageSource[]) {
    for (const s of sources) {
      this.parseCache.delete(s.title);
      this.passages.set(s.title, new Passage(s));
    }
    for (const pass of this.passages.values()) {
      this.nodesFor(pass);
      this.registerWidgets(pass);
    }
  }

  getPassage(name: string): Passage | undefined {
    return this.passages.get(name);
  }

  get passageTitles(): string[] {
    return [...this.passages.keys()];
  }

  nodesFor(pass: Passage): Node[] {
    let nodes = this.parseCache.get(pass.title);
    if (!nodes) {
      nodes = parseNodes(pass.source, { blockMacros: this.blockMacroNames() });
      this.parseCache.set(pass.title, nodes);
    }
    return nodes;
  }

  private blockMacroNames(): Set<string> {
    const s = new Set<string>();
    for (const m of this.macros.values()) if (m.block) s.add(m.name);
    return s;
  }

  private buildBase(): { base: Record<string, unknown>; helperNames: Set<string> } {
    const base: Record<string, unknown> = {
      vars: this.state.variables,
      state: this.state,
      engine: this,
      passage: () => this.state.current,
      turns: () => this.state.turns,
      history: () => [...this.state.history],
      visited: (name: string) => this.state.visited(name),
      random,
      dice: (n?: number) => random(n),
      set: <K extends string & keyof T>(k: K, v: T[K]) => {
        this.state.variables[k] = v;
      },
      get: <K extends string & keyof T>(k: K): T[K] => this.state.variables[k],
      has: (k: string) => Object.prototype.hasOwnProperty.call(this.state.variables, k),
      str: (v: unknown) => this.stringify(v),
      // Navigation / render control, available to click handlers (link/button
      // setup) and scripts. A handler that calls `navigate`/`back` moves the
      // story; one that calls `rerender` (or a button that does neither) stays
      // put and redraws the current passage.
      navigate: (target: string) => {
        this.pendingNav = target;
      },
      back: () => {
        this.pendingNav = '__back__';
      },
      rerender: () => {
        this.rerenderRequested = true;
      },
    };
    const helperNames = new Set(Object.keys(base));
    for (const [k, v] of this.helpers) {
      base[k] = v;
      helperNames.add(k);
    }
    return { base, helperNames };
  }

  buildScope(): any {
    const { base, helperNames } = this.buildBase();
    const handle = createScope(
      base,
      this.state.variables as Record<string, unknown>,
      helperNames,
      this.declaredVarNames,
    );
    this.renderTarget = handle.target;
    return handle.scope;
  }

  private captureScope(): Record<string, unknown> | undefined {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(this.renderTarget)) out[k] = this.renderTarget[k];
    return Object.keys(out).length ? out : undefined;
  }

  evalExpr(expr: string, scope?: any): unknown {
    const inner = expr.trim().match(/^\$\{(.+)\}$/s);
    if (inner) expr = inner[1];
    return evalExpression(scope ?? this.buildScope(), expr, this.options.transpile);
  }

  runScript(code: string, scope?: any): void {
    runStatements(scope ?? this.buildScope(), code, this.options.transpile);
  }

  stringify(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') {
      // Arrays / plain objects are shown as JSON so story authors don't get
      // "[object Object]" in interpolation or <<print>> output.
      try {
        return JSON.stringify(v);
      } catch {
        // Circular refs, etc.
      }
    }
    return String(v);
  }

  private registerWidgets(pass: Passage) {
    for (const node of this.nodesFor(pass)) {
      if (node.kind !== 'macro' || node.name !== 'widget') continue;
      const tokens = splitArgs(node.args);
      if (!tokens.length) throw new Error(`widget needs a name: ${node.args}`);
      const nameTok = tokens[0];
      const name = /^['"`]/.test(nameTok) ? this.stringify(this.evalExpr(nameTok)) : nameTok;
      const params = tokens.slice(1);
      const body = node.content ?? [];
      this.registerMacro({
        name,
        run: async ctx => {
          const callTokens = splitArgs(ctx.args);
          for (let i = 0; i < params.length; i++) {
            ctx.declareLocal(params[i], callTokens[i] !== undefined ? ctx.eval(callTokens[i]) : undefined);
          }
          return ctx.render(body);
        },
      });
    }
  }

  private async renderNodes(
    nodes: Node[],
    scope: any,
    passage: string,
    rc: RendCollector,
  ): Promise<string> {
    let out = '';
    for (const node of nodes) {
      if (rc.stopped) break;
      switch (node.kind) {
        case 'text':
          out += node.text;
          break;
        case 'interp':
          out += this.stringify(this.evalExpr(node.expr, scope));
          break;
        case 'link': {
          const id = 'L' + rc.links.length;
          rc.links.push({
            id,
            kind: 'link',
            label: node.label,
            target: node.target,
            setup: node.setup,
            captured: this.captureScope(),
          });
          out += linkSentinel(id);
          break;
        }
        case 'macro': {
          const def = this.macros.get(node.name);
          if (!def) {
            const code = node.args ? `${node.name} ${node.args}` : node.name;
            try {
              this.runScript(code, scope);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              throw new Error(
                `unknown macro <<${node.name}>> in "${passage}" (tried to run as code: ${code}) ${msg}`,
              );
            }
            break;
          }
          const res = await def.run(this.makeCtx(def, node, scope, passage, rc));
          if (typeof res === 'string') out += res;
          break;
        }
      }
    }
    return out;
  }

  private makeCtx(
    def: MacroDef,
    node: MacroNode,
    scope: any,
    passage: string,
    rc: RendCollector,
  ): MacroContext {
    const engine = this;
    return {
      engine,
      scope,
      passage,
      args: node.args,
      content: node.content ?? null,
      branches: node.branches,
      eval: (expr: string) => engine.evalExpr(expr, scope),
      evalStr: (expr: string) => engine.stringify(engine.evalExpr(expr, scope)),
      runScript: (code: string) => {
        engine.runScript(code, scope);
      },
      render: (ns: Node[]) => engine.renderNodes(ns, scope, passage, rc),
      emitLink: l => {
        const id = 'L' + rc.links.length;
        rc.links.push({ id, ...l, captured: engine.captureScope() });
        return linkSentinel(id);
      },
      emitHtml: html => {
        const id = 'E' + rc.embeds.length;
        rc.embeds.push({ id, html });
        return { marker: embedSentinel(id), id };
      },
      navigate: (t: string) => {
        engine.pendingNav = t;
      },
      stop: () => {
        rc.stopped = true;
      },
      declareLocal: (name, value) => {
        engine.renderTarget[name] = value;
      },
    };
  }

  /** Render a passage in place without touching history or the current passage. */
  async renderPassage(name: string): Promise<RenderResult> {
    const pass = this.passages.get(name);
    if (!pass) throw new Error(`no passage named "${name}"`);
    const scope = this.buildScope();
    const rc: RendCollector = { links: [], embeds: [], stopped: false };
    const text = await this.renderNodes(this.nodesFor(pass), scope, name, rc);
    const result: RenderResult = { passage: name, text, links: rc.links, embeds: rc.embeds };
    result.text = this.applyFilters(result.text);
    return result;
  }

  async renderCurrent(): Promise<RenderResult> {
    const redirect = await this.emit('passage:before', { name: this.state.current });
    if (typeof redirect === 'string') this.state.current = redirect;
    const name = this.state.current;
    if (!name) throw new Error('no current passage');
    const pass = this.passages.get(name);
    if (!pass) throw new Error(`no passage named "${name}"`);
    const nodes = this.nodesFor(pass);
    const scope = this.buildScope();
    const rc: RendCollector = { links: [], embeds: [], stopped: false };
    const text = await this.renderNodes(nodes, scope, name, rc);
    const result: RenderResult = { passage: name, text, links: rc.links, embeds: rc.embeds };
    await this.emit('passage:after', { name, text, result });
    result.text = this.applyFilters(result.text);
    this.lastRender = result;
    return result;
  }

  async transition(target: string): Promise<RenderResult> {
    if (!this.passages.has(target)) throw new Error(`no passage named "${target}"`);
    this.state.recordEnter(target);
    this.pendingNav = null;
    return this.renderCurrent();
  }

  async start(name?: string): Promise<RenderResult> {
    if (!this.started) {
      this.started = true;
      await this.emit('story:init', {});
      const init = this.passages.get('StoryInit');
      if (init) {
        const scope = this.buildScope();
        const rc: RendCollector = { links: [], embeds: [], stopped: false };
        await this.renderNodes(this.nodesFor(init), scope, 'StoryInit', rc);
      }
    }
    return this.transition(name ?? this.options.start);
  }

  async choose(id: string): Promise<RenderResult | null> {
    if (!this.lastRender) return null;
    const link = this.lastRender.links.find(l => l.id === id);
    if (!link) return null;
    // Clear the effect channels so we can observe what *this* click requests.
    this.pendingNav = null;
    this.rerenderRequested = false;
    if (link.setup) {
      if (link.captured) {
        const { base, helperNames } = this.buildBase();
        const handle = createScope(
          { ...base, ...link.captured },
          this.state.variables as Record<string, unknown>,
          helperNames,
          this.declaredVarNames,
        );
        this.runScript(link.setup, handle.scope);
      } else {
        this.runScript(link.setup);
      }
    }
    // The handler decides the outcome: an explicit navigate/back wins, then an
    // explicit rerender; otherwise links follow their target and buttons redraw
    // the current passage in place (no new history entry / turn).
    if (this.pendingNav !== null) return this.consumePendingNav();
    if (this.rerenderRequested || link.kind === 'button') return this.renderCurrent();
    return this.transition(link.target!);
  }

  async consumePendingNav(): Promise<RenderResult | null> {
    const t = this.pendingNav;
    if (t === null) return null;
    this.pendingNav = null;
    if (t === '__back__') return this.transition(this.state.previous ?? this.options.start);
    return this.transition(t);
  }

  reset(): void {
    this.state = new StoryState<T>(this.freshVars());
    this.lastRender = null;
    this.pendingNav = null;
    this.rerenderRequested = false;
    this.started = false;
  }

  private applyFilters(text: string): string {
    let t = text;
    for (const f of this.filters) t = f(t);
    return t;
  }
}
