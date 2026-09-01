import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { openTextSource } from '../src/server/diagnostics.js';

function mkDoc(uri: string, text: string, version: number): TextDocument {
  return TextDocument.create(uri, 'milkshake', version, text);
}

test('openTextSource serves an open document from memory by its path', () => {
  // Build a URI from a real path (as an editor would), then look it up by path.
  const path = 'C:\\story\\a.mksk';
  const uri = pathToFileURL(path).href;
  const doc = mkDoc(uri, ':: A\n<<goto "Nowhere">>\n', 3);
  const src = openTextSource({ get: () => undefined, all: () => [doc] });

  // Same path served from memory (disk is stale/clean).
  assert.equal(src.read(path), ':: A\n<<goto "Nowhere">>\n');
  // A file that isn't open is undefined (falls back to disk upstream).
  assert.equal(src.read('C:\\story\\b.mksk'), undefined);
  // openKey changes with the document version, so caches invalidate on edit.
  const k1 = src.openKey();
  const doc2 = mkDoc(uri, ':: A\nok\n', 4);
  const src2 = openTextSource({ get: () => undefined, all: () => [doc2] });
  assert.notEqual(src2.openKey(), k1);
});
