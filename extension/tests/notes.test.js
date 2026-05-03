'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const statePath = path.join(__dirname, '..', 'notes', 'state.js');

test('notes state 模块文件存在', () => {
  assert.ok(fs.existsSync(statePath));
});

const {
  createEmptyNotesState,
  normalizeNotesDocument,
  importNotesDocument,
  exportNotesDocument,
} = require('../notes/state.js');

test('createEmptyNotesState 返回可保存的默认笔记文档', () => {
  const state = createEmptyNotesState();

  assert.equal(state.title, '笔记');
  assert.equal(state.type, 'tiptap');
  assert.equal(state.content.type, 'doc');
  assert.equal(typeof state.updatedAt, 'string');
});

test('normalizeNotesDocument 会拒绝非法文档对象', () => {
  assert.throws(() => normalizeNotesDocument(null), /笔记文件无效/);
  assert.throws(() => normalizeNotesDocument('bad'), /笔记文件无效/);
});

test('normalizeNotesDocument 会补齐缺失字段', () => {
  const state = normalizeNotesDocument({
    content: {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    },
  });

  assert.equal(state.title, '笔记');
  assert.equal(state.type, 'tiptap');
  assert.equal(state.content.type, 'doc');
});

test('exportNotesDocument 会导出包含 frontmatter、列表和表格的 Markdown', () => {
  const original = normalizeNotesDocument({
    title: '项目笔记',
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '标题' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '正文内容' }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一项' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二项' }] }],
            },
          ],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '待处理任务' }] }],
            },
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '已完成任务' }] }],
            },
          ],
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '列一' }] }] },
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '列二' }] }] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A1' }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B1' }] }] },
              ],
            },
          ],
        },
      ],
    },
  });

  const markdown = exportNotesDocument(original);

  assert.match(markdown, /^---\ntitle: 项目笔记\n---\n\n## 标题/m);
  assert.match(markdown, /\n正文内容\n/);
  assert.match(markdown, /- 第一项/);
  assert.match(markdown, /- 第二项/);
  assert.match(markdown, /- \[ \] 待处理任务/);
  assert.match(markdown, /- \[x\] 已完成任务/);
  assert.match(markdown, /\| 列一 \| 列二 \|/);
  assert.match(markdown, /\| --- \| --- \|/);
  assert.match(markdown, /\| A1 \| B1 \|/);
});

test('importNotesDocument 可以把导出的 Markdown 还原成可编辑文档', () => {
  const original = normalizeNotesDocument({
    title: '项目笔记',
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '标题' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '正文内容' }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一项' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二项' }] }],
            },
          ],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '待处理任务' }] }],
            },
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '已完成任务' }] }],
            },
          ],
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '列一' }] }] },
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '列二' }] }] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A1' }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B1' }] }] },
              ],
            },
          ],
        },
      ],
    },
  });

  const restored = importNotesDocument(exportNotesDocument(original), {
    title: '项目笔记.md',
  });

  assert.equal(restored.title, '项目笔记');
  assert.equal(restored.type, 'tiptap');
  assert.deepEqual(restored.content, original.content);
});

test('importNotesDocument 可以解析标准 Markdown task list', () => {
  const restored = importNotesDocument([
    '---',
    'title: 任务清单',
    '---',
    '',
    '- [ ] 待处理任务',
    '- [x] 已完成任务',
  ].join('\n'));

  assert.equal(restored.title, '任务清单');
  assert.deepEqual(restored.content, {
    type: 'doc',
    content: [
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '待处理任务' }] }],
          },
          {
            type: 'taskItem',
            attrs: { checked: true },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '已完成任务' }] }],
          },
        ],
      },
    ],
  });
});

test('importNotesDocument 在缺少 frontmatter 时会回退到文件名标题', () => {
  const restored = importNotesDocument('## 临时标题\n\n正文内容', {
    title: '会议纪要.md',
  });

  assert.equal(restored.title, '会议纪要');
  assert.deepEqual(restored.content, {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '临时标题' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '正文内容' }] },
    ],
  });
});

test('importNotesDocument 会拒绝空白或无法识别的 Markdown', () => {
  assert.throws(() => importNotesDocument('   '), /笔记文件为空/);
  assert.throws(() => importNotesDocument('---\ntitle: \n---\n'), /笔记文件无效/);
});
