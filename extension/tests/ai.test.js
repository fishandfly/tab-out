'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extensionDir = path.resolve(__dirname, '..');
const {
  normalizeQuadrant,
  normalizeAiPlan,
  parsePlanText,
  preprocessChineseNumbering,
  detectPlanIntent,
  createBoardFromPlan,
  getChatEndpoint,
  CONFIG_STORAGE_KEY,
  HISTORY_STORAGE_KEY,
} = require('../ai.js');
const gtd = require('../gtd.js');

function readExtensionFile(relativePath) {
  return fs.readFileSync(path.join(extensionDir, relativePath), 'utf8');
}

test('AI 助手资源已接入主页面', () => {
  const indexHtml = readExtensionFile('index.html');
  const appJs = readExtensionFile('app.js');
  const styleCss = readExtensionFile('style.css');
  const manifest = JSON.parse(readExtensionFile('manifest.json'));

  assert.match(indexHtml, /id="aiAssistantRoot"/);
  assert.match(indexHtml, /<script src="ai\.js"><\/script>/);
  assert.match(appJs, /TabOutAI\.init/);
  assert.match(styleCss, /\.ai-fab\s*\{/);
  assert.match(styleCss, /\.ai-panel\s*\{/);
  assert.ok(manifest.host_permissions.includes('https://*/*'));
  assert.ok(manifest.host_permissions.includes('http://*/*'));
});

test('normalizeQuadrant 支持中文四象限别名', () => {
  assert.equal(normalizeQuadrant('重要且紧急'), 'importantUrgent');
  assert.equal(normalizeQuadrant('重要不紧急'), 'importantNotUrgent');
  assert.equal(normalizeQuadrant('紧急不重要'), 'urgentNotImportant');
  assert.equal(normalizeQuadrant('不重要不紧急'), 'notImportantNotUrgent');
  assert.equal(normalizeQuadrant('未知分类'), 'importantNotUrgent');
});

test('parsePlanText 可以解析模型返回的 JSON 计划', () => {
  const plan = parsePlanText(JSON.stringify({
    tasks: [
      {
        title: '完成周报',
        quadrant: '重要且紧急',
        steps: ['汇总完成项', { text: '列出风险', completed: true }],
      },
    ],
  }), { scope: 'week' });

  assert.equal(plan.scope, 'week');
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].quadrant, 'importantUrgent');
  assert.deepEqual(plan.tasks[0].checklist.map((item) => item.text), ['汇总完成项', '列出风险']);
  assert.equal(plan.tasks[0].checklist[1].completed, true);
});

test('parsePlanText 可以解析按四象限组织的 Markdown 计划', () => {
  const plan = parsePlanText([
    '## 重要且紧急',
    '- [ ] 处理客户反馈',
    '  - [ ] 整理问题列表',
    '  - [x] 回复关键联系人',
    '',
    '## 重要不紧急',
    '- 设计月度复盘框架',
  ].join('\n'));

  assert.equal(plan.scope, 'day');
  assert.equal(plan.tasks.length, 2);
  assert.equal(plan.tasks[0].title, '处理客户反馈');
  assert.equal(plan.tasks[0].quadrant, 'importantUrgent');
  assert.equal(plan.tasks[0].checklist.length, 2);
  assert.equal(plan.tasks[0].checklist[1].completed, true);
  assert.equal(plan.tasks[1].quadrant, 'importantNotUrgent');
});

test('detectPlanIntent 可以识别对话区里的计划写入意图', () => {
  assert.deepEqual(detectPlanIntent('把下面这些任务写入本周计划：\n- 完成周报'), {
    scope: 'week',
    mode: 'append',
  });
  assert.deepEqual(detectPlanIntent('替换今天的日计划\n- 处理客户反馈'), {
    scope: 'day',
    mode: 'replace',
  });
  assert.equal(detectPlanIntent('总结一下今天完成情况'), null);
});

