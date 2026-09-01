# Milkshake 使用文档

Milkshake 是一个 Twine / SugarCube 风格的互动小说（Interactive Fiction）引擎，支持：

- TypeScript 表达式（含类型注解），无需学习新语言即可写逻辑；
- 多文件分章节的 `.mksk` 剧本，一个文件可放多个段落；
- 静态类型检查（`milkshake check`）与 Web 导出（`milkshake build`）；
- VS Code 扩展（语法高亮 + 补全 / 跳转 / 诊断）。

本仓库包含 3 个子包 + 1 个构建产物目录：

| 目录 | 作用 |
| ---- | ---- |
| `engine/` | 核心引擎（解析器、宏、表达式求值、状态、静态检查、Web 构建） |
| `story/` | 示例故事《奶昔传说》，全部用 `.mksk` 剧本 + TS 脚本编写 |
| `vscode/` | VS Code 扩展：`.mksk` 语法高亮 + LSP |
| `web-dist/` | `engine` 的 Web 构建产物（`story.js` + `index.html`），勿手改 |

---

## 目录

1. [安装引擎 CLI](#1-安装引擎-cli)
2. [安装 VS Code 插件](#2-安装-vscode-插件)
3. [创建新项目](#3-创建新项目)
4. [新项目的目录结构](#4-新项目的目录结构)
5. [`.mksk` 剧本语法](#5-mksk-剧本语法)
6. [命令参考](#6-命令参考)
7. [系统设计基础（高级开发）](#7-系统设计基础高级开发)

---

## 1. 安装引擎 CLI

`engine/` 是一个 Node.js 包，自带了 `milkshake` 命令行工具（通过 `bin` 字段暴露）。先在 `engine/` 安装依赖：

```bash
cd engine
npm install
```

然后在 `engine/` 目录内即可使用 `npm run ...` 脚本，或通过 npm 链接让 `milkshake` 命令全局可用：

```bash
npm link        # 将 engine 链接为全局命令 `milkshake`
milkshake --help
```

> 说明：`npm run check` / `npm run build` / `npm run new` / `npm run dev` 只是把命令转交给 `cli/milkshake.js`。若你执行过 `npm link`，可直接用 `milkshake` 命令，二者等价。

依赖：Node 18+（需支持 `structuredClone`、`fs.watch` recursive 等）。Windows / macOS / Linux 均可。

---

## 2. 安装 VS Code 插件

`.mksk` 的编辑体验由 `vscode/` 扩展提供（语法高亮 + LSP 补全 / 跳转 / 诊断）。

### 从源码安装（推荐，本地开发）

```bash
cd vscode
npm install
npm run build        # 产出 dist/client.js + dist/server.js
```

然后在 VS Code 中：

1. 打开该目录（`vscode/`）；
2. 按 `F5` 启动「扩展开发宿主」（会先执行 preLaunchTask `npm run build`）；
3. 在新窗口里打开你的故事项目（含 `.mksk` 文件）即可获得语法高亮与 LSP 诊断。

### 打包为 vsix 安装（可选）

```bash
npx @vscode/vsce package
code --install-extension milkshake-0.1.0.vsix
```

### 已安装扩展的验收

打开任意 `.mksk` 文件，应看到：段落标题与宏被高亮；编辑时 LSP 会给出类型错误、目标段落缺失、未声明变量等诊断（含宏参数类型/个数）。宏名补全会展示签名，hover 宏可查看其参数与说明，宏参数里会提示故事变量与段落名。

---

## 3. 创建新项目

用 `milkshake new` 从内置模板初始化一个全新的故事项目：

```bash
milkshake new my-story                  # 目录名即故事名
milkshake new my-story --name 奶昔冒险   # 指定标题
milkshake new my-story --with save      # 顺带安装「存档 / 读档」基础设施
milkshake new my-story --interactive    # 向导：询问标题 + 勾选基础设施
```

或直接用引擎的 npm 脚本：

```bash
cd engine
npm run new -- ../my-story --name 奶昔冒险 --with save
```

参数说明：

| 参数 | 作用 |
| ---- | ---- |
| `<目标目录>` | 要创建项目的位置；目录已存在且非空会报错 |
| `--name <标题>` | 故事标题（写入 `story.config.ts` 与 `00_ui.mksk`） |
| `--with <a,b>` | 安装基础设施模块，逗号分隔（如 `save,battle`） |
| `--interactive` | 交互模式：用提示框询问标题、勾选模块 |

未提供 `--name` / `--with` 且在 TTY 下时，会自动进入交互模式。创建完成后会打印下一步提示：

```bash
cd my-story
milkshake check   # 静态检查
milkshake build   # 导出 Web 到 web-dist/
```

---

## 4. 新项目的目录结构

`milkshake new` 复制 `engine/template/` 的内容，再按需装配基础设施模块。生成的项目是一个**扁平的独立故事目录**：

```
my-story/
├── package.json            # 仅声明 "type": "module"（脚本间运行时 import 必需）
├── story.config.ts         # 故事配置：name / start / uid
├── vars.ts                 # 故事变量的唯一声明处（类型 + 默认值）
├── index.html              # 页面外壳（必须加载 ./story.js）
├── styles.css              # 页面样式（构建时复制为 story.css 并注入 <head>）
├── passages/               # 剧本，按编号前缀排序
│   ├── 00_ui.mksk          # StoryTitle / StoryCaption（驱动侧边栏）
│   └── 01_start.mksk       # 起始段落（tag {start}）
└── scripts/
    └── layout.ts           # 页面布局（构建 DOM + 渲染段落）
```

### 各文件作用

- **`story.config.ts`** — 导出 `{ name, start, uid }`。`name` 是故事标题；`start` 是起始段落名（默认为 `Start`）；`uid` 是 `milkshake new` 生成的故事稳定 GUID，用于存档按故事隔离。
- **`vars.ts`** — **故事变量的唯一声明处**。`interface StoryVars` 声明类型，默认导出默认值对象。开局与「重新开始」时深拷贝默认值；向未在此声明的变量赋值会**直接抛错**。新增变量必须同时补类型与默认值。
- **`passages/*.mksk`** — 剧本正文。按文件名字典序加载，编号前缀控制展示顺序（`00_` 起）。每个文件可含多个段落。
- **`scripts/layout.ts`** — 默认界面（SugarCube 风格左侧边栏 + 底部链接）。导出 `const layout`，含 `init(ctrl)`（构建 DOM、绑定控件，只调用一次）与 `render(ctrl, result)`（每次渲染段落时绘制正文与链接）。可自由修改或整个替换。
- **`index.html`** — 页面外壳，`<!--story-css-->` 是样式注入占位符。
- **`package.json`** — 只声明 `"type": "module"`，否则 Node 会把 `.ts` 按 CJS 处理，默认导入会被 interop 包一层导致脚本间 import 出错。

---

## 5. `.mksk` 剧本语法

`.mksk` 文件由多个**段落（passage）**组成，段落以 `::` 开头。

### 5.1 段落头

```mksk
:: Start {start} meta:key=val
```

- `Start` 是段落标题；
- `{start}` 是标签（可多个，用空格分隔）；
- `meta:key=val` 是元数据（可多个），其中 `key` 为字母数字下划线，`val` 不含空格；
- 起始段落由 `story.config.ts` 的 `start` 决定（模板里同时打上 `{start}` 标签，二者含义可不同，实际以配置为准）。

特殊段落：
- `StoryInit` — 开局前执行（可放初始化逻辑）。
- `StoryTitle` / `StoryCaption` — 驱动 UI 侧边栏的标题与说明（SugarCube 约定）。

### 5.2 内联 Markdown

段落正文支持轻量 Markdown：`**加粗**`、`*斜体*`、`` `代码` ``、列表、标题 `#`、引用 `>` 等。

### 5.3 表达式插值

```mksk
${gold}
${hp} / ${maxhp}
${name || '无名旅人'}
```

`${...}` 内是 TypeScript 表达式，运行时求值后转为字符串。表达式可写任意合法 TS（含类型注解、`as`）。

### 5.4 链接

```mksk
[[目标]]                       # 标签与目标同名
[[标签->目标]]                 # 显式标签 + 目标
[[标签|目标]]                  # 同上（SugarCube 风格竖线）
[[去市场->Market][gold -= 5]]  # 带 setup：点击时执行一条语句
```

点击链接会跳转到 `target` 段落；`setup` 会在跳转前对捕获的作用域执行（常用于扣钱、设标记等副作用）。

### 5.5 宏（`<<...>>`）

#### 赋值 / 执行

```mksk
<<set gold += 5>>            // 赋值（可写任意 TS 语句，可带分号）
<<run gold += 1; hp-->>      // 执行语句
<<print gold>>               // 输出表达式求值结果
<<= gold>>                   // 等价于 <<print>>
<<comment ...>>              // 注释，不产生输出
```

#### 条件

```mksk
<<if gold >= 20>>富裕
<<elseif gold >= 10>>一般
<<else>>贫穷
<</if>>
```

`elseif` / `else` 在 `<<if>>` 内部使用；`<</if>>` 也可写作 `<</endif>>`。

#### 循环

```mksk
<<for i from 1 upto 3>>${i}<</for>>          // 1..3 含端点
<<for i from 1 until 3>>${i}<</for>>          // 1..2 不含端点
<<for i from 10 downto 1>>${i}<</for>>        // 10..1
<<for item of items>>${item}<</for>>          // 遍历可迭代对象
<<for k in obj>>${k}<</for>>                  // 遍历对象键
<<for i = 0; i < n; i++>>${i}<</for>>         // C 风格（三部分以分号分隔）
```

#### 脚本 / 按钮

```mksk
<<script>>
let x: number = 1;
gold += x;
<</script>>
```

`<<script>>` 内可写多行 TypeScript（支持类型注解），运行时转译后执行。

```mksk
<<button "喝一口">>hp = Math.min(hp + 20, maxhp)<</button>>
```

`<<button>>` 渲染一个按钮，点击后执行其内容（作为语句），并重渲染当前段落（按钮点击不算导航，不会新增 history / turn）。

#### 其它

```mksk
<<display "SomePassage">>      // 内联渲染另一个段落
<<goto "Next">>                // 跳转（同 <<navigate>>）
<<return>> / <<back>>          // 返回上一段落
<<stop>>                       // 停止当前段落后续渲染
<<link "标签">>Target<</link>> // 块级链接：内容为标签，文本为目标
<<widget "名称" 参数...>>
  ...模板...
<</widget>>
```

`<<widget>>` 定义一个可复用的片段宏，之后可直接调用 `<<名称 实参...>>`。参数可声明类型：`<<widget "stat" value:number>>`，则调用 `<<stat ...>>` 时会做参数类型检查。

> 宏的参数会在**编译期**被校验：脚本里注册的宏若声明了 `signature`（见 §7.3），`milkshake check` / LSP 会对每次调用的**参数个数**与**参数类型**做检查，把宏用错提前到编译期而非运行时报错。示例 `story/scripts/custom-macros.ts` 展示了 `heal` / `enemy` / `battle` 等宏的签名写法。

### 5.6 内建作用域（可在表达式中直接使用）

| 名字 | 说明 |
| ---- | ---- |
| `vars` | 故事变量的别名对象 |
| `state` | 引擎状态（`variables` / `history` / `visits` / `turns` / `current` / `previous`） |
| `engine` | 引擎实例 |
| `passage()` | 当前段落名 |
| `turns()` | 当前回合数 |
| `history()` | 历史段落名数组 |
| `visited(name)` | 某段落被访问次数 |
| `random([min], [max])` | 随机数（`random()` 0~1；`random(n)` 1..n；`random(a,b)` a..b） |
| `dice([n])` | 掷骰子，默认 1..6 |
| `set(k, v)` / `get(k)` / `has(k)` | 读 / 写 / 查故事变量 |
| `str(v)` | 转为字符串（对象 / 数组输出 JSON，不再显示 `[object Object]`） |

> 这些名字会遮蔽同名的故事变量。变量本身在表达式中直接按名字访问，无需加 `vars.` 前缀（`vars.gold` 与 `gold` 等价）。

### 5.7 块级宏的闭合

`if` / `for` / `script` / `button` / `widget` 以及脚本注册的块级宏，用 `<</name>>`（或 `end`、`endname`、`end<name>`，如 `<</endif>>`、`<</endfor>>`）闭合。

---

## 6. 命令参考

在 `engine/` 下运行：

| npm 脚本 | 等价命令 | 作用 |
| ---- | ---- | ---- |
| `npm run check` | `milkshake check [目录]` | 静态检查：目标链接、widget 参数个数、类型错误、未声明变量、重复段落标题 |
| `npm run build` | `milkshake build [目录] [-o 目录]` | `check` + 用 esbuild 导出 Web 到 `web-dist/` |
| `npm run dev` | `milkshake dev [目录] [-o 目录] [-p 端口]` | 构建 + 本地静态服务器 + 监听 `.mksk/.ts/.html/.css` 改动自动重构建 |
| `npm run new -- <目录>` | `milkshake new <目录>` | 从模板初始化新故事项目 |
| `npm run typecheck` | — | `tsc --noEmit` 检查引擎源码 |
| `npm test` | — | Node 内置测试（`test/*.test.ts`） |

故事目录解析规则（`resolveStoryDir`）：
1. 显式传入的目录参数优先；
2. 当前目录本身是故事根（含 `passages/`、`story.config.ts` 或 `vars.ts`）→ 用它；
3. 否则找 `./story`，再找 `../story`（即从 `engine/` 运行时的仓库布局）；
4. 找不到则报错。

在 `vscode/` 下运行：

| npm 脚本 | 作用 |
| ---- | ---- |
| `npm run build` | esbuild 打包 `dist/client.js` + `dist/server.js`（CJS） |
| `npm run watch` | 监听模式重新打包 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | 含 LSP e2e 测试，需先 `npm run build` |

---

## 7. 系统设计基础（高级开发）

### 7.1 分层与数据流

```
.mksk / .ts 源码
   │  parsePassageFile / walk + importTsFile
   ▼
loadProject → Engine（注册宏/助手/钩子，加载段落）
   │  runStory（web/app.ts 控制器）
   ▼
Engine.renderCurrent()/transition() → RenderResult { passage, text, links }
   │  applyFilters → 纯文本
   ▼
StoryLayout.render(ctrl, result) → DOM
```

- **`Engine`**（`engine/src/engine/engine.ts`）：状态 + 注册表 + 渲染流程。对外 API：`start` / `transition` / `choose` / `renderPassage` / `renderCurrent` / `reset` / `registerMacro` / `registerHelper` / `addFilter` / `on`。
- **`StoryState`**（`state.ts`）：`variables` / `history` / `visits` / `turns` / `current` / `previous`。
- **`web/app.ts` 的 `runStory`**：浏览器端控制器——安装脚本、加载段落、导航 / 重新开始；布局可插拔。渲染异常会被捕获并渲染为「运行时错误」面板（`engine-error`），而非静默卡死。
- **`StoryLayout` / `StoryController` 接口**：定义自定义布局契约（`init` / `render` + `md` / `advance` / `restart` / `choose`）。默认 UI 在 `template/scripts/layout.ts`。

### 7.2 表达式求值（`expr.ts`）

1. 表达式 / 语句先经 `ts.transpileModule` 转译为 ES2020（仅转译，不做类型检查）。
2. 通过 `new Function('__scope', 'with (__scope) { ... }')` 执行，作用域是一个 `Proxy`。
3. `createScope` 的 `Proxy` 负责：
   - `get`：先在基对象（内建助手 + 脚本助手）里找，再找 `variables`；
   - `set`：写入 `variables`；若目标名字未在 `vars.ts` 声明（且非内建/助手）则抛「未声明变量」错误；
   - `has`：遮蔽全局对象（`Math` 等在 `JS_GLOBALS` 中）以允许裸名访问。

所以「向未声明变量赋值会报错」是 `createScope` 的 `set` 陷阱实现的（`expr.ts`）。

### 7.3 宏系统（`macros.ts` + `engine.ts`）

- 核心宏在 `coreMacros` 数组中，构造 `Engine` 时全部注册。
- 每个宏是 `MacroDef { name, block?, raw?, signature?, run(ctx) }`。
  - `block: true` → 解析器视其为块级宏，内容作为 `content` 传入；
  - `raw: true` → 内容按原文处理（不解析内部宏/插值），如 `script`、`button`。
  - `signature` → **编译期签名**（可选）。描述宏接受的参数（`params` / `rest`，每个参数含 `name` / `type` / `optional`）。有签名时，`milkshake check` 与 LSP 会**在编译期校验调用**：参数个数，以及每个实参表达式是否可赋值给声明的类型——把「宏用错」从运行时错误提前到编译期。`type` 是 TS 类型字符串，会相对故事 `vars.ts` 解析（可用 `number` / `string` / `Drink` / `Drink[]` / `typeof __vars["gold"]` 等）。
- `MacroContext` 提供：`eval` / `evalStr`（求值表达式）、`runScript`（执行语句）、`render`（渲染子节点）、`emitLink`（产出链接）、`navigate`（跳转）、`stop`、`declareLocal`。
- `run` 可返回字符串（追加到输出）或 Promise（支持异步宏，如阻塞式战斗弹窗 `battle`）。
- 未知宏名在渲染时被当作代码尝试执行（兼容 `<<gold += 1>>` 这类简写）；在 `milkshake check` 里，真正未知的宏名会以「未定义标识符」类型错误的形式在编译期报出。

`<<widget>>` 定义也可带类型：`<<widget "stat" value:number>>`，之后 `<<stat 42>>` 会对 `value` 做类型检查。

### 7.4 解析器（`parser.ts`）

手写递归下降式解析，输出 `Node[]`（`text` / `interp` / `link` / `macro`）：

- `parseNodes(source, { blockMacros })`：块级宏名集合影响解析——在 `blockMacros` 中的宏名会压栈并等待闭合。
- 闭合别名：`endif→if`、`endfor→for`、`endscript→script`、`endwidget→widget`、`endbutton→button`，以及 `/` 前缀、`end`。
- `splitArgs` / `splitLinkParts` 都能正确处理引号与嵌套括号。
- 解析器会校验未闭合块、闭合不匹配等语法错误（抛错 → 被 check / 渲染捕获）。

### 7.5 静态检查（`check.ts`）

`checkStory(dir)` 逐段检查并返回 `CheckIssue[]`：

1. 用一次性 `Engine` 安装故事脚本，收集脚本注册的助手与块级宏名（`collectScriptInfo`）；
2. 以「核心块级宏 + 脚本块级宏」为集合解析全部段落；
3. 校验：链接 / `<<goto>>` / `<<display>>` 目标是否存在、widget 参数个数、未知宏、**重复段落标题**；
4. 若存在 `vars.ts`，把所有表达式 / 语句片段收集后，用 `typescript` API 离线做类型检查（`typeCheckSnippets`）——每个片段放进独立 `namespace` 并 `declare` 变量与助手，避免与 lib.dom 全局冲突；
5. 输出带段落、文件与行号定位的问题。

`collectStoryInfo` 供 LSP / 编辑器复用（标题、位置、widget、已知宏、助手、变量名）。脚本信息按 TS 文件 mtime 指纹缓存。

### 7.6 脚本加载（`story.ts`）

- `importTsFile`：无 tsx 时把 `.ts` 转译为 ESM，经 data URL 导入；相对 import/export 说明符改写为**绝对文件 URL**，让脚本之间可做运行时 import。这就要求项目有 `"type": "module"` 的 `package.json`。
- 只会把「导出 `install` 的脚本」当作宏 / 助手 / 钩子安装器收集；`story.config.ts` / `vars.ts` / `layout.ts` 由 `isSpecialScript` 排除。
- `loadProject`：读 vars → 安装脚本 → 加载段落。

### 7.7 基础设施模块（`engine/infra/`）

`milkshake new --with save` 装配的单元。每个模块是 `engine/infra/<id>/` 下的自治包：

- `module.ts` 导出 `default InfraModule`，含 `id / label / description`、`files`（随模块拷入项目）、`patches`（对生成文件做字符串补丁：`file + anchor + insert`，`mode` 为 `after` / `before` / `append`）。
- 装配流程（`web/init.ts`）：复制 base 模板 → 替换标题（`story.config.ts` 与 `00_ui.mksk`）→ 写入稳定 `uid` → `resolveModules`（依赖展开、去重、按依赖排序）→ `applyModules`（拷文件 + 打补丁，**anchor 未命中会报错**而非静默漏装）。
- **设计约定**：模块运行时脚本必须自包含（用结构类型而非 `import` 引擎），因为独立新项目里没有 `../../engine`；check / build 运行时剥离类型。

首个样板模块 `save`（`infra/save/`）：提供 `<<save>>` 宏与 `hasSave()` / `saves()` 助手，序列化 `engine.state` 到 localStorage（`milkshake:<uid>:saves` + `milkshake:<uid>:save:<id>`）。

### 7.8 故事脚本写法（以示例 `story/` 为参考）

`story/scripts/*.ts` 导出 `install(ctx: StoryContext)` 安装宏 / 助手 / 钩子：

```ts
import type { StoryContext } from '../../engine/src/index.js';
import type { StoryVars } from '../vars.js';

export function install(ctx: StoryContext<StoryVars>) {
  ctx.registerMacro({ name: 'heal', run: c => {
    const v = ctx.variables;
    v.hp = Math.min(v.hp + Number(c.eval(c.args) || 0), v.maxhp);
    return `\n体力恢复，当前 ${v.hp}/${v.maxhp}。`;
  }});

  ctx.registerHelper('dice', (n?: number) => Math.floor(Math.random() * (n ?? 6)) + 1);

  ctx.on('passage:after', ({ result }) => {
    if (ctx.variables.hp < 20 && result.text) result.text += `\n\n> 你感觉有些虚弱……`;
  });
}
```

要点：
- `StoryContext` 提供 `engine` / `on` / `registerMacro` / `registerHelper` / `addFilter` / `variables`。
- **钩子事件**：`story:init`（开局）、`passage:before`（返回字符串可重定向当前段）、`passage:after`（可改写 `result.text`）。
- 辅助模块（无 `install`，如战斗弹窗）只作为安装脚本的 import 依赖存在，不会被单独收集。
- **注意**：脚本会被 `npm run check` 在无 DOM 环境 import，因此顶层的 `document` 访问要放进函数内部（如 `custom-macros.ts` 的 `openBattleModal`）。

### 7.9 Web 构建（`web/build.ts`）

1. 收集 `.mksk` 段落与「导出 `install`」的 TS 脚本；
2. 生成 `entry.ts`：`import { runStory } from '...app.js'`，按需 import `vars`、`layout`、各脚本，拼装 `runStory({ title, start, uid, vars, layout, passages, install })`；
3. esbuild 打包为 `story.js`（IIFE、浏览器目标、压缩）；
4. 复制 `index.html`（自定义外壳）与 `styles.css`（→ `story.css`，注入 `<head>` 或替换 `<!--story-css-->`）。

`web/app.ts` 的 `runStory` 就是浏览器端入口（控制器），`StoryLayout` 定义了自定义布局的契约。

---

## 常用工作流

```bash
# 1) 建项目
milkshake new my-story --name 奶昔冒险 --with save

# 2) 边写边预览（自动重构建）
cd my-story
milkshake dev

# 3) 提交前静态检查（类型 / 目标链接 / 未声明变量）
milkshake check

# 4) 导出发布版
milkshake build -o dist
```

编写改动引擎或扩展源码后，请运行对应目录的 `npm run typecheck` 与 `npm test`。
