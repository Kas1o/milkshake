import { Hover, MarkupContent } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { StoryInfo } from '../../../engine/src/check.js';

/** Find `<<name` starting at or before `character` on a line. */
function macroNameAtLine(line: string, character: number): string | null {
  for (const m of line.matchAll(/<<(\/)?\s*([A-Za-z_][\w-]*)/g)) {
    const start = m.index!;
    const name = m[2];
    const end = start + m[0].length;
    if (character >= start && character <= end) return name;
  }
  return null;
}

export function hoverAt(
  doc: TextDocument,
  position: { line: number; character: number },
  info: StoryInfo,
): Hover | null {
  const line = doc.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line + 1, character: 0 },
  });
  const name = macroNameAtLine(line, position.character);
  if (!name) return null;

  const sig = info.macroSigs.get(name);
  if (!sig) return null;

  const params = sig.params ?? [];
  const parts = params.map(p => `\`${p.name}${p.optional ? '?' : ''}: ${p.type}\`` + (p.description ? ` — ${p.description}` : ''));
  if (sig.rest) parts.push(`\`...${sig.rest.name}: ${sig.rest.type}\``);
  const title = `<<${name}>>${parts.length ? ` (${parts.join(', ')})` : ''}`;
  const lines = [`\`\`\`mksk`, title, `\`\`\``];
  if (sig.description) lines.push('', sig.description);
  if (parts.length) lines.push('', '参数：', ...parts.map(p => `- ${p}`));
  const contents: MarkupContent = { kind: 'markdown', value: lines.join('\n') };
  return { contents };
}
