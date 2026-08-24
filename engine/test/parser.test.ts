import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNodes } from '../src/index.js';

const block = new Set(['if', 'for', 'script', 'widget', 'button']);

test('parses text and macros', () => {
  const nodes = parseNodes('hi <<set $a = 1>> there', { blockMacros: block });
  assert.equal(nodes.length, 3);
  assert.equal(nodes[0].kind, 'text');
  assert.equal(nodes[1].kind, 'macro');
  assert.equal((nodes[1] as any).name, 'set');
});

test('parses if/elseif/else', () => {
  const nodes = parseNodes('<<if $a>1>>A<<elseif $a==1>>B<<else>>C<</if>>', { blockMacros: block });
  const n = nodes[0] as any;
  assert.equal(n.name, 'if');
  assert.equal(n.branches.length, 3);
  assert.equal(n.branches[1].test, '$a==1');
});

test('parses link with setup', () => {
  const nodes = parseNodes('[[Go->Next][$x = 1]]', { blockMacros: block });
  const l = nodes[0] as any;
  assert.equal(l.kind, 'link');
  assert.equal(l.label, 'Go');
  assert.equal(l.target, 'Next');
  assert.equal(l.setup, '$x = 1');
});

test('parses interpolation', () => {
  const nodes = parseNodes('x=${$a + 1}', { blockMacros: block });
  const n = nodes[1] as any;
  assert.equal(n.kind, 'interp');
  assert.equal(n.expr, '$a + 1');
});

test('parses for of', () => {
  const nodes = parseNodes('<<for _i of $list>>x<</for>>', { blockMacros: block });
  const n = nodes[0] as any;
  assert.equal(n.name, 'for');
  assert.equal(n.args, '_i of $list');
});

test('nested blocks and raw script', () => {
  const src = '<<if $a>><<script>>let _x: number = 1<</script>>A<</if>>';
  const nodes = parseNodes(src, { blockMacros: block });
  assert.equal(nodes.length, 1);
  assert.equal((nodes[0] as any).name, 'if');
});
