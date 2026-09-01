import { CompletionItem, CompletionItemKind, Position } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { BUILTIN_HELPER_NAMES, type StoryInfo } from '../../../engine/src/check.js';
import { detectCompletionContext } from '../shared/context.js';

/** Short, human-readable parameter list for a macro, e.g. `amount: number`. */
function signatureDetail(info: StoryInfo, name: string, fallback: string): string {
  const sig = info.macroSigs.get(name);
  const params = sig?.params;
  if ((!params || !params.length) && !sig?.rest) return fallback;
  const parts = (params ?? []).map(p => `${p.name}${p.optional ? '?' : ''}: ${p.type}`);
  if (sig?.rest) parts.push(`...${sig.rest.name}: ${sig.rest.type}`);
  return `${fallback}(${parts.join(', ')})`;
}

export async function completeAt(
  doc: TextDocument,
  position: Position,
  info: StoryInfo,
): Promise<CompletionItem[]> {
  const textBefore = doc.getText({ start: { line: 0, character: 0 }, end: position });
  const ctx = detectCompletionContext(textBefore);
  if (ctx.kind === 'none') return [];

  switch (ctx.kind) {
    case 'macro-name':
      return [...info.knownMacros].map(name => ({
        label: name,
        kind: CompletionItemKind.Function,
        detail: signatureDetail(info, name, info.widgets.has(name) ? 'widget' : 'macro'),
      }));
    case 'passage-title':
      return [...info.titles].map(title => ({
        label: title,
        kind: CompletionItemKind.Reference,
        detail: 'passage',
      }));
    case 'identifier': {
      const items: CompletionItem[] = info.varNames.map(v => ({
        label: v,
        kind: CompletionItemKind.Variable,
        detail: 'story var',
      }));
      for (const h of info.helpers) {
        items.push({ label: h, kind: CompletionItemKind.Function, detail: 'helper' });
      }
      for (const h of BUILTIN_HELPER_NAMES) {
        items.push({ label: h, kind: CompletionItemKind.Function, detail: 'builtin' });
      }
      return items;
    }
  }
}
