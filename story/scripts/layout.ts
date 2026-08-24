import type { StoryController, StoryLayout } from '../../engine/src/index.js';
import { saveGame, loadGame, deleteSave, listSaves } from './save-system.js';

let ctrl: StoryController | null = null;

/** 读档面板：列出所有存档位，可读档 / 删除。DOM 只在函数内访问（Node 侧安全）。 */
function openSavesPanel(c: StoryController) {
  const overlay = document.createElement('div');
  overlay.className = 'save-overlay';
  const box = document.createElement('div');
  box.className = 'save-window';

  const title = document.createElement('h3');
  title.textContent = '读档';

  const list = document.createElement('ul');
  list.className = 'save-slots';

  function renderList() {
    list.innerHTML = '';
    const saves = listSaves();
    if (!saves.length) {
      const li = document.createElement('li');
      li.className = 'save-empty';
      li.textContent = '（暂无存档）';
      list.appendChild(li);
      return;
    }
    for (const s of saves) {
      const li = document.createElement('li');
      const info = document.createElement('span');
      info.className = 'save-info';
      info.textContent = `${s.label} · ${new Date(s.savedAt).toLocaleString()}`;

      const loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.textContent = '读档';
      loadBtn.addEventListener('click', async () => {
        if (!loadGame(c.engine, s.id)) return;
        overlay.remove();
        await layout.render(c, await c.engine.renderCurrent());
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'save-delete';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', () => {
        deleteSave(s.id);
        renderList();
      });

      li.append(info, loadBtn, delBtn);
      list.appendChild(li);
    }
  }

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'save-close';
  closeBtn.textContent = '关闭';
  closeBtn.addEventListener('click', () => overlay.remove());

  overlay.addEventListener('click', ev => {
    if (ev.target === overlay) overlay.remove();
  });

  box.append(title, list, closeBtn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  renderList();
}

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
            <ul>
              <li><a href="#" id="menu-restart">重新开始</a></li>
              <li><a href="#" id="menu-save">存档</a></li>
              <li><a href="#" id="menu-load">读档</a></li>
            </ul>
          </nav>
        </div>
        <main id="story"><div id="passages"></div></main>
      </div>`;

    document.getElementById('menu-restart')!.addEventListener('click', ev => {
      ev.preventDefault();
      c.restart();
    });

    // 存档：新建一个存档位（自由数量），写入 localStorage。
    document.getElementById('menu-save')!.addEventListener('click', ev => {
      ev.preventDefault();
      const d = saveGame(c.engine);
      alert(`已新建存档：${d.label}（${new Date(d.savedAt).toLocaleTimeString()}）。当前共 ${listSaves().length} 个存档位。`);
    });

    // 读档：打开面板，从任意存档位恢复并重绘当前段落。
    document.getElementById('menu-load')!.addEventListener('click', ev => {
      ev.preventDefault();
      if (!listSaves().length) {
        alert('还没有任何存档，先点「存档」创建一个吧。');
        return;
      }
      openSavesPanel(c);
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
