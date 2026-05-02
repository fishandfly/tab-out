'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createEmptyStructureboardState,
  normalizeStructureboardDocument,
  importStructureboardDocument,
  exportStructureboardDocument,
} = require('../structureboard/state.js');

test('createEmptyStructureboardState 返回可保存的默认结构图文档', () => {
  const state = createEmptyStructureboardState();

  assert.equal(state.title, '结构图');
  assert.equal(state.type, 'drawio');
  assert.equal(typeof state.xml, 'string');
  assert.match(state.xml, /<mxfile/);
  assert.equal(typeof state.updatedAt, 'string');
});

test('normalizeStructureboardDocument 会拒绝非法文档对象', () => {
  assert.throws(() => normalizeStructureboardDocument(null), /结构图文件无效/);
  assert.throws(() => normalizeStructureboardDocument('bad'), /结构图文件无效/);
});

test('normalizeStructureboardDocument 会补齐缺失字段', () => {
  const state = normalizeStructureboardDocument({
    xml: '<mxfile host="app.diagrams.net"></mxfile>',
  });

  assert.equal(state.title, '结构图');
  assert.equal(state.type, 'drawio');
  assert.match(state.xml, /<mxfile/);
});

test('exportStructureboardDocument 与 importStructureboardDocument 可以往返文档', () => {
  const original = normalizeStructureboardDocument({
    title: '系统结构',
    xml: '<mxfile host="app.diagrams.net"><diagram id="a" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>',
  });

  const text = exportStructureboardDocument(original);
  const restored = importStructureboardDocument(text, {
    title: '系统结构.drawio',
  });

  assert.equal(restored.title, '系统结构');
  assert.equal(restored.type, 'drawio');
  assert.equal(restored.xml, original.xml);
});

test('importStructureboardDocument 会拒绝非 draw.io XML 内容', () => {
  assert.throws(() => importStructureboardDocument('not-xml'), /结构图文件无法解析/);
});
