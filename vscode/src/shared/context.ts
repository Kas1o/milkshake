/** Completion context detected from the text before the cursor. */
export type CompletionContext =
  | { kind: 'macro-name'; prefix: string }
  | { kind: 'passage-title'; prefix: string }
  | { kind: 'identifier' }
  | { kind: 'none' };

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
