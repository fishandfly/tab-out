'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const extensionDir = path.resolve(__dirname, '..');

const TabOutQuickLinks = require('../quick-links.js');
const TabOutPomodoro = require('../pomodoro.js');
const TabOutDeferredTabs = require('../deferred-tabs.js');
const TabOutBackgroundManager = require('../background-manager.js');
const TabOutGTDDialogs = require('../gtd-dialogs.js');

function createMockStorage(initial = {}) {
  const store = { ...initial };
  return {
    async get(key) {
      return { [key]: store[key] };
    },
    async set(items) {
      Object.assign(store, items);
    },
    _getStore() {
      return store;
    },
  };
}

test('TabOutQuickLinks: extractTabInfo 支持解析多种拖拽数据载荷', () => {
  // 1. application/tabout-tab
  const dt1 = {
    getData(type) {
      if (type === 'application/tabout-tab') {
        return JSON.stringify({ url: 'https://github.com/trending', title: 'GitHub Trending' });
      }
      return '';
    },
  };
  const res1 = TabOutQuickLinks.extractTabInfo(dt1);
  assert.deepEqual(res1, { url: 'https://github.com/trending', title: 'GitHub Trending' });

  // 2. application/json
  const dt2 = {
    getData(type) {
      if (type === 'application/json') {
        return JSON.stringify({ url: 'https://v2ex.com', title: 'V2EX' });
      }
      return '';
    },
  };
  const res2 = TabOutQuickLinks.extractTabInfo(dt2);
  assert.deepEqual(res2, { url: 'https://v2ex.com', title: 'V2EX' });

  // 3. text/uri-list
  const dt3 = {
    getData(type) {
      if (type === 'text/uri-list') return '# comment\r\nhttps://news.ycombinator.com\r\n';
      return '';
    },
  };
  const res3 = TabOutQuickLinks.extractTabInfo(dt3);
  assert.equal(res3.url, 'https://news.ycombinator.com');
  assert.equal(res3.title, 'news.ycombinator.com');

  // 4. text/plain url with html a tag
  const dt4 = {
    getData(type) {
      if (type === 'text/plain') return 'https://example.com/docs/guide';
      if (type === 'text/html') return '<a href="https://example.com/docs/guide">Documentation Guide</a>';
      return '';
    },
  };
  const res4 = TabOutQuickLinks.extractTabInfo(dt4);
  assert.equal(res4.url, 'https://example.com/docs/guide');
  assert.equal(res4.title, 'Documentation Guide');

  // 5. invalid data
  const dtEmpty = { getData: () => '' };
  assert.equal(TabOutQuickLinks.extractTabInfo(dtEmpty), null);
});

test('TabOutQuickLinks: 增删改查、移动分区与渲染', async () => {
  const storage = createMockStorage();

  // 添加链接到默认分区
  const s1 = await TabOutQuickLinks.addQuickLink(storage, 'default', {
    url: 'https://github.com',
    title: 'GitHub',
  });
  assert.equal(s1.partitions[0].links.length, 1);
  assert.equal(s1.partitions[0].links[0].url, 'https://github.com');
  const linkId = s1.partitions[0].links[0].id;

  // 添加新分区
  const s2 = await TabOutQuickLinks.addQuickLinksPartition(storage, '开发');
  assert.equal(s2.partitions.length, 2);
  const devPartId = s2.partitions[1].id;
  assert.equal(s2.partitions[1].name, '开发');

  // 将链接移动到新分区
  const s3 = await TabOutQuickLinks.moveQuickLink(storage, linkId, devPartId);
  assert.equal(s3.partitions[0].links.length, 0);
  assert.equal(s3.partitions[1].links.length, 1);
  assert.equal(s3.partitions[1].links[0].id, linkId);

  // 重命名分区
  const s4 = await TabOutQuickLinks.renameQuickLinksPartition(storage, devPartId, '研发工具');
  assert.equal(s4.partitions[1].name, '研发工具');

  // 渲染 HTML 测试
  const html = TabOutQuickLinks.renderQuickLinksBar(s4);
  assert.match(html, /class="gtd-quick-links-bar"/);
  assert.match(html, /研发工具/);
  assert.match(html, /GitHub/);
  assert.match(html, /data-link-url="https:\/\/github\.com"/);

  // 删除链接
  const s5 = await TabOutQuickLinks.removeQuickLink(storage, linkId);
  assert.equal(s5.partitions[1].links.length, 0);

  // 删除分区
  const s6 = await TabOutQuickLinks.removeQuickLinksPartition(storage, devPartId);
  assert.equal(s6.partitions.length, 1);
});

