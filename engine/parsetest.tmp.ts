import { parseNodes, splitArgs } from './src/engine/parser.ts';
const block = new Set(['if', 'for', 'script', 'widget', 'button']);
const t = (s: string) => {
  try {
    const n = parseNodes(s, { blockMacros: block });
    console.log('OK  ', JSON.stringify(s), '=>', JSON.stringify(n));
  } catch (e) {
    console.log('ERR ', JSON.stringify(s), '=>', (e as Error).message);
  }
};
t('a [[x->y]] b');
t('a [[x->y][z=[1,2]]] b');
t('<<button "buy\\nmilk">>x<</button>>');
t('<<for i of [1,2]>><<if i>1>>${i}<</if>><</for>>');
t('text {{ not link }}');
t('<<set x = {a:1}>>');
t('<<link "next">>Target<</link>>');
t('<<for i from 1 upto 3>>${i}<</for>>');
t('nested [[a->[[b->c]]]]');
t('quote " inside [[x]]"');
console.log('splitArgs:', JSON.stringify(splitArgs('{enemy: \'a\', hp: 20, gold: 6}')));
