'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');

function readFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('结构图页面源码包含 draw.io iframe、工具栏与状态脚本接入', () => {
  const indexHtml = readFile('extension/structureboard/index.html');
  const appJs = readFile('extension/structureboard/app.js');
  const stateJs = readFile('extension/structureboard/state.js');
  const styleCss = readFile('extension/structureboard/style.css');

  assert.match(indexHtml, /state\.js/);
  assert.match(indexHtml, /app\.js/);
  assert.match(indexHtml, /color-scheme" content="light dark"/);
  assert.match(indexHtml, /导入 \.drawio/);
  assert.match(indexHtml, /导出 \.drawio/);
  assert.match(indexHtml, /全屏/);
  assert.match(appJs, /https:\/\/embed\.diagrams\.net/);
  assert.match(appJs, /format=0/);
  assert.match(appJs, /sidebar=0/);
  assert.match(appJs, /prefers-color-scheme:\s*dark/);
  assert.match(appJs, /dark=\$\{isDarkMode \? '1' : '0'\}/);
  assert.match(appJs, /dblclick/);
  assert.match(appJs, /DEFAULT_STRUCTUREBOARD_TITLE\s*=\s*'结构图'/);
  assert.match(appJs, /structureboard-embed-frame/);
  assert.match(stateJs, /STRUCTUREBOARD_STORAGE_KEY/);
  assert.match(styleCss, /color-scheme:\s*light dark;/);
  assert.match(styleCss, /@media\s*\(prefers-color-scheme:\s*dark\)/);
  assert.match(styleCss, /\.structureboard-title\[hidden\],/);
  assert.match(styleCss, /\.structureboard-title-input\[hidden\]\s*\{/);
  assert.match(styleCss, /display:\s*none\s*!important;/);
});