test('TabOutPomodoro: 状态规范化与计时流转', async () => {
  const idle = TabOutPomodoro.createIdlePomodoroState();
  assert.equal(idle.status, 'idle');
  assert.equal(idle.taskId, '');

  const now = Date.now();
  const running = TabOutPomodoro.normalizePomodoroState({
    taskId: 'task-1',
    taskTitle: '测试任务',
    status: 'running',
    endAt: now + 60000,
  }, now);
  assert.equal(running.status, 'running');
  assert.equal(running.taskId, 'task-1');
  assert.equal(running.remainingMs, 60000);

  // 超时后自动转为 completed
  const expired = TabOutPomodoro.normalizePomodoroState({
    taskId: 'task-1',
    taskTitle: '测试任务',
    status: 'running',
    endAt: now - 1000,
  }, now);
  assert.equal(expired.status, 'completed');
  assert.equal(expired.remainingMs, 0);

  // 初始化与操作测试
  const storage = createMockStorage();
  await TabOutPomodoro.init({ storage });
  await TabOutPomodoro.start('task-2', '开发番茄钟');
  assert.equal(TabOutPomodoro.getState().status, 'running');
  assert.equal(TabOutPomodoro.getState().taskId, 'task-2');

  await TabOutPomodoro.pause();
  assert.equal(TabOutPomodoro.getState().status, 'paused');

  await TabOutPomodoro.reset({ silent: true });
  assert.equal(TabOutPomodoro.getState().status, 'idle');
});

test('TabOutDeferredTabs: 稍后读/已保存标签存储与清单渲染', async () => {
  const storage = createMockStorage();
  TabOutDeferredTabs.init({ storage });

  await TabOutDeferredTabs.saveTabForLater({
    url: 'https://news.ycombinator.com',
    title: 'Hacker News',
  });

  const { active, archived } = await TabOutDeferredTabs.getSavedTabs();
  assert.equal(active.length, 1);
  assert.equal(archived.length, 0);
  assert.equal(active[0].title, 'Hacker News');
  const tabId = active[0].id;

  // 渲染 item
  const itemHtml = TabOutDeferredTabs.renderDeferredItem(active[0]);
  assert.match(itemHtml, /class="deferred-item"/);
  assert.match(itemHtml, /Hacker News/);
  assert.match(itemHtml, /news\.ycombinator\.com/);

  // 勾选归档
  await TabOutDeferredTabs.checkOffSavedTab(tabId);
  const afterCheck = await TabOutDeferredTabs.getSavedTabs();
  assert.equal(afterCheck.active.length, 0);
  assert.equal(afterCheck.archived.length, 1);

  // 彻底移除
  await TabOutDeferredTabs.dismissSavedTab(tabId);
  const afterDismiss = await TabOutDeferredTabs.getSavedTabs();
  assert.equal(afterDismiss.active.length, 0);
  assert.equal(afterDismiss.archived.length, 0);
});

test('TabOutBackgroundManager: 背景轮换与方向选择', () => {
  const dir1 = TabOutBackgroundManager.getNextBackgroundDirection();
  assert.ok(['epic', 'sport'].includes(dir1));

  const dir2 = TabOutBackgroundManager.getNextBackgroundDirection('epic');
  assert.equal(dir2, 'sport');

  const themeInfo = TabOutBackgroundManager.getNextBackgroundTheme('summit-gold', 'epic');
  assert.equal(themeInfo.direction, 'sport');
  assert.ok(typeof themeInfo.theme === 'string' && themeInfo.theme.length > 0);
});

