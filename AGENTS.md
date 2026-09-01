# AGENTS.md

Milkshake：一个 Twine / SugarCube 风格的互动小说（Interactive Fiction）引擎。
支持 TypeScript 表达式、多文件分章节的 `.mksk` 剧本、静态类型检查与 Web 导出。

仓库包含 3 个子包 + 1 个构建产物目录，**不是 git 仓库**：

| 目录 | 作用 |
| ---- | ---- |
| `engine/` | 核心引擎（解析器、宏、表达式求值、状态、静态检查、Web 构建） |
| `story/` | 示例故事《奶昔传说》，全部用 `.mksk` 剧本 + TS 脚本编写 |
| `vscode/` | VS Code 扩展：`.mksk` 语法高亮 + LSP（补全 / 跳转 / 诊断） |
| `web-dist/` | `engine` 的 Web 构建产物（`story.js` + `index.html`），勿手改 |

## 常用命令

`engine/` 与 `vscode/` 各自独立（各自的 `package.json` / `node_modules`），需在对应目录内运行：

```bash
# engine
npm run check       # 静态检查 story/（走 src/check.ts）
npm run build       # check + 导出 Web 到 web-dist/（src/web/build.ts，esbuild 打包）
npm run new -- <dir> # 初始化新故事项目（src/web/init.ts，向导可选装基础设施）
#   milkshake new <dir> [--name 标题] [--with save,battle] [--interactive]
npm run typecheck   # tsc --noEmit
npm test            # node --import tsx --test "test/*.test.ts"

# vscode
npm run build       # esbuild 打包 dist/client.js + dist/server.js（CJS）
npm run watch       # esbuild 监听模式
npm run typecheck
npm test            # 含 LSP e2e 测试，需先 npm run build
```

技术栈：TypeScript（strict）、ESM（`"type": "module"`）、esbuild、`tsx`、Node 内置 test runner（`node:test`）。
无 jest/mocha/vitest。改动后请运行相关目录的 `npm run typecheck` 与 `npm test`。

> 运行时依赖约束：CLI/向导用 `@inquirer/prompts`（仅 Node 端 init 使用，不会打进 Web 产物）。

## 基础设施模块（`engine/infra/`）

`milkshake new` 的向导按需装配「基础设施模块」到新项目。每个模块是 `engine/infra/<id>/` 下的自治包：

- `module.ts`：导出 `default InfraModule`（见 `engine/src/web/infra.ts` 的 `InfraModule`），含 `id / label / description`、
  `files`（随模块拷入项目的脚本相对路径）与 `patches`（对生成文件做字符串补丁：`file + anchor + insert`，`mode` 为
  `after`/`before`/`append`）。
- 模块脚本必须**自包含**（用结构类型，勿 `import` 引擎），因为独立新项目里没有 `../../engine`；check/build 运行时剥离类型。

`init.ts` 流程：复制 base 模板 → 替换标题（story.config.ts / 00_ui.mksk）→ 依次 `resolveModules`（依赖展开、去重、按依赖排序）→
`applyModules`（拷文件 + 打补丁，anchor 未命中会报错而非静默漏装）。交互模式用 `@inquirer/prompts` 询问标题与多选模块；
非交互用 `--name` / `--with a,b`。首个样板模块：`save`（存档/读档，见 `engine/infra/save/`）。

## .mksk 剧本格式

`.mksk` 文件可包含多个段落（passage），以 `:: 标题 {tags} meta:key=val` 开头；支持块级结构、表达式插值与链接。

```mksk
:: Start {start}
# 标题

普通文本，支持 **加粗** / *斜体* / `代码` / 列表等轻量 Markdown。

${gold}                      // 表达式插值
[[标签->目标]]               // 链接
[[去市场->Market][gold -= 5]]  // 带 setup 的链接（点击时执行）
<<set gold += 5>>            // 宏：赋值
<<if gold >= 20>>富裕<<elseif gold >= 10>>一般<<else>>贫穷<</if>>
<<for i from 1 upto 3>>${i}<</for>>
<<script>>let x: number = 1;<</script>>
<<button "喝一口">>hp = Math.min(hp + 20, maxhp)<</button>>
```

关键约定：

- 表达式 / 脚本可写 TypeScript（含类型注解、`as`），运行时用 TS transpile 后经 `with` + Proxy 作用域执行（`engine/src/engine/expr.ts`）。
- 宏：核心宏见 `coreMacros`（`engine/src/engine/macros.ts`）。块级宏（`if`/`for`/`script`/`button`/`widget` 及脚本注册的）用 `<<name>><</name>>`、`<</name>>`、`endname` 闭合。
- 链接 setup 在 `choose()` 时对捕获作用域执行；按钮（`button`）点击后重渲染当前段。
- 引擎内建作用域：`vars`、`state`、`engine`、`passage`、`turns`、`history`、`visited`、`random`、`dice`、`set`、`get`、`has`、`str`（见 `BUILTIN_HELPER_NAMES`，`engine/src/check.ts`）。
- 特殊段落：`StoryInit`（开局前执行）、`StoryTitle` / `StoryCaption`（驱动 UI 栏）、tag `{start}` 标识起始段（实际起始由 `story.config.ts` 的 `start` 决定）。

## 故事项目约定（story/）

