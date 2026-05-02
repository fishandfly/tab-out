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
  updateChecklistItemText,
  moveChecklistItem,
  toggleChecklistItemCompleted,
  deleteChecklistItem,
  deleteTask,
  updateTaskTitle,
  moveTaskToQuadrant,
  exportBoardToMarkdown,
  importBoardFromMarkdown,
  getSelectedTask,
  getTaskProgress,
  getQuadrantTasks,
  renderWorkspace,
  renderWorkspaceShell,
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

test('renderWorkspaceShell 会渲染 GTD、白板、笔记与结构图四个 tab，并默认激活 GTD', () => {
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
  assert.match(html, /data-workspace-active-tab="gtd"/);
  assert.match(html, /aria-selected="true"[^>]*>GTD</);
  assert.match(html, /aria-selected="false"[^>]*>白板</);
  assert.match(html, /aria-selected="false"[^>]*>笔记</);
  assert.match(html, /aria-selected="false"[^>]*>结构图</);
  assert.match(html, /src="whiteboard\/index\.html"/);
  assert.match(html, /src="notes\/index\.html"/);
  assert.match(html, /src="structureboard\/index\.html"/);
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
  assert.match(html, /class="workspace-panel workspace-panel-gtd"/);
  assert.match(html, /class="workspace-panel workspace-panel-whiteboard(?: is-active)?"/);
  assert.match(html, /class="workspace-panel workspace-panel-notes"/);
  assert.match(html, /class="workspace-panel workspace-panel-structure"/);
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
  assert.match(html, /class="workspace-panel workspace-panel-structure is-active"/);
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
