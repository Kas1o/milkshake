import type { CondBranch, Node } from '../types.js';

export interface ParseOptions {
  blockMacros: ReadonlySet<string>;
}

interface Frame {
  name: string;
  args: string;
  branches: CondBranch[];
  raw?: boolean;
}

const CLOSER_ALIASES: Record<string, string> = {
  endif: 'if',
  endfor: 'for',
  endscript: 'script',
  endwidget: 'widget',
  endbutton: 'button',
};

export function parseNodes(source: string, opts: ParseOptions): Node[] {
  const root: Node[] = [];
  const stack: Frame[] = [];
  let buf = '';
  let i = 0;
  const n = source.length;

  const list = (): Node[] => {
    if (!stack.length) return root;
    const f = stack[stack.length - 1];
    return f.branches[f.branches.length - 1].nodes;
  };
  const flush = () => {
    if (!buf.length) return;
    list().push({ kind: 'text', text: buf });
    buf = '';
  };
  const push = (node: Node) => {
    flush();
    list().push(node);
  };
  const closeTop = (): Frame => {
    flush();
    return stack.pop()!;
  };

  const isCloser = (name: string): boolean =>
    name.startsWith('/') || name === 'end' || name in CLOSER_ALIASES || name.startsWith('end');

  while (i < n) {
    const top = stack[stack.length - 1];

    if (top?.raw) {
      const idx = source.indexOf('<<', i);
      if (idx === -1) {
        buf += source.slice(i);
        i = n;
        break;
      }
      let tokenName: string;
      let tokenEnd: number;
      try {
        const m = readMacro(source, idx);
        tokenName = m.name;
        tokenEnd = m.end;
      } catch {
        buf += source.slice(i, idx + 2);
        i = idx + 2;
        continue;
      }
      if (closesRaw(tokenName, top.name)) {
        buf += source.slice(i, idx);
        i = tokenEnd;
        const f = closeTop();
        list().push({ kind: 'macro', name: f.name, args: f.args, content: f.branches[0].nodes });
        continue;
      }
      buf += source.slice(i, tokenEnd);
      i = tokenEnd;
      continue;
    }

    if (source.startsWith('<<', i)) {
      const m = readMacro(source, i);
      i = m.end;
      const rawName = m.name;

      if (isCloser(rawName)) {
        if (!stack.length) throw new Error(`unexpected closing <</${rawName.replace(/^\//, '')}>>`);
        const top2 = stack[stack.length - 1];
        let closeName = '';
        if (rawName.startsWith('/')) closeName = rawName.slice(1);
        else if (rawName === 'end') closeName = top2.name;
        else if (rawName in CLOSER_ALIASES) closeName = CLOSER_ALIASES[rawName];
        else if (rawName.startsWith('end')) closeName = rawName.slice(3);
        if (closeName !== top2.name) {
          throw new Error(
            `closing <</${rawName.replace(/^\//, '')}>> does not match <<${top2.name}>>`,
          );
        }
        const f = closeTop();
        if (f.name === 'if') f.branches[0].test = f.args;
        const node: Node =
          f.name === 'if'
            ? { kind: 'macro', name: 'if', args: f.args, branches: f.branches }
            : { kind: 'macro', name: f.name, args: f.args, content: f.branches[0].nodes };
        list().push(node);
        continue;
      }

      if (rawName === 'elseif' || rawName === 'else') {
        const top2 = stack[stack.length - 1];
        if (!top2 || top2.name !== 'if') throw new Error(`<<${rawName}>> outside of <<if>>`);
        flush();
        top2.branches.push({ test: rawName === 'else' ? undefined : m.args, nodes: [] });
        continue;
      }

      if (opts.blockMacros.has(rawName)) {
        flush();
        stack.push({
          name: rawName,
          args: m.args,
          branches: [{ nodes: [] }],
          raw: rawName === 'script' || rawName === 'button',
        });
        continue;
      }

      push({ kind: 'macro', name: rawName, args: m.args });
      continue;
    }

    if (source.startsWith('${', i)) {
      const b = readBraces(source, i + 1);
      push({ kind: 'interp', expr: b.inner });
      i = b.end;
      continue;
    }

    if (source.startsWith('[[', i)) {
      const b = readBrackets(source, i);
      push(parseLink(b.inner));
      i = b.end;
      continue;
    }

    buf += source[i];
    i++;
  }

  if (stack.length) throw new Error(`unclosed block <<${stack[stack.length - 1].name}>>`);
  flush();
  return root;
}

