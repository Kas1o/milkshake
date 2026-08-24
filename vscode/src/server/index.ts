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
import { computeDiagnostics } from './diagnostics.js';
import { completeAt } from './completion.js';
import { definitionAt } from './definition.js';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

const debounceTimers = new Map<string, NodeJS.Timeout>();
let lastDiagnosed: Set<string> = new Set();

connection.onInitialize((_params: InitializeParams) => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Full,
    completionProvider: { triggerCharacters: ['<', '[', '$', '"', "'", ' '] },
    definitionProvider: true,
  },
}));

function scheduleDiagnostics(doc: TextDocument) {
  const uri = doc.uri;
  const old = debounceTimers.get(uri);
  if (old) clearTimeout(old);
  debounceTimers.set(uri, setTimeout(() => void refreshDiagnostics(doc), 300));
}

/** The checker runs per story root, so every refresh re-reports all files. */
async function refreshDiagnostics(doc: TextDocument) {
  for (const uri of lastDiagnosed) {
    connection.sendDiagnostics({ uri, diagnostics: [] });
  }
  lastDiagnosed = new Set();
  const root = findStoryRoot(fileURLToPath(doc.uri));
  if (!root) return;
  try {
    const byFile = await computeDiagnostics(root);
    for (const [uri, diagnostics] of byFile) {
      connection.sendDiagnostics({ uri, diagnostics });
      lastDiagnosed.add(uri);
    }
  } catch (err) {
    connection.console.error(`Milkshake check failed: ${err}`);
  }
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
    return await completeAt(root, doc, params.position);
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
    return await definitionAt(root, doc, params.position);
  } catch (err) {
    connection.console.error(`Milkshake definition failed: ${err}`);
    return null;
  }
});

documents.listen(connection);
connection.listen();