test('TabOutGTDDialogs: 导出函数存在性及渲染清单安全转义', () => {
  assert.equal(typeof TabOutGTDDialogs.init, 'function');
  assert.equal(typeof TabOutGTDDialogs.openReuseDialog, 'function');
  assert.equal(typeof TabOutGTDDialogs.closeReuseDialog, 'function');
  assert.equal(typeof TabOutGTDDialogs.openGtdArchiveDialog, 'function');
  assert.equal(typeof TabOutGTDDialogs.closeGtdArchiveDialog, 'function');
  assert.equal(typeof TabOutGTDDialogs.openEmojiDialog, 'function');
  assert.equal(typeof TabOutGTDDialogs.closeEmojiDialog, 'function');
  assert.equal(typeof TabOutGTDDialogs.applyEmoji, 'function');

  // renderReuseList
  const mockContainer = { innerHTML: '' };
  TabOutGTDDialogs.renderReuseList(mockContainer, [
    {
      id: 'template-1',
      name: '<script>alert(1)</script>模板',
      taskTitle: '测试任务',
      items: [{ text: '步骤一' }, { text: '步骤二' }],
    },
  ]);
  assert.doesNotMatch(mockContainer.innerHTML, /<script>/);
  assert.match(mockContainer.innerHTML, /&lt;script&gt;/);
  assert.match(mockContainer.innerHTML, /模板/);
});

test('app.js 浏览器环境初始化与 GTD 渲染不产生 ReferenceError', async () => {
  const vm = require('node:vm');
  const code = fs.readFileSync(path.join(extensionDir, 'app.js'), 'utf8');
  const mockGtd = require('../gtd.js');
  const mockQuickLinks = require('../quick-links.js');

  let runtimeError = null;
  const context = {
    console: {
      log: () => {},
      warn: () => {},
      error: (...args) => {
        runtimeError = args.join(' ');
      },
    },
    fetch: () => Promise.resolve({ ok: false }),
    setTimeout: (fn) => setTimeout(fn, 1),
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    Date,
    Math,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    JSON,
    URL,
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
    requestAnimationFrame: () => {},
    document: {
      documentElement: { dataset: {} },
      getElementById: (id) => ({
        id,
        innerHTML: '',
        style: {},
        dataset: {},
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
      }),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
      body: { classList: { add() {}, remove() {}, contains() { return false; } }, style: {} },
    },
    window: {
      setTimeout: (fn) => setTimeout(fn, 1),
      clearTimeout,
      setInterval: () => 0,
      clearInterval: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      innerWidth: 1920,
      innerHeight: 1080,
      TabOutGTD: mockGtd,
      TabOutQuickLinks: mockQuickLinks,
    },
    chrome: {
      tabs: { query: () => Promise.resolve([]), remove: () => Promise.resolve() },
      storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
    },
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  context.window.window = context.window;
  context.window.document = context.document;

  vm.runInNewContext(code, context);

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(runtimeError, null, `运行时捕获到了错误: ${runtimeError}`);
});

test('app.js 支持看板泳道整体任务与步骤拖拽事件监听', () => {
  const code = fs.readFileSync(path.join(extensionDir, 'app.js'), 'utf8');
  assert.match(code, /setGtdKanbanDropTarget/);
  assert.match(code, /data-gtd-action="drag-kanban-item"/);
  assert.match(code, /updateTaskKanbanStatus/);
  assert.match(code, /updateChecklistItemKanbanStatus/);
  assert.match(code, /data-gtd-drop-lane/);
  assert.match(code, /activeGtdKanbanDragState/);
  assert.match(code, /preserveKanbanTaskExpandState/);
});
