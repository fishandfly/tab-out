'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extensionDir = path.resolve(__dirname, '..');

function readExtensionFile(relativePath) {
  return fs.readFileSync(path.join(extensionDir, relativePath), 'utf8');
}

test('index.html 与 app.js 不再包含会触发扩展 CSP 的内联 onerror 处理器', () => {
  const indexHtml = readExtensionFile('index.html');
  const appJs = readExtensionFile('app.js');

  assert.doesNotMatch(indexHtml, /\sonerror=/);
  assert.doesNotMatch(appJs, /\sonerror=/);
});

test('背景图加载失败不会继续写入扩展错误页 warning', () => {
  const appJs = readExtensionFile('app.js');

  assert.doesNotMatch(appJs, /Failed to refresh direct fallback background/);
  assert.doesNotMatch(appJs, /Failed to refresh remote background/);
});

test('Tab Out 重复标签提示条位于 GTD 工作台下方', () => {
  const indexHtml = readExtensionFile('index.html');
  const gtdIndex = indexHtml.indexOf('id="gtdWorkspace"');
  const bannerIndex = indexHtml.indexOf('id="tabOutDupeBanner"');

  assert.notEqual(gtdIndex, -1);
  assert.notEqual(bannerIndex, -1);
  assert.ok(gtdIndex < bannerIndex);
});
