'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getBoardDate,
  createEmptyBoard,
  addTask,
  toggleTaskCompleted,
  selectTask,
  addChecklistItem,
  addChecklistItems,
  splitBatchStepLines,
  updateChecklistItemText,
  moveChecklistItem,
  toggleChecklistItemCompleted,
  deleteChecklistItem,
  deleteTask,
  archiveTask,
  restoreTask,
  getArchivedTasks,
  restoreArchivedTask,
  deleteArchivedTaskPermanent,
  renderArchiveList,
  updateTaskTitle,
  moveTaskToQuadrant,
  exportBoardToMarkdown,
  importBoardFromMarkdown,
  getSelectedTask,
  getTaskProgress,
  getQuadrantTasks,
  getScopeBoard,
  getTodayBoard,
  saveScopeBoard,
  renderWorkspace,
  renderWorkspaceShell,
  QUADRANT_CONFIG_KEY,
  DEFAULT_QUADRANT_TITLES,
  DEFAULT_QUADRANT_ORDER,
  normalizeQuadrantOrder,
  swapQuadrantOrder,
  normalizeQuadrantConfig,
  getQuadrantConfig,
  saveQuadrantConfig,
  getQuadrants,
  KANBAN_LANES,
  normalizeKanbanStatus,
  updateTaskKanbanStatus,
  updateChecklistItemKanbanStatus,
  updateTaskEmoji,
  updateChecklistItemEmoji,
  DEFAULT_QUADRANT_SHORT_CHARS,
  getQuadrantShortChar,
  computeStepTreeVisibility,
  renderQuadrantRibbon,
  renderQuadrantFlag,
  getCompletedTimeValue,
  sortCompletedDesc,
  renderKanbanBoard,
  QUICK_LINKS_KEY,
  DEFAULT_QUICK_LINKS_PARTITION_ID,
  DEFAULT_QUICK_LINKS_PARTITION_NAME,
  normalizeQuickLinksState,
  getQuickLinks,
  saveQuickLinks,
  addQuickLink,
  removeQuickLink,
  moveQuickLink,
  addQuickLinksPartition,
  removeQuickLinksPartition,
  renameQuickLinksPartition,
  renderQuickLinksBar,
  recoverTaskChecklistFromHistory,
  saveBoard,
  getBoards,
  saveSavedChecklist,
} = require('../gtd.js');

test('createEmptyBoard 为当天创建四象限空白工作板', () => {
  const date = new Date('2026-04-28T08:00:00+08:00');
  const board = createEmptyBoard(getBoardDate(date));

  assert.equal(board.date, '2026-04-28');
  assert.deepEqual(board.tasks, []);
  assert.equal(board.selectedTaskId, '');
});

test('addTask 会把任务加入指定象限并默认选中它', () => {
  const board = createEmptyBoard('2026-04-28');
  const nextBoard = addTask(board, 'importantUrgent', '完成投标文件');

  assert.equal(nextBoard.tasks.length, 1);
  assert.equal(nextBoard.selectedTaskId, nextBoard.tasks[0].id);
  assert.equal(nextBoard.tasks[0].quadrant, 'importantUrgent');
  assert.equal(nextBoard.tasks[0].completed, false);
  assert.equal(nextBoard.tasks[0].title, '完成投标文件');
});

test('任务可被选中、添加步骤、勾选步骤并计算进度', () => {
  let board = addTask(createEmptyBoard('2026-04-28'), 'importantNotUrgent', '整理周计划');
  const taskId = board.tasks[0].id;

  board = selectTask(board, taskId);
  board = addChecklistItem(board, taskId, '列出三个最重要目标');
  board = addChecklistItem(board, taskId, '安排时间块');

  const selected = getSelectedTask(board);
  assert.equal(selected.checklist.length, 2);
  assert.deepEqual(getTaskProgress(selected), { completed: 0, total: 2 });

  board = toggleChecklistItemCompleted(board, taskId, selected.checklist[0].id, true);

  const updated = getSelectedTask(board);
  assert.deepEqual(getTaskProgress(updated), { completed: 1, total: 2 });
});

test('删除步骤后进度会同步更新', () => {
  let board = addTask(createEmptyBoard('2026-04-28'), 'urgentNotImportant', '回访供应商');
  const taskId = board.tasks[0].id;

  board = addChecklistItem(board, taskId, '确认联系人');
  board = addChecklistItem(board, taskId, '发送邮件');

  const stepId = board.tasks[0].checklist[0].id;
  board = deleteChecklistItem(board, taskId, stepId);

  assert.equal(board.tasks[0].checklist.length, 1);
  assert.deepEqual(getTaskProgress(board.tasks[0]), { completed: 0, total: 1 });
});

test('splitBatchStepLines 按折行拆分文本并忽略空行', () => {
  const lines = splitBatchStepLines('收集素材\r\n\r\n 整理提纲 \n\n完成初稿');

  assert.deepEqual(lines, ['收集素材', '整理提纲', '完成初稿']);
  assert.deepEqual(splitBatchStepLines(''), []);
  assert.deepEqual(splitBatchStepLines(null), []);
});

test('addChecklistItems 会按顺序批量追加步骤，且忽略空文本', () => {
  let board = addTask(createEmptyBoard('2026-04-28'), 'importantUrgent', '准备周报');
  const taskId = board.tasks[0].id;

  board = addChecklistItems(board, taskId, ['汇总本周进展', '', '  ', '整理下周计划']);

  const checklist = board.tasks[0].checklist;
  assert.equal(checklist.length, 2);
  assert.deepEqual(checklist.map((item) => item.text), ['汇总本周进展', '整理下周计划']);
  assert.ok(checklist.every((item) => !item.completed && item.level === 0));
  assert.equal(board.tasks[0].id, taskId);
});

test('addChecklistItems 在无有效文本时不改动看板', () => {
  let board = addTask(createEmptyBoard('2026-04-28'), 'importantUrgent', '准备周报');
  const taskId = board.tasks[0].id;
  board = addChecklistItem(board, taskId, '已有步骤');

  const unchanged = addChecklistItems(board, taskId, []);

  assert.equal(unchanged.tasks[0].checklist.length, 1);
  assert.equal(unchanged.tasks[0].checklist[0].text, '已有步骤');
});

test('renderChecklistPanel 根据 batchStepTaskId 控制批量面板显隐', () => {
  let board = addTask(createEmptyBoard('2026-04-28'), 'importantUrgent', '准备周报');
  const taskId = board.tasks[0].id;

  const withoutPanel = renderWorkspace(board, { batchStepTaskId: '' });
  assert.ok(!withoutPanel.includes('add-batch-steps'));

  board = selectTask(board, taskId);
  const withPanel = renderWorkspace(board, { batchStepTaskId: taskId });
  assert.ok(withPanel.includes('add-batch-steps'));
  assert.ok(withPanel.includes('toggle-batch-steps'));
});

test('renderWorkspace 渲染面板分隔条并支持折叠与自定义宽度', () => {
  const board = addTask(createEmptyBoard('2026-04-28'), 'importantUrgent', '准备周报');

  const normal = renderWorkspace(board, {});
  assert.ok(normal.includes('gtd-panel-divider'));
  assert.ok(normal.includes('data-gtd-action="toggle-gtd-detail"'));
  assert.ok(!normal.includes('is-detail-collapsed'));

  const collapsed = renderWorkspace(board, { detailCollapsed: true });
  assert.ok(collapsed.includes('is-detail-collapsed'));
  assert.ok(collapsed.includes('gtd-panel-divider is-collapsed'));

  const resized = renderWorkspace(board, { detailWidth: 460 });
  assert.ok(resized.includes('--gtd-detail-width:460px'));
  assert.ok(resized.includes('has-custom-width'));

  // 非法宽度不应产生内联样式
  const invalid = renderWorkspace(board, { detailWidth: 'abc' });
  assert.ok(!invalid.includes('--gtd-detail-width'));
});

test('updateChecklistItemText 会更新步骤文本并保留完成状态', () => {
  let board = addTask(createEmptyBoard('2026-04-28'), 'importantUrgent', '整理合同');
  const taskId = board.tasks[0].id;
  board = addChecklistItem(board, taskId, '旧步骤');
  const stepId = board.tasks[0].checklist[0].id;
  board = toggleChecklistItemCompleted(board, taskId, stepId, true);

  board = updateChecklistItemText(board, taskId, stepId, '新步骤');

  assert.equal(board.tasks[0].checklist[0].text, '新步骤');
  assert.equal(board.tasks[0].checklist[0].completed, true);
});

test('moveChecklistItem 会调整步骤上下顺序，并连同子步骤一起移动', () => {
  let board = addTask(createEmptyBoard('2026-04-28'), 'importantUrgent', '整理合同');
  const taskId = board.tasks[0].id;
  board = addChecklistItem(board, taskId, '步骤 A');
  board = addChecklistItem(board, taskId, '步骤 B');
  board = addChecklistItem(board, taskId, '步骤 C');

  const [stepA, stepB, stepC] = board.tasks[0].checklist.map((item) => item.id);
  board = moveChecklistItem(board, taskId, stepB, stepA, {
    position: 'after',
    desiredLevel: 1,
  });
  board = moveChecklistItem(board, taskId, stepA, stepC, {
    position: 'after',
    desiredLevel: 0,
  });

  const checklist = board.tasks[0].checklist;
  assert.deepEqual(
    checklist.map((item) => ({ text: item.text, level: item.level })),
    [
      { text: '步骤 C', level: 0 },
      { text: '步骤 A', level: 0 },
      { text: '步骤 B', level: 1 },
    ]
  );
});

