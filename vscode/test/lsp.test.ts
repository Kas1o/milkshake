import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const serverBundle = resolve(__dirname, '../dist/server.js');

// Spawns the built server over stdio and runs a real LSP handshake:
// initialize -> didOpen -> expect publishDiagnostics from the engine checker.
test('LSP server e2e: initialize and diagnostics', { skip: !existsSync(serverBundle) && 'run npm run build first' }, async () => {
  const child = spawn(process.execPath, [serverBundle, '--stdio']);
  let buf = Buffer.alloc(0);
  let capabilities: any = null;
  const published: any[] = [];

  child.stdout.on('data', (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd < 0) break;
      const m = buf.slice(0, headerEnd).toString().match(/Content-Length: (\d+)/i);
      if (!m) break;
      const len = parseInt(m[1], 10);
      if (buf.length < headerEnd + 4 + len) break;
      const msg = JSON.parse(buf.slice(headerEnd + 4, headerEnd + 4 + len).toString());
      buf = buf.slice(headerEnd + 4 + len);
      if (msg.id === 1) capabilities = msg.result?.capabilities;
      if (msg.id !== undefined) messages.push(msg);
      if (msg.method === 'textDocument/publishDiagnostics') published.push(msg.params);
    }
  });
  const stderr: string[] = [];
  child.stderr.on('data', (d: Buffer) => stderr.push(d.toString()));

  const send = (obj: unknown) => {
    const s = JSON.stringify(obj);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`);
  };

  const dir = await mkdtemp(join(tmpdir(), 'milkshake-lsp-e2e-'));
  const file = join(dir, 'a.mksk');
  await writeFile(join(dir, 'vars.ts'), 'export default { gold: 7 };\n');
  // Disk is VALID; the open (unsaved) document carries the error. Diagnostics
  // must come from the in-memory content, not the stale on-disk copy.
  await writeFile(file, ':: A\nok\n<<goto "Nowhere">>\n');
  const uri = pathToFileURL(file).href;
  const text = ':: A\nok\n<<goto "Nowhere">>\n';

  const messages: any[] = [];
  let hover: any = null;

  try {
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: process.pid, rootUri: pathToFileURL(dir).href, capabilities: {} } });
    await new Promise(r => setTimeout(r, 1500));
    send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'milkshake', version: 1, text } } });
    await new Promise(r => setTimeout(r, 4000));
    // Hover on `<<goto` (line 2, character 2) to exercise the signature hover.
    send({ jsonrpc: '2.0', id: 2, method: 'textDocument/hover', params: { textDocument: { uri }, position: { line: 2, character: 3 } } });
    await new Promise(r => setTimeout(r, 1500));

    assert.ok(capabilities, `no initialize response; server stderr: ${stderr.join('')}`);
    assert.equal(capabilities.definitionProvider, true);
    assert.equal(capabilities.hoverProvider, true);
    assert.ok(capabilities.completionProvider);
    const issues = published.flatMap(p => (p.uri === uri ? p.diagnostics : []));
    assert.ok(
      issues.some(d => d.message.includes('Nowhere')),
      `expected a missing-target diagnostic from the UNSAVED edit, got: ${JSON.stringify(published)}`,
    );
    const hoverMsg = messages.find(m => m.id === 2);
    assert.ok(hoverMsg, `no hover response; server stderr: ${stderr.join('')}`);
    hover = hoverMsg.result;
    const hoverText = JSON.stringify(hover?.contents);
    assert.ok(
      hoverText.includes('<<goto>>') && hoverText.includes('passage: string'),
      `expected goto signature in hover, got: ${hoverText}`,
    );
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
