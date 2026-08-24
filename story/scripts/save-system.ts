import type { Engine, StoryContext } from '../../engine/src/index.js';

/**
 * 存档 / 读档系统（纯故事侧，不改引擎），支持任意数量的自由存档位。
 *
 * 原理：引擎的 `engine.state`（StoryState）字段全部公开可变，把
 * `variables / history / visits / turns / current / previous` 序列化后写入
 * localStorage；读档时原地写回 `engine.state` 再重新渲染当前段落即可。
 * 不触碰引擎源码，仅复用其公开 API（Engine.state、Engine.renderCurrent）。
 *
 * 存储布局（localStorage）：
 *   - `milkshake:<story>:saves`       JSON 数组：该故事所有存档位的元信息（id / label / savedAt / passage）
 *   - `milkshake:<story>:save:<id>`   单个存档位的完整 SaveData
 * 其中 `<story>` 取 `engine.options.uid`（story.config.ts 里的故事 GUID，稳定），缺省回退故事名，
 * 保证不同故事互不串档。
 */

const VERSION = 1;

/** 故事命名空间：优先稳定 GUID，缺省回退故事名。 */
function storyKey(engine: Engine<object>): string {
  return engine.options.uid || engine.options.name || 'default';
}

function keysFor(engine: Engine<object>): { registry: string; slot: (id: string) => string } {
  const ns = storyKey(engine);
  return {
    registry: `milkshake:${ns}:saves`,
    slot: (id: string) => `milkshake:${ns}:save:${id}`,
  };
}

export interface SaveMeta {
  id: string;
  label: string;
  savedAt: number;
  passage: string;
}

export interface SaveData<T extends object> extends SaveMeta {
  version: number;
  variables: T;
  history: string[];
  visits: [string, number][];
  turns: number;
  previous?: string;
}

/* ---------------- 存储底层 ---------------- */

function readRegistry(engine: Engine<object>): SaveMeta[] {
  const { registry } = keysFor(engine);
  try {
    const raw = localStorage.getItem(registry);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as SaveMeta[]) : [];
  } catch {
    return [];
  }
}

function writeRegistry(engine: Engine<object>, meta: SaveMeta[]) {
  const { registry } = keysFor(engine);
  try {
    localStorage.setItem(registry, JSON.stringify(meta));
  } catch {
    // 隐私模式等场景下可能失败，忽略。
  }
}

/** 列出全部存档位（按保存时间从新到旧）。 */
export function listSaves(engine: Engine<object>): SaveMeta[] {
  return readRegistry(engine).sort((a, b) => b.savedAt - a.savedAt);
}

export function hasSave(engine: Engine<object>): boolean {
  return listSaves(engine).length > 0;
}

/** 生成一个唯一的存档位 id。 */
function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------------- 保存 / 读取 / 删除 ---------------- */

/**
 * 把当前状态保存为一个存档位。
 * - 不传 `id`：新建一个存档位；
 * - 传 `id` 且该存档位存在：覆盖它。
 * 返回写入后的 SaveData。
 */
export function saveGame<T extends object>(engine: Engine<T>, id?: string): SaveData<T> {
  const st = engine.state;
  const { slot } = keysFor(engine);
  const meta = readRegistry(engine);

  let slotId = id;
  if (!slotId || !meta.some(m => m.id === slotId)) slotId = newId();

  const day = (st.variables as Record<string, unknown> | null)?.day as number | undefined;
  const label = `第 ${day ?? '?'} 天 · ${st.current ?? '未命名段落'}`;

  const data: SaveData<T> = {
    id: slotId,
    version: VERSION,
    label,
    savedAt: Date.now(),
    passage: st.current ?? '',
    variables: structuredClone(st.variables),
    history: [...st.history],
    visits: [...st.visits.entries()],
    turns: st.turns,
    previous: st.previous,
  };

  try {
    localStorage.setItem(slot(slotId), JSON.stringify(data));
  } catch {
    // 忽略写入失败。
  }

  const idx = meta.findIndex(m => m.id === slotId);
  const entry: SaveMeta = { id: slotId, label, savedAt: data.savedAt, passage: data.passage };
  if (idx >= 0) meta[idx] = entry;
  else meta.push(entry);
  writeRegistry(engine, meta);

  return data;
}

/** 从指定存档位读取并写回引擎状态。返回是否成功。 */
export function loadGame<T extends object>(engine: Engine<T>, id: string): boolean {
  const { slot } = keysFor(engine);
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(slot(id));
  } catch {
    return false;
  }
  if (!raw) return false;

  let data: SaveData<T>;
  try {
    data = JSON.parse(raw) as SaveData<T>;
  } catch {
    return false;
  }

  const st = engine.state;
  st.variables = data.variables ?? (st.variables as T);
  st.history = data.history ?? [];
  st.visits = new Map(data.visits ?? []);
  st.turns = data.turns ?? 0;
  st.current = data.passage || st.current;
  st.previous = data.previous;
  engine.pendingNav = null;
  return true;
}

/** 删除指定存档位。返回是否删除成功。 */
export function deleteSave(engine: Engine<object>, id: string): boolean {
  const { slot } = keysFor(engine);
  let existed = false;
  try {
    localStorage.removeItem(slot(id));
    existed = localStorage.getItem(slot(id)) === null;
  } catch {
    return false;
  }
  const meta = readRegistry(engine).filter(m => m.id !== id);
  writeRegistry(engine, meta);
  return existed;
}

/** 用当前存档重新渲染当前段落（读档后调用，刷新页面上的链接与文本）。 */
export async function repaint<T extends object>(
  engine: Engine<T>,
  paint: (result: unknown) => Promise<void>,
): Promise<void> {
  const result = await engine.renderCurrent();
  await paint(result);
}

/* ---------------- 宏 / 助手 ---------------- */

export function install(ctx: StoryContext) {
  ctx.registerMacro({
    name: 'save',
    run: () => {
      const d = saveGame(ctx.engine);
      return `\n💾 已存档（${d.label}，${new Date(d.savedAt).toLocaleTimeString()}）。当前共 ${listSaves(ctx.engine).length} 个存档位。`;
    },
  });

  ctx.registerHelper('hasSave', () => hasSave(ctx.engine));
  ctx.registerHelper('saves', () => listSaves(ctx.engine));
}
