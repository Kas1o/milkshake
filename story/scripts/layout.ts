import type { StoryController, StoryLayout } from '../../engine/src/index.js';

let ctrl: StoryController | null = null;

/**
 * 默认页面布局：SugarCube 风格左侧边栏 + 底部链接列表。
 * 由 engine/template 复制而来，是自定义布局的起点 —— 改这里即可重排页面。
 */
export const layout: StoryLayout = {
  init(c) {
    ctrl = c;

    document.body.innerHTML = `
      <div id="story-container">
        <div id="ui-bar">
          <div id="ui-bar-header">
            <h1 id="story-title"></h1>
            <div id="story-caption"></div>
          </div>
          <nav id="menu">
            <ul><li><a href="#" id="menu-restart">重新开始</a></li></ul>
          </nav>
        </div>
        <main id="story"><div id="passages"></div></main>
      </div>`;

    document.getElementById('menu-restart')!.addEventListener('click', ev => {
      ev.preventDefault();
      c.restart();
    });
  },

  async render(c, result) {
    const engine = c.engine;

    // SugarCube 约定：StoryTitle / StoryCaption 段落驱动侧边栏。
    const title = engine.getPassage('StoryTitle')
      ? (await engine.renderPassage('StoryTitle')).text.trim()
      : engine.options.name;
    document.title = title;
    document.getElementById('story-title')!.textContent = title;
    const captionEl = document.getElementById('story-caption')!;
    if (engine.getPassage('StoryCaption')) {
      const cap = await engine.renderPassage('StoryCaption');
      captionEl.innerHTML = c.md(cap.text);
      captionEl.style.display = '';
    } else {
      captionEl.style.display = 'none';
    }

    const passagesEl = document.getElementById('passages')!;
    // 移除所有多余的历史段落，只保留可能正在淡出的最旧一段，避免快速点击时堆积出重复界面。
    const children = [...passagesEl.children];
    for (let i = 1; i < children.length; i++) children[i].remove();
    const old = passagesEl.firstElementChild;
    if (old) old.classList.add('passage-out');

    const el = document.createElement('div');
    el.className = 'passage passage-in';
    el.id = `passage-${result.passage}`;

    const body = document.createElement('div');
    body.className = 'passage-body';
    body.innerHTML = c.md(result.text);
    el.appendChild(body);

    if (result.links.length) {
      const ul = document.createElement('ul');
      ul.className = 'choices';
      for (const link of result.links) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = link.label;
        a.addEventListener('click', ev => {
          ev.preventDefault();
          c.choose(link.id);
        });
        li.appendChild(a);
        ul.appendChild(li);
      }
      el.appendChild(ul);
    }

    passagesEl.appendChild(el);
    window.scrollTo({ top: 0 });
    if (old) setTimeout(() => old.remove(), 400);
  },
};
