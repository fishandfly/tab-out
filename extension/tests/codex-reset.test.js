'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extensionDir = path.resolve(__dirname, '..');

function readExtensionFile(relativePath) {
  return fs.readFileSync(path.join(extensionDir, relativePath), 'utf8');
}

const TabOutCodexReset = require('../codex-reset.js');

test('parseCodexResetResponse 正确解析 aitrend reset-predictions 返回数据', () => {
  const sampleApiResponse = {
    data: {
      items: [
        {
          current: {
            id: 'codex-reset-2026-10-22-next',
            provider: 'codex',
            state: 'scheduled',
            probability: 95,
            resetType: 'global',
            title: 'Codex 第 18 天的全球额度重置，最晚北京时间 10/24 01:00',
            summary: '北京时间 10/23 12:46，Tibo 发布活动第 18 天的更新...',
            lastCompletedAt: '2026-10-22T17:00:00Z',
            plans: ['ChatGPT Plus', 'ChatGPT Pro', 'ChatGPT Business'],
            sourceLabel: '@thsottiaux',
            sourceUrl: 'https://x.com/thsottiaux/status/2113492187770175603',
          },
          hasCurrentEvent: true,
          hasProbability: true,
          hasTimePrediction: true,
          probability: 95,
          provider: 'codex',
          windowText: '北京 10/23 约 12:46–10/24 01:00',
          windowStatus: 'elapsed_unconfirmed',
        },
      ],
    },
    ok: true,
  };

  const parsed = TabOutCodexReset.parseCodexResetResponse(sampleApiResponse);
  assert.ok(parsed, '应成功解析出结果对象');
  assert.equal(parsed.provider, 'codex');
  assert.equal(parsed.probability, 95);
  assert.equal(parsed.level, 'high');
  assert.equal(parsed.state, 'scheduled');
  assert.equal(parsed.stateLabel, '计划中');
  assert.equal(parsed.hasTimePrediction, true);
  assert.equal(parsed.windowText, '北京 10/23 约 12:46–10/24 01:00');
  assert.equal(parsed.windowStatus, 'elapsed_unconfirmed');
  assert.equal(parsed.windowStatusLabel, '窗口期内（待兑现）');
  assert.equal(parsed.lastCompletedAt, '2026-10-22T17:00:00Z');
  assert.deepEqual(parsed.plans, ['ChatGPT Plus', 'ChatGPT Pro', 'ChatGPT Business']);
  assert.equal(parsed.sourceLabel, '@thsottiaux');
  assert.equal(parsed.sourceUrl, 'https://x.com/thsottiaux/status/2113492187770175603');
});

test('getProbabilityLevel 正确划分概率等级', () => {
  assert.equal(TabOutCodexReset.getProbabilityLevel(95), 'high');
  assert.equal(TabOutCodexReset.getProbabilityLevel(80), 'high');
  assert.equal(TabOutCodexReset.getProbabilityLevel(65), 'medium');
  assert.equal(TabOutCodexReset.getProbabilityLevel(45), 'medium');
  assert.equal(TabOutCodexReset.getProbabilityLevel(20), 'low');
  assert.equal(TabOutCodexReset.getProbabilityLevel(null), 'unknown');
});

test('renderPillHtml 渲染各状态下的胶囊药丸结构及预测时间', () => {
  const loadingHtml = TabOutCodexReset.renderPillHtml(null, 'loading');
  assert.match(loadingHtml, /is-loading/);
  assert.match(loadingHtml, /Codex 重置/);

  const errorHtml = TabOutCodexReset.renderPillHtml(null, 'error');
  assert.match(errorHtml, /is-error/);
  assert.match(errorHtml, /点击重试/);

  const loadedHtml = TabOutCodexReset.renderPillHtml({
    probability: 95,
    level: 'high',
    windowText: '北京 10/23 约 12:46–10/24 01:00',
  }, 'loaded');
  assert.match(loadedHtml, /level-high/);
  assert.match(loadedHtml, /95%/);
  assert.match(loadedHtml, /codex-reset-time-chip/);
  assert.match(loadedHtml, /北京 10\/23 约 12:46–10\/24 01:00/);
  assert.match(loadedHtml, /codex-reset-chevron/);
});

test('renderPopoverHtml 渲染包含预测时间窗口、上一轮重置及来源的弹出浮层', () => {
  const popoverHtml = TabOutCodexReset.renderPopoverHtml({
    title: 'Codex 额度重置测试标题',
    probability: 95,
    level: 'high',
    state: 'scheduled',
    stateLabel: '计划中',
    windowText: '北京 10/24 01:00',
    windowStatus: 'scheduled',
    windowStatusLabel: '已定档',
    lastCompletedAt: '2026-10-22T17:00:00Z',
    summary: '测试重置详情说明内容',
    plans: ['ChatGPT Plus', 'ChatGPT Pro'],
    sourceUrl: 'https://x.com/example',
    sourceLabel: '@example',
  });

  assert.match(popoverHtml, /Codex 额度重置预测/);
  assert.match(popoverHtml, /Codex 额度重置测试标题/);
  assert.match(popoverHtml, /95% 概率/);
  assert.match(popoverHtml, /预测重置时间：/);
  assert.match(popoverHtml, /北京 10\/24 01:00/);
  assert.match(popoverHtml, /上一轮完成重置：/);
  assert.match(popoverHtml, /测试重置详情说明内容/);
  assert.match(popoverHtml, /ChatGPT Plus/);
  assert.match(popoverHtml, /https:\/\/x\.com\/example/);
});

test('index.html 在首页标题右侧包含 codexResetWidget 容器并加载 codex-reset.js', () => {
  const indexHtml = readExtensionFile('index.html');

  assert.match(indexHtml, /<div class="header-title-row">/);
  assert.match(indexHtml, /<h1 id="greeting"><\/h1>/);
  assert.match(indexHtml, /<div class="codex-reset-widget" id="codexResetWidget"/);
  assert.match(indexHtml, /<script src="codex-reset\.js"><\/script>/);
});

test('app.js 在初始化阶段调用 TabOutCodexReset.init', () => {
  const appJs = readExtensionFile('app.js');

  assert.match(appJs, /TabOutCodexReset\.init/);
  assert.match(appJs, /storage:\s*getGtdStorage\(\)/);
});

test('style.css 包含 header-title-row 与 codex-reset 样式定义', () => {
  const styleCss = readExtensionFile('style.css');

  assert.match(styleCss, /\.header-title-row\s*\{/);
  assert.match(styleCss, /\.codex-reset-widget\s*\{/);
  assert.match(styleCss, /\.codex-reset-pill\s*\{/);
  assert.match(styleCss, /\.codex-reset-popover\s*\{/);
});

test('getCachedData 与 setCachedData 支持读写本地缓存', async () => {
  const mockStorage = {
    store: {},
    async get(key) {
      return { [key]: this.store[key] };
    },
    async set(items) {
      Object.assign(this.store, items);
    },
  };

  const sampleData = { provider: 'codex', probability: 95 };
  await TabOutCodexReset.setCachedData(mockStorage, sampleData);

  const cached = await TabOutCodexReset.getCachedData(mockStorage);
  assert.ok(cached, '应该成功读取缓存记录');
  assert.equal(cached.data.probability, 95);
  assert.ok(typeof cached.timestamp === 'number');
});
