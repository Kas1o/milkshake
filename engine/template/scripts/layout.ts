/**
 * 默认页面布局：SugarCube 风格左侧边栏 + 底部链接列表。
 * 新增项目时由 `npm run new` 复制到 `scripts/layout.ts`，可自由修改。
 *
 * 导出对象需符合引擎的 StoryLayout 结构：
 *   init(ctrl)            构建页面骨架并绑定控件（只调用一次）
 *   render(ctrl, result)  每次渲染段落时绘制正文与链接
 * 其中 ctrl 提供：
 *   ctrl.engine            引擎实例（读状态、渲染 StoryTitle / StoryCaption 等）
 *   ctrl.md(md)            轻量 Markdown 文本 -> HTML
 *   ctrl.advance()         消费待跳转导航并重新渲染
 *   ctrl.restart()         重新开始
 *   ctrl.choose(id)        选择链接 / 按钮
 */
export const layout = {
  init(ctrl) {
    const engine = ctrl.engine;

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

    document.getElementById('menu-restart').addEventListener('click', ev => {
      ev.preventDefault();
      ctrl.restart();
    });

    void engine;
  },

  async render(ctrl, result) {
    const engine = ctrl.engine;

    // SugarCube 约定：StoryTitle / StoryCaption 段落驱动侧边栏。
    const title = engine.getPassage('StoryTitle')
      ? (await engine.renderPassage('StoryTitle')).text.trim()
      : engine.options.name;
    document.title = title;
    document.getElementById('story-title').textContent = title;
    const captionEl = document.getElementById('story-caption');
    if (engine.getPassage('StoryCaption')) {
      const cap = await engine.renderPassage('StoryCaption');
      captionEl.innerHTML = ctrl.md(cap.text);
      captionEl.style.display = '';
    } else {
      captionEl.style.display = 'none';
    }

    const passagesEl = document.getElementById('passages');
    const old = passagesEl.firstElementChild;
    if (old) old.classList.add('passage-out');

    const el = document.createElement('div');
    el.className = 'passage passage-in';
    el.id = `passage-${result.passage}`;

    const body = document.createElement('div');
    body.className = 'passage-body';
    body.innerHTML = ctrl.md(result.text);
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
          ctrl.choose(link.id);
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
