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
}

export function deactivate() {
  return client?.stop();
}
