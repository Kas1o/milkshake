import { readdir, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * 基础设施模块系统：`milkshake new` 向导的装配单元。
 *
 * 每个模块是 `engine/infra/<id>/` 下的一个自治包，包含：
 *   - `module.ts`       描述元数据 + 对生成文件的补丁（导出 default InfraModule）
 *   - 若干文件          随模块拷入新项目（如 `scripts/save-system.ts`）
 *
 * 装配流程（见 web/init.ts）：先复制 base 模板，再逐个应用选中的模块：
 *   1. 把 `files` 中列出的文件从模块目录复制到新项目对应相对路径；
 *   2. 对 `patches` 里指定的文件做字符串补丁（anchor 定位或追加）。
 *
 * 设计约定：模块的运行时脚本必须**自包含**（用结构类型而非 import 引擎），
 * 因为独立新项目里没有 `../../engine`；`milkshake check/build` 在运行时
 * 会剥离类型，因此结构类型既满足类型约束又随处可用。
 */

export interface InfraPatch {
  /** 新项目中的相对路径（如 `scripts/layout.ts`）。 */
  file: string;
  /** 定位锚点（`mode !== 'append'` 时必填）；未命中会报错而不是静默漏装。 */
  anchor?: string;
  /** 要插入的文本。 */
  insert: string;
  /** after=插在 anchor 之后（默认）；before=之前；append=追加到文件末尾。 */
  mode?: 'after' | 'before' | 'append';
}

export interface InfraModule {
  /** 稳定 id，用于 `--with save,battle` 等选择。 */
  id: string;
  label: string;
  description: string;
  /** 依赖的其它模块 id。 */
  requires?: string[];
  /** 从模块目录复制到新项目的文件（相对路径，二者相同）。 */
  files?: string[];
  /** 对生成文件的字符串补丁。 */
  patches?: InfraPatch[];
}

const INFRA_DIR = fileURLToPath(new URL('../../infra', import.meta.url));

/** 扫描 `engine/infra/<id>/module.ts`，返回全部可用的基础设施模块。 */
export async function loadInfraModules(): Promise<InfraModule[]> {
  const modules: InfraModule[] = [];
  const entries = await readdir(INFRA_DIR, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const mod = await import(pathToFileURL(join(INFRA_DIR, e.name, 'module.ts')).href);
      if (mod.default) modules.push(mod.default as InfraModule);
    } catch {
      // 跳过无法加载的模块目录。
    }
  }
  return modules;
}

/** 解析模块 id（含依赖展开、去重、按依赖排序），未找到时报错。 */
export async function resolveModules(ids: string[]): Promise<InfraModule[]> {
  const all = await loadInfraModules();
  const byId = new Map(all.map(m => [m.id, m]));
  const ordered: InfraModule[] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const mod = byId.get(id);
    if (!mod) throw new Error(`未知的基础设施模块：「${id}」。可用：${all.map(m => m.id).join(', ') || '（无）'}`);
    for (const dep of mod.requires ?? []) visit(dep);
    ordered.push(mod);
  };
  for (const id of ids) visit(id);
  return ordered;
}

/** 把一组模块应用到已复制好的新项目目录。返回补丁/复制失败的错误信息列表。 */
export async function applyModules(
  projectDir: string,
  modules: InfraModule[],
): Promise<string[]> {
  const errors: string[] = [];
  // 读入可能被打补丁的文件；未列出的文件不加载（避免整目录读取）。
  const buffered = new Map<string, string>();
  const content = async (rel: string): Promise<string | undefined> => {
    const key = rel.replace(/\\/g, '/');
    if (buffered.has(key)) return buffered.get(key);
    try {
      const text = await readFile(join(projectDir, key), 'utf8');
      buffered.set(key, text);
      return text;
    } catch {
      return undefined;
    }
  };

  for (const mod of modules) {
    // 1) 复制随模块携带的文件。
    for (const rel of mod.files ?? []) {
      const key = rel.replace(/\\/g, '/');
      const dest = join(projectDir, key);
      try {
        await mkdir(dirname(dest), { recursive: true });
        await copyFile(join(INFRA_DIR, mod.id, key), dest);
      } catch (err) {
        errors.push(`模块「${mod.id}」复制文件失败：${key}（${msg(err)}）`);
      }
    }
    // 2) 应用补丁。
    for (const p of mod.patches ?? []) {
      const key = p.file.replace(/\\/g, '/');
      const src = await content(key);
      if (src === undefined) {
        errors.push(`模块「${mod.id}」补丁目标缺失：${key}`);
        continue;
      }
      if (p.mode === 'append') {
        buffered.set(key, src.replace(/\s+$/, '\n') + p.insert.replace(/^\n+/, ''));
        continue;
      }
      if (!p.anchor) {
        errors.push(`模块「${mod.id}」补丁缺少 anchor：${key}`);
        continue;
      }
      const idx = src.indexOf(p.anchor);
      if (idx === -1) {
        errors.push(`模块「${mod.id}」补丁 anchor 未命中于 ${key}：「${truncate(p.anchor)}」`);
        continue;
      }
      const at = p.mode === 'before' ? idx : idx + p.anchor.length;
      buffered.set(key, src.slice(0, at) + p.insert + src.slice(at));
    }
  }

  // 写回所有被打补丁的文件。
  for (const [key, text] of buffered) {
    await writeFile(join(projectDir, key), text, 'utf8');
  }
  return errors;
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function truncate(s: string, max = 40): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}
