import { pathToFileURL } from 'node:url';
import type { Diagnostic } from 'vscode-languageserver';
import { DiagnosticSeverity } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { checkStory, type CheckOptions } from '../../../engine/src/check.js';
import { lineLength } from '../shared/locate.js';

/** Serves open, unsaved documents from memory instead of their stale on-disk
 * copy, so the checker reflects the current edit immediately. */
export interface OpenTextSource {
  /** checkStory/collectStoryInfo override: in-memory text for a path, if open. */
  read(path: string): string | undefined;
  /** Stable key reflecting open-document content, for cache invalidation. */
  openKey(): string;
}

export function openTextSource(
  documents: { get(uri: string): TextDocument | undefined; all(): TextDocument[] },
): OpenTextSource {
  const read = (path: string) => documents.get(pathToFileURL(path).href)?.getText();
  const openKey = () =>
    documents
      .all()
      .filter(d => d.languageId === 'milkshake')
      .sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0))
      .map(d => `${d.uri}:${d.version}`)
      .join('|');
  return { read, openKey };
}

/** Run the engine checker over the story root and group issues per file. */
export async function computeDiagnostics(
  root: string,
  opts: CheckOptions = {},
): Promise<Map<string, Diagnostic[]>> {
  const issues = await checkStory(root, opts);
  const byFile = new Map<string, Diagnostic[]>();
  for (const i of issues) {
    if (!i.file) continue;
    const uri = pathToFileURL(i.file).href;
    const line = i.line ?? 0;
    const end = await lineLength(i.file, line);
    let list = byFile.get(uri);
    if (!list) byFile.set(uri, (list = []));
    list.push({
      range: { start: { line, character: 0 }, end: { line, character: Math.max(end, 1) } },
      severity: DiagnosticSeverity.Error,
      source: 'milkshake',
      message: `段落「${i.passage}」：${i.message}`,
    });
  }
  return byFile;
}
