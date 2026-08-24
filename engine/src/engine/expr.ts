import ts from 'typescript';

export function transpileTS(code: string): string {
  const out = ts.transpileModule(code, {
    fileName: 'milkshake.ts',
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
      strict: false,
    },
  });
  const errors = (out.diagnostics ?? []).filter(
    d => d.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length > 0) {
    throw new Error(errors.map(e => e.messageText).join('; '));
  }
  return out.outputText.trim();
}

const JS_GLOBALS = new Set([
  'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date',
  'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Symbol', 'BigInt',
  'Error', 'TypeError', 'RangeError', 'URIError', 'SyntaxError', 'EvalError',
  'ReferenceError', 'AggregateError', 'parseInt', 'parseFloat', 'isNaN',
  'isFinite', 'NaN', 'Infinity', 'undefined', 'globalThis', 'console',
  'ArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
  'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array',
  'Float64Array', 'BigInt64Array', 'BigUint64Array', 'Function', 'Proxy',
  'Reflect', 'escape', 'unescape', 'decodeURI', 'decodeURIComponent',
  'encodeURI', 'encodeURIComponent', 'window', 'document', 'fetch',
  'WebAssembly', 'Atomics', 'SharedArrayBuffer', 'structuredClone',
]);

function isGlobal(key: string): boolean {
  return JS_GLOBALS.has(key);
}

export interface ScopeHandle {
  scope: any;
  target: Record<string, unknown>;
}

export function createScope(
  base: Record<string, unknown>,
  variables: Record<string, unknown>,
  helpers: ReadonlySet<string>,
  declared?: ReadonlySet<string>,
): ScopeHandle {
  const target: Record<string, unknown> = { ...base };
  const scope = new Proxy(target, {
    has(_t, k) {
      const key = String(k);
      if (key in target) return true;
      if (Object.prototype.hasOwnProperty.call(variables, key)) return true;
      return !isGlobal(key);
    },
    get(_t, k) {
      const key = String(k);
      if (key in target) return target[key];
      if (Object.prototype.hasOwnProperty.call(variables, key)) return variables[key];
      return undefined;
    },
    set(_t, k, v) {
      const key = String(k);
      if (!helpers.has(key) && key in target) {
        target[key] = v;
        return true;
      }
      if (declared && !declared.has(key)) {
        throw new Error(`未声明的变量 "${key}"：请先在 story/vars.ts 中声明`);
      }
      variables[key] = v;
      return true;
    },
    deleteProperty(_t, k) {
      const key = String(k);
      if (key in target) delete target[key];
      else delete variables[key];
      return true;
    },
  });
  return { scope, target };
}

export function evalExpression(scope: any, expr: string, transpile: boolean): unknown {
  let code = expr.trim();
  if (transpile) code = transpileTS(code);
  code = code.replace(/;\s*$/, '');
  const fn = new Function('__scope', `with (__scope) { return (${code}); }`);
  return fn(scope);
}

export function runStatements(scope: any, code: string, transpile: boolean): unknown {
  const js = transpile ? transpileTS(code) : code;
  const fn = new Function('__scope', `with (__scope) { ${js} }`);
  return fn(scope);
}