test('moveChecklistItem 可以通过左右拖拽调整步骤层级，并保留子树结构', () => {
  let board = addTask(createEmptyBoard('2026-04-28'), 'importantUrgent', '写方案');
  const taskId = board.tasks[0].id;
  board = addChecklistItem(board, taskId, '总纲');
  board = addChecklistItem(board, taskId, '分项一');
  board = addChecklistItem(board, taskId, '分项二');

  const [rootId, childOneId, childTwoId] = board.tasks[0].checklist.map((item) => item.id);

  board = moveChecklistItem(board, taskId, childOneId, rootId, {
    position: 'after',
    desiredLevel: 1,
  });
  board = moveChecklistItem(board, taskId, childTwoId, childOneId, {
    position: 'after',
    desiredLevel: 2,
  });

  assert.deepEqual(
    board.tasks[0].checklist.map((item) => ({ text: item.text, level: item.level })),
    [
      { text: '总纲', level: 0 },
      { text: '分项一', level: 1 },
      { text: '分项二', level: 2 },
    ]
  );
});

test('toggleTaskCompleted 与 deleteTask 会维护当天看板状态', () => {
  let board = addTask(createEmptyBoard('2026-04-28'), 'notImportantNotUrgent', '清理下载目录');
  const taskId = board.tasks[0].id;

  board = toggleTaskCompleted(board, taskId, true);
  assert.equal(board.tasks[0].completed, true);

  board = deleteTask(board, taskId);
  assert.equal(board.tasks.length, 0);
  assert.equal(board.selectedTaskId, '');
  assert.deepEqual(getQuadrantTasks(board, 'notImportantNotUrgent'), []);
});

test('updateTaskTitle 会更新任务标题并保留原任务', () => {
  let board = addTask(createEmptyBoard('2026-04-28'), 'importantUrgent', '旧标题');
  const taskId = board.tasks[0].id;

  board = updateTaskTitle(board, taskId, '新标题');
  assert.equal(board.tasks[0].title, '新标题');
});

test('moveTaskToQuadrant 会把任务拖到新象限并保留已选中状态和步骤', () => {
  let board = addTask(createEmptyBoard('2026-04-28'), 'importantUrgent', '写周报');
  const taskId = board.tasks[0].id;
  board = addChecklistItem(board, taskId, '整理本周完成项');

  board = moveTaskToQuadrant(board, taskId, 'importantNotUrgent');

  assert.equal(board.selectedTaskId, taskId);
  assert.equal(board.tasks[0].quadrant, 'importantNotUrgent');
  assert.equal(board.tasks[0].checklist.length, 1);
  assert.deepEqual(getQuadrantTasks(board, 'importantUrgent'), []);
  assert.equal(getQuadrantTasks(board, 'importantNotUrgent').length, 1);
});

test('renderWorkspace 默认使用双击象限添加任务，而不是常驻输入框', () => {
  const html = renderWorkspace(createEmptyBoard('2026-04-28'));

  assert.match(html, /data-gtd-action="prompt-add-task"/);
  assert.match(html, /data-gtd-drop-zone="importantUrgent"/);
  assert.doesNotMatch(html, /data-gtd-form="add-task"/);
  assert.match(html, /双击空白处快速添加/);
  assert.doesNotMatch(html, /今天只看今天/);
});

test('renderWorkspace 在指定象限激活时显示原地输入框', () => {
  const html = renderWorkspace(createEmptyBoard('2026-04-28'), {
    composerQuadrant: 'importantUrgent',
  });

  assert.match(html, /data-gtd-form="add-task"/);
  assert.match(html, /placeholder="直接输入任务，回车保存"/);
  assert.match(html, /data-quadrant="importantUrgent"/);
});

test('renderWorkspace 把四象限放在今日 GTD 分组内的左侧列，步骤清单在右侧', () => {
  const html = renderWorkspace(createEmptyBoard('2026-04-28'));

  assert.match(html, /class="gtd-main-row"/);
  assert.match(html, /class="gtd-board-panel"[\s\S]*class="gtd-detail-panel"/);
  assert.match(html, /data-gtd-action="import-gtd-report"/);
  assert.match(html, /导入日报/);
  assert.match(html, /data-gtd-action="export-gtd-report"/);
  assert.match(html, /导出日报/);
});

test('renderWorkspace 在收起 GTD 时只保留标题栏', () => {
  const html = renderWorkspace(createEmptyBoard('2026-04-28'), {
    collapsed: true,
  });

  assert.match(html, /data-gtd-action="toggle-gtd-section"/);
  assert.match(html, /is-collapsed/);
  assert.doesNotMatch(html, /class="gtd-main-row"/);
});

test('renderWorkspaceShell 会渲染 GTD、白板、笔记、结构图与备份五个 tab，并默认激活 GTD', () => {
  const html = renderWorkspaceShell(createEmptyBoard('2026-04-28'), {
    activeTab: 'gtd',
    whiteboardUrl: 'whiteboard/index.html',
    notesUrl: 'notes/index.html',
    structureboardUrl: 'structureboard/index.html',
  });

  assert.match(html, /data-gtd-action="switch-workspace-tab"/);
  assert.match(html, /data-workspace-tab="gtd"/);
  assert.match(html, /data-workspace-tab="whiteboard"/);
  assert.match(html, /data-workspace-tab="notes"/);
  assert.match(html, /data-workspace-tab="structure"/);
  assert.match(html, /data-workspace-tab="backup"/);
  assert.match(html, /data-workspace-active-tab="gtd"/);
  assert.match(html, /aria-selected="true"[^>]*>GTD</);
  assert.match(html, /aria-selected="false"[^>]*>白板</);
  assert.match(html, /aria-selected="false"[^>]*>笔记</);
  assert.match(html, /aria-selected="false"[^>]*>结构图</);
  assert.match(html, /aria-selected="false"[^>]*>备份</);
  assert.match(html, /src="whiteboard\/index\.html"/);
  assert.match(html, /src="notes\/index\.html"/);
  assert.match(html, /src="structureboard\/index\.html"/);
  assert.match(html, /backup-panel-shell/);
});

test('renderWorkspaceShell 激活白板 tab 时保留 GTD 面板并切换选中态', () => {
  const html = renderWorkspaceShell(createEmptyBoard('2026-04-28'), {
    activeTab: 'whiteboard',
    whiteboardUrl: 'whiteboard/index.html',
    notesUrl: 'notes/index.html',
    structureboardUrl: 'structureboard/index.html',
  });

  assert.match(html, /data-workspace-active-tab="whiteboard"/);
  assert.match(html, /aria-selected="false"[^>]*>GTD</);
  assert.match(html, /aria-selected="true"[^>]*>白板</);
  assert.match(html, /aria-selected="false"[^>]*>笔记</);
  assert.match(html, /aria-selected="false"[^>]*>结构图</);
  assert.match(html, /aria-selected="false"[^>]*>备份</);
  assert.match(html, /class="workspace-panel workspace-panel-gtd"/);
  assert.match(html, /class="workspace-panel workspace-panel-whiteboard(?: is-active)?"/);
  assert.match(html, /class="workspace-panel workspace-panel-notes"/);
  assert.match(html, /class="workspace-panel workspace-panel-structure"/);
  assert.match(html, /class="workspace-panel workspace-panel-backup"/);
});

test('renderWorkspaceShell 激活笔记 tab 时保留其余面板并切换选中态', () => {
  const html = renderWorkspaceShell(createEmptyBoard('2026-04-28'), {
    activeTab: 'notes',
    whiteboardUrl: 'whiteboard/index.html',
    notesUrl: 'notes/index.html',
    structureboardUrl: 'structureboard/index.html',
  });

  assert.match(html, /data-workspace-active-tab="notes"/);
  assert.match(html, /aria-selected="false"[^>]*>GTD</);
  assert.match(html, /aria-selected="false"[^>]*>白板</);
  assert.match(html, /aria-selected="true"[^>]*>笔记</);
  assert.match(html, /aria-selected="false"[^>]*>结构图</);
  assert.match(html, /aria-selected="false"[^>]*>备份</);
  assert.match(html, /class="workspace-panel workspace-panel-notes is-active"/);
});

test('renderWorkspaceShell 激活结构图 tab 时保留其余面板并切换选中态', () => {
  const html = renderWorkspaceShell(createEmptyBoard('2026-04-28'), {
    activeTab: 'structure',
    whiteboardUrl: 'whiteboard/index.html',
    notesUrl: 'notes/index.html',
    structureboardUrl: 'structureboard/index.html',
  });

  assert.match(html, /data-workspace-active-tab="structure"/);
  assert.match(html, /aria-selected="false"[^>]*>GTD</);
  assert.match(html, /aria-selected="false"[^>]*>白板</);
  assert.match(html, /aria-selected="false"[^>]*>笔记</);
  assert.match(html, /aria-selected="true"[^>]*>结构图</);
  assert.match(html, /aria-selected="false"[^>]*>备份</);
  assert.match(html, /class="workspace-panel workspace-panel-structure is-active"/);
  assert.match(html, /class="workspace-panel workspace-panel-backup"/);
});

