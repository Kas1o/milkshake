import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, watch, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve, sep, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exportWeb } from './build.js';
import { resolveStoryDir } from '../engine/story.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function parseArgs(argv: string[]): { dir?: string; out?: string; port: number } {
  const args = { dir: undefined as string | undefined, out: undefined as string | undefined, port: 5173 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-o') args.out = argv[++i];
    else if (argv[i] === '-p') args.port = Number(argv[++i]) || 5173;
    else args.dir = argv[i];
  }
  return args;
}

function serve(out: string, port: number): void {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = join(out, pathname);
    if (!file.startsWith(out + sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    try {
      const s = await stat(file);
      if (!s.isFile()) throw new Error('not file');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
    }
  });
  server.listen(port, () => {
    console.log(`本地监听：http://localhost:${port}`);
  });
}

/** Watch a directory tree for changes, returning relative paths. */
function watchTree(dir: string, onChange: (rel: string) => void): void {
  if (!existsSync(dir)) return;
  try {
    // fs.watch recursive is supported on Windows and macOS.
    watch(dir, { recursive: true }, (_event, filename) => {
      if (filename) onChange(String(filename));
    });
  } catch {
    // Fallback: poll for changes.
    let last = snapshot(dir);
    setInterval(() => {
      const cur = snapshot(dir);
      for (const k of new Set([...last.keys(), ...cur.keys()])) {
        if (last.get(k) !== cur.get(k)) onChange(k);
      }
      last = cur;
    }, 800);
  }
}

function snapshot(dir: string, prefix = ''): Map<string, [number, number]> {
  const map = new Map<string, [number, number]>();
  for (const name of readdirSync(dir, { withFileTypes: true }) as { name: string; isDirectory(): boolean }[]) {
    const rel = prefix ? `${prefix}/${name.name}` : name.name;
    if (name.isDirectory()) {
      for (const [k, v] of snapshot(join(dir, name.name), rel)) map.set(k, v);
    } else {
      try {
        const s = statSync(join(dir, name.name));
        map.set(rel, [s.mtimeMs, s.size]);
      } catch {}
    }
  }
  return map;
}

const INTERESTING = /\.(mksk|ts|html|css)$/i;

export async function devServer(dirArg?: string, outArg?: string, port = 5173): Promise<void> {
  const cwd = process.cwd();
  const dir = resolveStoryDir(cwd, dirArg);
  const out = resolve(cwd, outArg ?? join(dir, 'web-dist'));

  let building = false;
  let queued = false;

  const build = async () => {
    if (building) {
      queued = true;
      return;
    }
    building = true;
    try {
      await exportWeb(dir, out);
      console.log('构建完成，浏览器刷新即可看到改动。');
    } catch (err) {
      console.error('\n构建失败：\n' + (err as Error).message);
    } finally {
      building = false;
      if (queued) {
        queued = false;
        build();
      }
    }
  };

  await build();

  console.log('正在监听 ' + dir + ' 的改动……');
  watchTree(dir, rel => {
    if (!INTERESTING.test(rel)) return;
    console.log(`检测到改动：${relative(dir, join(dir, rel))}`);
    build();
  });

  serve(out, port);

  const shutdown = () => {
    console.log('\n已停止。');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const { dir, out, port } = parseArgs(process.argv.slice(2));
  devServer(dir, out, port).catch(err => {
    console.error('\n' + err.message);
    process.exit(1);
  });
}
