/**
 * 输入交互基础设施（自包含，随 `milkshake new --with interact` 装进项目）。
 *
 * 提供一组「页面内联」交互控件宏（非弹窗）：
 *   - <<ask name "提示" [number]>>     单行文本输入，提交后写入变量 name
 *   - <<confirm target "问题">>        内联 是/否 按钮，结果布尔写入 target
 *   - <<menu target "问题" "甲" "乙"...>>  内联选项按钮，选中项写入 target
 *
 * 工作机制：宏输出正文时用 `emitHtml` 嵌入一个原生控件槽位（绕过 Markdown
 * 转义，由布局展开成真实 <input>），再用 `emitLink` 发一个「确定 / 选项」按钮；
 * 点击按钮走引擎既有 choose() 循环：执行写入 setup -> 重绘当前段落。
 *
 * 一次问答语义：控件只显示到该段落被回答过一次为止（内部用 _interact 保留
 * 状态记录），因此故事里写一次宏即可，无需额外 <<if>> 包裹。惯用法是每段一个
 * 交互控件。
 *
 * 注意：本文件不 import 引擎，使用结构类型；DOM 仅在函数内访问（Node 侧安全）。
 */

const NS = '_interact';

type InteractVars = { done?: Record<string, boolean> };

export interface EngineLike<T extends object = Record<string, unknown>> {
  state: { variables: T; current?: string };
}
/** 安装器上下文（`makeContext` 结果的结构子集）。宏运行上下文另由 c 提供。 */
export interface CtxLike<T extends object = Record<string, unknown>> {
  engine: EngineLike<T>;
  registerMacro(def: unknown): void;
  registerHelper(name: string, fn: unknown): void;
}
/** 宏运行上下文：用到引擎 MacroContext 的 subset。 */

function ns<T extends object>(engine: EngineLike<T>): InteractVars {
  const vars = engine.state.variables as Record<string, unknown>;
  let s = vars[NS] as InteractVars | undefined;
  if (!s || typeof s !== 'object') {
    s = {};
    vars[NS] = s;
  }
  (s.done ??= {});
  return s;
}

function isDone(engine: EngineLike, key: string): boolean {
  return ns(engine).done?.[key] === true;
}
function setDone(engine: EngineLike, key: string): void {
  ns(engine).done![key] = true;
}

