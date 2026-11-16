# AGENTS.md -- Tab Out 项目理解与开发手册

本文件面向后续接手本仓库的 coding agent。用户要求：永远用中文回复。

## 项目定位

Tab Out 是一个 Chrome Manifest V3 扩展，核心目标是在 Chrome 里替换默认新标签页，提供一个本地优先的个人工作台。它不是 Web SaaS，也没有后端服务；安装方式是把 `extension/` 目录作为“已解压的扩展程序”加载到 Chrome。

当前产品形态：

- 新标签页首页：`extension/index.html`
- Manifest：`extension/manifest.json`
- 新标签页覆盖：`chrome_url_overrides.newtab = "index.html"`
- 扩展权限：`tabs`、`activeTab`、`storage`
- 主数据存储：`chrome.storage.local`
- 自动备份索引：IndexedDB `TabOutBackups`

这个项目原始能力是标签页管理：按域名分组展示当前所有打开的 tab、关闭重复 tab、保存稍后处理 tab。当前 fork 已扩展为一个 GTD 工作台，包含 GTD 四象限、番茄钟、微笔记、Excalidraw 白板、Tiptap 笔记、draw.io 结构图、自动备份和动态背景图。

## 目录结构

关键文件：

- `extension/index.html`：新标签页主 HTML，加载 `style.css`、`jszip.min.js`、`backup.js`、`gtd.js`、`memo.js`、`app.js`。
- `extension/app.js`：主工作台控制器。负责读取 Chrome tabs、渲染标签页分组、接线 GTD/微笔记/备份、动态背景、Toast、全局事件委托。
- `extension/style.css`：主工作台样式。包含背景、Header、GTD、工作台 tab、标签卡片、备份、微笔记等样式。
- `extension/gtd.js`：GTD 纯逻辑模块，支持 CommonJS 测试和浏览器全局 `window.TabOutGTD`。负责四象限数据模型、任务/步骤增删改、拖拽排序、Markdown 导入导出、工作台 shell HTML 渲染。
- `extension/memo.js`：微笔记纯逻辑模块，支持 `window.TabOutMemo`。负责 memo 数据模型、标签提取、面板 HTML 渲染。
- `extension/backup.js`：每日自动备份。读取多个 `chrome.storage.local` key，生成 ZIP，写入 IndexedDB，并支持从备份面板下载。
- `extension/whiteboard/*`：Excalidraw 白板子应用，React + Vite 构建到 `extension/whiteboard/dist/` 后被主工作台 iframe 嵌入。
- `extension/notes/*`：Tiptap 笔记子应用，React + Vite 构建到 `extension/notes/dist/` 后被主工作台 iframe 嵌入。
- `extension/structureboard/*`：draw.io/diagrams.net 结构图页面，由主工作台 iframe 嵌入。
- `extension/tests/*.test.js`：Node test 测试，主要覆盖纯逻辑和关键源码结构约束。

仓库根目录：

- `package.json`：测试与构建脚本。
- `package-lock.json`：依赖锁定。
- `package-extension.sh`：打包可分享扩展 ZIP。
- `README.zh-CN.md`：中文产品说明。

## 运行与安装

这是纯 Chrome 扩展，不需要启动开发服务器才能使用主页面。

手动安装：

1. 打开 `chrome://extensions`
2. 打开右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择仓库中的 `extension/` 目录
5. 打开新标签页

常用命令：

```bash
npm test
npm run build:whiteboard
npm run build:notes
npm run build
./package-extension.sh
```

`npm run build` 只构建 React 子应用：白板和笔记。主工作台 `extension/app.js`、`extension/gtd.js`、`extension/memo.js`、`extension/style.css` 是直接被扩展加载的源文件。

## 架构与数据流

主页面加载顺序：

1. `index.html` 建立基础 DOM、背景层、Header、GTD workspace mount、标签页区域、Toast、复用 checklist dialog。
2. `jszip.min.js` 给备份模块生成 ZIP。
3. `backup.js` 注册每日自动备份能力。
4. `gtd.js` 暴露 `window.TabOutGTD`。
5. `memo.js` 暴露 `window.TabOutMemo`。
6. `app.js` 调用 `initializeDashboard()`，加载可选配置、UI 偏好、GTD workspace、动态背景、番茄钟，然后渲染主页面。

