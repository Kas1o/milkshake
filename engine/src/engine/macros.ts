import type { CondBranch, Node } from '../types.js';
import type { Engine } from './engine.js';

export interface MacroContext {
  // Widened to any: macros only touch var-agnostic engine APIs.
  engine: Engine<any>;
  scope: any;
  passage: string;
  args: string;
  content: Node[] | null;
  branches?: CondBranch[];
  eval(expr: string): unknown;
  evalStr(expr: string): string;
  runScript(code: string): void;
  render(nodes: Node[]): Promise<string>;
  emitLink(link: { kind: 'link' | 'button'; label: string; target?: string; setup?: string }): string;
  navigate(target: string): void;
  stop(): void;
  declareLocal(name: string, value: unknown): void;
}

export interface MacroDef {
  name: string;
  block?: boolean;
  raw?: boolean;
  run(ctx: MacroContext): void | string | Promise<void | string>;
}

export function truthy(v: unknown): boolean {
  return !!v;
}

export function rawText(nodes: Node[] | null): string {
  if (!nodes) return '';
  return nodes.map(x => (x.kind === 'text' ? x.text : '')).join('');
}

function splitTopSemicolons(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = '';
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === '\\') {
        i++;
        cur += s[i] ?? '';
        continue;
      }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      cur += c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      depth++;
      cur += c;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      cur += c;
      continue;
    }
    if (c === ';' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

export const coreMacros: MacroDef[] = [
  { name: 'set', run: ctx => { ctx.runScript(ctx.args); return ''; } },
  { name: 'run', run: ctx => { ctx.runScript(ctx.args); return ''; } },
  { name: 'print', run: ctx => ctx.evalStr(ctx.args) },
  { name: '=', run: ctx => ctx.evalStr(ctx.args) },
  { name: 'comment', run: () => '' },
  { name: 'stop', run: ctx => { ctx.stop(); return ''; } },
  {
    name: 'display',
    run: ctx => {
      const name = ctx.evalStr(ctx.args);
      const pass = ctx.engine.getPassage(name);
      if (!pass) throw new Error(`<<display>>: no passage "${name}"`);
      return ctx.render(ctx.engine.nodesFor(pass));
    },
  },
  { name: 'goto', run: ctx => { ctx.navigate(ctx.evalStr(ctx.args)); return ''; } },
  { name: 'return', run: ctx => { ctx.navigate('__back__'); return ''; } },
  { name: 'back', run: ctx => { ctx.navigate('__back__'); return ''; } },
  {
    name: 'script',
    block: true,
    raw: true,
    run: ctx => { ctx.runScript(rawText(ctx.content)); return ''; },
  },
  {
    name: 'if',
    block: true,
    run: async ctx => {
      for (const b of ctx.branches ?? []) {
        if (b.test !== undefined && !truthy(ctx.eval(b.test))) continue;
        return ctx.render(b.nodes);
      }
      return '';
    },
  },
  {
    name: 'for',
    block: true,
    run: async ctx => {
      const a = ctx.args.trim();
      if (!a) return '';
      const m = a.match(/^(\w+)\s+(of|in)\s+(.+)$/);
      if (m) {
        const [, varName, op, expr] = m;
        const val: any = ctx.eval(expr);
        if (val == null) return '';
        let out = '';
        if (op === 'of') {
          const iter = typeof val[Symbol.iterator] === 'function' ? val : [val];
          for (const item of iter) {
            ctx.declareLocal(varName, item);
            out += await ctx.render(ctx.content ?? []);
          }
        } else {
          for (const k in val) {
            ctx.declareLocal(varName, k);
            out += await ctx.render(ctx.content ?? []);
          }
        }
        return out;
      }
      const m2 = a.match(/^(\w+)\s+(from|upto|until|to|downto)\s+(.+)$/);
      if (m2) {
        const [, varName, kind, rest] = m2;
        let from: unknown = 1;
        let to: unknown;
        let step = 1;
        let inclusive = true;
        if (kind === 'to' || kind === 'upto' || kind === 'until') {
          to = ctx.eval(rest);
          if (kind === 'until') inclusive = false;
        } else if (kind === 'downto') {
          to = ctx.eval(rest);
          step = -1;
        } else {
          const mm = rest.match(/^(.+?)\s+(upto|until|to|downto)\s+(.+)$/);
          if (!mm) throw new Error(`bad <<for>> syntax: ${a}`);
          from = ctx.eval(mm[1]);
          to = ctx.eval(mm[3]);
          if (mm[2] === 'downto') step = -1;
          if (mm[2] === 'until') inclusive = false;
        }
        let out = '';
        let guard = 0;
        const nf = Number(from);
        const nt = Number(to);
        for (let v = nf; step > 0 ? (inclusive ? v <= nt : v < nt) : (inclusive ? v >= nt : v > nt); v += step) {
          ctx.declareLocal(varName, v);
          out += await ctx.render(ctx.content ?? []);
          if (++guard > 1_000_000) throw new Error('<<for>>: too many iterations');
        }
        return out;
      }
      const parts = splitTopSemicolons(a);
      if (parts.length === 3) {
        const [init, cond, step] = parts;
        const m3 = init.match(/^\s*([A-Za-z_$][\w$]*)\s*=/);
        if (m3) ctx.declareLocal(m3[1], undefined);
        if (init) ctx.runScript(init);
        let out = '';
        let guard = 0;
        for (;;) {
          if (cond && !truthy(ctx.eval(cond))) break;
          out += await ctx.render(ctx.content ?? []);
          if (step) ctx.runScript(step);
          if (++guard > 1_000_000) throw new Error('<<for>>: too many iterations');
        }
        return out;
      }
      throw new Error(`bad <<for>> syntax: ${a}`);
    },
  },
  {
    name: 'link',
    block: true,
    run: async ctx => {
      const label = ctx.evalStr(ctx.args);
      const target = (await ctx.render(ctx.content ?? [])).trim();
      if (!target) throw new Error('<<link>> produced an empty target');
      return ctx.emitLink({ kind: 'link', label, target });
    },
  },
  {
    name: 'button',
    block: true,
    raw: true,
    run: ctx => {
      const label = ctx.evalStr(ctx.args);
      return ctx.emitLink({ kind: 'button', label, setup: rawText(ctx.content) });
    },
  },
  { name: 'widget', block: true, run: () => '' },
];
