import { CompletionItem, CompletionItemKind, Position } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { collectStoryInfo, BUILTIN_HELPER_NAMES } from '../../../engine/src/check.js';
import { detectCompletionContext } from '../shared/context.js';

export async function completeAt(
  root: string,
  doc: TextDocument,
  position: Position,
): Promise<CompletionItem[]> {
  const textBefore = doc.getText({ start: { line: 0, character: 0 }, end: position });
  const ctx = detectCompletionContext(textBefore);
  if (ctx.kind === 'none') return [];

  const info = await collectStoryInfo(root);
  switch (ctx.kind) {
    case 'macro-name':
      return [...info.knownMacros].map(name => ({
        label: name,
        kind: CompletionItemKind.Function,
        detail: info.widgets.has(name) ? 'widget' : 'macro',
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
