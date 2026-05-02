'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');

function readFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('白板构建链文件存在，并声明 Excalidraw 相关依赖', () => {
  const packageJson = JSON.parse(readFile('package.json'));
  const deps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };

  assert.ok(deps['@excalidraw/excalidraw']);
  assert.ok(deps.react);
  assert.ok(deps['react-dom']);
  assert.ok(deps.vite);
  assert.ok(deps['@vitejs/plugin-react']);
  assert.match(packageJson.scripts?.['build:whiteboard'] || '', /vite build/);
});

test('白板页面源码包含工具栏、Excalidraw 画布与状态脚本接入', () => {
  const indexHtml = readFile('extension/whiteboard/index.html');
  const appJsx = readFile('extension/whiteboard/app.jsx');
  const styleCss = readFile('extension/whiteboard/style.css');

  assert.match(indexHtml, /state\.js/);
  assert.match(indexHtml, /EXCALIDRAW_ASSET_PATH/);
  assert.match(indexHtml, /color-scheme" content="light dark"/);
  assert.match(appJsx, /Excalidraw/);
  assert.match(appJsx, /全屏/);
  assert.match(appJsx, /导入 \.excalidraw/);
  assert.match(appJsx, /导出 \.excalidraw/);
  assert.match(appJsx, /FALLBACK_TITLE\s*=\s*'白板'/);
  assert.match(appJsx, /onDoubleClick=/);
  assert.match(appJsx, /whiteboard-title-input/);
  assert.match(appJsx, /downloadTextFile\(buildExportFilename\(title\), serialized\)/);
  assert.match(appJsx, /scrollToContent:\s*true/);
  assert.match(appJsx, /prefers-color-scheme:\s*dark/);
  assert.match(appJsx, /theme=\{isDarkMode \? 'dark' : 'light'\}/);
  assert.match(styleCss, /color-scheme:\s*light dark;/);
  assert.match(styleCss, /@media\s*\(prefers-color-scheme:\s*dark\)/);
  assert.doesNotMatch(appJsx, /用 Excalidraw 快速整理想法，内容会自动本地保存。/);
  assert.doesNotMatch(appJsx, /Tab Out 工作台/);
  assert.doesNotMatch(appJsx, /whiteboard-status/);
});
