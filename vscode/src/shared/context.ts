/** Completion context detected from the text before the cursor. */
export type CompletionContext =
  | { kind: 'macro-name'; prefix: string }
  | { kind: 'macro-arg'; macro: string; argIndex: number }
  | { kind: 'passage-title'; prefix: string }
  | { kind: 'identifier' }
  | { kind: 'none' };

/** Split macro args typed so far (quote/bracket aware), returning the arg at
 * the cursor (or null if none / the cursor is on a fresh arg). */
function typedArgs(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = '';
  let depth = 0;
  for (const c of text) {
    if (quote) {
      cur += c;
      if (c === '\\') continue;
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
      if (depth > 0) depth--;
      cur += c;
      continue;
    }
    if (/\s/.test(c) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

export function detectCompletionContext(textBefore: string): CompletionContext {
  // <<goto "X" / <<display "X">: completing a passage title.
  const nav = textBefore.match(/<<(?:goto|display)\s+["']?([^"'<>]*)$/);
  if (nav) return { kind: 'passage-title', prefix: nav[1] };

  const lastMacro = textBefore.lastIndexOf('<<');
  const lastLink = textBefore.lastIndexOf('[[');
  const lastInterp = textBefore.lastIndexOf('${');
  const latest = Math.max(lastMacro, lastLink, lastInterp);
  if (latest < 0) return { kind: 'none' };

  if (latest === lastMacro) {
    const inner = textBefore.slice(lastMacro + 2);
    if (inner.includes('>>')) return { kind: 'none' };
    // Right after << (or <</): completing the macro name itself.
    const name = inner.match(/^\/?\s*([A-Za-z_][\w-]*)?$/);
    if (name) return { kind: 'macro-name', prefix: name[1] ?? '' };
    // Inside a macro's argument list — report the current parameter index so
    // completions can be type-aware (e.g. suggest passage titles for strings).
    const m = inner.match(/^\/?\s*([A-Za-z_][\w-]*)\s+(.*)$/);
    if (m) {
      const args = typedArgs(m[2]);
      // A trailing space (or open quote) means the cursor is starting a new arg.
      const startingNew = /[\s'"`([]{0,1}$/.test(m[2]) && /[\s]$/.test(m[2]);
      const argIndex = startingNew ? args.length : Math.max(args.length - 1, 0);
      return { kind: 'macro-arg', macro: m[1], argIndex };
    }
    return { kind: 'identifier' };
  }

  if (latest === lastLink) {
    const inner = textBefore.slice(lastLink + 2);
    if (inner.includes(']]')) return { kind: 'none' };
    const arrow = inner.lastIndexOf('->');
    if (arrow >= 0) {
      const target = inner.slice(arrow + 2);
      // After a `[` we are inside the setup part, not the target.
      if (!target.includes('[')) return { kind: 'passage-title', prefix: target.replace(/^\s+/, '') };
    }
    return { kind: 'none' };
  }

  // ${...} interpolation: expression identifiers.
  const inner = textBefore.slice(lastInterp + 2);
  if (inner.includes('}')) return { kind: 'none' };
  return { kind: 'identifier' };
}

/** Find `<<name` starting at or before `character` on a line. */
export function macroNameAtLine(line: string, character: number): string | null {
  for (const m of line.matchAll(/<<(\/)?\s*([A-Za-z_][\w-]*)/g)) {
    const start = m.index!;
    const name = m[2];
    const end = start + m[0].length;
    if (character >= start && character <= end) return name;
  }
  return null;
}

/** The identifier word (`[A-Za-z_$][\w$]*`) under the cursor, if any. */
export function wordAt(line: string, character: number): string | null {
  const m = line.match(/[A-Za-z_$][\w$]*/g);
  if (!m) return null;
  let consumed = 0;
  for (const w of m) {
    const idx = line.indexOf(w, consumed);
    const start = idx;
    const end = idx + w.length;
    if (character >= start && character <= end) return w;
    consumed = end;
  }
  return null;
}

export interface PassageRef {
  target: string;
  /** Character range of the target text within the line. */
  start: number;
  end: number;
}

/** Find the passage reference ([[...->T]] or <<goto/display "T">>) at a position. */
export function findPassageRefAt(lineText: string, character: number): PassageRef | null {
  for (const m of lineText.matchAll(/\[\[[^\[\]]*?\]\]/g)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (character < start || character > end) continue;
    const inner = m[0].slice(2, -2);
    const arrow = inner.lastIndexOf('->');
    const targetStart = start + 2 + (arrow >= 0 ? arrow + 2 : 0);
    return targetRange(inner.slice(arrow >= 0 ? arrow + 2 : 0), targetStart);
  }
  for (const m of lineText.matchAll(/<<(?:goto|display)\s+(["'])([^"']*)\1/g)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (character < start || character > end) continue;
    return targetRange(m[2], m.index! + m[0].indexOf(m[1]) + 1);
  }
  return null;
}

function targetRange(raw: string, offset: number): PassageRef | null {
  const bracket = raw.indexOf('[');
  const part = bracket >= 0 ? raw.slice(0, bracket) : raw;
  const lead = part.match(/^\s*/)?.[0].length ?? 0;
  const target = part.trim();
  if (!target) return null;
  return { target, start: offset + lead, end: offset + lead + target.length };
}