主渲染入口：

- `initializeDashboard()`：初始化入口。
- `renderDashboard()`：先 `renderGtdWorkspace()`，再 `renderStaticDashboard()`。
- `renderGtdWorkspace()`：读取当前 GTD scope（日/周/月），调用 `TabOutGTD.renderWorkspaceShell()` 渲染工作台 shell。如果当前 tab 是 `memo` 或 `backup`，再分别渲染对应面板。
- `renderStaticDashboard()`：读取当前所有 Chrome tabs，分组后渲染 open tabs 和 saved for later。

工作台 tab：

- `gtd`：GTD 四象限与 checklist。
- `memo`：微笔记。
- `whiteboard`：iframe 到 `whiteboard/dist/index.html`。
- `notes`：iframe 到 `notes/dist/index.html`。
- `structure`：iframe 到 `structureboard/index.html`。
- `backup`：备份下载面板。

## 存储键

主要 `chrome.storage.local` key：

- `gtdBoards`：GTD 看板集合。key 可能是具体日期 `YYYY-MM-DD`，也可能是 `week-YYYY-Wxx`、`month-YYYY-MM`。
- `tab-out-saved-checklists-v1`：GTD 已保存 checklist 模板。
- `tab-out-memos-v1`：微笔记列表。
- `tab-out-pomodoro`：番茄钟状态。
- `deferred`：稍后处理的标签页清单。
- `tab-out-ui-prefs`：主工作台 UI 偏好，目前包含 GTD 折叠状态和 active scope 等。
- `tab-out-whiteboard-global-v1`：白板全局状态。
- `tab-out-structureboard-global-v1`：结构图状态。
- `tab-out-notes-global-v1`：笔记全局状态。
- `tab-out-notes-multi-v1`：历史/多笔记兼容数据。

非扩展环境 fallback：

- `getGtdStorage()` 在没有 `chrome.storage.local` 时会退回 localStorage key `tab-out-gtd-fallback`，方便本地或测试环境运行部分逻辑。

备份：

- `backup.js` 会把关键 storage keys 打包成 ZIP，存入 IndexedDB `TabOutBackups` 的 `backups` object store。
- 备份保留最近 30 份。

## GTD 重要约定

`extension/gtd.js` 是可测试的纯逻辑模块。修改 GTD 数据模型、导入导出、HTML shell 时，应优先在这里改，并补充 `extension/tests/gtd.test.js`。

GTD scope：

- 日：`YYYY-MM-DD`
- 周：`week-YYYY-Wxx`
- 月：`month-YYYY-MM`

四象限 key：

- `importantUrgent`：重要且紧急
- `importantNotUrgent`：重要不紧急
- `urgentNotImportant`：紧急不重要
- `notImportantNotUrgent`：不重要不紧急

Markdown 导入导出：

- `exportBoardToMarkdown(board)` 输出“今日 GTD 日报”格式。
- `importBoardFromMarkdown(markdown, { date })` 只识别 `## 四象限标题` 下的 markdown task list。
- 导入失败会抛出中文错误，例如“导入失败：不是可识别的 GTD 日报”。

在 `app.js` 里更新当前 GTD scope 应使用 `updateGtdBoard(mutator)`，它会读取当前 active scope、保存并重新渲染。

## UI 与事件约定

主页面使用原生 JS 和事件委托，不是 React。

常见事件入口：

- `initGtdWorkspace()`：GTD、memo、workspace tabbar 相关事件都在这里挂到 `#gtdWorkspace` 或 `#workspaceTabbarMount`。
- 全局 `document.addEventListener('click', ...)`：处理 `data-action` 的标签页操作、复用 checklist dialog、archive toggle 等。

样式约定：

- 主页面保持现有工作台视觉语言，优先复用 `style.css` 的变量和组件形态。
- 这是工具型新标签页，不要做营销 landing page。
- 新入口要考虑 Chrome 扩展 CSP，尽量避免 inline script 新增。
- 如果新增图片/图标，优先放在 `extension/icons` 或纯 CSS/内联 SVG；不要引入远程 UI 资源。

## 白板、笔记、结构图

白板：

