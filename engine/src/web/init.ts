import { cp, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 从内置模板（engine/template）初始化一个新的故事项目。 */
export async function initProject(dirArg?: string): Promise<void> {
  const dir = resolve(process.cwd(), dirArg ?? '');
  if (!dirArg) throw new Error('用法：tsx src/web/init.ts <目标目录>');
  if (existsSync(dir) && (await readdir(dir)).length > 0) {
    throw new Error(`目标目录不为空：${dir}`);
  }
  const template = fileURLToPath(new URL('../../template', import.meta.url));
  await mkdir(dir, { recursive: true });
  await cp(template, dir, { recursive: true });
  console.log(`已初始化故事项目到：${dir}`);
  console.log('包含默认布局（scripts/layout.ts + index.html + styles.css），可直接修改。');
  console.log('接下来：');
  console.log(`  cd ${dir}`);
  console.log('  milkshake check   # 静态检查');
  console.log('  milkshake build   # 导出 Web 到 web-dist/');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  initProject(process.argv[2]).catch(err => {
    console.error('\n' + err.message);
    process.exit(1);
  });
}
