import { pathToFileURL } from 'node:url';
import { Location, Position, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { collectStoryInfo } from '../../../engine/src/check.js';
import { findPassageRefAt } from '../shared/context.js';
import { lineLength } from '../shared/locate.js';

export async function definitionAt(
  root: string,
  doc: TextDocument,
  position: Position,
): Promise<Location | null> {
  const lineText = doc.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line + 1, character: 0 },
  });
  const ref = findPassageRefAt(lineText, position.character);
  if (!ref) return null;
  const info = await collectStoryInfo(root);
  const loc = info.locations.get(ref.target);
  if (!loc) return null;
  const end = await lineLength(loc.file, loc.line);
  return Location.create(
    pathToFileURL(loc.file).href,
    Range.create(loc.line, 0, loc.line, Math.max(end, 1)),
  );
}
