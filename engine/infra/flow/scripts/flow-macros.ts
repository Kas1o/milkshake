/**
 * 流程控制基础设施（自包含，随 `milkshake new --with flow` 装进项目）。
 *
 * 提供一组流程 / 状态宏，故事脚本无需重复手写：
 *   - <<visitOnce>>  块内容整局只渲染一次（可选按名称命名）
 *   - <<ifVisited>> / <<ifNotVisited>>  按段落访问次数分支
 *   - <<counter>> / <<resetCounter>>    具名计数器
 *   - count(name) 助手（表达式内读取；visited() 为引擎内建）
 *
 * 存储约定：全部状态放在 `engine.state.variables` 下保留命名空间 `_flow`
 * （一个普通对象）。直接写该对象不会触发「未声明变量」拦截；它随 variables
 * 一起被存档系统序列化、并在「重新开始」时被引擎重新克隆清零。
 *
 * 注意：本文件不 import 引擎，使用结构类型（check/build 运行时剥离类型）。
 */

/** 保留命名空间在 variables 里的键名。 */
const NS = '_flow';

type FlowVars = {
  /** visitOnce 是否已触发（name -> true） */
  once?: Record<string, boolean>;
  /** 具名计数器（name -> value） */
  counters?: Record<string, number>;
};

/** 引擎结构：只声明用到的字段。 */
export interface EngineLike<T extends object = Record<string, unknown>> {
  state: { variables: T };
}
/** 安装器上下文（`makeContext` 结果的结构子集）。宏运行上下文另由 c 提供。 */
export interface CtxLike<T extends object = Record<string, unknown>> {
  engine: EngineLike<T>;
  registerMacro(def: unknown): void;
  registerHelper(name: string, fn: unknown): void;
}

/** 取（必要时初始化）variables 上的 _flow 保留对象。直接改普通对象以绕过
 * 未声明变量拦截——这些是内部状态，无需在 vars.ts 声明。 */
function ns<T extends object>(engine: EngineLike<T>): FlowVars {
  const vars = engine.state.variables as Record<string, unknown>;
  let f = vars[NS] as FlowVars | undefined;
  if (!f || typeof f !== 'object') {
    f = {};
    vars[NS] = f;
  }
  (f.once ??= {});
  (f.counters ??= {});
  return f;
}

/** 首个参数是计数器的名字：带引号则剥引号取字面量，否则按原样使用。
 * 不 eval，避免 `<<counter gold>>` 被当成变量读取。 */
function tokenName(raw: string): string {
  const m = /^(['"`])(.*)\1$/.exec(raw.trim());
  return m ? m[2] : raw.trim();
}

export function visitOnceKey(engine: EngineLike, name: string): boolean {
  return ns(engine).once?.[name] === true;
}

export function markVisitedOnce(engine: EngineLike, name: string): void {
  ns(engine).once![name] = true;
}

/** 读取具名计数器的当前值（未设则 0）。 */
export function readCount(engine: EngineLike, name: string): number {
  return ns(engine).counters?.[name] ?? 0;
}

/** 给具名计数器加 delta（默认 +1）。返回新值。 */
export function addCount(engine: EngineLike, name: string, delta: number): number {
  const c = ns(engine).counters!;
  c[name] = Math.max(0, (c[name] ?? 0) + (Number.isFinite(delta) ? delta : 1));
  return c[name];
}

/** 重置（或设为 value）。返回新值。 */
export function resetCount(engine: EngineLike, name: string, value = 0): number {
  const c = ns(engine).counters!;
  c[name] = Number.isFinite(value) ? Math.max(0, value) : 0;
  return c[name];
}

export function install(ctx: CtxLike) {
  ctx.registerMacro({
    name: 'visitOnce',
    block: true,
    signature: {
      description: '块内容整局只渲染一次（可选 name；缺省取所在段落名）。',
      params: [{ name: 'name', type: 'string', optional: true }],
    },
    run: async (c: any) => {
      const key = (c.args?.trim() ? c.evalStr(c.args) : c.passage) || c.passage || '';
      if (visitOnceKey(ctx.engine, key)) return '';
      markVisitedOnce(ctx.engine, key);
      return await c.render(c.content ?? []);
    },
  });

  ctx.registerMacro({
    name: 'ifVisited',
    block: true,
    signature: {
      description: '若段落已被访问过则渲染块内容。',
      params: [{ name: 'passage', type: 'string' }],
    },
    run: async (c: any) => {
      const p = c.evalStr(c.args);
      const state = ctx.engine.state as { visits?: Map<string, number>; visited?: (n: string) => number };
      const n = state.visits?.get?.(p) ?? state.visited?.(p) ?? 0;
      if (n > 0) return await c.render(c.content ?? []);
      return '';
    },
  });

  ctx.registerMacro({
    name: 'ifNotVisited',
    block: true,
    signature: {
      description: '若段落尚未被访问过则渲染块内容。',
      params: [{ name: 'passage', type: 'string' }],
    },
    run: async (c: any) => {
      const p = c.evalStr(c.args);
      const state = ctx.engine.state as { visits?: Map<string, number>; visited?: (n: string) => number };
      const n = state.visits?.get?.(p) ?? state.visited?.(p) ?? 0;
      if (n === 0) return await c.render(c.content ?? []);
      return '';
    },
  });

  ctx.registerMacro({
    name: 'counter',
    signature: {
      description: '给具名计数器加 delta（默认 +1），返回 void。可用 ${count("x")} 读取。',
      params: [
        { name: 'name', type: 'unknown' },
        { name: 'delta', type: 'number', optional: true },
      ],
    },
    run: (c: any) => {
      const a = (c.args ?? '').trim();
      const m = a.match(/^(\S+)(?:\s+(.+))?$/);
      const name = m ? tokenName(m[1]) : '';
      const delta = m && m[2] ? Number(c.eval(m[2])) : 1;
      addCount(ctx.engine, name, delta);
      return '';
    },
  });

  ctx.registerMacro({
    name: 'resetCounter',
    signature: {
      description: '把具名计数器重置为 0（或给定 value）。',
      params: [
        { name: 'name', type: 'unknown' },
        { name: 'value', type: 'number', optional: true },
      ],
    },
    run: (c: any) => {
      const a = (c.args ?? '').trim();
      const m = a.match(/^(\S+)(?:\s+(.+))?$/);
      const name = m ? tokenName(m[1]) : '';
      const value = m && m[2] ? Number(c.eval(m[2])) : 0;
      resetCount(ctx.engine, name, value);
      return '';
    },
  });

  ctx.registerHelper('count', (name: string) => readCount(ctx.engine, String(name ?? '')));
}
