import { randomUUID } from 'node:crypto';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { input, checkbox } from '@inquirer/prompts';
import {
  loadInfraModules,
  resolveModules,
  applyModules,
  type InfraModule,
} from './infra.js';

export interface InitOptions {
  dir: string;
  /** 故事标题；缺省时取目录名，交互模式会询问。 */
  title?: string;
  /** 要安装的基础设施模块 id。 */
  with?: string[];
  /** 交互模式：对缺失的 title / 模块选择弹出提示。 */
  interactive?: boolean;
}

/** 用 story 标题替换复制产物里的占位名，并写入一个稳定的故事 GUID。 */
async function applyTitle(dir: string, title: string): Promise<void> {
  const lit = JSON.stringify(title);
  const cfg = join(dir, 'story.config.ts');
  const cfgText = (await readFile(cfg, 'utf8')).replace(
    /name:\s*'[^']*'/,
    `name: ${lit}`,
  );
  await writeFile(cfg, cfgText, 'utf8');

  const ui = join(dir, 'passages', '00_ui.mksk');
  const uiText = (await readFile(ui, 'utf8')).replace('新的奶昔故事', title);
  await writeFile(ui, uiText, 'utf8');
}

/** 为 story.config.ts 追加一个稳定的故事 GUID（存档命名空间用）。 */
async function applyUid(dir: string): Promise<void> {
  const cfg = join(dir, 'story.config.ts');
  const text = await readFile(cfg, 'utf8');
  if (/\buid\s*:/.test(text)) return;
  const lit = JSON.stringify(randomUUID());
  await writeFile(cfg, text.replace(/\}(\s*;?)\s*$/, `  uid: ${lit},\n}$1`), 'utf8');
}

/** 从内置模板初始化一个新的故事项目，并按需装配基础设施模块。 */
export async function initProject(target: string | InitOptions): Promise<void> {
  const opts: InitOptions =
    typeof target === 'string' ? { dir: target } : { ...target };

  const dir = resolve(process.cwd(), opts.dir ?? '');
  if (existsSync(dir) && (await readdir(dir)).length > 0) {
    throw new Error(`目标目录不为空：${dir}`);
  }

  const available = await loadInfraModules();

  // 交互模式：补齐缺失的信息。
  let title = opts.title;
  let ids = opts.with;
  if (opts.interactive) {
    if (!title) {
      title = await input({
        message: '故事标题',
        default: basename(dir) || '我的奶昔故事',
      });
    }
    if (!ids) {
      ids = (
        await checkbox({
          message: '选择要安装的基础设施（空格勾选，回车确认）：',
          choices: available.map(m => ({
            name: `${m.label} — ${m.description}`,
            value: m.id,
            checked: false,
          })),
        })
      );
    }
  }
  title = title ?? (basename(dir) || '新的奶昔故事');
  ids = ids ?? [];

  const template = fileURLToPath(new URL('../../template', import.meta.url));
  await mkdir(dir, { recursive: true });
  await cp(template, dir, { recursive: true });
  await applyTitle(dir, title);
  await applyUid(dir);

  const modules: InfraModule[] = ids.length ? await resolveModules(ids) : [];
  const errors = await applyModules(dir, modules);
  if (errors.length) {
    for (const e of errors) console.error(`  ✗ ${e}`);
    throw new Error(`基础设施安装出现问题，共 ${errors.length} 处（已生成的项目仍可使用）。`);
  }

  const withDesc = modules.length ? `，已安装：${modules.map(m => m.label).join('、')}` : '';
  console.log(`已初始化故事项目到：${dir}${withDesc}`);
  console.log('包含默认布局（scripts/layout.ts + index.html + styles.css），可直接修改。');
  console.log('接下来：');
  console.log(`  cd ${dir}`);
  console.log('  milkshake check   # 静态检查');
  console.log('  milkshake build   # 导出 Web 到 web-dist/');
}

/* ---------------------------------------------------------------------------
 * CLI 入口：tsx src/web/init.ts <目标目录> [--name 标题] [--with a,b] [--interactive]
 * ------------------------------------------------------------------------- */

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const dir = args.find(a => !a.startsWith('--')) ?? '';
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const title = flag('--name');
  const withList = flag('--with')?.split(',').map(s => s.trim()).filter(Boolean);
  const interactive = args.includes('--interactive');

  initProject({
    dir,
    title,
    with: withList,
    interactive: interactive || (process.stdout.isTTY && !title && !withList),
  }).catch(err => {
    console.error('\n' + err.message);
    process.exit(1);
  });
}