/** 变量名：带引号则剥引号，否则原样（作为 LHS 赋值的标识符名）。 */
function targetName(raw: string): string {
  const m = /^(['"`])(.*)\1$/.exec(raw.trim());
  return m ? m[2] : raw.trim();
}

/** 生成给按钮 setup 用的、把控件当前值写回目标变量的代码。
 * 值取自「当前活动段落」里的控件，避免误读正在淡出的旧段落。 */
function assignSetup(target: string, type: string): string {
  const el = `document.querySelector('#passages .passage:last-child .mk-control')`;
  if (type === 'number') {
    return `${target} = Number((${el} && ${el}.value) || 0);`;
  }
  return `${target} = ${el} ? ${el}.value : '';`;
}

export function install(ctx: CtxLike) {
  // 一次性状态以「段落 + 控件类型 + 目标变量」为键，故需要宏运行上下文 c。
  const keyFor = (c: { passage?: string }, kind: string) => `${c?.passage ?? ''}::${kind}`;
  // 可被按钮 setup 调用的收尾助手：回答后把该控件标为已应答。
  const settle = (key: string) => {
    setDone(ctx.engine, key);
    return '';
  };
  // 注册到引擎作用域，使按钮 setup 字符串里能直接调用 settleKey(...)。
  ctx.registerHelper('settleKey', (k: string) => settle(String(k ?? '')));

  const answerFor = (c: any, kind: string, target: string, valueCode: string): string =>
    `${valueCode} settleKey(${JSON.stringify(keyFor(c, `${kind}:${target}`))});`;

  ctx.registerMacro({
    name: 'ask',
    signature: {
      description: '页面内联单行文本输入；提交后写入变量，段落重绘（每段一次）。',
      params: [
        { name: 'target', type: 'unknown' },
        { name: 'label', type: 'string', optional: true },
        { name: 'type', type: 'unknown', optional: true },
      ],
    },
    run: (c: any) => {
      const a = c.args.trim();
      const first = a.split(/\s+/)[0] ?? '';
      const target = targetName(first);
      const key = keyFor(c, 'ask:' + target);
      if (isDone(ctx.engine, key)) return '';
      // 可选 label 与 type：剥去首词 target 后的剩余参数。
      const rest = a.replace(first, '').trim();
      const toks = splitArgsLocal(rest);
      const label = unquote(toks[0] ?? '"请输入"');
      const type = unquote(toks[1] ?? 'text');
      const inp = c.emitHtml(
        `<span class="mk-ask" data-widget><label>${escHtml(label)}</label> <input class="mk-control" type="${escHtml(type)}"></span>`,
      );
      const btn = c.emitLink({
        kind: 'button',
        label: '确定',
        setup: answerFor(c, 'ask', target, assignSetup(target, type)),
      });
      return inp.marker + ' ' + btn;
    },
  });

  ctx.registerMacro({
    name: 'confirm',
    signature: {
      description: '页面内联是/否按钮；结果布尔写入 target，段落重绘（每段一次）。',
      params: [
        { name: 'target', type: 'unknown' },
        { name: 'question', type: 'string', optional: true },
      ],
    },
    run: (c: any) => {
      const a = c.args.trim();
      const first = a.split(/\s+/)[0] ?? '';
      const target = targetName(first);
      const key = keyFor(c, 'confirm:' + target);
      if (isDone(ctx.engine, key)) return '';
      const rest = a.replace(first, '').trim();
      const q = /^(['"])(.*)\1$/.test(rest) ? rest.slice(1, -1) : rest || '请确认';
      const yes = c.emitLink({
        kind: 'button',
        label: '是',
        setup: answerFor(c, 'confirm', target, `${target} = true;`),
      });
      const no = c.emitLink({
        kind: 'button',
        label: '否',
        setup: answerFor(c, 'confirm', target, `${target} = false;`),
      });
      return `${q} ${yes} ${no}`;
    },
  });

  ctx.registerMacro({
    name: 'menu',
    signature: {
      description: '页面内联选项按钮列表；所选写入 target，段落重绘（每段一次）。',
      params: [
        { name: 'target', type: 'unknown' },
        { name: 'prompt', type: 'string', optional: true },
      ],
      rest: { name: 'options', type: 'string' },
    },
    run: (c: any) => {
      const args = splitArgsLocal(c.args);
      const target = targetName(args[0] ?? '');
      const key = keyFor(c, 'menu:' + target);
      if (isDone(ctx.engine, key)) return '';
      const prompt = unquote(args[1] ?? '请选择');
      const opts = args.slice(2);
      if (!opts.length) throw new Error(`<<menu>> 需要至少一个选项，如 <<menu choice "x" "a" "b">>`);
      const buttons = opts
        .map(o => {
          const v = unquote(o);
          const setup = answerFor(c, 'menu', target, `${target} = ${JSON.stringify(v)};`);
          return c.emitLink({ kind: 'button', label: v, setup });
        })
        .join(' ');
      return `${prompt} ${buttons}`;
    },
  });

  ctx.registerHelper('answered', (name: string) => {
    const cur = ctx.engine.state.current ?? '';
    const done = ns(ctx.engine).done ?? {};
    for (const kind of ['ask', 'confirm', 'menu']) {
      if (done[`${cur}::${kind}:${String(name ?? '')}`]) return true;
    }
    return false;
  });
}

function unquote(t: string): string {
  return /^(['"`])/.test(t) ? t.slice(1, -1) : t;
}

/** 文本进入原生 HTML 槽位前先转义（避免破坏控件标记）。 */
function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 简化参数切分：识别引号与空白（与引擎 splitArgs 行为一致）。 */
function splitArgsLocal(args: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = '';
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (quote) {
      cur += c;
      if (c === '\\' && i + 1 < args.length) cur += args[++i];
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      cur += c;
      continue;
    }
    if (/\s/.test(c)) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
