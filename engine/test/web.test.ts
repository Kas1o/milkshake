import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from '../src/web/init.js';
import { loadInfraModules, resolveModules, applyModules } from '../src/web/infra.js';
import { isSpecialScript, isStoryRoot, resolveStoryDir } from '../src/engine/story.js';
import { createEngine } from '../src/index.js';
import { saveGame, loadGame, listSaves } from '../../story/scripts/save-system.js';
import { checkStory } from '../src/check.js';

test('initProject copies the default project template', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-new-'));
  try {
    await initProject(dir);
    const files = (await readdir(dir)).sort();
    assert.deepEqual(files, [
      'index.html',
      'package.json',
      'passages',
      'scripts',
      'story.config.ts',
      'styles.css',
      'vars.ts',
    ]);
    assert.match(await readFile(join(dir, 'scripts', 'layout.ts'), 'utf8'), /export const layout/);
    assert.match(await readFile(join(dir, 'passages', '00_ui.mksk'), 'utf8'), /StoryTitle/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('initProject refuses a non-empty target directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-new-'));
  try {
    await writeFile(join(dir, 'existing.txt'), 'x');
    await assert.rejects(() => initProject(dir), /不为空/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadInfraModules discovers the save module', async () => {
  const mods = await loadInfraModules();
  const save = mods.find(m => m.id === 'save');
  assert.ok(save, '应发现 save 模块');
  assert.ok(save.files!.includes('scripts/save-system.ts'));
  assert.ok(save.patches!.length >= 3);
});

test('resolveModules: unknown id throws; deps dedupe', async () => {
  await assert.rejects(() => resolveModules(['nope']), /未知的基础设施模块/);
  const [m] = await resolveModules(['save']);
  assert.equal(m.id, 'save');
});

test('initProject with --with save wires the module into the project', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-new-'));
  try {
    await initProject({ dir, title: '测试故事', with: ['save'] });

    // 拷贝的脚本存在。
    const sys = await readFile(join(dir, 'scripts', 'save-system.ts'), 'utf8');
    assert.match(sys, /export function saveGame/);
    const ui = await readFile(join(dir, 'scripts', 'save-ui.ts'), 'utf8');
    assert.match(ui, /export function initSaveUI/);

    // layout.ts 被接线：import + 菜单按钮 + initSaveUI 调用。
    const layout = await readFile(join(dir, 'scripts', 'layout.ts'), 'utf8');
    assert.match(layout, /import \{ initSaveUI \} from '\.\/save-ui\.js'/);
    assert.match(layout, /id="menu-save"/);
    assert.match(layout, /id="menu-load"/);
    assert.match(layout, /initSaveUI\(ctrl/);

    // styles.css 追加面板样式。
    const css = await readFile(join(dir, 'styles.css'), 'utf8');
    assert.match(css, /\.save-window/);

    // 标题被替换。
    assert.match(await readFile(join(dir, 'story.config.ts'), 'utf8'), /name: "测试故事"/);
    assert.match(await readFile(join(dir, 'passages', '00_ui.mksk'), 'utf8'), /测试故事/);

    // 生成的项目能通过静态检查。
    const issues = await checkStory(dir);
    assert.deepEqual(issues, [], `生成的带存档项目应有 0 个检查问题，实际：${JSON.stringify(issues)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('initProject without infra leaves the template untouched', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-new-'));
  try {
    await initProject({ dir, title: '朴素故事' });
    const layout = await readFile(join(dir, 'scripts', 'layout.ts'), 'utf8');
    assert.doesNotMatch(layout, /menu-save/);
    assert.ok(!(await readdir(join(dir, 'scripts'))).some(f => f === 'save-system.ts'));
    const issues = await checkStory(dir);
    assert.deepEqual(issues, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('applyModules reports a missing anchor instead of silently skipping', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-new-'));
  try {
    await initProject({ dir, title: '锚点测试' });
    const mods = await resolveModules(['save']);
    const broken = mods.map(m => ({
      ...m,
      patches: [{ file: 'scripts/layout.ts', anchor: 'THIS-ANCHOR-DOES-NOT-EXIST', insert: 'x' }],
    }));
    const errors = await applyModules(dir, broken);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /anchor 未命中/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('save slots are isolated per story uid', () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };

  const mk = (uid: string) => {
    const e = createEngine({ uid });
    e.state.variables = { gold: 0, day: 1, inventory: [] } as never;
    e.state.current = 'Village';
    return e;
  };

  const a = mk('uid-story-a');
  const b = mk('uid-story-b');
  const sa = saveGame(a);
  const sb = saveGame(b);

  // 各自只看到自己的存档。
  assert.equal(listSaves(a).length, 1);
  assert.equal(listSaves(b).length, 1);
  assert.notEqual(sa.id, sb.id);

  // 跨故事读不到对方的存档。
  assert.equal(loadGame(a, sb.id), false, '故事 A 不应读到故事 B 的存档');
  assert.equal(loadGame(b, sa.id), false, '故事 B 不应读到故事 A 的存档');
  assert.equal(loadGame(a, sa.id), true);
  assert.equal(loadGame(b, sb.id), true);
});

test('story.config.ts gets a uid when the wizard creates a project', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-new-'));
  try {
    await initProject({ dir, title: 'GUID 测试' });
    const cfg = await readFile(join(dir, 'story.config.ts'), 'utf8');
    assert.match(cfg, /\buid:\s*"/);
    const m = cfg.match(/uid:\s*"([^"]+)"/);
    assert.ok(m && m[1].length > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('isSpecialScript excludes layout.ts', () => {
  assert.equal(isSpecialScript('/x/scripts/layout.ts'), true);
  assert.equal(isSpecialScript('/x/layout.ts'), true);
  assert.equal(isSpecialScript('/x/scripts/helpers.ts'), false);
});

test('isStoryRoot detects flat standalone projects', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-root-'));
  try {
    assert.equal(isStoryRoot(dir), false);
    await mkdir(join(dir, 'passages'));
    assert.equal(isStoryRoot(dir), true);
    assert.equal(isStoryRoot(join(dir, 'passages')), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveStoryDir: explicit dirArg wins', async () => {
  const base = await mkdtemp(join(tmpdir(), 'milkshake-res-'));
  const sub = join(base, 'sub');
  await mkdir(sub);
  try {
    assert.equal(resolveStoryDir(base, 'sub'), sub);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('resolveStoryDir: flat project resolves to cwd', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-res-'));
  await mkdir(join(dir, 'passages'));
  try {
    assert.equal(resolveStoryDir(dir), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveStoryDir: prefers story/ subdir over ../story', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-res-'));
  try {
    await mkdir(join(dir, 'story', 'passages'), { recursive: true });
    assert.equal(resolveStoryDir(dir), join(dir, 'story'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveStoryDir: falls back to ../story (engine-repo layout)', async () => {
  const base = await mkdtemp(join(tmpdir(), 'milkshake-res-'));
  try {
    const parent = join(base, 'engine');
    await mkdir(parent);
    await mkdir(join(base, 'story', 'passages'), { recursive: true });
    assert.equal(resolveStoryDir(parent), join(base, 'story'));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('resolveStoryDir: throws when no story root is found', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-res-'));
  try {
    assert.throws(() => resolveStoryDir(dir), /找不到故事目录/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
