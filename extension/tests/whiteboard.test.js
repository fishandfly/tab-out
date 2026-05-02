'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createEmptyWhiteboardState,
  normalizeWhiteboardScene,
  importWhiteboardScene,
  exportWhiteboardScene,
} = require('../whiteboard/state.js');

test('createEmptyWhiteboardState 返回可保存的默认白板场景', () => {
  const state = createEmptyWhiteboardState();

  assert.equal(state.title, '白板');
  assert.equal(state.type, 'excalidraw');
  assert.equal(state.version, 2);
  assert.deepEqual(state.elements, []);
  assert.equal(typeof state.appState, 'object');
  assert.deepEqual(state.files, {});
  assert.equal(typeof state.updatedAt, 'string');
});

test('normalizeWhiteboardScene 会拒绝非法场景对象', () => {
  assert.throws(() => normalizeWhiteboardScene(null), /白板文件无效/);
  assert.throws(() => normalizeWhiteboardScene('bad'), /白板文件无效/);
});

test('normalizeWhiteboardScene 会补齐缺失字段', () => {
  const state = normalizeWhiteboardScene({
    elements: [],
    appState: { viewBackgroundColor: '#ffffff' },
  });

  assert.equal(state.title, '白板');
  assert.equal(state.type, 'excalidraw');
  assert.equal(state.version, 2);
  assert.deepEqual(state.elements, []);
  assert.deepEqual(state.files, {});
  assert.equal(state.appState.viewBackgroundColor, '#ffffff');
});

test('exportWhiteboardScene 与 importWhiteboardScene 可以往返场景', () => {
  const original = normalizeWhiteboardScene({
    title: '项目草图',
    elements: [{ id: 'shape-1', type: 'rectangle', isDeleted: false }],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {
      fileA: { id: 'fileA', mimeType: 'image/png', dataURL: 'data:image/png;base64,abc' },
    },
  });

  const text = exportWhiteboardScene(original);
  const restored = importWhiteboardScene(text);

  assert.equal(restored.title, '项目草图');
  assert.deepEqual(restored.elements, original.elements);
  assert.deepEqual(restored.appState, original.appState);
  assert.deepEqual(restored.files, original.files);
});

test('importWhiteboardScene 会拒绝非 JSON 内容', () => {
  assert.throws(() => importWhiteboardScene('not-json'), /白板文件无法解析/);
});
