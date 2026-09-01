import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Location, Position, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { collectStoryInfo } from '../../../engine/src/check.js';
import { isSpecialScript, walk } from '../../../engine/src/engine/story.js';
import { findPassageRefAt, macroNameAtLine, wordAt } from '../shared/context.js';
import { lineLength } from '../shared/locate.js';
import type { OpenTextSource } from './diagnostics.js';

function loc(file: string, line: number, column = 0): Location {
  return Location.create(
    pathToFileURL(file).href,
    Range.create(line, column, line, column),
  );
}

/** First line in `vars.ts` where `<name>:` (interface) or `<name> =` (default)
 * declares the variable. */
async function findVarDefinition(root: string, name: string): Promise<Location | null> {
  const file = join(root, 'vars.ts');
  const text = await readFile(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const re = new RegExp(`^\\s*${name}\\s*(:|=)`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      const col = lines[i].indexOf(name);
      return loc(file, i, col >= 0 ? col : 0);
    }
  }
  return null;
}

/** Find the `registerMacro({ name: '<name>' ... })` call in a story script. */
async function findMacroDefinition(root: string, name: string): Promise<Location | null> {
  const files = await walk(root, p => /\.ts$/i.test(p) && !isSpecialScript(p));
  const re = new RegExp(`name\\s*:\\s*[\\"']${name}[\\"']`);
  for (const file of files) {
    const text = await readFile(file, 'utf8').catch(() => '');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        const col = lines[i].search(re);
        return loc(file, i, col >= 0 ? col : 0);
      }
    }
  }
  return null;
}

/** Find the `<<widget "name" ...>>` definition in a passage file. */
async function findWidgetDefinition(root: string, name: string): Promise<Location | null> {
  const files = await walk(root, p => /\.mksk$/i.test(p));
  const re = new RegExp(`<<widget\\s+[\\"']${name}[\\"']`);
  for (const file of files) {
    const text = await readFile(file, 'utf8').catch(() => '');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        const col = lines[i].search(re);
        return loc(file, i, col >= 0 ? col : 0);
      }
    }
  }
  return null;
}

export async function definitionAt(
  root: string,
  doc: TextDocument,
  position: Position,
  open?: OpenTextSource,
): Promise<Location | null> {
  const lineText = doc.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line + 1, character: 0 },
  });

  const collect = () => collectStoryInfo(root, open ? { read: open.read } : undefined);

  // 1) Passage references (links / <<goto>> / <<display>>).
  const ref = findPassageRefAt(lineText, position.character);
  if (ref) {
    const info = await collect();
    const locInfo = info.locations.get(ref.target);
    if (locInfo) {
      const end = await lineLength(locInfo.file, locInfo.line);
      return Location.create(
        pathToFileURL(locInfo.file).href,
        Range.create(locInfo.line, 0, locInfo.line, Math.max(end, 1)),
      );
    }
    return null;
  }

  // 2) Macro call → its definition (widget in a passage, or registration in a
  //    story script). Core macros have no story definition → null.
  const macro = macroNameAtLine(lineText, position.character);
  if (macro) {
    const info = await collect();
    if (!info.knownMacros.has(macro)) return null;
    if (info.widgets.has(macro)) return await findWidgetDefinition(root, macro);
    return await findMacroDefinition(root, macro);
  }

  // 3) Story variable → its declaration in vars.ts.
  const word = wordAt(lineText, position.character);
  if (word) {
    const info = await collect();
    if (info.varNames.includes(word)) {
      return await findVarDefinition(root, word);
    }
  }

  return null;
}
