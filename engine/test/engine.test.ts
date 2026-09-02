import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/index.js';

const P = (source: string, title = 'Start') => ({ title, source, tags: [], metadata: {} });

test('assignment macro and print', async () => {
  const e = createEngine();
  e.loadPassages([P('<<gold = 10>><<if gold > 5>>rich<</if>><<print gold>>')]);
  const r = await e.start();
  assert.equal(r.text, 'rich10');
});

test('compound assignment macro', async () => {
  const e = createEngine();
  e.loadPassages([P('<<set n = 5>><<n += 3>><<print n>>')]);
  const r = await e.start();
  assert.equal(r.text, '8');
});

test('statement call macro (method invocation)', async () => {
  const e = createEngine();
  e.loadPassages([P('<<set list = [1]>><<list.push(2)>><<print list.length>>')]);
  const r = await e.start();
  assert.equal(r.text, '2');
});

test('if/elseif/else branches', async () => {
  const e = createEngine();
  e.loadPassages([P('<<x = 2>><<if x == 1>>a<<elseif x == 2>>b<<else>>c<</if>>')]);
  const r = await e.start();
  assert.equal(r.text, 'b');
});

test('turn state and history', async () => {
  const e = createEngine();
  e.loadPassages([P('[[Next->Next]]'), P('hello', 'Next')]);
  const r = await e.start();
  assert.equal(e.state.turns, 1);
  assert.equal(r.links.length, 1);
  await e.choose(r.links[0].id);
  assert.equal(e.state.current, 'Next');
  assert.equal(e.state.turns, 2);
  assert.deepEqual(e.state.history, ['Start', 'Next']);
});

test('link setup runs on choose', async () => {
  const e = createEngine();
  e.loadPassages([P('<<set gold = 0>>[[Go->Next][gold = 5]]'), P('x=${gold}', 'Next')]);
  const r1 = await e.start();
  const r2 = (await e.choose(r1.links[0].id))!;
  assert.equal(r2.text, 'x=5');
});

test('for loop over list', async () => {
  const e = createEngine();
  e.loadPassages([P('<<set list = [1,2,3]>><<for x of list>>[${x}]<</for>>')]);
  const r = await e.start();
  assert.equal(r.text, '[1][2][3]');
});

test('for numeric upto', async () => {
  const e = createEngine();
  e.loadPassages([P('<<for i from 1 upto 3>>${i}<</for>>')]);
  const r = await e.start();
  assert.equal(r.text, '123');
});

test('for JS-style', async () => {
  const e = createEngine();
  e.loadPassages([P('<<for i = 0; i < 3; i++>>${i}<</for>>')]);
  const r = await e.start();
  assert.equal(r.text, '012');
});

test('for JS-style does not leak loop var', async () => {
  const e = createEngine();
  e.loadPassages([P('<<for i = 0; i < 2; i++>>x<</for>><<print has(\'i\') ? "leaked" : "clean">>')]);
  const r = await e.start();
  assert.equal(r.text, 'xxclean');
});

test('transpile TS annotations in script', async () => {
  const e = createEngine();
  e.loadPassages([P('<<script>>let b: number = 5; gold += b; x = (b as number)<</script>><<print x>>')]);
  const r = await e.start();
  assert.equal(r.text, '5');
});

test('widget', async () => {
  const e = createEngine();
  e.loadPassages([P('<<widget "stat" v>>[${v}]<</widget>><<stat 42>>')]);
  const r = await e.start();
  assert.equal(r.text, '[42]');
});

test('hook passage:after modifies text', async () => {
  const e = createEngine();
  e.loadPassages([P('hello')]);
  e.on('passage:after', ({ result }: any) => {
    result.text += '!';
  });
  const r = await e.start();
  assert.equal(r.text, 'hello!');
});

test('custom macro install', async () => {
  const e = createEngine();
  e.registerMacro({ name: 'double', run: c => String(Number(c.eval(c.args)) * 2) });
  e.loadPassages([P('<<double 21>>')]);
  const r = await e.start();
  assert.equal(r.text, '42');
});

test('button re-renders current passage', async () => {
  const e = createEngine();
  e.loadPassages([P('<<if !has(\'n\')>><<set n = 0>><</if>>n=${n}<<button "+">>n += 1<</button>>')]);
  const r1 = await e.start();
  assert.equal(r1.text.replace(/[\uE000](L\d+)[\uE001]/g, ''), 'n=0');
  assert.equal(e.state.turns, 1, '开局占 1 个 turn');
  const r2 = (await e.choose(r1.links[0].id))!;
  assert.equal(r2.text.replace(/[\uE000](L\d+)[\uE001]/g, '').includes('n=1'), true);
  // 点按钮不是导航：不应新增 turn / history 记录。
  assert.equal(e.state.turns, 1, '按钮点击不应增加 turn');
  assert.equal(e.state.history.length, 1, '按钮点击不应新增 history');
});

