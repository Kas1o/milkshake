import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkStory, type CheckIssue } from '../src/check.js';

async function withStory(files: Record<string, string>, fn: (issues: CheckIssue[]) => void) {
  const dir = await mkdtemp(join(tmpdir(), 'milkshake-check-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(dir, name), content);
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
      assert.ok(issues.some(i => i.message.includes('<<tip>> 需要 1 个参数，实际给了 2 个')));
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
