'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');

function readFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('笔记构建链文件存在，并声明 Tiptap 相关依赖', () => {
  const packageJson = JSON.parse(readFile('package.json'));
  const deps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };

  assert.ok(deps['@tiptap/react']);
  assert.ok(deps['@tiptap/starter-kit']);
  assert.ok(deps['@tiptap/pm']);
  assert.ok(deps['@tiptap/extension-table']);
  assert.ok(deps['@tiptap/extension-table-row']);
  assert.ok(deps['@tiptap/extension-table-cell']);
  assert.ok(deps['@tiptap/extension-table-header']);
  assert.ok(deps.react);
  assert.ok(deps['react-dom']);
  assert.ok(deps.vite);
  assert.ok(deps['@vitejs/plugin-react']);
  assert.match(packageJson.scripts?.['build:notes'] || '', /vite build/);
});

test('笔记页面源码包含工具栏、Tiptap 编辑器与状态脚本接入', () => {
  const indexHtml = readFile('extension/notes/index.html');
  const appJsx = readFile('extension/notes/app.jsx');
  const stateJs = readFile('extension/notes/state.js');
  const styleCss = readFile('extension/notes/style.css');

  assert.match(indexHtml, /state\.js/);
  assert.match(indexHtml, /main\.jsx/);
  assert.match(indexHtml, /color-scheme" content="light dark"/);
  assert.match(appJsx, /useEditor/);
  assert.match(appJsx, /EditorContent/);
  assert.match(appJsx, /StarterKit/);
  assert.match(appJsx, /Table/);
  assert.match(appJsx, /TableRow/);
  assert.match(appJsx, /TableCell/);
  assert.match(appJsx, /TableHeader/);
  assert.match(appJsx, /全屏/);
  assert.match(appJsx, /导入 \.md/);
  assert.match(appJsx, /导出 \.md/);
  assert.match(appJsx, /FALLBACK_TITLE\s*=\s*'笔记'/);
  assert.match(appJsx, /onDoubleClick=/);
  assert.match(appJsx, /notes-title-input/);
  assert.match(appJsx, /downloadTextFile\(buildExportFilename\(title\), serialized/);
  assert.match(appJsx, /accept="\.md,\s*\.markdown,\s*text\/markdown,\s*text\/plain"/);
  assert.match(appJsx, /\.md/);
  assert.match(appJsx, /notes-editor-content/);
  assert.match(appJsx, /notes-editor-icon/);
  assert.match(appJsx, /aria-label=\{label\}/);
  assert.match(appJsx, /title=\{label\}/);
  assert.match(appJsx, /insertTable/);
  assert.match(appJsx, /addColumnAfter/);
  assert.match(appJsx, /addRowAfter/);
  assert.match(appJsx, /deleteTable/);
  assert.match(appJsx, /label="插入表格"/);
  assert.match(appJsx, /label="加列"/);
  assert.match(appJsx, /label="加行"/);
  assert.match(appJsx, /label="删表"/);
  assert.match(stateJs, /NOTES_STORAGE_KEY/);
  assert.match(stateJs, /title:/);
  assert.match(stateJs, /text\/markdown/);
  assert.match(styleCss, /color-scheme:\s*light dark;/);
  assert.match(styleCss, /@media\s*\(prefers-color-scheme:\s*dark\)/);
  assert.match(styleCss, /\.notes-title-input/);
  assert.match(styleCss, /\.ProseMirror/);
  assert.match(styleCss, /\.notes-editor-btn\s*\{[\s\S]*border:\s*none;/);
  assert.match(styleCss, /\.notes-editor-btn\s*\{[\s\S]*background:\s*transparent;/);
  assert.match(styleCss, /\.notes-editor-btn\s*\{[\s\S]*box-shadow:\s*none;/);
  assert.match(styleCss, /\.notes-editor-icon\s*\{/);
  assert.match(styleCss, /\.notes-editor-content table\s*\{/);
  assert.match(styleCss, /\.notes-editor-content th,\s*\n\.notes-editor-content td\s*\{/);
  assert.doesNotMatch(styleCss, /\.notes-editor-btn\.is-active/);
  assert.doesNotMatch(styleCss, /\.notes-editor-btn\s*\{[\s\S]*appearance:\s*auto;/);
  assert.doesNotMatch(appJsx, /Tab Out 工作台/);
});
