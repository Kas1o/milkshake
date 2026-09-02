import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PassageSource } from '../src/types.js';
import { createEngine, makeContext } from '../src/index.js';
import { loadInfraModules, resolveModules } from '../src/web/infra.js';
import { install as installFlow } from '../infra/flow/scripts/flow-macros.js';
import { install as installInteract } from '../infra/interact/scripts/interact-macros.js';

const P = (source: string, title = 'Start'): PassageSource => ({
  title,
  source,
  tags: [],
  metadata: {},
});

function boot(install: (ctx: any) => void, sources: ReturnType<typeof P>[]) {
  const e = createEngine();
  install(makeContext(e));
  e.loadPassages(sources);
  return e;
}

test('infra: flow and interact modules are discovered and resolvable', async () => {
  const mods = await loadInfraModules();
  for (const id of ['flow', 'interact']) {
    assert.ok(mods.find(m => m.id === id), `应发现 ${id} 模块`);
  }
  const resolved = await resolveModules(['interact', 'flow']);
  assert.deepEqual(
    resolved.map(m => m.id).sort(),
    ['flow', 'interact'],
  );
});

test('flow: visitOnce renders block content only once per key', async () => {
  const e = boot(installFlow, [
    P('<<visitOnce "greet">>你好<</visitOnce>>', 'Start'),
    P('<<visitOnce "greet">>你好<</visitOnce>>', 'A'),
  ]);
  // Re-enter same passage twice; block only shows on the first visit.
  const r1 = await e.start();
  assert.match(r1.text, /你好/);
  const r2 = await e.transition('Start');
  assert.ok(!/你好/.test(r2.text), 'second time block is empty');
});

test('flow: counter increments, persists across passages, resettable', async () => {
  const e = boot(installFlow, [
    P('<<counter "loot">>n=${count("loot")}', 'Start'),
    P('<<counter "loot">><<counter "loot">>n=${count("loot")}', 'B'),
    P('<<resetCounter "loot">>n=${count("loot")}', 'C'),
  ]);
  const r1 = await e.start();
  assert.equal(r1.text, 'n=1');
  const r2 = await e.transition('B');
  assert.equal(r2.text, 'n=3');
  const r3 = await e.transition('C');
  assert.equal(r3.text, 'n=0');
});

test('flow: ifVisited / ifNotVisited branch on passage visits', async () => {
  const e = boot(installFlow, [
    P('<<ifNotVisited "B">>new<</ifNotVisited>><<ifVisited "B">>old<</ifVisited>>', 'Start'),
    P('x', 'B'),
  ]);
  const r1 = await e.start();
  assert.equal(r1.text, 'new');
  await e.transition('B');
  await e.transition('Start');
  const r2 = await e.renderCurrent();
  assert.equal(r2.text, 'old');
});

test('interact: ask emits an inline text control (embed) plus a submit button', async () => {
  const e = boot(installInteract, [P('<<ask name "称呼">>', 'Start')]);
  const r = await e.start();
  // An embed carrying an <input> and a button link whose setup writes `name`.
  assert.equal(r.embeds.length, 1);
  assert.match(r.embeds[0].html, /<input class="mk-control"/);
  assert.ok(r.links.length >= 1);
  const btn = r.links.find(l => l.label === '确定');
  assert.ok(btn, 'should emit a 确定 button');
  assert.match(btn!.setup ?? '', /name = /);
});

test('interact: ask stays visible across unrelated re-renders until answered', async () => {
  const e = boot(installInteract, [P('<<ask name>>', 'Start')]);
  await e.start();
  const r2 = await e.renderCurrent();
  // Not answered yet → the widget is still offered on a plain re-render.
  assert.equal(r2.embeds.length, 1);
  assert.equal(r2.links.filter(l => l.label === '确定').length, 1);
});

test('interact: confirm settles (goes one-shot) only after an answer is clicked', async () => {
  const e = boot(installInteract, [P('<<confirm brave "要上吗？">>', 'Start')]);
  const r = await e.start();
  const yes = r.links.find(l => l.label === '是');
  assert.ok(yes);
  const after = await e.choose(yes!.id);
  // choose() ran setup → set brave=true, settleKey marked done, re-rendered.
  assert.equal((e.state.variables as any).brave, true);
  assert.equal(after!.links.filter(l => l.label === '是').length, 0);
  assert.equal(after!.links.filter(l => l.label === '否').length, 0);
});

test('interact: confirm emits yes/no buttons setting a boolean', async () => {
  const e = boot(installInteract, [P('<<confirm brave "要上吗？">>', 'Start')]);
  const r = await e.start();
  assert.equal(r.embeds.length, 0);
  assert.ok(r.links.find(l => l.label === '是')?.setup?.includes('brave = true'));
  assert.ok(r.links.find(l => l.label === '否')?.setup?.includes('brave = false'));
});

test('interact: menu emits one button per option', async () => {
  const e = boot(installInteract, [P('<<menu road "去哪？" "镇子" "森林">>', 'Start')]);
  const r = await e.start();
  const labels = r.links.map(l => l.label);
  assert.deepEqual(labels, ['镇子', '森林']);
  assert.ok(r.links.find(l => l.label === '镇子')?.setup?.includes('road = "镇子"'));
});

test('interact: answering a menu writes the value and settles it', async () => {
  const e = boot(installInteract, [P('<<menu road "去哪？" "镇子" "森林">>', 'Start')]);
  const r = await e.start();
  const town = r.links.find(l => l.label === '镇子');
  assert.ok(town);
  const after = await e.choose(town!.id);
  assert.equal((e.state.variables as any).road, '镇子');
  assert.equal(after!.links.length, 0);
});

