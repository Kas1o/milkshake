import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
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

/** Normalize a filesystem path so on-disk paths and editor URIs compare equal
 * regardless of drive-letter casing or separator style (Windows). */
function normalizePath(p: string): string {
  const r = resolve(p);
  return process.platform === 'win32' ? r.toLowerCase().replace(/\\/g, '/') : r;
}

export function openTextSource(
  documents: { get(uri: string): TextDocument | undefined; all(): TextDocument[] },
): OpenTextSource {
  // Convert each open document's URI to a real filesystem path and index by
  // the normalized path. This is far more robust than string-comparing the
  // `file://` URIs (which differ in casing / encoding across platforms).
  const byPath = new Map<string, { text: string; version: number }>();
  for (const d of documents.all()) {
    if (d.languageId !== 'milkshake') continue;
    let p: string;
    try {
      p = fileURLToPath(d.uri);
    } catch {
      continue; // non-file scheme
    }
    byPath.set(normalizePath(p), { text: d.getText(), version: d.version });
  }

  const read = (path: string) => byPath.get(normalizePath(path))?.text;
  const openKey = () =>
    [...byPath.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([p, e]) => `${p}:${e.version}`)
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
