import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mdToHtml, escapeHtml, inlineLinksToHtml, embedsToHtml } from '../src/web/md.js';

test('escapeHtml escapes HTML metacharacters', () => {
  assert.equal(escapeHtml('<b>"a&b"</b>'), '&lt;b&gt;&quot;a&amp;b&quot;&lt;/b&gt;');
});

test('mdToHtml keeps emphasis inside inline code intact', () => {
  assert.equal(
    mdToHtml('这是 `**不是加粗**` 的代码').trim(),
    '<p>这是 <code>**不是加粗**</code> 的代码</p>',
  );
  assert.equal(
    mdToHtml('`a * b`').trim(),
    '<p><code>a * b</code></p>',
  );
});

test('mdToHtml renders emphasis and mixed formatting', () => {
  assert.equal(
    mdToHtml('*斜体* 和 **粗体** 和 `x`').trim(),
    '<p><em>斜体</em> 和 <strong>粗体</strong> 和 <code>x</code></p>',
  );
});

test('mdToHtml handles headings, lists, blockquote, hr', () => {
  assert.equal(mdToHtml('# 标题').trim(), '<h1>标题</h1>');
  assert.equal(mdToHtml('- a\n- b').trim(), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
  assert.equal(mdToHtml('> 引用').trim(), '<blockquote>引用</blockquote>');
  assert.equal(mdToHtml('---').trim(), '<hr>');
});

test('inlineLinksToHtml replaces sentinels with escaped anchors', () => {
  const html = inlineLinksToHtml(
    `\uE000L0\uE001 与 \uE000L1\uE001`,
    id => (id === 'L0' ? { label: '去 <市场>' } : { label: 'L1' }),
  );
  assert.equal(html, '<a href="#" class="link" data-link="L0">去 &lt;市场&gt;</a> 与 <a href="#" class="link" data-link="L1">L1</a>');
});

test('embedsToHtml replaces embed placeholders with raw html, after md', () => {
  const md = mdToHtml('请填写：\uE010E0\uE011');
  const html = embedsToHtml(md, id => (id === 'E0' ? { html: '<input class="mk-control">' } : undefined));
  assert.equal(html, '<p>请填写：<input class="mk-control"></p>');
  // Unknown embed ids are dropped cleanly.
  assert.equal(embedsToHtml('<p>\uE010E9\uE011</p>', () => undefined), '<p></p>');
});