- React + Excalidraw。
- 状态逻辑在 `extension/whiteboard/state.js`。
- 构建输出在 `extension/whiteboard/dist/`，主页面通过 iframe 加载。

笔记：

- React + Tiptap。
- 状态逻辑在 `extension/notes/state.js`。
- 构建输出在 `extension/notes/dist/`，主页面通过 iframe 加载。

结构图：

- `extension/structureboard/index.html` + `app.js` + `state.js`。
- 使用 draw.io/diagrams.net embed 思路。

修改 whiteboard/notes 源码后，需要运行对应 build，让 `dist/` 更新，否则扩展加载的还是旧 bundle。当前仓库里 `dist/` 文件可能被跟踪，注意不要误删用户已有构建产物。

## 测试策略

运行全部测试：

```bash
npm test
```

测试使用 Node 内置 test runner。很多测试会直接读取源码文本，检查关键结构是否存在，因此改名、移动函数、改变字符串时可能需要同步测试。

建议：

- 改 `gtd.js` 纯逻辑：补 `extension/tests/gtd.test.js`。
- 改 `memo.js` 纯逻辑：补或更新 memo 测试。
- 改主工作台结构：检查 `workspace-shell.test.js`、`csp.test.js` 等结构测试。
- 改 Chrome 扩展 manifest/CSP：必须跑 `npm test`。

## 开发注意事项

- 当前项目可能有未提交改动；不要回退用户已有修改。
- 不要使用 `git reset --hard`、`git checkout --` 等破坏性命令。
- 手工编辑文件时使用 `apply_patch`。
- 搜索文件优先使用 `rg`。
- 主扩展没有后端。任何外部 AI/API 功能都必须明确由用户配置 URL/API Key，并注意 `manifest.json` 的 `host_permissions` 或 `connect-src` 约束。
- API Key 存在 `chrome.storage.local` 只适合个人本地扩展使用，不要把它写入仓库文件。
- 如果新增可配置模型供应商，优先做 OpenAI-compatible 请求格式，并把 URL/API Key/model 都作为用户配置项保存。
- AI 如果要操作 Tap Out 数据，优先输出结构化 JSON，再用 `TabOutGTD`、`TabOutMemo` 等本地 API 落库，避免直接拼 storage 对象。
- 上传图片若要参与 AI 上下文，需考虑存储体积和 Chrome storage quota；大图更适合转 base64 临时发送或保存到 IndexedDB，而不是长期塞进 `chrome.storage.local`。

## 当前 AI 助手需求理解

用户希望后续在 Tap Out 中加入 AI 助手：

- 页面上增加 AI 助手图标。
- 点击图标弹出 AI 助手对话框，可与 AI 交流。
- AI 上下文来源包括 GTD 历史、微笔记、各页面内容、用户上传图片。
- AI 需要理解 Tap Out 内容结构，能回答今日/本周/月度/年度计划完成情况。
- 用户可粘贴其他 AI 生成的周计划、日计划文本，让助手自动填入 Tap Out 对应的周计划和日计划。
- 用户可配置大模型供应商、URL、API Key 和模型名。

推荐实现路径：

1. 新增 `extension/ai.js` 作为纯逻辑与浏览器 UI 接线模块，避免把模型调用细节塞进 `app.js`。
2. `index.html` 增加悬浮 AI 按钮和对话框 mount，并在 `app.js` 初始化后调用 AI 模块。
3. AI 配置保存到 `chrome.storage.local`，例如 `tab-out-ai-config-v1`。
4. 上下文聚合函数读取 `gtdBoards`、`tab-out-memos-v1`、`deferred`、notes/whiteboard/structureboard 摘要。
5. 与模型通信使用用户配置的 OpenAI-compatible endpoint，例如 POST `${baseUrl}/chat/completions` 或用户完整 URL。
6. “自动填入计划”应要求模型返回严格 JSON，再转换为 `TabOutGTD.normalizeBoard()` 可接受的 board/task/checklist 结构，并通过 `saveScopeBoard()` 写入日/周/月 scope。
7. 最小可行版本先支持文本对话、配置模型、聚合 GTD/微笔记/标签页上下文、从结构化 JSON 导入日/周计划；图片理解和全页面深度索引可后续迭代。