function closesRaw(name: string, topName: string): boolean {
  if (name === 'end') return true;
  if (name.startsWith('/')) return name.slice(1) === topName;
  if (name.startsWith('end')) return name.slice(3) === topName;
  return false;
}

function readMacro(src: string, start: number): { name: string; args: string; end: number } {
  let j = start + 2;
  const n = src.length;
  let quote = '';
  let depth = 0;
  while (j < n) {
    const c = src[j];
    if (quote) {
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === quote) quote = '';
      j++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      j++;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      depth++;
      j++;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      j++;
      continue;
    }
    if (c === '>' && src[j + 1] === '>' && depth === 0) {
      const inner = src.slice(start + 2, j).trim();
      const sp = inner.search(/\s/);
      const name = inner.slice(0, sp === -1 ? inner.length : sp);
      const args = sp === -1 ? '' : inner.slice(sp).trim();
      return { name, args, end: j + 2 };
    }
    j++;
  }
  throw new Error('Unclosed macro');
}

function readBraces(src: string, start: number): { inner: string; end: number } {
  let j = start;
  const n = src.length;
  let depth = 0;
  let quote = '';
  while (j < n) {
    const c = src[j];
    if (quote) {
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === quote) quote = '';
      j++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      j++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return { inner: src.slice(start + 1, j), end: j + 1 };
    }
    j++;
  }
  throw new Error('Unclosed ${');
}

function readBrackets(src: string, start: number): { inner: string; end: number } {
  let j = start + 2;
  const n = src.length;
  let quote = '';
  let depth = 0;
  while (j < n) {
    const c = src[j];
    if (quote) {
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === quote) quote = '';
      j++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      j++;
      continue;
    }
    if (c === '[') {
      depth++;
      j++;
      continue;
    }
    if (c === ']') {
      if (depth === 0) {
        if (src[j + 1] === ']') {
          return { inner: src.slice(start + 2, j), end: j + 2 };
        }
        if (src[j + 1] === '[') {
          j += 2;
          continue;
        }
        throw new Error('Malformed link');
      }
      depth--;
    }
    j++;
  }
  throw new Error('Unclosed link');
}

function splitLinkParts(inner: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let quote = '';
  let depth = 0;
  const n = inner.length;
  for (let i = 0; i < n; i++) {
    const c = inner[i];
    if (quote) {
      cur += c;
      if (c === '\\') {
        i++;
        cur += inner[i] ?? '';
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
    if (c === '[') {
      depth++;
      cur += c;
      continue;
    }
    if (c === ']') {
      if (depth === 0 && inner[i + 1] === '[') {
        parts.push(cur.trim());
        cur = '';
        i++;
        continue;
      }
      if (depth > 0) depth--;
      cur += c;
      continue;
    }
    cur += c;
  }
  parts.push(cur.trim());
  return parts;
}

function parseLink(inner: string): Node {
  const parts = splitLinkParts(inner);
  const head = parts[0] ?? '';
  const setup = parts.length > 1 ? parts[1] : undefined;
  let label = head;
  let target = head;
  const arrow = head.lastIndexOf('->');
  const bar = head.lastIndexOf('|');
  if (arrow > -1 && (bar === -1 || arrow > bar)) {
    label = head.slice(0, arrow);
    target = head.slice(arrow + 2);
  } else if (bar > -1) {
    label = head.slice(0, bar);
    target = head.slice(bar + 1);
  }
  return { kind: 'link', label, target, setup };
}

export function splitArgs(args: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = '';
  let depth = 0;
  const n = args.length;
  for (let i = 0; i < n; i++) {
    const c = args[i];
    if (quote) {
      cur += c;
      if (c === '\\') {
        if (i + 1 < n) {
          cur += args[i + 1];
          i++;
        }
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
    if (/\s/.test(c) && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
