'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extensionDir = path.resolve(__dirname, '..');

function readExtensionFile(relativePath) {
  return fs.readFileSync(path.join(extensionDir, relativePath), 'utf8');
}

test('app.js 管理工作台 tab，并使用 renderWorkspaceShell 渲染白板、笔记与结构图 iframe', () => {
  const appJs = readExtensionFile('app.js');
  const indexHtml = readExtensionFile('index.html');

  assert.match(appJs, /workspaceTab:\s*'gtd'/);
  assert.match(appJs, /renderWorkspaceShell\(board,\s*\{/);
  assert.match(appJs, /whiteboardUrl:\s*getExtensionAssetUrl\('whiteboard\/dist\/index\.html'\)/);
  assert.match(appJs, /notesUrl:\s*getExtensionAssetUrl\('notes\/dist\/index\.html'\)/);
  assert.match(appJs, /structureboardUrl:\s*getExtensionAssetUrl\('structureboard\/index\.html'\)/);
  assert.match(appJs, /data-gtd-action="switch-workspace-tab"|switch-workspace-tab/);
  assert.match(appJs, /uiPrefs\.workspaceTab\s*=/);
  assert.match(appJs, /function normalizeWorkspaceTab\(value\)/);
  assert.match(appJs, /value === 'whiteboard' \|\| value === 'notes' \|\| value === 'structure'/);
  assert.match(appJs, /workspaceTabbarMount/);
  assert.doesNotMatch(appJs, /initHeaderSearch\(\)/);
  assert.match(indexHtml, /id="workspaceTabbarMount"/);
  assert.match(indexHtml, /<div class="header-right">\s*<div class="header-workspace-tabs" id="workspaceTabbarMount"><\/div>\s*<\/div>/);
  assert.doesNotMatch(indexHtml, /id="webSearchForm"/);
});

test('app.js 新开页面时默认回到 GTD，而不是恢复上次工作台 tab', () => {
  const appJs = readExtensionFile('app.js');
  const loadUiPrefsBlock = appJs.match(/function loadUiPrefs\(\)\s*\{[\s\S]*?\n\}/)?.[0] || '';
  const saveUiPrefsBlock = appJs.match(/function saveUiPrefs\(\)\s*\{[\s\S]*?\n\}/)?.[0] || '';

  assert.ok(loadUiPrefsBlock, '应该能找到 loadUiPrefs 函数');
  assert.ok(saveUiPrefsBlock, '应该能找到 saveUiPrefs 函数');
  assert.match(loadUiPrefsBlock, /workspaceTab:\s*'gtd'/);
  assert.doesNotMatch(loadUiPrefsBlock, /normalizeWorkspaceTab\(parsed\.workspaceTab\)/);
  assert.doesNotMatch(saveUiPrefsBlock, /workspaceTab/);
});

test('style.css 包含工作台 tab、白板、笔记与结构图嵌入样式', () => {
  const styleCss = readExtensionFile('style.css');

  assert.match(styleCss, /\.workspace-shell\s*\{/);
  assert.match(styleCss, /\.workspace-tabbar\s*\{/);
  assert.match(styleCss, /\.workspace-panel-whiteboard\s*\{/);
  assert.match(styleCss, /\.whiteboard-embed-frame\s*\{/);
  assert.match(styleCss, /\.workspace-panel-notes\s*\{/);
  assert.match(styleCss, /\.notes-embed-frame\s*\{/);
  assert.match(styleCss, /\.workspace-panel-structure\s*\{/);
  assert.match(styleCss, /\.structureboard-embed-frame\s*\{/);
  assert.match(styleCss, /color-scheme:\s*light dark;/);
  assert.match(styleCss, /@media\s*\(prefers-color-scheme:\s*dark\)/);
});

test('style.css 让标题区透明，并为心灵鸡汤文字提供白字黑影与居中对齐', () => {
  const styleCss = readExtensionFile('style.css');

  assert.match(styleCss, /header\s*\{[\s\S]*align-items:\s*center;/);
  assert.match(styleCss, /header\s*\{[\s\S]*background:\s*transparent;/);
  assert.match(styleCss, /\.header-left\s*\{[\s\S]*justify-content:\s*center;/);
  assert.match(styleCss, /\.header-left h1\s*\{[\s\S]*text-shadow:/);
  assert.match(styleCss, /\.header-left h1\s*\{[\s\S]*color:\s*rgba\(255,\s*255,\s*255,\s*0\.98\);/);
  assert.match(styleCss, /\.header-left h1\s*\{[\s\S]*rgba\(0,\s*0,\s*0,\s*0\.[0-9]+\)/);
  assert.doesNotMatch(styleCss, /\.header-left h1\s*\{[\s\S]*-webkit-text-stroke:/);
  assert.doesNotMatch(styleCss, /\.header-left h1\s*\{[\s\S]*paint-order:\s*stroke fill;/);
  assert.doesNotMatch(styleCss, /background:\s*rgba\(255,\s*253,\s*249,\s*0\.52\);/);
  assert.doesNotMatch(styleCss, /body\.has-background-photo header\s*\{/);
});

test('style.css 为 GTD 导入导出按钮提供独立的暗色模式样式，避免浅底白字', () => {
  const styleCss = readExtensionFile('style.css');
  const darkModeBlock = styleCss.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*\}\s*$/)?.[0] || '';

  assert.ok(darkModeBlock, '应该能找到暗色模式样式块');
  assert.match(darkModeBlock, /\.gtd-header-btn\s*\{/);
  assert.match(darkModeBlock, /\.gtd-header-btn\s*\{[\s\S]*background:/);
  assert.match(darkModeBlock, /\.gtd-header-btn\s*\{[\s\S]*color:\s*#?[a-zA-Z0-9(),.\s%-]+;/);
  assert.doesNotMatch(darkModeBlock, /\.gtd-header-btn\s*\{[\s\S]*background:\s*var\(--ink\)/);
});
