/**
 * 存档系统的页面侧 UI（自包含）。
 * 由 `milkshake new --with save` 注入到项目的 `scripts/layout.ts` 里调用：
 *
 *   import { initSaveUI } from './save-ui.js';
 *   initSaveUI(ctrl, result => layout.render(ctrl, result));
 *
 * `repaint` 是布局提供的重绘回调：读档后用它把恢复的状态画到页面上。
 * 本文件不 import 引擎，使用结构类型，可在任意项目布局中复用。
 */

import { saveGame, loadGame, deleteSave, listSaves } from './save-system.js';

/** 只声明用到的控制器字段，保持对 StoryController 的结构兼容。 */
interface CtrlLike {
  engine: { renderCurrent(): Promise<unknown> };
}
type Repaint = (result: unknown) => Promise<void> | void;

/** 读档面板：列出全部存档位，可读档 / 删除。DOM 只在函数内访问（Node 侧安全）。 */
function openSavesPanel(ctrl: CtrlLike, repaint: Repaint) {
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
        if (!loadGame(ctrl.engine as never, s.id)) return;
        overlay.remove();
        await repaint(await ctrl.engine.renderCurrent());
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

/** 绑定「存档 / 读档」菜单按钮（id 由布局补丁注入），并挂读档面板。 */
export function initSaveUI(ctrl: CtrlLike, repaint: Repaint): void {
  const saveBtn = document.getElementById('menu-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', ev => {
      ev.preventDefault();
      const d = saveGame(ctrl.engine as never);
      alert(`已新建存档：${d.label}（${new Date(d.savedAt).toLocaleTimeString()}）。当前共 ${listSaves().length} 个存档位。`);
    });
  }

  const loadBtn = document.getElementById('menu-load');
  if (loadBtn) {
    loadBtn.addEventListener('click', ev => {
      ev.preventDefault();
      if (!listSaves().length) {
        alert('还没有任何存档，先点「存档」创建一个吧。');
        return;
      }
      openSavesPanel(ctrl, repaint);
    });
  }
}
