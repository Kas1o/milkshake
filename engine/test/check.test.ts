import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { checkStory, type CheckIssue } from '../src/check.js';

async function withStory(files: Record<string, string>, fn: (issues: CheckIssue[]) => void) {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-check-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const p = join(dir, name);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, content);
    }
    await fn(await checkStory(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const VARS = `export default { gold: 7, name: '' };\n`;

test('check passes a clean story', async () => {
  await withStory(
    {
      'vars.ts': VARS,
      'a.mksk': ':: A\n[[去集市->Market]]\n<<gold += 1>>\n${name || "无名"}\n',
      'b.mksk': ':: Market\n<<set gold = 5>>\n',
    },
    issues => assert.deepEqual(issues, []),
  );
});

test('check flags missing link and goto targets', async () => {
  await withStory(
    {
      'vars.ts': VARS,
      'a.mksk': ':: A\n[[去->Nowhere]]\n<<goto "AlsoMissing">>\n',
    },
    issues => {
      assert.equal(issues.length, 2);
      assert.ok(issues.some(i => i.message.includes('链接目标「Nowhere」不存在')));
      assert.ok(issues.some(i => i.message.includes('<<goto>> 目标「AlsoMissing」不存在')));
    },
  );
});

test('check flags type errors against vars.ts', async () => {
  await withStory(
    {
      'vars.ts': VARS,
      'a.mksk': ':: A\n<<gold = "oops">>\n',
    },
    issues => {
      assert.equal(issues.length, 1);
      assert.equal(issues[0].passage, 'A');
      assert.ok(issues[0].message.includes('类型错误'));
    },
  );
});

test('check flags assignments to undeclared variables', async () => {
  await withStory(
    {
      'vars.ts': VARS,
      'a.mksk': ':: A\n<<silver = 1>>\n',
    },
    issues => {
      assert.equal(issues.length, 1);
      assert.ok(issues[0].message.includes('silver'));
    },
  );
});

test('check flags widget arity mismatch', async () => {
  await withStory(
    {
      'vars.ts': VARS,
      'w.mksk': ':: W\n<<widget "tip" amount>>\n<<gold += amount>>\n<</widget>>\n',
      'a.mksk': ':: A\n<<tip 1 2>>\n',
    },
    issues => {
      assert.ok(issues.some(i => i.message.includes('<<tip>> 最多接受 1 个参数，实际给了 2 个')));
    },
  );
});

test('check flags duplicate passage titles', async () => {
  await withStory(
    {
      'vars.ts': VARS,
      'a.mksk': ':: Start\nfirst\n',
      'b.mksk': ':: Start\nsecond\n',
    },
    issues => {
      assert.ok(issues.some(i => i.message.includes('重复定义')));
      assert.equal(issues.filter(i => i.message.includes('重复定义')).length, 1);
    },
  );
});

test('check does not flag the loop var of a JS-style for', async () => {
  await withStory(
    {
      'vars.ts': 'export default { n: 5 };\n',
      'a.mksk': ':: A\n<<for i = 0; i < n; i++>>${i}<</for>>\n',
    },
    issues => assert.deepEqual(issues, []),
  );
});

test('check does not flag from/upto range forms', async () => {
  await withStory(
    {
      'vars.ts': 'export default { n: 5, m: 2 };\n',
      'a.mksk': [
        ':: A',
        '<<for i from 1 upto n>>${i}<</for>>',
        '<<for i from m until n>>x<</for>>',
        '<<for i from n downto 1>>x<</for>>',
        '<<for i upto n>>x<</for>>',
      ].join('\n'),
    },
    issues => assert.deepEqual(issues, []),
  );
});

test('check finds widgets defined inside a block macro', async () => {
  await withStory(
    {
      'vars.ts': VARS,
      'a.mksk': ':: A\n<<if gold > 0>><<widget "inset" v>>[${v}]<</widget>><</if>>\n<<inset 3>>\n',
    },
    issues => assert.deepEqual(issues, []),
  );
});

test('check knows the vars / state / engine built-ins', async () => {
  await withStory(
    {
      'vars.ts': VARS,
      'a.mksk': ':: A\n${vars.gold} ${state.turns} ${engine.options.name}\n',
    },
    issues => assert.deepEqual(issues, []),
  );
});

test('check knows the navigation / engine-state built-ins', async () => {
  await withStory(
    {
      'vars.ts': VARS,
      'a.mksk': [
        ':: A',
        '<<button "go">>if (gold >= 20) navigate("A"); else back(); rerender();<</button>>',
        '${engine.pendingNav} ${engine.state.turns} ${engine.passageTitles.length}',
        '',
      ].join('\n'),
    },
    issues => assert.deepEqual(issues, []),
  );
});

test('check flags a missing <<link>> block target', async () => {
  await withStory(
    {
      'vars.ts': VARS,
      'a.mksk': ':: A\n<<link "go">>MissingTarget<</link>>\n',
    },
    issues => {
      assert.equal(issues.length, 1);
      assert.ok(issues[0].message.includes('<<link>> 目标「MissingTarget」不存在'));
    },
  );
});

// A script that registers macros with compile-time signatures.
const SIGNED_SCRIPT = `
export function install(ctx: any) {
  ctx.registerMacro({ name: 'heal', signature: { params: [{ name: 'amount', type: 'number' }] }, run: () => '' });
  ctx.registerMacro({ name: 'greet', signature: { params: [{ name: 'who', type: 'string' }, { name: 'times', type: 'number', optional: true }] }, run: () => '' });
  ctx.registerMacro({ name: 'many', signature: { params: [{ name: 'a', type: 'number' }], rest: { name: 'more', type: 'string' } }, run: () => '' });
}
`;

test('macro signatures: arity + argument types are checked at compile time', async () => {
  await withStory(
    {
      'scripts/m.ts': SIGNED_SCRIPT,
      'vars.ts': VARS,
      'a.mksk': [
        ':: A',
        '<<heal 5>>',
        '<<heal "abc">>',
        '<<heal 5 6>>',
        '<<greet "bob">>',
        '<<greet>>',
        '<<greet 7>>',
        '<<many 1 "a" "b">>',
      ].join('\n'),
    },
    issues => {
      const msgs = issues.map(i => i.message);
      assert.ok(msgs.some(m => m.includes('not assignable to parameter of type \'number\'')), 'heal wrong type');
      assert.ok(msgs.some(m => m.includes('<<heal>> 最多接受 1 个参数')), 'heal too many');
      assert.ok(msgs.some(m => m.includes('<<greet>> 需要至少 1 个参数')), 'greet too few');
      assert.ok(msgs.some(m => m.includes('not assignable to parameter of type \'string\'')), 'greet wrong type');
      assert.equal(issues.length, 4);
    },
  );
});

test('macro signature types resolve against story vars.ts types', async () => {
  await withStory(
    {
      'scripts/m.ts': `
        export function install(ctx: any) {
          ctx.registerMacro({ name: 'wants', signature: { params: [{ name: 'd', type: 'Drink[]' }] }, run: () => '' });
        }
      `,
      'vars.ts': 'export interface Drink { name: string; price: number; }\nexport default { drinks: [] as Drink[], gold: 5 };\n',
      'a.mksk': ':: A\n<<wants drinks>>\n<<wants gold>>\n',
    },
    issues => {
      assert.equal(issues.length, 1);
      assert.ok(issues[0].message.includes('not assignable to parameter of type \'Drink[]\''));
    },
  );
});

test('widget calls with typed params are type-checked', async () => {
  await withStory(
    {
      'vars.ts': VARS,
      'a.mksk': ':: A\n<<widget "stat" value:number>>x<</widget>>\n<<stat 42>>\n<<stat "oops">>\n',
    },
    issues => {
      const msgs = issues.map(i => i.message);
      assert.equal(issues.length, 1);
      assert.ok(msgs.some(m => m.includes('not assignable to parameter of type \'number\'')));
    },
  );
});

test('core macro args are type-checked (goto/button labels must be strings)', async () => {
  await withStory(
    {
      'vars.ts': VARS,
      'a.mksk': ':: A\n<<goto 123>>\n<<button 999>>gold = 5<</button>>\n',
    },
    issues => {
      const msgs = issues.map(i => i.message);
      assert.equal(issues.length, 2);
      assert.ok(msgs.some(m => m.includes("not assignable to parameter of type 'string'")));
    },
  );
});

test('check uses the in-memory override instead of the stale on-disk file', async () => {
  // Disk has a valid passage; the in-memory edit introduces an unclosed block.
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-check-'));
  try {
    const p = join(dir, 'a.mksk');
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, ':: A\n<<button "x">>gold = 1<</button>>\n');
    // Unclosed on disk should be reported by a normal check.
    await writeFile(p, ':: A\n<<button "x">>\n');
    let issues = await checkStory(dir);
    assert.ok(issues.some(i => i.message.includes('解析失败')), 'disk unclosed should be flagged');

    // Restore disk to valid; the override makes the checker see the unclosed edit.
    await writeFile(p, ':: A\n<<button "x">>gold = 1<</button>>\n');
    issues = await checkStory(dir, {
      read: path => (path === p ? ':: A\n<<button "x">>\n' : undefined),
    });
    assert.ok(issues.some(i => i.message.includes('解析失败')), 'override unclosed should be flagged');
    assert.ok(issues.some(i => i.passage === 'A'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