- `story/vars.ts`：**故事变量的唯一声明处**（类型 + 默认值，`export default`）。开局与「重新开始」时深拷贝默认值；**向未声明变量赋值会直接抛错**（`engine/src/engine/expr.ts` 的 `createScope.set`）。新增故事变量必须同时在这里补类型与默认值。
- `story/story.config.ts`：`export default { name, start, uid }`。`uid` 是故事稳定标识（`npm run new` 生成），经 build 注入 `engine.options.uid`，用于存档等按故事隔离（缺省回退故事名）。
- `story/package.json`：`{ "type": "module" }`。**脚本之间做运行时 import 时必须要有**（没有的话 Node 按 CJS 处理 `.ts`，默认导入会被 interop 包一层）。
- `story/scripts/*.ts`：导出 `install(ctx: StoryContext)` 的脚本是宏 / 助手 / 钩子安装器（`ctx.registerMacro`、`ctx.registerHelper`、`ctx.on`），会被 check / build 单独收集；**没有 `install` 的辅助模块**（如 `battle-window.ts`）只作为它们的 import 依赖存在。加载时排除 `story.config.ts`、`vars.ts` 与 `layout.ts`（`isSpecialScript`）。
- `story/scripts/layout.ts`：**页面布局**（默认 UI 的起点）。导出 `const layout: StoryLayout`（`init` 构建 DOM / 绑定控件、`render` 绘制段落），`build.ts` 会把该对象注入 `runStory`。不写 `install`。
- `story/index.html`：页面外壳（必须加载 `./story.js`）；`story/styles.css`：被复制为 `story.css` 并注入 `<head>`（模板里含 `<!--story-css-->` 占位符）。
- `story/passages/*.mksk`：按编号前缀排序（`00_ui` 起）。
- 校验器会收集脚本注册的助手与块级宏名（`collectScriptInfo`），再对全部表达式做类型检查（`typeCheckSnippets` 用 `typescript` API 离线检查）。
- **宏签名**：`MacroDef.signature`（`MacroSignature`，见 `engine/src/engine/macros.ts`）是**编译期元数据**——描述宏的参数（`params` / `rest`，每参数含 `name` / `type` / `optional`）。有签名时，`checkStory` 会校验每次宏调用的**参数个数**并对其做**类型检查**（`type` 相对故事 `vars.ts` 的导出类型解析，如 `Drink` → `import('./story-vars').Drink`）。核心宏、脚本注册宏、`<<widget>>`（参数可写 `name:type`）都参与。LSP 在补全详情与 hover 里展示签名。设计初衷：**能在编译期/检查期报的错，不拖到运行时**。

## 引擎核心文件（engine/src/）

- `engine/engine.ts`：`Engine` 类（状态、宏/助手/钩子/过滤器注册、渲染流程、`start/transition/choose`）。API 经 `src/index.ts` 导出。
- `engine/parser.ts`：`parseNodes`（手写解析器，文本/宏/插值/链接）、`splitArgs`。
- `engine/expr.ts`：`transpileTS`、`createScope`（Proxy 作用域 + 未声明变量拦截）、`evalExpression` / `runStatements`。
- `engine/macros.ts`：`coreMacros` 与 `MacroContext` / `MacroDef` 接口。
- `engine/story.ts`：`walk`、`parsePassageFile` / `parseHeader`、`loadProject` / `loadVars` / `loadConfig`、`importTsFile`（无 tsx 时转译并 data-URL 导入；相对 import 会改写为绝对文件 URL，脚本之间可做运行时 import，要求项目有 `type: module` 的 `package.json`）。
- `engine/state.ts`：`StoryState`（variables / history / visits / turns / current / previous）。
- `engine/passage.ts`：`Passage`（标题 / tags / metadata / source）。
- `web/app.ts`：浏览器端 `runStory`（控制器：安装脚本、加载段落、导航/重新开始；布局可插拔）。`StoryLayout` / `StoryController` 接口定义了自定义布局的契约，默认提供最小内建布局；完整默认 UI 位于 `template/scripts/layout.ts`。`web/md.ts` 轻量 Markdown；`web/build.ts` esbuild 导出；`web/init.ts` 从模板初始化新项目。
- `template/`：新项目的初始化模板（`index.html` / `styles.css` / `vars.ts` / `story.config.ts` / `passages/` / `scripts/layout.ts`），即默认界面所在地。`npm run new -- <dir>` 会整体复制。
- `check.ts`：静态检查器（目标链接、widget 参数个数、类型错误、未声明变量），也是 LSP 诊断与 CLI `npm run check` 的共用入口；提供 `collectStoryInfo` 供编辑器工具链复用。

## VS Code 扩展（vscode/）

- 扩展注册语言 `milkshake`（`.mksk`），语法高亮在 `syntaxes/milkshake.tmLanguage.json`。
- LSP 服务器：`src/server/index.ts`（补全 / 跳转 / 诊断），客户端 `src/client.ts`。
- 服务器通过 `../../../engine/src/check.js` 直接复用引擎的 `checkStory` / `collectStoryInfo`；`src/shared/locate.ts` 向上查找故事根（`vars.ts` 或 `story.config.ts` 所在目录）。
- esbuild 打两个 CJS 包：`dist/client.js`（external `vscode`）、`dist/server.js`（external `typescript`）。
- 调试：F5（`.vscode/launch.json`，preLaunchTask 先 `npm run build`）。
- 改引擎或服务器代码后需 `npm run build` 再跑 e2e 测试。

## 代码风格

- 全部用 TypeScript、strict；ESM，源码内 import 写 `.js` 后缀（NodeNext 约定）。
- 错误消息、检查器输出、示例故事内容使用中文；标识符、API、注释通常为英文。
- 复用既有工具：脚本加载一律走 `importTsFile` / `loadProject`；不要引入新运行时依赖（仅 esbuild / tsx / typescript / vscode-languageserver 等已在用的）。
