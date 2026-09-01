import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCompletionContext, findPassageRefAt } from '../src/shared/context.js';

test('macro name completion right after <<', () => {
  assert.deepEqual(detectCompletionContext('你好 <<'), { kind: 'macro-name', prefix: '' });
  assert.deepEqual(detectCompletionContext('<<if'), { kind: 'macro-name', prefix: 'if' });
  assert.deepEqual(detectCompletionContext('<<set x = 1>> <</'), { kind: 'macro-name', prefix: '' });
});

test('identifier completion inside interpolation', () => {
  assert.deepEqual(detectCompletionContext('${na'), { kind: 'identifier' });
});

test('macro-arg completion reports the macro and current arg index', () => {
  assert.deepEqual(detectCompletionContext('<<heal '), { kind: 'macro-arg', macro: 'heal', argIndex: 0 });
  assert.deepEqual(detectCompletionContext('<<heal 5 '), { kind: 'macro-arg', macro: 'heal', argIndex: 1 });
  assert.deepEqual(detectCompletionContext('<<if gol'), { kind: 'macro-arg', macro: 'if', argIndex: 0 });
});

test('passage title completion after -> and in goto/display', () => {
  assert.deepEqual(detectCompletionContext('[[去->'), { kind: 'passage-title', prefix: '' });
  assert.deepEqual(detectCompletionContext('[[去->Vil'), { kind: 'passage-title', prefix: 'Vil' });
  assert.deepEqual(detectCompletionContext('<<goto "For'), { kind: 'passage-title', prefix: 'For' });
  assert.deepEqual(detectCompletionContext("<<display 'V"), { kind: 'passage-title', prefix: 'V' });
});

test('no completion in plain text or closed constructs', () => {
  assert.deepEqual(detectCompletionContext('普通文本'), { kind: 'none' });
  assert.deepEqual(detectCompletionContext('<<set x = 1>> '), { kind: 'none' });
  assert.deepEqual(detectCompletionContext('${gold} '), { kind: 'none' });
  assert.deepEqual(detectCompletionContext('[[去->Village]] '), { kind: 'none' });
  assert.deepEqual(detectCompletionContext('[[去->Village][flags.'), { kind: 'none' });
});

test('findPassageRefAt finds link target under cursor', () => {
  const line = '选择 [[迎战->MilkShade]] 或 [[逃跑->Village]]';
  const ref = findPassageRefAt(line, line.indexOf('MilkShade') + 2);
  assert.ok(ref);
  assert.equal(ref.target, 'MilkShade');
  const ref2 = findPassageRefAt(line, line.indexOf('Village') + 1);
  assert.ok(ref2);
  assert.equal(ref2.target, 'Village');
});

test('findPassageRefAt finds goto target under cursor', () => {
  const line = '<<goto "Forest">>';
  const ref = findPassageRefAt(line, 9);
  assert.ok(ref);
  assert.equal(ref.target, 'Forest');
  assert.equal(findPassageRefAt(line, 100), null);
});
