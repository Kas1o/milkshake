import type { InfraModule } from '../../src/web/infra.js';

/**
 * 「存档 / 读档」基础设施模块。
 * 安装后：
 *   - 拷入 scripts/save-system.ts（数据逻辑）与 scripts/save-ui.ts（页面 UI）；
 *   - 在 layout.ts 侧栏菜单加入「存档 / 读档」按钮并接线；
 *   - 在 styles.css 追加读档面板样式。
 * 提供 <<save>> 宏与 hasSave() / saves() 助手。
 */
const module: InfraModule = {
  id: 'save',
  label: '存档 / 读档',
  description: '多存档位系统（localStorage），侧栏「存档/读档」面板 + <<save>> 宏。',

  files: ['scripts/save-system.ts', 'scripts/save-ui.ts'],

  patches: [
    // 1) 侧栏菜单加入两个按钮（anchor 定位到重新开始一项之后）。
    {
      file: 'scripts/layout.ts',
      anchor: '<ul><li><a href="#" id="menu-restart">重新开始</a></li></ul>',
      insert:
        '\n              <li><a href="#" id="menu-save">存档</a></li>\n              <li><a href="#" id="menu-load">读档</a></li>',
    },
    // 2) 顶部引入 save-ui。
    {
      file: 'scripts/layout.ts',
      anchor: 'export const layout = {',
      mode: 'before',
      insert: "import { initSaveUI } from './save-ui.js';\n\n",
    },
    // 3) init 里接线（repaint 回调引用本文件的 layout.render，保证读档能重绘）。
    {
      file: 'scripts/layout.ts',
      anchor: '    void engine;',
      mode: 'after',
      insert: '\n    initSaveUI(ctrl, result => layout.render(ctrl, result));',
    },
    // 4) 样式追加到 styles.css 末尾。
    {
      file: 'styles.css',
      mode: 'append',
      insert: `
/* 存档 / 读档面板（milkshake --with save 注入）。 */
.save-overlay {
  position: fixed; inset: 0; z-index: 110;
  background: rgba(0, 0, 0, .6);
  display: flex; align-items: center; justify-content: center;
}
.save-window {
  width: min(30em, 90vw);
  background: #1d1d1d; border: 1px solid #444; border-radius: 8px;
  padding: 1.2em 1.4em; box-shadow: 0 8px 30px rgba(0, 0, 0, .5);
}
.save-window h3 { margin: 0 0 .8em; }
.save-slots { list-style: none; margin: 0 0 .8em; padding: 0; max-height: 50vh; overflow-y: auto; }
.save-slots li {
  display: flex; align-items: center; gap: .6em;
  padding: .5em .6em; margin: .35em 0;
  background: rgba(255, 255, 255, .05); border-radius: 6px;
}
.save-slots li.save-empty { background: none; opacity: .6; }
.save-info { flex: 1; font-size: .9em; }
.save-slots button { flex: none; }
.save-delete { color: #ff8a8a; }
.save-close { margin-top: .4em; padding: .4em 1.2em; }
button {
  background: rgba(255, 255, 255, .12); color: inherit;
  border: 1px solid #555; border-radius: 5px; padding: .2em .7em; cursor: pointer;
}
button:hover { background: rgba(255, 255, 255, .2); }
`,
    },
  ],
};

export default module;
