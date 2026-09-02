import type { InfraModule } from '../../src/web/infra.js';

/**
 * 「输入交互」基础设施模块。
 * 安装后拷入 scripts/interact-macros.ts，提供页面内联（非弹窗）交互控件：
 *   - <<ask>>      单行文本输入
 *   - <<confirm>>  是/否
 *   - <<menu>>     选项列表
 * 控件用引擎的 inline-embed 槽位机制内联进正文；每段一次、回答后自动消失，
 * 结果写入目标变量并重绘当前段。纯逻辑经宏注册，样式追加到 styles.css。
 */
const module: InfraModule = {
  id: 'interact',
  label: '输入交互',
  description: '页面内联的 ask / confirm / menu 交互控件宏（非弹窗）。',

  files: ['scripts/interact-macros.ts'],

  patches: [
    {
      file: 'styles.css',
      mode: 'append',
      insert: `
/* 输入交互控件（milkshake --with interact 注入）。 */
.mk-ask {
  display: inline-flex; align-items: baseline; gap: .4em;
  background: rgba(255, 255, 255, .05);
  border: 1px solid #555; border-radius: 6px; padding: .35em .6em;
  margin: .2em 0;
}
.mk-ask label { opacity: .85; }
.mk-control {
  background: #141414; color: inherit;
  border: 1px solid #666; border-radius: 4px; padding: .18em .4em;
  min-width: 10em; font: inherit;
}
.mk-control:focus { outline: none; border-color: #8ab4f8; }
`,
    },
  ],
};

export default module;
