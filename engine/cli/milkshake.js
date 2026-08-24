#!/usr/bin/env node
import 'tsx';
import { fileURLToPath } from 'node:url';

const sub = process.argv[2];
const entries = {
  check: new URL('../src/check.ts', import.meta.url),
  build: new URL('../src/web/build.ts', import.meta.url),
  dev: new URL('../src/web/dev.ts', import.meta.url),
  new: new URL('../src/web/init.ts', import.meta.url),
};

if (!sub || !entries[sub]) {
  console.error('用法：milkshake <check|build|dev|new> [参数...]');
  console.error('  milkshake check [故事目录]               静态检查');
  console.error('  milkshake build [故事目录] [-o 目录]     导出 Web');
  console.error('  milkshake dev [故事目录] [-o 目录] [-p 端口]  构建并本地监听');
  console.error('  milkshake new <目标目录> [--name 标题] [--with a,b] [--interactive]');
  console.error('                           初始化新故事项目（向导可勾选基础设施）');
  process.exit(1);
}

// Reuse each entry's `isMain` check so they run their CLI logic. The entry
// scripts read process.argv[2] as their first argument, so shift the
// subcommand out before forwarding the remaining args.
process.argv = [process.argv[0], fileURLToPath(entries[sub]), ...process.argv.slice(3)];
await import(entries[sub].href);