test('button setup captures loop scope', async () => {
  const e = createEngine();
  e.loadPassages([
    P('<<set gold = 10>>', 'StoryInit'),
    P('<<for i of [2,5]>><<button "buy ${i}">>gold -= i<</button>><</for>>'),
  ]);
  const r = await e.start();
  const r2 = (await e.choose(r.links[0].id))!;
  assert.equal(e.state.variables['gold'], 8);
  await e.choose(r2.links[1].id);
  assert.equal(e.state.variables['gold'], 3);
});

test('goto sets pending nav', async () => {
  const e = createEngine();
  e.loadPassages([P('<<goto "Next">>ignored'), P('arrived', 'Next')]);
  const r1 = await e.start();
  assert.equal(r1.text, 'ignored');
  assert.equal(e.pendingNav, 'Next');
  const r2 = (await e.consumePendingNav())!;
  assert.equal(r2.text, 'arrived');
});

test('StoryInit runs before start', async () => {
  const e = createEngine();
  e.loadPassages([
    P('<<set gold = 100>>', 'StoryInit'),
    P('gold=${gold}'),
  ]);
  const r = await e.start();
  assert.equal(r.text, 'gold=100');
});

test('globals still reachable in expressions', async () => {
  const e = createEngine();
  e.loadPassages([P('<<print Math.max(1, 9)>>')]);
  const r = await e.start();
  assert.equal(r.text, '9');
});

test('transpile can be disabled', async () => {
  const e = createEngine({ transpile: false });
  e.loadPassages([P('<<print gold>>')]);
  const r = await e.start();
  assert.equal(r.text, '');
});

test('declared vars seed state as a deep clone', async () => {
  const defaults = { gold: 10, inventory: ['牛奶'] };
  const e = createEngine({ vars: defaults });
  e.loadPassages([P('<<set gold += 5>><<set inventory.push("草莓")>><<print gold>>')]);
  const r = await e.start();
  assert.equal(r.text, '15');
  assert.equal(e.state.variables['gold'], 15);
  // Defaults must stay untouched (state is a clone).
  assert.equal(defaults.gold, 10);
  assert.deepEqual(defaults.inventory, ['牛奶']);
});

test('reset restores declared var defaults', async () => {
  const e = createEngine({ vars: { gold: 10 } });
  e.loadPassages([P('<<set gold = 99>>')]);
  await e.start();
  assert.equal(e.state.variables['gold'], 99);
  e.reset();
  assert.equal(e.state.variables['gold'], 10);
});

test('assigning an undeclared variable throws when vars are declared', async () => {
  const e = createEngine({ vars: { gold: 0 } });
  e.loadPassages([P('<<set glod = 1>>')]);
  await assert.rejects(() => e.start(), /未声明的变量 "glod"/);
});

test('declareVars after construction seeds and guards', async () => {
  const e = createEngine();
  e.declareVars({ hp: 3 } as Record<string, unknown>);
  e.loadPassages([P('hp=${hp}')]);
  const r = await e.start();
  assert.equal(r.text, 'hp=3');
});

test('stringify renders objects/arrays as JSON, not [object Object]', async () => {
  const e = createEngine();
  e.loadPassages([P('<<set arr = [1,2]>><<set obj = { a: 1 }>><<print arr>><<print obj>>')]);
  const r = await e.start();
  assert.equal(r.text, '[1,2]{"a":1}');
});

test('async macro suspends rendering until its promise resolves (blocking side-channel UI)', async () => {
  const e = createEngine();
  let finish!: (v: string) => void;
  e.registerMacro({
    name: 'battle',
    run: () =>
      new Promise<string>(res => {
        finish = res;
      }),
  });
  e.loadPassages([P('start<<battle>>end')]);
  const started = e.start();
  let settled = false;
  void started.then(() => (settled = true));
  await new Promise(r => setTimeout(r, 20));
  assert.equal(settled, false, '渲染必须挂起，等待宏的 Promise（旁路弹窗）');
  finish('victory');
  const r = await started;
  assert.equal(settled, true);
  assert.equal(r.text, 'startvictoryend');
});

test('macro emitHtml registers an inline embed in the render result', async () => {
  const e = createEngine();
  e.registerMacro({
    name: 'field',
    signature: { params: [{ name: 'label', type: 'string' }] },
    run: c => {
      const { marker } = c.emitHtml('<input class="mk-control">');
      return `label:${marker}`;
    },
  });
  e.loadPassages([P('start<<field "x">>end')]);
  const r = await e.start();
  assert.match(r.text, /label:[\uE010]E0[\uE011]/);
  assert.equal(r.embeds.length, 1);
  assert.equal(r.embeds[0].id, 'E0');
  assert.equal(r.embeds[0].html, '<input class="mk-control">');
});
