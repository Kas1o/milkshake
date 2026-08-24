import { pathToFileURL } from 'node:url';
import type { Diagnostic } from 'vscode-languageserver';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { checkStory } from '../../../engine/src/check.js';

/** Run the engine checker over the story root and group issues per file. */
export async function computeDiagnostics(root: string): Promise<Map<string, Diagnostic[]>> {
  const issues = await checkStory(root);
  const byFile = new Map<string, Diagnostic[]>();
  for (const i of issues) {
    if (!i.file) continue;
    const uri = pathToFileURL(i.file).href;
    const line = i.line ?? 0;
    let list = byFile.get(uri);
    if (!list) byFile.set(uri, (list = []));
    list.push({
      range: { start: { line, character: 0 }, end: { line, character: 1000 } },
      severity: DiagnosticSeverity.Error,
      source: 'milkshake',
      message: `段落「${i.passage}」：${i.message}`,
    });
  }
  return byFile;
}
