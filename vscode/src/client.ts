import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { ExtensionContext } from 'vscode';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext) {
  const serverModule = context.asAbsolutePath('dist/server.js');
  const serverOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };
  const clientOptions = {
    documentSelector: [{ scheme: 'file', language: 'milkshake' }],
  };
  client = new LanguageClient('milkshake', 'Milkshake Language Server', serverOptions, clientOptions);
  client.start();

  // In development the server bundle is rebuilt by the `watch` task whenever
  // the engine or server sources change. Restart the language server on each
  // rebuild so engine edits take effect without reloading the window.
  if (context.extensionMode === vscode.ExtensionMode.Development) {
    context.subscriptions.push(watchServerBundle(context, () => client?.restart()));
  }
}

/** Watch `dist/` and call `restart` (debounced) whenever `server.js` is rebuilt. */
function watchServerBundle(context: ExtensionContext, restart: () => Thenable<void> | undefined) {
  let timer: NodeJS.Timeout | undefined;
  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(join(context.extensionPath, 'dist'), (_event, filename) => {
      if (filename !== 'server.js') return;
      // esbuild may touch the file several times per rebuild; coalesce.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const p = restart();
        if (p) void Promise.resolve(p).catch(err => console.error('[milkshake] LSP restart failed:', err));
      }, 150);
    });
  } catch {
    // dist/ may not exist yet; the next build creates it.
  }
  return {
    dispose() {
      if (timer) clearTimeout(timer);
      watcher?.close();
    },
  };
}

export function deactivate() {
  return client?.stop();
}