test('renderWorkspace 为当前任务显示番茄钟入口与倒计时', () => {
  let board = addTask(createEmptyBoard('2026-04-28'), 'importantUrgent', '写方案');
  const taskId = board.tasks[0].id;
  board = selectTask(board, taskId);

  const idleHtml = renderWorkspace(board, {
    pomodoro: {
      taskId: '',
      status: 'idle',
      remainingMs: 25 * 60 * 1000,
    },
  });
  assert.match(idleHtml, /class="gtd-pomodoro-track is-idle"/);
  assert.match(idleHtml, />25:00</);
  assert.doesNotMatch(idleHtml, /gtd-pomodoro-btn/);

  const runningHtml = renderWorkspace(board, {
    pomodoro: {
      taskId,
      status: 'running',
      remainingMs: 5 * 60 * 1000,
    },
  });
  assert.match(runningHtml, /class="gtd-pomodoro-track is-running"/);
  assert.match(runningHtml, /class="gtd-detail-title-block"[\s\S]*class="gtd-pomodoro-track/);
  assert.match(runningHtml, /style="width: 20%"/);
  assert.match(runningHtml, />05:00</);
  assert.doesNotMatch(runningHtml, /gtd-pomodoro-btn/);
  assert.doesNotMatch(runningHtml, /data-gtd-action="reset-pomodoro"/);
});

test('renderWorkspace 在编辑任务时显示原地输入框', () => {
  let board = addTask(createEmptyBoard('2026-04-28'), 'importantUrgent', '写方案');
  const taskId = board.tasks[0].id;

  const html = renderWorkspace(board, {
    editingTaskId: taskId,
  });

  assert.match(html, /data-gtd-form="edit-task"/);
  assert.match(html, /placeholder="直接修改任务，回车保存"/);
});

test('renderWorkspace 在编辑步骤时显示原地输入框', () => {
  let board = addTask(createEmptyBoard('2026-04-28'), 'importantUrgent', '写方案');
  const taskId = board.tasks[0].id;
  board = addChecklistItem(board, taskId, '先写提纲');
  const stepId = board.tasks[0].checklist[0].id;

  const html = renderWorkspace(board, {
    editingStepId: stepId,
  });

  assert.match(html, /data-gtd-form="edit-step"/);
  assert.match(html, new RegExp(`data-step-id="${stepId}"`));
  assert.match(html, /placeholder="直接修改步骤，回车保存"/);
});

test('renderWorkspace 为步骤输出拖拽属性和层级标记', () => {
  let board = addTask(createEmptyBoard('2026-04-28'), 'importantUrgent', '写方案');
  const taskId = board.tasks[0].id;
  board = addChecklistItem(board, taskId, '先写提纲');
  const stepId = board.tasks[0].checklist[0].id;

  const html = renderWorkspace(board);

  assert.match(html, new RegExp(`data-step-id="${stepId}"[\\s\\S]*draggable="true"`));
  assert.match(html, /data-step-level="0"/);
  assert.match(html, /data-gtd-action="drag-step"/);
});

test('renderWorkspace 为任务和象限输出拖拽属性', () => {
  let board = addTask(createEmptyBoard('2026-04-28'), 'importantUrgent', '整理合同');
  const taskId = board.tasks[0].id;

  const html = renderWorkspace(board);

  assert.match(html, new RegExp(`data-task-id="${taskId}"[\\s\\S]*draggable="true"`));
  assert.match(html, /data-gtd-action="drag-task"/);
  assert.match(html, /data-gtd-drop-zone="importantUrgent"/);
});

test('exportBoardToMarkdown 会导出当日任务和步骤清单', () => {
  let board = createEmptyBoard('2026-04-28');
  board = addTask(board, 'importantUrgent', '完成日报导出');
  board = addTask(board, 'importantNotUrgent', '整理下周计划');

  const urgentTaskId = board.tasks.find((task) => task.title === '完成日报导出').id;
  board = addChecklistItem(board, urgentTaskId, '整理今日产出');
  board = addChecklistItem(board, urgentTaskId, '确认重点问题');
  const childStepId = board.tasks.find((task) => task.id === urgentTaskId).checklist[1].id;
  const parentStepId = board.tasks.find((task) => task.id === urgentTaskId).checklist[0].id;
  board = moveChecklistItem(board, urgentTaskId, childStepId, parentStepId, {
    position: 'after',
    desiredLevel: 1,
  });
  board = toggleTaskCompleted(board, urgentTaskId, true);
  board = toggleChecklistItemCompleted(board, urgentTaskId, board.tasks.find((task) => task.id === urgentTaskId).checklist[0].id, true);

  const markdown = exportBoardToMarkdown(board);

  assert.match(markdown, /^# 今日 GTD 日报/);
  assert.match(markdown, /日期：2026-04-28/);
  assert.match(markdown, /## 重要且紧急/);
  assert.match(markdown, /- \[x\] 完成日报导出/);
  assert.match(markdown, /  - \[x\] 整理今日产出/);
  assert.match(markdown, /    - \[ \] 确认重点问题/);
  assert.match(markdown, /## 重要不紧急/);
  assert.match(markdown, /- \[ \] 整理下周计划/);
});

test('importBoardFromMarkdown 会把日报解析成今天的工作板', () => {
  const markdown = `# 今日 GTD 日报

日期：2026-04-28
完成概览：1/2 任务完成

## 重要且紧急

- [x] 完成日报导出
  - [x] 整理今日产出
    - [ ] 确认重点问题

## 重要不紧急

- [ ] 整理下周计划

## 紧急不重要

- 暂无任务

## 不重要不紧急

- 暂无任务
`;

  const board = importBoardFromMarkdown(markdown, { date: '2026-04-29' });

  assert.equal(board.date, '2026-04-29');
  assert.equal(board.tasks.length, 2);
  assert.equal(board.tasks[0].quadrant, 'importantUrgent');
  assert.equal(board.tasks[0].completed, true);
  assert.equal(board.tasks[1].quadrant, 'importantNotUrgent');
  assert.equal(board.tasks[1].completed, false);
  assert.deepEqual(
    board.tasks[0].checklist.map((item) => ({
      text: item.text,
      level: item.level,
      completed: item.completed,
    })),
    [
      { text: '整理今日产出', level: 0, completed: true },
      { text: '确认重点问题', level: 1, completed: false },
    ]
  );
  assert.equal(board.selectedTaskId, board.tasks[0].id);
});

test('importBoardFromMarkdown 会忽略空象限并保留步骤层级', () => {
  const markdown = `# 今日 GTD 日报

日期：2026-04-01

## 重要且紧急

- [ ] 写方案
  - [ ] 先写提纲
    - [x] 列出章节
      - [ ] 收集材料

## 重要不紧急

- 暂无任务

## 紧急不重要

- 暂无任务

## 不重要不紧急

- 暂无任务
`;

  const board = importBoardFromMarkdown(markdown, { date: '2026-04-29' });

  assert.equal(board.tasks.length, 1);
  assert.deepEqual(
    board.tasks[0].checklist.map((item) => item.level),
    [0, 1, 2]
  );
});

test('importBoardFromMarkdown 会拒绝无法识别的日报格式', () => {
  assert.throws(
    () => importBoardFromMarkdown('随便写点内容', { date: '2026-04-29' }),
    /不是可识别的 GTD 日报/
  );
});

const createMockStorage = () => ({
  data: {},
  async get(key) {
    return { [key]: this.data[key] };
  },
  async set(obj) {
    Object.assign(this.data, obj);
  }
});

test('getScopeBoard 日、周、月具有独立的历史承接能力，只在同类作用域之间承接历史任务', async () => {
  const storage = createMockStorage();

  // 1. 测试日级看板承接（日对日，不被周/月混淆）
  const day1 = addTask(createEmptyBoard('2026-05-25'), 'importantUrgent', '昨日未完事项');
  await saveScopeBoard(storage, day1);

  // 写入混淆的周看板与月看板
  const weekConfused = addTask(createEmptyBoard('week-2026-W21'), 'importantUrgent', '周看板任务');
  await saveScopeBoard(storage, weekConfused);
  const monthConfused = addTask(createEmptyBoard('month-2026-05'), 'importantUrgent', '月看板任务');
  await saveScopeBoard(storage, monthConfused);

  // 加载今日 (2026-05-26) 看板，应该正确承接昨日任务，且不被周/月干扰
  const todayBoard = await getScopeBoard(storage, '2026-05-26');
  assert.equal(todayBoard.date, '2026-05-26');
  assert.equal(todayBoard.tasks.length, 1);
  assert.equal(todayBoard.tasks[0].title, '昨日未完事项');

  // 2. 测试周级看板承接（周对周，不被日/月混淆）
  const week1 = addTask(createEmptyBoard('week-2026-W20'), 'importantUrgent', '上周遗留任务');
  await saveScopeBoard(storage, week1);

  // 加载新一周 (week-2026-W22) 看板，应该继承上一周 (week-2026-W21) 的周看板任务
  const nextWeekBoard = await getScopeBoard(storage, 'week-2026-W22');
  assert.equal(nextWeekBoard.date, 'week-2026-W22');
  assert.equal(nextWeekBoard.tasks.length, 1);
  assert.equal(nextWeekBoard.tasks[0].title, '周看板任务'); // 离 W22 最近的周看板是 W21

  // 3. 测试月级看板承接（月对月，不被日/周混淆）
  const month1 = addTask(createEmptyBoard('month-2026-04'), 'importantUrgent', '上月遗留任务');
  await saveScopeBoard(storage, month1);

  // 加载新一月 (month-2026-06) 看板，应该继承上一次的月看板任务
  const nextMonthBoard = await getScopeBoard(storage, 'month-2026-06');
  assert.equal(nextMonthBoard.date, 'month-2026-06');
  assert.equal(nextMonthBoard.tasks.length, 1);
  assert.equal(nextMonthBoard.tasks[0].title, '月看板任务'); // 离 2026-06 最近的月看板是 2026-05

  // 4. 测试无历史数据时返回空看板并存储
  const emptyStorage = createMockStorage();
  const freshBoard = await getScopeBoard(emptyStorage, '2026-05-26');
  assert.equal(freshBoard.date, '2026-05-26');
  assert.equal(freshBoard.tasks.length, 0);
});

test('getQuadrantConfig 与 saveQuadrantConfig 支持读取与保存自定义四象限标题', async () => {
  const storage = createMockStorage();
  const defaultConfig = await getQuadrantConfig(storage);
  assert.deepEqual(defaultConfig, DEFAULT_QUADRANT_TITLES);

  const customConfig = {
    importantUrgent: 'P0 紧急攻坚',
    importantNotUrgent: 'P1 长期价值',
    urgentNotImportant: 'P2 外部打扰',
    notImportantNotUrgent: 'P3 琐碎待办',
  };

  const saved = await saveQuadrantConfig(storage, customConfig);
  assert.deepEqual(saved, customConfig);

  const loaded = await getQuadrantConfig(storage);
  assert.deepEqual(loaded, customConfig);
});

test('renderWorkspace 移除了象限描述 hint 节点，并支持自定义标题与编辑态', () => {
  const board = createEmptyBoard('2026-04-28');
  const customConfig = {
    importantUrgent: '核心优先',
    importantNotUrgent: '战略规划',
    urgentNotImportant: '临时事务',
    notImportantNotUrgent: '低效游离',
  };

  const htmlNormal = renderWorkspace(board, { quadrantConfig: customConfig });
  assert.doesNotMatch(htmlNormal, /gtd-quadrant-hint/);
  assert.match(htmlNormal, /data-gtd-action="edit-quadrant-title"/);
  assert.match(htmlNormal, /核心优先/);
  assert.match(htmlNormal, /战略规划/);

  const htmlEditing = renderWorkspace(board, {
    quadrantConfig: customConfig,
    editingQuadrantKey: 'importantUrgent',
  });
  assert.match(htmlEditing, /data-gtd-form="edit-quadrant-title"/);
  assert.match(htmlEditing, /value="核心优先"/);
});

test('exportBoardToMarkdown 与 importBoardFromMarkdown 支持自定义象限标题导出与导入', () => {
  let board = createEmptyBoard('2026-04-28');
  const customConfig = {
    importantUrgent: '战术破局',
    importantNotUrgent: '长期复利',
    urgentNotImportant: '响应支持',
    notImportantNotUrgent: '低频归档',
  };

  board = addTask(board, 'importantUrgent', '攻坚核心缺陷');
  board = addTask(board, 'importantNotUrgent', '重构模块架构');

  const markdown = exportBoardToMarkdown(board, customConfig);
  assert.match(markdown, /## 战术破局/);
  assert.match(markdown, /## 长期复利/);

  const imported = importBoardFromMarkdown(markdown, {
    date: '2026-04-29',
    quadrantConfig: customConfig,
  });

  assert.equal(imported.tasks.length, 2);
  assert.equal(imported.tasks[0].quadrant, 'importantUrgent');
  assert.equal(imported.tasks[0].title, '攻坚核心缺陷');
  assert.equal(imported.tasks[1].quadrant, 'importantNotUrgent');
  assert.equal(imported.tasks[1].title, '重构模块架构');
});

test('archiveTask 与 restoreTask：归档任务后在象限中隐藏，但在看板数据中保留并可恢复', () => {
  let board = addTask(createEmptyBoard('2026-05-20'), 'importantUrgent', '需要归档的调研任务');
  const taskId = board.tasks[0].id;

  // 归档任务
  board = archiveTask(board, taskId);
  assert.equal(board.tasks.length, 1);
  assert.equal(board.tasks[0].archived, true);
  assert.ok(board.tasks[0].archivedAt);
  assert.equal(board.selectedTaskId, '');

  // 四象限列表中不显示
  const visibleTasks = getQuadrantTasks(board, 'importantUrgent');
  assert.equal(visibleTasks.length, 0);

  // 渲染工作台时象限内不包含该任务
  const html = renderWorkspace(board);
  assert.doesNotMatch(html, /需要归档的调研任务/);

  // 恢复任务
  board = restoreTask(board, taskId);
  assert.equal(board.tasks[0].archived, false);
  assert.equal(getQuadrantTasks(board, 'importantUrgent').length, 1);
  assert.match(renderWorkspace(board), /需要归档的调研任务/);
});

test('renderWorkspace 渲染检索归档按钮，且位于导出日报后面', () => {
  const html = renderWorkspace(createEmptyBoard('2026-05-20'), { activeScope: 'day' });

  assert.match(html, /data-gtd-action="export-gtd-report"/);
  assert.match(html, /导出日报/);
  assert.match(html, /data-gtd-action="open-gtd-archive"/);
  assert.match(html, /检索归档/);

  const exportIndex = html.indexOf('data-gtd-action="export-gtd-report"');
  const archiveIndex = html.indexOf('data-gtd-action="open-gtd-archive"');
  assert.ok(exportIndex !== -1 && archiveIndex !== -1);
  assert.ok(exportIndex < archiveIndex, '检索归档按钮应该位于导出日报后面');
});

test('getArchivedTasks, restoreArchivedTask 与 deleteArchivedTaskPermanent 支持跨看板检索、恢复与彻底删除', async () => {
  const storage = createMockStorage();

  // 创建两个日期的看板，各含有一条归档任务
  let board1 = addTask(createEmptyBoard('2026-05-18'), 'importantUrgent', '五月上旬归档事项');
  board1 = archiveTask(board1, board1.tasks[0].id);
  await saveScopeBoard(storage, board1);

  let board2 = addTask(createEmptyBoard('2026-05-20'), 'importantNotUrgent', '五月下旬归档事项');
  board2 = addChecklistItem(board2, board2.tasks[0].id, '检索相关子步骤');
  board2 = archiveTask(board2, board2.tasks[0].id);
  await saveScopeBoard(storage, board2);

  // 1. 无搜索词，获取全部归档
  const allArchived = await getArchivedTasks(storage);
  assert.equal(allArchived.length, 2);

  // 2. 根据标题关键字检索
  const searchByTitle = await getArchivedTasks(storage, '下旬');
  assert.equal(searchByTitle.length, 1);
  assert.equal(searchByTitle[0].title, '五月下旬归档事项');

  // 3. 根据子步骤关键字检索
  const searchByStep = await getArchivedTasks(storage, '子步骤');
  assert.equal(searchByStep.length, 1);
  assert.equal(searchByStep[0].title, '五月下旬归档事项');

  // 4. renderArchiveList 渲染测试
  const listHtml = renderArchiveList(allArchived);
  assert.match(listHtml, /五月上旬归档事项/);
  assert.match(listHtml, /五月下旬归档事项/);
  assert.match(listHtml, /data-gtd-action="restore-archived-task"/);
  assert.match(listHtml, /data-gtd-action="delete-archived-task-permanent"/);

  // 5. 跨看板恢复到当前看板 (2026-05-20)
  const taskToRestore = allArchived.find((t) => t.title === '五月上旬归档事项');
  await restoreArchivedTask(storage, taskToRestore.boardKey, taskToRestore.id, '2026-05-20');

  const afterRestoreArchived = await getArchivedTasks(storage);
  assert.equal(afterRestoreArchived.length, 1);
  assert.equal(afterRestoreArchived[0].title, '五月下旬归档事项');

  // 6. 彻底删除
  const taskToDelete = afterRestoreArchived[0];
  await deleteArchivedTaskPermanent(storage, taskToDelete.boardKey, taskToDelete.id);

  const afterDeleteArchived = await getArchivedTasks(storage);
  assert.equal(afterDeleteArchived.length, 0);
});

test('renderWorkspace 把象限中已完成的任务折叠起来，并支持配置展开', () => {
  let board = addTask(createEmptyBoard('2026-06-01'), 'importantUrgent', '进行中的任务');
  board = addTask(board, 'importantUrgent', '已完成的任务');
  const completedTaskId = board.tasks[1].id;
  board = toggleTaskCompleted(board, completedTaskId, true);

  // 默认折叠已完成任务
  const collapsedHtml = renderWorkspace(board);
  assert.match(collapsedHtml, /data-completed-quadrant="importantUrgent"/);
  assert.match(collapsedHtml, /data-gtd-action="toggle-completed-tasks"/);
  assert.match(collapsedHtml, /已完成 \(1\)/);
  assert.match(collapsedHtml, /class="gtd-completed-list is-collapsed"/);
  assert.match(collapsedHtml, /进行中的任务/);
  assert.match(collapsedHtml, /已完成的任务/);

  // 显式展开已完成任务
  const expandedHtml = renderWorkspace(board, {
    expandedCompletedQuadrants: { importantUrgent: true },
  });
  assert.match(expandedHtml, /class="gtd-completed-list is-expanded"/);
  assert.match(expandedHtml, /aria-expanded="true"/);
});

test('renderWorkspace 把 checklist 中已完成的步骤折叠起来，并支持配置展开', () => {
  let board = addTask(createEmptyBoard('2026-06-01'), 'importantUrgent', '主任务');
  const taskId = board.tasks[0].id;
  board = addChecklistItem(board, taskId, '进行中步骤');
  board = addChecklistItem(board, taskId, '已完成步骤');
  const completedStepId = board.tasks[0].checklist[1].id;
  board = toggleChecklistItemCompleted(board, taskId, completedStepId, true);

  // 默认折叠已完成步骤
  const collapsedHtml = renderWorkspace(board);
  assert.match(collapsedHtml, /data-completed-task=/);
  assert.match(collapsedHtml, /data-gtd-action="toggle-completed-steps"/);
  assert.match(collapsedHtml, /已完成步骤 \(1\)/);
  assert.match(collapsedHtml, /class="gtd-completed-list gtd-completed-steps-list is-collapsed"/);
  assert.match(collapsedHtml, /进行中步骤/);
  assert.match(collapsedHtml, /已完成步骤/);

  // 显式展开已完成步骤
  const expandedHtml = renderWorkspace(board, {
    expandedCompletedSteps: { [taskId]: true },
  });
  assert.match(expandedHtml, /class="gtd-completed-list gtd-completed-steps-list is-expanded"/);
  assert.match(expandedHtml, /aria-expanded="true"/);
});

test('swapQuadrantOrder 与 getQuadrants 支持自定义四象限排序与拖拽位置切换', () => {
  const originalOrder = [...DEFAULT_QUADRANT_ORDER];
  assert.deepEqual(normalizeQuadrantOrder(null), originalOrder);

  // 互换第 0 个和第 1 个象限（重要且紧急 <-> 重要不紧急）
  const swapped = swapQuadrantOrder(originalOrder, 'importantUrgent', 'importantNotUrgent');
  assert.deepEqual(swapped, [
    'importantNotUrgent',
    'importantUrgent',
    'urgentNotImportant',
    'notImportantNotUrgent',
  ]);

  // getQuadrants 输出顺序与配置的 order 一致
  const orderedQuadrants = getQuadrants({ order: swapped });
  assert.equal(orderedQuadrants[0].key, 'importantNotUrgent');
  assert.equal(orderedQuadrants[1].key, 'importantUrgent');

  // renderWorkspace 渲染的象限卡片具备拖拽属性与拖拽把手，且按自定义顺序渲染
  const html = renderWorkspace(createEmptyBoard('2026-06-01'), {
    quadrantConfig: { order: swapped },
  });
  assert.match(html, /data-gtd-action="drag-quadrant"/);
  assert.match(html, /class="gtd-quadrant-drag-handle"/);
  assert.match(html, /draggable="true"/);

  const posNotUrgent = html.indexOf('data-quadrant="importantNotUrgent"');
  const posUrgent = html.indexOf('data-quadrant="importantUrgent"');
  assert.ok(posNotUrgent !== -1 && posUrgent !== -1);
  assert.ok(posNotUrgent < posUrgent, 'importantNotUrgent 应该在 importantUrgent 前面渲染');
});

test('Kanban 状态和表情标准化及 KANBAN_LANES 定义', () => {
  assert.equal(KANBAN_LANES.length, 4);
  assert.deepEqual(KANBAN_LANES.map((l) => l.key), ['todo', 'planned', 'doing', 'done']);
  assert.deepEqual(KANBAN_LANES.map((l) => l.title), ['待完成', '今日计划', '开始工作', '已完成']);

  assert.equal(normalizeKanbanStatus('doing'), 'doing');
  assert.equal(normalizeKanbanStatus('planned'), 'planned');
  assert.equal(normalizeKanbanStatus('invalid'), 'todo');
  assert.equal(normalizeKanbanStatus('todo', true), 'done');

  let board = addTask(createEmptyBoard('2026-06-01'), 'importantUrgent', '主任务');
  const task = board.tasks[0];
  assert.equal(task.status, 'todo');
  assert.equal(task.emoji, '');

  board = addChecklistItem(board, task.id, '子任务一');
  const step = board.tasks[0].checklist[0];
  assert.equal(step.status, 'todo');
  assert.equal(step.emoji, '');
});

test('updateTaskKanbanStatus 整体拖拽任务只更新任务自身泳道状态，绝不修改 checklist 步骤的状态', () => {
  let board = addTask(createEmptyBoard('2026-06-01'), 'importantUrgent', '重构模块');
  const taskId = board.tasks[0].id;
  board = addChecklistItems(board, taskId, ['子任务1-未完成', '子任务2-已完成']);
  const step1Id = board.tasks[0].checklist[0].id;
  const step2Id = board.tasks[0].checklist[1].id;

  // 先把 子任务2 标记为完成
  board = toggleChecklistItemCompleted(board, taskId, step2Id, true);
  assert.equal(board.tasks[0].checklist.find((s) => s.id === step2Id).completed, true);
  assert.equal(board.tasks[0].checklist.find((s) => s.id === step2Id).status, 'done');

  // 1. 拖拽任务至「今日计划」，任务状态变为 planned，所有 checklist 步骤状态完全保持不变！
  board = updateTaskKanbanStatus(board, taskId, 'planned');
  assert.equal(board.tasks[0].status, 'planned');
  assert.equal(board.tasks[0].completed, false);
  const plannedStep1 = board.tasks[0].checklist.find((s) => s.id === step1Id);
  const plannedStep2 = board.tasks[0].checklist.find((s) => s.id === step2Id);
  assert.equal(plannedStep1.status, 'todo'); // 保持原状
  assert.equal(plannedStep1.completed, false);
  assert.equal(plannedStep2.status, 'done'); // 保持完成
  assert.equal(plannedStep2.completed, true);

  // 2. 拖拽任务至「开始工作」，任务自身变为 doing，checklist 保持原状
  board = updateTaskKanbanStatus(board, taskId, 'doing');
  assert.equal(board.tasks[0].status, 'doing');
  assert.equal(board.tasks[0].completed, false);
  const doingStep1 = board.tasks[0].checklist.find((s) => s.id === step1Id);
  const doingStep2 = board.tasks[0].checklist.find((s) => s.id === step2Id);
  assert.equal(doingStep1.status, 'todo');
  assert.equal(doingStep1.completed, false);
  assert.equal(doingStep2.status, 'done');
  assert.equal(doingStep2.completed, true);

  // 3. 拖拽任务到「已完成」，任务自身标记为完成，checklist 依然保持各自的完成状态
  board = updateTaskKanbanStatus(board, taskId, 'done');
  assert.equal(board.tasks[0].status, 'done');
  assert.equal(board.tasks[0].completed, true);
  assert.equal(board.tasks[0].checklist.find((s) => s.id === step1Id).completed, false);
  assert.equal(board.tasks[0].checklist.find((s) => s.id === step2Id).completed, true);
});

test('updateChecklistItemKanbanStatus 拖拽子任务或孙任务只更新自身状态', () => {
  let board = addTask(createEmptyBoard('2026-06-01'), 'importantUrgent', '系统架构');
  const taskId = board.tasks[0].id;
  board = addChecklistItems(board, taskId, ['子任务A', '孙任务B', '子任务C']);
  const stepAId = board.tasks[0].checklist[0].id;
  const stepBId = board.tasks[0].checklist[1].id;
  const stepCId = board.tasks[0].checklist[2].id;

  // 将 stepB 变为孙任务 (level 1)
  board = moveChecklistItem(board, taskId, stepBId, stepAId, {
    position: 'after',
    desiredLevel: 1,
  });

  // 拖拽孙任务 stepB 到「今日计划」
  board = updateChecklistItemKanbanStatus(board, taskId, stepBId, 'planned');
  assert.equal(board.tasks[0].checklist.find((s) => s.id === stepBId).status, 'planned');
  assert.equal(board.tasks[0].checklist.find((s) => s.id === stepBId).completed, false);
  // 其他子任务与任务状态保持原样
  assert.equal(board.tasks[0].status, 'todo');
  assert.equal(board.tasks[0].checklist.find((s) => s.id === stepAId).status, 'todo');
  assert.equal(board.tasks[0].checklist.find((s) => s.id === stepCId).status, 'todo');

  // 拖拽子任务 stepA 到「已完成」
  board = updateChecklistItemKanbanStatus(board, taskId, stepAId, 'done');
  assert.equal(board.tasks[0].checklist.find((s) => s.id === stepAId).status, 'done');
  assert.equal(board.tasks[0].checklist.find((s) => s.id === stepAId).completed, true);
  assert.equal(board.tasks[0].status, 'todo'); // 父任务不直接完成
});

test('updateTaskEmoji 与 updateChecklistItemEmoji 支持为任务、子任务、孙任务设置表情', () => {
  let board = addTask(createEmptyBoard('2026-06-01'), 'importantUrgent', '主任务');
  const taskId = board.tasks[0].id;
  board = addChecklistItems(board, taskId, ['子任务1', '孙任务2']);
  const step1Id = board.tasks[0].checklist[0].id;
  const step2Id = board.tasks[0].checklist[1].id;

  board = updateTaskEmoji(board, taskId, '🚀');
  assert.equal(board.tasks[0].emoji, '🚀');

  board = updateChecklistItemEmoji(board, taskId, step1Id, '⚡');
  assert.equal(board.tasks[0].checklist[0].emoji, '⚡');

  board = updateChecklistItemEmoji(board, taskId, step2Id, '🔥');
  assert.equal(board.tasks[0].checklist[1].emoji, '🔥');
});

test('renderWorkspace 与 renderKanbanBoard 支持看板模式渲染、父任务分组与表情展示', () => {
  let board = addTask(createEmptyBoard('2026-06-01'), 'importantUrgent', '电商首页重构');
  const taskId = board.tasks[0].id;
  board = updateTaskEmoji(board, taskId, '🛍️');
  board = addChecklistItems(board, taskId, ['子任务A', '孙任务B']);
  const stepAId = board.tasks[0].checklist[0].id;
  const stepBId = board.tasks[0].checklist[1].id;
  board = updateChecklistItemEmoji(board, taskId, stepAId, '🎨');
  board = updateChecklistItemEmoji(board, taskId, stepBId, '🛠️');

  // 将孙任务 B 设为 level 1，并将状态移动到「开始工作」
  board = moveChecklistItem(board, taskId, stepBId, stepAId, {
    position: 'after',
    desiredLevel: 1,
  });
  board = updateChecklistItemKanbanStatus(board, taskId, stepBId, 'doing');

  // 1. 默认四象限视图包含切换按钮
  const quadHtml = renderWorkspace(board, { viewMode: 'quadrant' });
  assert.match(quadHtml, /class="gtd-view-switcher"/);
  assert.match(quadHtml, /data-view="quadrant"/);
  assert.match(quadHtml, /data-view="kanban"/);
  assert.match(quadHtml, /🛍️/);

  // 2. 看板模式渲染
  const kanbanHtml = renderWorkspace(board, { viewMode: 'kanban' });
  assert.match(kanbanHtml, /class="gtd-kanban-board"/);
  assert.match(kanbanHtml, /待完成/);
  assert.match(kanbanHtml, /今日计划/);
  assert.match(kanbanHtml, /开始工作/);
  assert.match(kanbanHtml, /已完成/);

  // 默认情况下看板任务与子任务均为折叠状态
  assert.match(kanbanHtml, /class="gtd-kanban-group-steps is-collapsed"/);
  assert.match(kanbanHtml, /data-gtd-action="toggle-kanban-task-collapse"/);
  assert.match(kanbanHtml, /<span class="gtd-kanban-toggle-icon">▸<\/span>/);

  // 显式展开看板任务后，泳道内子任务显示
  const expandedKanban = renderWorkspace(board, {
    viewMode: 'kanban',
    expandedKanbanTasks: { [`todo:${taskId}`]: true, [`doing:${taskId}`]: true },
  });
  assert.match(expandedKanban, /class="gtd-kanban-group-steps is-expanded"/);
  assert.match(expandedKanban, /<span class="gtd-kanban-toggle-icon">▾<\/span>/);
  assert.match(expandedKanban, /子任务A/);
  assert.match(expandedKanban, /孙任务B/);

  // 不再渲染「子任务」、「孙任务」文字徽标
  assert.doesNotMatch(kanbanHtml, /class="[^"]*gtd-badge-subtask/);
  assert.doesNotMatch(kanbanHtml, /class="[^"]*gtd-badge-grandtask/);
  assert.doesNotMatch(kanbanHtml, /孙任务 L/);

  // 四象限 Checklist 视图中，带有孙任务的子任务默认处于折叠状态，子级隐藏
  let detailBoard = selectTask(board, taskId);
  const checklistDefaultHtml = renderWorkspace(detailBoard);
  assert.match(checklistDefaultHtml, /data-gtd-action="toggle-step-collapse"/);
  assert.match(checklistDefaultHtml, /is-step-collapsed/);

  // 显式展开子任务后，孙任务展示
  const checklistExpandedHtml = renderWorkspace(detailBoard, {
    expandedChecklistSteps: { [stepAId]: true },
  });
  assert.match(checklistExpandedHtml, /aria-expanded="true"/);

  // 表情展示
  assert.match(kanbanHtml, /🛍️/);
  assert.match(kanbanHtml, /🎨/);
  assert.match(kanbanHtml, /🛠️/);

  // 拖拽属性支持（包括任务卡片、锚点所属任务、子步骤均支持拖拽）
  assert.match(kanbanHtml, /data-gtd-action="drag-kanban-item"/);
  assert.match(kanbanHtml, /draggable="true"/);
  assert.match(kanbanHtml, /class="gtd-kanban-anchor-title"[^>]*draggable="true"/);

  // 四象限分类以 Ribbon（斜角绸带单字样式）展示在任务名称右侧，且不使用旗标图标
  assert.match(kanbanHtml, /class="gtd-quadrant-ribbon gtd-quadrant-ribbon-importantUrgent"/);
  assert.match(kanbanHtml, /<span class="gtd-ribbon-text">急<\/span>/);
  assert.doesNotMatch(kanbanHtml, /class="gtd-flag-icon"/);
  // 5/9 步等进度不再在看板与任务项中展示
  assert.doesNotMatch(kanbanHtml, /class="gtd-task-progress"/);
  assert.doesNotMatch(quadHtml, /class="gtd-task-progress"/);

  const taskTitlePos = kanbanHtml.indexOf('class="gtd-kanban-task-title">电商首页重构</span>');
  const ribbonPos = kanbanHtml.indexOf('class="gtd-quadrant-ribbon gtd-quadrant-ribbon-importantUrgent"', taskTitlePos);
  assert.ok(taskTitlePos !== -1 && ribbonPos > taskTitlePos, '看板任务卡片中的 Ribbon 位于任务名称右侧');

  // 四象限常规视图中，任务项本身无需显示分类小图标（因为四象限本身即为分类）
  assert.match(quadHtml, /class="gtd-task-title-wrap"/);
  const quadTaskTitleWrap = quadHtml.match(/<span class="gtd-task-title-wrap">([\s\S]*?)<\/span>/)?.[1] || '';
  assert.doesNotMatch(quadTaskTitleWrap, /class="gtd-quadrant-ribbon"/, '四象限任务项中无需显示分类小图标');

  // Checklist 头部保留 Ribbon 展示当前选中任务的所属象限
  const checklistTitlePos = quadHtml.indexOf('<h3>电商首页重构</h3>');
  const checklistRibbonPos = quadHtml.indexOf('class="gtd-quadrant-ribbon gtd-quadrant-ribbon-importantUrgent"', checklistTitlePos);
  assert.ok(checklistTitlePos !== -1 && checklistRibbonPos > checklistTitlePos, 'Checklist 标题中的 Ribbon 位于任务名称右侧');
});

test('renderQuadrantRibbon 输出斜角绸带样式的分类单字标签，且不带旗标图标与 5/9 步进度', () => {
  const defaultRibbon = renderQuadrantRibbon('importantUrgent');
  assert.match(defaultRibbon, /class="gtd-quadrant-ribbon gtd-quadrant-ribbon-importantUrgent"/);
  assert.match(defaultRibbon, /<span class="gtd-ribbon-text">急<\/span>/);
  assert.match(defaultRibbon, /title="四象限分类：重要且紧急"/);
  assert.doesNotMatch(defaultRibbon, /<svg class="gtd-flag-icon"/);

  // 四象限默认单字
  assert.equal(getQuadrantShortChar('importantUrgent'), '急');
  assert.equal(getQuadrantShortChar('importantNotUrgent'), '重');
  assert.equal(getQuadrantShortChar('urgentNotImportant'), '杂');
  assert.equal(getQuadrantShortChar('notImportantNotUrgent'), '闲');

  const customRibbon = renderQuadrantRibbon('importantNotUrgent', {
    importantNotUrgent: '战略推进',
  });
  assert.match(customRibbon, /class="gtd-quadrant-ribbon gtd-quadrant-ribbon-importantNotUrgent"/);
  assert.match(customRibbon, /<span class="gtd-ribbon-text">战<\/span>/);
  assert.match(customRibbon, /title="四象限分类：战略推进"/);

  // 验证别名兼容
  assert.equal(renderQuadrantFlag, renderQuadrantRibbon);
});

test('computeStepTreeVisibility 正确计算步骤树层级可见性与默认折叠状态', () => {
  const steps = [
    { id: 'step1', level: 0, text: '子任务1' },
    { id: 'step1_1', level: 1, text: '孙任务1.1' },
    { id: 'step1_2', level: 2, text: '曾孙任务1.2' },
    { id: 'step2', level: 0, text: '子任务2' },
  ];

  // 1. 默认全部折叠：step1_1 和 step1_2 不可见
  const defaultMeta = computeStepTreeVisibility(steps, {});
  assert.equal(defaultMeta[0].hasChildren, true);
  assert.equal(defaultMeta[0].isExpanded, false);
  assert.equal(defaultMeta[0].isVisible, true);

  assert.equal(defaultMeta[1].hasChildren, true);
  assert.equal(defaultMeta[1].isVisible, false); // 被父级折叠

  assert.equal(defaultMeta[2].hasChildren, false);
  assert.equal(defaultMeta[2].isVisible, false); // 被祖先折叠

  assert.equal(defaultMeta[3].hasChildren, false);
  assert.equal(defaultMeta[3].isVisible, true);

  // 2. 展开 step1 后，step1_1 可见，但 step1_2 仍被 step1_1 折叠
  const metaExpandedStep1 = computeStepTreeVisibility(steps, { step1: true });
  assert.equal(metaExpandedStep1[0].isExpanded, true);
  assert.equal(metaExpandedStep1[1].isVisible, true);
  assert.equal(metaExpandedStep1[1].isExpanded, false);
  assert.equal(metaExpandedStep1[2].isVisible, false);

  // 3. 同时展开 step1 与 step1_1 后，step1_2 可见
  const metaExpandedAll = computeStepTreeVisibility(steps, { step1: true, step1_1: true });
  assert.equal(metaExpandedAll[1].isExpanded, true);
  assert.equal(metaExpandedAll[2].isVisible, true);

  // 4. 编辑 step1_2 时自动展开所有祖先节点
  const metaEditing = computeStepTreeVisibility(steps, {}, { editingStepId: 'step1_2' });
  assert.equal(metaEditing[0].isExpanded, true);
  assert.equal(metaEditing[1].isExpanded, true);
  assert.equal(metaEditing[2].isVisible, true);
});

test('normalizeQuickLinksState 支持空值与异常数据兜底，确保默认分区存在', () => {
  const empty = normalizeQuickLinksState(null);
  assert.equal(empty.partitions.length, 1);
  assert.equal(empty.partitions[0].id, DEFAULT_QUICK_LINKS_PARTITION_ID);
  assert.equal(empty.partitions[0].name, DEFAULT_QUICK_LINKS_PARTITION_NAME);
  assert.deepEqual(empty.partitions[0].links, []);

  const invalid = normalizeQuickLinksState({
    partitions: [
      { id: 'p1', name: '工作', links: [{ url: '', title: 'bad' }, { url: 'https://github.com' }] },
    ],
  });
  assert.equal(invalid.partitions.length, 1);
  assert.equal(invalid.partitions[0].name, '工作');
  assert.equal(invalid.partitions[0].links.length, 1);
  assert.equal(invalid.partitions[0].links[0].url, 'https://github.com');
  assert.equal(invalid.partitions[0].links[0].title, 'github.com');
});

test('getQuickLinks 与 saveQuickLinks 正确读写 storage', async () => {
  const memoryStore = {};
  const mockStorage = {
    async get(key) { return { [key]: memoryStore[key] }; },
    async set(payload) { Object.assign(memoryStore, payload); },
  };

  const initial = await getQuickLinks(mockStorage);
  assert.equal(initial.partitions.length, 1);

  const updated = addQuickLink(initial, 'default', {
    url: 'https://news.ycombinator.com',
    title: 'Hacker News',
  });
  await saveQuickLinks(mockStorage, updated);

  const reloaded = await getQuickLinks(mockStorage);
  assert.equal(reloaded.partitions[0].links.length, 1);
  assert.equal(reloaded.partitions[0].links[0].title, 'Hacker News');
  assert.equal(reloaded.partitions[0].links[0].url, 'https://news.ycombinator.com');
});

test('addQuickLink, moveQuickLink 与 removeQuickLink 实现添加、分类移动与删除', () => {
  let state = normalizeQuickLinksState(null);
  state = addQuickLinksPartition(state, '工作');
  const workPartId = state.partitions[1].id;

  // 1. 添加常用链接到默认分区
  state = addQuickLink(state, 'default', {
    url: 'https://github.com',
    title: 'GitHub',
  });
  assert.equal(state.partitions[0].links.length, 1);
  const linkId = state.partitions[0].links[0].id;

  // 2. 重复添加相同 URL 会更新标题，不产生重复链接
  state = addQuickLink(state, 'default', {
    url: 'https://github.com',
    title: 'GitHub Code',
  });
  assert.equal(state.partitions[0].links.length, 1);
  assert.equal(state.partitions[0].links[0].title, 'GitHub Code');

  // 3. 拖拽移动到工作分区实现分类显示
  state = moveQuickLink(state, linkId, workPartId);
  assert.equal(state.partitions[0].links.length, 0);
  assert.equal(state.partitions[1].links.length, 1);
  assert.equal(state.partitions[1].links[0].url, 'https://github.com');

  // 4. 拖拽到外部删除常用链接
  state = removeQuickLink(state, workPartId, linkId);
  assert.equal(state.partitions[1].links.length, 0);
});

test('addQuickLinksPartition, renameQuickLinksPartition 与 removeQuickLinksPartition 管理分区', () => {
  let state = normalizeQuickLinksState(null);
  state = addQuickLinksPartition(state, '开发工具');
  assert.equal(state.partitions.length, 2);
  const newPartId = state.partitions[1].id;
  assert.equal(state.partitions[1].name, '开发工具');

  // 重命名分区
  state = renameQuickLinksPartition(state, newPartId, '生产力');
  assert.equal(state.partitions[1].name, '生产力');

  // 添加链接后删除分区，链接会被合入首个保留分区
  state = addQuickLink(state, newPartId, { url: 'https://linear.app', title: 'Linear' });
  state = removeQuickLinksPartition(state, newPartId);
  assert.equal(state.partitions.length, 1);
  assert.equal(state.partitions[0].links.length, 1);
  assert.equal(state.partitions[0].links[0].url, 'https://linear.app');

  // 最后一个分区不可删除
  state = removeQuickLinksPartition(state, state.partitions[0].id);
  assert.equal(state.partitions.length, 1);
});

test('renderQuickLinksBar 与 renderWorkspace 正确渲染单行占用、顶部布局及跳转按钮', () => {
  let state = normalizeQuickLinksState(null);
  state = addQuickLink(state, 'default', {
    url: 'https://example.com',
    title: 'Example Domain',
  });
  state = addQuickLinksPartition(state, '日常');

  const barHtml = renderQuickLinksBar(state);
  assert.match(barHtml, /class="gtd-quick-links-bar"/);
  assert.match(barHtml, /data-gtd-component="quick-links-bar"/);
  assert.match(barHtml, /常用链接/);
  assert.match(barHtml, /data-gtd-action="open-quick-link"/);
  assert.match(barHtml, /data-link-url="https:\/\/example\.com"/);
  assert.match(barHtml, /Example Domain/);
  assert.match(barHtml, /data-gtd-action="add-quick-links-partition"/);
  assert.match(barHtml, />日常<\/span>/);

  // 在 GTD 主工作区顶部渲染
  const workspaceHtml = renderWorkspace(createEmptyBoard('2026-04-28'), {
    quickLinks: state,
  });
  assert.match(workspaceHtml, /<div class="gtd-shell[^>]*>[\s\S]*?<div\s+class="gtd-quick-links-bar"/);
  assert.match(workspaceHtml, /class="gtd-quick-link-btn"/);
});

test('sortCompletedDesc 按照 completedAt 时间倒序排列已完成项', () => {
  const items = [
    { id: '1', title: '早些完成', completedAt: '2026-11-16T08:00:00.000Z' },
    { id: '2', title: '最新完成', completedAt: '2026-11-16T10:30:00.000Z' },
    { id: '3', title: '中间完成', completedAt: '2026-11-16T09:15:00.000Z' },
  ];
  const sorted = sortCompletedDesc(items);
  assert.deepEqual(sorted.map((item) => item.id), ['2', '3', '1']);
});

test('四象限视图、步骤清单及看板已完成泳道均按时间倒序排列已完成任务与步骤', () => {
  let board = createEmptyBoard('2026-11-16');
  // 添加 3 个任务
  board = addTask(board, 'importantUrgent', '任务A-最早');
  board = addTask(board, 'importantUrgent', '任务B-中间');
  board = addTask(board, 'importantUrgent', '任务C-最晚');

  const taskA = board.tasks.find((t) => t.title === '任务A-最早');
  const taskB = board.tasks.find((t) => t.title === '任务B-中间');
  const taskC = board.tasks.find((t) => t.title === '任务C-最晚');

  // 为任务A添加 3 个步骤
  board = addChecklistItem(board, taskA.id, '步骤1-先完成');
  board = addChecklistItem(board, taskA.id, '步骤2-后完成');
  board = addChecklistItem(board, taskA.id, '步骤3-最后完成');

  const step1 = board.tasks.find((t) => t.id === taskA.id).checklist[0];
  const step2 = board.tasks.find((t) => t.id === taskA.id).checklist[1];
  const step3 = board.tasks.find((t) => t.id === taskA.id).checklist[2];

  // 按不同时间依次完成任务
  board.tasks = board.tasks.map((t) => {
    if (t.id === taskA.id) {
      return { ...t, completed: true, status: 'done', completedAt: '2026-11-16T09:00:00.000Z' };
    }
    if (t.id === taskB.id) {
      return { ...t, completed: true, status: 'done', completedAt: '2026-11-16T11:00:00.000Z' };
    }
    if (t.id === taskC.id) {
      return { ...t, completed: true, status: 'done', completedAt: '2026-11-16T10:00:00.000Z' };
    }
    return t;
  });

  // 按不同时间依次完成步骤
  const targetTask = board.tasks.find((t) => t.id === taskA.id);
  targetTask.checklist = targetTask.checklist.map((s) => {
    if (s.id === step1.id) {
      return { ...s, completed: true, status: 'done', completedAt: '2026-11-16T09:10:00.000Z' };
    }
    if (s.id === step2.id) {
      return { ...s, completed: true, status: 'done', completedAt: '2026-11-16T09:30:00.000Z' };
    }
    if (s.id === step3.id) {
      return { ...s, completed: true, status: 'done', completedAt: '2026-11-16T09:20:00.000Z' };
    }
    return s;
  });

  // 1. 验证四象限卡片中已完成任务的渲染顺序（倒序：任务B (11:00) -> 任务C (10:00) -> 任务A (09:00)）
  const quadHtml = renderWorkspace(board, {
    expandedCompletedQuadrants: { importantUrgent: true },
  });
  const taskBIdx = quadHtml.indexOf('任务B-中间');
  const taskCIdx = quadHtml.indexOf('任务C-最晚');
  const taskAIdx = quadHtml.indexOf('任务A-最早');
  assert.ok(taskBIdx !== -1 && taskCIdx !== -1 && taskAIdx !== -1);
  assert.ok(taskBIdx < taskCIdx, '任务B应该在任务C之前渲染');
  assert.ok(taskCIdx < taskAIdx, '任务C应该在任务A之前渲染');

  // 2. 验证步骤清单中已完成步骤的渲染顺序（倒序：步骤2 (09:30) -> 步骤3 (09:20) -> 步骤1 (09:10)）
  const detailBoard = selectTask(board, taskA.id);
  const checklistHtml = renderWorkspace(detailBoard, {
    expandedCompletedSteps: { [taskA.id]: true },
  });
  const step2Idx = checklistHtml.indexOf('步骤2-后完成');
  const step3Idx = checklistHtml.indexOf('步骤3-最后完成');
  const step1Idx = checklistHtml.indexOf('步骤1-先完成');
  assert.ok(step2Idx !== -1 && step3Idx !== -1 && step1Idx !== -1);
  assert.ok(step2Idx < step3Idx, '步骤2应该在步骤3之前渲染');
  assert.ok(step3Idx < step1Idx, '步骤3应该在步骤1之前渲染');

  // 3. 验证看板模式已完成泳道中任务与步骤的倒序渲染
  const kanbanHtml = renderWorkspace(board, {
    viewMode: 'kanban',
    expandedKanbanTasks: { [`done:${taskA.id}`]: true },
  });
  const kanbanBIdx = kanbanHtml.indexOf('任务B-中间');
  const kanbanCIdx = kanbanHtml.indexOf('任务C-最晚');
  const kanbanAIdx = kanbanHtml.indexOf('任务A-最早');
  assert.ok(kanbanBIdx < kanbanCIdx, '看板已完成泳道中任务B应在任务C之前');
  assert.ok(kanbanCIdx < kanbanAIdx, '看板已完成泳道中任务C应在任务A之前');
});

test('toggleTaskCompleted 与 toggleChecklistItemCompleted 会刷新 completedAt 并让重新完成的项置顶', async () => {
  let board = createEmptyBoard('2026-11-16');
  board = addTask(board, 'importantUrgent', '任务1');
  board = addTask(board, 'importantUrgent', '任务2');
  const task1Id = board.tasks[0].id;
  const task2Id = board.tasks[1].id;

  board = toggleTaskCompleted(board, task1Id, true);
  await new Promise((r) => setTimeout(r, 5));
  board = toggleTaskCompleted(board, task2Id, true);

  const t1 = board.tasks.find((t) => t.id === task1Id);
  const t2 = board.tasks.find((t) => t.id === task2Id);
  assert.ok(Date.parse(t2.completedAt) >= Date.parse(t1.completedAt));

  // 任务1 取消勾选后再次完成，时间戳刷新，变为最新完成
  board = toggleTaskCompleted(board, task1Id, false);
  assert.equal(board.tasks.find((t) => t.id === task1Id).completedAt, '');
  await new Promise((r) => setTimeout(r, 5));
  board = toggleTaskCompleted(board, task1Id, true);
  const t1New = board.tasks.find((t) => t.id === task1Id);
  assert.ok(Date.parse(t1New.completedAt) > Date.parse(t2.completedAt));

  // 在工作区中，任务1 排在任务2 前面
  const html = renderWorkspace(board, { expandedCompletedQuadrants: { importantUrgent: true } });
  assert.ok(html.indexOf('任务1') < html.indexOf('任务2'));
});

test('Kanban 视图中拖拽任务至「今日计划」仅流转未完成步骤，已完成步骤保留在「已完成」泳道并按倒序排列', () => {
  let board = addTask(createEmptyBoard('2026-11-16'), 'importantUrgent', '长春市一张图开发');
  const taskId = board.tasks[0].id;
  board = addChecklistItems(board, taskId, ['冬季房顶的雪去掉', 'onemap改进', '提升精模分辨率']);
  const step1Id = board.tasks[0].checklist[0].id;
  const step2Id = board.tasks[0].checklist[1].id;
  const step3Id = board.tasks[0].checklist[2].id;

  // 模拟按时间先后完成前两步：step1 (早), step2 (晚)
  board.tasks[0].checklist = board.tasks[0].checklist.map((s) => {
    if (s.id === step1Id) {
      return { ...s, completed: true, status: 'done', completedAt: '2026-11-16T10:00:00.000Z' };
    }
    if (s.id === step2Id) {
      return { ...s, completed: true, status: 'done', completedAt: '2026-11-16T10:30:00.000Z' };
    }
    return s;
  });

  // 整体拖拽任务至「今日计划」，只移动任务自身，checklist 各自状态完全不变
  board = updateTaskKanbanStatus(board, taskId, 'planned');
  assert.equal(board.tasks[0].status, 'planned');
  assert.equal(board.tasks[0].checklist.find((s) => s.id === step1Id).completed, true);
  assert.equal(board.tasks[0].checklist.find((s) => s.id === step1Id).status, 'done');
  assert.equal(board.tasks[0].checklist.find((s) => s.id === step2Id).completed, true);
  assert.equal(board.tasks[0].checklist.find((s) => s.id === step2Id).status, 'done');
  assert.equal(board.tasks[0].checklist.find((s) => s.id === step3Id).completed, false);
  assert.equal(board.tasks[0].checklist.find((s) => s.id === step3Id).status, 'todo');

  // 将未完成的 step3 拖拽至「今日计划」
  board = updateChecklistItemKanbanStatus(board, taskId, step3Id, 'planned');
  assert.equal(board.tasks[0].checklist.find((s) => s.id === step3Id).status, 'planned');

  // 看板渲染：
  // 1. 「今日计划」泳道内只展示当前泳道未完成步骤（提升精模分辨率），绝不包含已完成步骤
  const kanbanHtml = renderWorkspace(board, {
    viewMode: 'kanban',
    expandedKanbanTasks: { [`planned:${taskId}`]: true, [`done:${taskId}`]: true },
  });

  const plannedSection = kanbanHtml.slice(
    kanbanHtml.indexOf('data-gtd-drop-lane="planned"'),
    kanbanHtml.indexOf('data-gtd-drop-lane="doing"')
  );
  assert.match(plannedSection, /提升精模分辨率/);
  assert.doesNotMatch(plannedSection, /冬季房顶的雪去掉/);
  assert.doesNotMatch(plannedSection, /onemap改进/);

  // 2. 「已完成」泳道内展示所属任务及已完成步骤，且按时间倒序排列（step2 10:30 在 step1 10:00 之前）
  const doneSection = kanbanHtml.slice(kanbanHtml.indexOf('data-gtd-drop-lane="done"'));
  assert.match(doneSection, /所属任务:[\s\S]*长春市一张图开发/);
  const idxStep2 = doneSection.indexOf('onemap改进');
  const idxStep1 = doneSection.indexOf('冬季房顶的雪去掉');
  assert.ok(idxStep2 !== -1 && idxStep1 !== -1);
  assert.ok(idxStep2 < idxStep1, '已完成泳道中后完成的步骤 onemap改进 必须排在先完成的 冬季房顶的雪去掉 之前');

  // 3. 在四象限 Checklist 视图中，未完成步骤在上方，已完成步骤归入底部的已完成折叠区
  const selectedBoard = selectTask(board, taskId);
  const checklistHtml = renderWorkspace(selectedBoard, {
    expandedCompletedSteps: { [taskId]: true },
  });
  assert.match(checklistHtml, /2\/3 步已完成/);
  assert.match(checklistHtml, /class="gtd-completed-section gtd-step-completed-section"/);
  assert.match(checklistHtml, /已完成步骤 \(2\)/);
});

test('recoverTaskChecklistFromHistory 能够精准比对历史看板并恢复 checklist 已完成步骤与时间戳', async () => {
  const storage = createMockStorage();

  // 1. 模拟历史看板 2026-11-15：包含“长春市一张图开发”，部分步骤已完成
  let histBoard = addTask(createEmptyBoard('2026-11-15'), 'importantUrgent', '长春市一张图开发');
  const histTaskId = histBoard.tasks[0].id;
  histBoard = addChecklistItem(histBoard, histTaskId, '冬季房顶的雪去掉');
  histBoard = addChecklistItem(histBoard, histTaskId, 'onemap改进');
  histBoard = addChecklistItem(histBoard, histTaskId, '提升精模的3dtiles分辨率');
  histBoard = addChecklistItem(histBoard, histTaskId, '大华视频接入，使用go网关');

  const histTask = histBoard.tasks[0];
  const step0Id = histTask.checklist[0].id;
  const step1Id = histTask.checklist[1].id;
  const step3Id = histTask.checklist[3].id;

  // 历史中已完成第 0、1、3 步
  histBoard = toggleChecklistItemCompleted(histBoard, histTaskId, step0Id, true);
  histBoard = toggleChecklistItemCompleted(histBoard, histTaskId, step1Id, true);
  histBoard = toggleChecklistItemCompleted(histBoard, histTaskId, step3Id, true);

  // 保存历史看板
  await saveBoard(storage, histBoard);

  // 2. 模拟今日看板 2026-11-16：由于拖拽 bug，步骤全部被错误置为未完成 (completed: false)
  let todayBoard = addTask(createEmptyBoard('2026-11-16'), 'importantUrgent', '长春市一张图开发');
  const todayTaskId = todayBoard.tasks[0].id;
  todayBoard = addChecklistItem(todayBoard, todayTaskId, '冬季房顶的雪去掉');
  todayBoard = addChecklistItem(todayBoard, todayTaskId, 'onemap改进');
  todayBoard = addChecklistItem(todayBoard, todayTaskId, '提升精模的3dtiles分辨率');
  todayBoard = addChecklistItem(todayBoard, todayTaskId, '大华视频接入，使用go网关');

  // 保存今日异常看板
  await saveBoard(storage, todayBoard);

  // 3. 执行历史恢复
  const result = await recoverTaskChecklistFromHistory(storage, todayBoard, todayTaskId);

  assert.equal(result.success, true);
  assert.equal(result.count, 3, '应当成功恢复 3 个历史已完成步骤');
  assert.equal(result.board.tasks[0].checklist[0].completed, true);
  assert.equal(result.board.tasks[0].checklist[1].completed, true);
  assert.equal(result.board.tasks[0].checklist[2].completed, false);
  assert.equal(result.board.tasks[0].checklist[3].completed, true);

  // 验证时间戳与 status: 'done' 被正确设置
  assert.equal(result.board.tasks[0].checklist[0].status, 'done');
  assert.ok(result.board.tasks[0].checklist[0].completedAt);

  // 验证已经持久化写入了 storage
  const savedBoards = await getBoards(storage);
  const reloadedToday = savedBoards['2026-11-16'];
  assert.equal(reloadedToday.tasks[0].checklist.filter(i => i.completed).length, 3);
});

test('recoverTaskChecklistFromHistory 支持跨多天历史看板恢复，且不覆盖今日已有完成状态与时间戳', async () => {
  const storage = createMockStorage();

  // 1. 模拟更早历史看板 2026-11-14
  let pastBoard = addTask(createEmptyBoard('2026-11-14'), 'importantUrgent', '生态数据资源平台-进行一次重构');
  const pastTaskId = pastBoard.tasks[0].id;
  pastBoard = addChecklistItem(pastBoard, pastTaskId, '去服务中心对接');
  pastBoard = addChecklistItem(pastBoard, pastTaskId, '完成代码审查');
  pastBoard = toggleChecklistItemCompleted(pastBoard, pastTaskId, pastBoard.tasks[0].checklist[0].id, true);
  const pastCompletedAt = pastBoard.tasks[0].checklist[0].completedAt;
  await saveBoard(storage, pastBoard);

  // 2. 今日看板 2026-11-16：包含该任务，第一步今天完成了，第二步历史上完成过但今天未完成
  let todayBoard = addTask(createEmptyBoard('2026-11-16'), 'importantUrgent', '生态数据资源平台-进行一次重构');
  const tId = todayBoard.tasks[0].id;
  todayBoard = addChecklistItem(todayBoard, tId, '今日新增临时待办');
  todayBoard = addChecklistItem(todayBoard, tId, '去服务中心对接');
  // 今日手动完成了第一步
  todayBoard = toggleChecklistItemCompleted(todayBoard, tId, todayBoard.tasks[0].checklist[0].id, true);
  const todayStep1CompletedAt = todayBoard.tasks[0].checklist[0].completedAt;
  await saveBoard(storage, todayBoard);

  // 3. 不传 taskId 执行全看板历史比对恢复
  const result = await recoverTaskChecklistFromHistory(storage, todayBoard);
  assert.equal(result.count, 1);
  const checklist = result.board.tasks[0].checklist;
  // 原第一步不受影响且时间戳未被修改
  assert.equal(checklist[0].completed, true);
  assert.equal(checklist[0].completedAt, todayStep1CompletedAt);
  // 第二步被成功恢复
  assert.equal(checklist[1].completed, true);
  assert.equal(checklist[1].status, 'done');
  assert.equal(checklist[1].completedAt, pastCompletedAt);
});