test('parsePlanText 可以解析对话区的一行中文编号计划', () => {
  const plan = parsePlanText('做数据运营 + 安全管控方案包装、销售培训素材及演示环境，供 6-8 月落地；2. 筛 20 个高优先级数梦脚本列表并完成替换；3. 从项目组手头治理梳 2-3 个数据资源目录场景，带跑通上手。', {
    scope: 'week',
  });

  assert.equal(plan.scope, 'week');
  assert.equal(plan.tasks.length, 3);
  assert.equal(plan.tasks[0].title, '做数据运营 + 安全管控方案包装、销售培训素材及演示环境，供 6-8 月落地');
  assert.equal(plan.tasks[1].title, '筛 20 个高优先级数梦脚本列表并完成替换');
  assert.equal(plan.tasks[2].title, '从项目组手头治理梳 2-3 个数据资源目录场景，带跑通上手。');
});

test('detectPlanIntent 在周视图里默认写入本周计划', () => {
  assert.deepEqual(detectPlanIntent('写入计划：1. 完成周报', { defaultScope: 'week' }), {
    scope: 'week',
    mode: 'append',
  });
});

test('createBoardFromPlan 使用现有 GTD normalizeBoard 生成可保存 board', () => {
  const plan = normalizeAiPlan({
    tasks: [
      { title: '写方案', quadrant: '重要不紧急', checklist: ['列大纲'] },
    ],
  });
  const board = createBoardFromPlan(plan, {
    gtd,
    boardKey: '2026-05-25',
    mode: 'replace',
  });

  assert.equal(board.date, '2026-05-25');
  assert.equal(board.tasks.length, 1);
  assert.equal(board.tasks[0].title, '写方案');
  assert.equal(board.tasks[0].quadrant, 'importantNotUrgent');
  assert.equal(board.tasks[0].checklist[0].text, '列大纲');
  assert.equal(board.selectedTaskId, board.tasks[0].id);
});

test('AI 配置使用本地 storage key，endpoint 兼容 base URL 和完整 chat URL', () => {
  assert.equal(CONFIG_STORAGE_KEY, 'tab-out-ai-config-v1');
  assert.equal(HISTORY_STORAGE_KEY, 'tab-out-ai-messages-v1');
  assert.equal(getChatEndpoint({ baseUrl: 'https://api.openai.com/v1' }), 'https://api.openai.com/v1/chat/completions');
  assert.equal(getChatEndpoint({ baseUrl: 'https://example.com/v1/chat/completions' }), 'https://example.com/v1/chat/completions');
});

test('parsePlanText 支持解析带粗体标记等复杂装饰的象限标题', () => {
  const plan = parsePlanText([
    '**重要且紧急**',
    '- [ ] 处理高优缺陷',
    '### **重要不紧急**：',
    '- 规划下阶段方向',
  ].join('\n'));

  assert.equal(plan.tasks.length, 2);
  assert.equal(plan.tasks[0].title, '处理高优缺陷');
  assert.equal(plan.tasks[0].quadrant, 'importantUrgent');
  assert.equal(plan.tasks[1].title, '规划下阶段方向');
  assert.equal(plan.tasks[1].quadrant, 'importantNotUrgent');
});

test('detectPlanIntent 能够完美识别自然对话（更新、规划）并正确解析覆盖替换意图', () => {
  assert.deepEqual(detectPlanIntent('帮我规划本周计划为：1. 写方案 2. 跑通测试'), {
    scope: 'week',
    mode: 'replace',
  });
  assert.deepEqual(detectPlanIntent('更新我的今日待办：- 拜访客户'), {
    scope: 'day',
    mode: 'replace',
  });
});

test('preprocessChineseNumbering 支持将中文的一是、二是、一、二、①、② 等中文段落列表格式化为标准列表', () => {
  const source = '一是完成数据目录查找问题场景替换；二是推进3个任务；三是做好工具箱制作。';
  const preprocessed = preprocessChineseNumbering(source);
  assert.match(preprocessed, /- 完成数据目录查找问题场景替换/);
  assert.match(preprocessed, /- 推进3个任务/);
  assert.match(preprocessed, /- 做好工具箱制作。/);

  const plan = parsePlanText(source);
  assert.equal(plan.tasks.length, 3);
  assert.equal(plan.tasks[0].title, '完成数据目录查找问题场景替换');
  assert.equal(plan.tasks[1].title, '推进3个任务');
  assert.equal(plan.tasks[2].title, '做好工具箱制作。');
});


