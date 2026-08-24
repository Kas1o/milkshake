/**
 * 存档 / 读档基础设施（自包含，可随 `milkshake new --with save` 装进任意项目）。
 *
 * 原理：引擎的 `engine.state`（StoryState）字段全部公开可变，把
 * `variables / history / visits / turns / current / previous` 序列化后写入
 * localStorage；读档时原地写回 `engine.state`，再由布局（save-ui.ts）重新渲染。
 *
 * 存储布局（localStorage）：
 *   - `milkshake-saves`      JSON 数组：所有存档位的元信息（id / label / savedAt / passage）
 *   - `milkshake-save:<id>`  单个存档位的完整数据
 *
 * 注意：本文件不 import 引擎，使用结构类型，因此既能在 monorepo 的 story/ 里跑，
 * 也能在独立新项目里跑（check/build 运行时剥离类型）。
 */

/** 只声明本模块实际用到的引擎字段，保持对真实 Engine 的结构兼容。 */
export interface EngineLike<T extends object = Record<string, unknown>> {
  state: {
    variables: T;
    history: string[];
    visits: Map<string, number>;
    turns: number;
    current?: string;
    previous?: string;
  };
  pendingNav: string | null;
}

export interface CtxLike<T extends object = Record<string, unknown>> {
  engine: EngineLike<T>;
  registerMacro(def: { name: string; run: (c: unknown) => unknown }): void;
  registerHelper(name: string, fn: unknown): void;
}

const REGISTRY_KEY = 'milkshake-saves';
const SLOT_PREFIX = 'milkshake-save:';
const VERSION = 1;

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

function readRegistry(): SaveMeta[] {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as SaveMeta[]) : [];
  } catch {
    return [];
  }
}

function writeRegistry(meta: SaveMeta[]) {
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(meta));
  } catch {
    // 隐私模式等场景下可能失败，忽略。
  }
}

/** 列出全部存档位（按保存时间从新到旧）。 */
export function listSaves(): SaveMeta[] {
  return readRegistry().sort((a, b) => b.savedAt - a.savedAt);
}

export function hasSave(): boolean {
  return listSaves().length > 0;
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------------- 保存 / 读取 / 删除 ---------------- */

/** 保存为存档位；不传 `id` 新建，传已存在的 `id` 则覆盖。返回写入后的 SaveData。 */
export function saveGame<T extends object>(engine: EngineLike<T>, id?: string): SaveData<T> {
  const st = engine.state;
  const meta = readRegistry();

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
    localStorage.setItem(SLOT_PREFIX + slotId, JSON.stringify(data));
  } catch {
    // 忽略写入失败。
  }

  const idx = meta.findIndex(m => m.id === slotId);
  const entry: SaveMeta = { id: slotId, label, savedAt: data.savedAt, passage: data.passage };
  if (idx >= 0) meta[idx] = entry;
  else meta.push(entry);
  writeRegistry(meta);

  return data;
}

/** 从指定存档位读取并写回引擎状态。返回是否成功。 */
export function loadGame<T extends object>(engine: EngineLike<T>, id: string): boolean {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SLOT_PREFIX + id);
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
export function deleteSave(id: string): boolean {
  let existed = false;
  try {
    localStorage.removeItem(SLOT_PREFIX + id);
    existed = localStorage.getItem(SLOT_PREFIX + id) === null;
  } catch {
    return false;
  }
  const meta = readRegistry().filter(m => m.id !== id);
  writeRegistry(meta);
  return existed;
}

/* ---------------- 宏 / 助手 ---------------- */

export function install(ctx: CtxLike) {
  ctx.registerMacro({
    name: 'save',
    run: () => {
      const d = saveGame(ctx.engine);
      return `\n💾 已存档（${d.label}，${new Date(d.savedAt).toLocaleTimeString()}）。当前共 ${listSaves().length} 个存档位。`;
    },
  });

  ctx.registerHelper('hasSave', () => hasSave());
  ctx.registerHelper('saves', () => listSaves());
}
