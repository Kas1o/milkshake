import { fileURLToPath } from 'node:url';
import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  type InitializeParams,
  type CompletionParams,
  type DefinitionParams,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { findStoryRoot } from '../shared/locate.js';
import { computeDiagnostics, openTextSource, type OpenTextSource } from './diagnostics.js';
import { cachedStoryInfo } from './storyInfo.js';
import { completeAt } from './completion.js';
import { definitionAt } from './definition.js';
import { hoverAt } from './hover.js';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

const debounceTimers = new Map<string, NodeJS.Timeout>();
let lastDiagnosed: Set<string> = new Set();

// Serializes the (expensive) whole-project check: if a refresh is in flight and
// a newer edit lands, the newest request wins and stale runs are discarded, so
// the server never falls further and further behind ("反应迟钝/不更新").
let runToken = 0;
let running = Promise.resolve();

connection.onInitialize((_params: InitializeParams) => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Full,
    completionProvider: { triggerCharacters: ['<', '[', '$', '"', "'", ' '] },
    definitionProvider: true,
    hoverProvider: true,
  },
}));

function scheduleDiagnostics(doc: TextDocument) {
  const uri = doc.uri;
  const old = debounceTimers.get(uri);
  if (old) clearTimeout(old);
  // Short debounce: the whole-project check is cheap now (~tens of ms thanks to
  // the incremental type-check session), so feedback appears almost immediately.
  debounceTimers.set(uri, setTimeout(() => void refreshDiagnostics(doc), 120));
}

/** The checker runs per story root, so every refresh re-reports all files. */
async function refreshDiagnostics(doc: TextDocument) {
  const token = ++runToken;
  const root = findStoryRoot(fileURLToPath(doc.uri));
  if (!root) return;
  const open: OpenTextSource = openTextSource(documents);
  running = running
    .then(async () => {
      // A newer edit superseded this run while it was queued.
      if (token !== runToken) return;
      let byFile: Awaited<ReturnType<typeof computeDiagnostics>> | undefined;
      try {
        // Serve open (possibly unsaved) documents from memory so diagnostics
        // reflect the current edit immediately instead of the last save.
        byFile = await computeDiagnostics(root, { read: open.read });
      } catch (err) {
        connection.console.error(`Milkshake check failed: ${err}`);
        return;
      }
      if (token !== runToken) return; // superseded during the check itself
      for (const uri of lastDiagnosed) {
        connection.sendDiagnostics({ uri, diagnostics: [] });
      }
      lastDiagnosed = new Set();
      for (const [uri, diagnostics] of byFile) {
        connection.sendDiagnostics({ uri, diagnostics });
        lastDiagnosed.add(uri);
      }
    })
    .catch(err => connection.console.error(`Milkshake check failed: ${err}`));
}

documents.onDidOpen(e => scheduleDiagnostics(e.document));
documents.onDidChangeContent(e => scheduleDiagnostics(e.document));
documents.onDidClose(e => {
  const timer = debounceTimers.get(e.document.uri);
  if (timer) clearTimeout(timer);
  connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

connection.onCompletion(async (params: CompletionParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const root = findStoryRoot(fileURLToPath(doc.uri));
  if (!root) return [];
  try {
    return await completeAt(doc, params.position, await cachedStoryInfo(root, openTextSource(documents)));
  } catch (err) {
    connection.console.error(`Milkshake completion failed: ${err}`);
    return [];
  }
});

connection.onDefinition(async params => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const root = findStoryRoot(fileURLToPath(doc.uri));
  if (!root) return null;
  try {
    return await definitionAt(root, doc, params.position, openTextSource(documents));
  } catch (err) {
    connection.console.error(`Milkshake definition failed: ${err}`);
    return null;
  }
});

connection.onHover(async params => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const root = findStoryRoot(fileURLToPath(doc.uri));
  if (!root) return null;
  try {
    return hoverAt(doc, params.position, await cachedStoryInfo(root, openTextSource(documents)));
  } catch (err) {
    connection.console.error(`Milkshake hover failed: ${err}`);
    return null;
  }
});

documents.listen(connection);
connection.listen();
