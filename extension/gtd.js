(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TabOutGTD = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'gtdBoards';
  const CHECKLIST_MAX_LEVEL = 6;
  const QUADRANTS = [
    {
      key: 'importantUrgent',
      title: '重要且紧急',
      hint: '今天必须先完成的关键事项',
      empty: '先把今天最不能拖的事情放进来',
      tone: 'critical',
    },
    {
      key: 'importantNotUrgent',
      title: '重要不紧急',
      hint: '决定长期质量，但容易被挤掉',
      empty: '把值得提前推进的任务安排进来',
      tone: 'steady',
    },
    {
      key: 'urgentNotImportant',
      title: '紧急不重要',
      hint: '需要处理，但不该吃掉全部注意力',
      empty: '只放那些必须回应的外部事项',
      tone: 'alert',
    },
    {
      key: 'notImportantNotUrgent',
      title: '不重要不紧急',
      hint: '尽量减少投入，不要让它占满今天',
      empty: '如果这里很多，说明今天的焦点跑偏了',
      tone: 'muted',
    },
  ];

  const QUADRANT_MAP = Object.fromEntries(QUADRANTS.map((item) => [item.key, item]));
  const QUADRANT_TITLE_MAP = Object.fromEntries(QUADRANTS.map((item) => [item.title, item.key]));

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function getBoardDate(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function createId(prefix = 'gtd') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function isValidQuadrant(quadrant) {
    return Object.prototype.hasOwnProperty.call(QUADRANT_MAP, quadrant);
  }

  function clampChecklistLevel(level) {
    const safeLevel = Number.isFinite(Number(level)) ? Math.trunc(Number(level)) : 0;
    return Math.max(0, Math.min(CHECKLIST_MAX_LEVEL, safeLevel));
  }

  function normalizeChecklistItem(item) {
    return {
      id: typeof item?.id === 'string' && item.id ? item.id : createId('step'),
      text: typeof item?.text === 'string' ? item.text.trim() : '',
      level: clampChecklistLevel(item?.level),
      completed: Boolean(item?.completed),
      createdAt: item?.createdAt || nowIso(),
      completedAt: item?.completed ? (item?.completedAt || nowIso()) : '',
    };
  }

  function normalizeTask(task) {
    const checklist = Array.isArray(task?.checklist)
      ? task.checklist.map(normalizeChecklistItem).filter((item) => item.text)
      : [];

    return {
      id: typeof task?.id === 'string' && task.id ? task.id : createId('task'),
      title: typeof task?.title === 'string' ? task.title.trim() : '',
      quadrant: isValidQuadrant(task?.quadrant) ? task.quadrant : 'importantUrgent',
      completed: Boolean(task?.completed),
      createdAt: task?.createdAt || nowIso(),
      completedAt: task?.completed ? (task?.completedAt || nowIso()) : '',
      checklist,
    };
  }

  function normalizeBoard(board, fallbackDate = getBoardDate()) {
    const tasks = Array.isArray(board?.tasks)
      ? board.tasks.map(normalizeTask).filter((task) => task.title)
      : [];
    const selectedTaskId = typeof board?.selectedTaskId === 'string' ? board.selectedTaskId : '';
    const selectedExists = selectedTaskId && tasks.some((task) => task.id === selectedTaskId);

    return {
      date: typeof board?.date === 'string' && board.date ? board.date : fallbackDate,
      tasks,
      selectedTaskId: selectedExists ? selectedTaskId : '',
      updatedAt: board?.updatedAt || nowIso(),
    };
  }

  function createEmptyBoard(date = getBoardDate()) {
    return {
      date,
      tasks: [],
      selectedTaskId: '',
      updatedAt: nowIso(),
    };
  }

  function touchBoard(board, tasks, selectedTaskId) {
    return normalizeBoard({
      ...board,
      tasks,
      selectedTaskId,
      updatedAt: nowIso(),
    }, board.date);
  }

  function getQuadrantTasks(board, quadrant) {
    return normalizeBoard(board).tasks.filter((task) => task.quadrant === quadrant);
  }

  function getTaskProgress(task) {
    const checklist = Array.isArray(task?.checklist) ? task.checklist : [];
    return {
      completed: checklist.filter((item) => item.completed).length,
      total: checklist.length,
    };
  }

  function getSelectedTask(board) {
    const normalized = normalizeBoard(board);
    if (!normalized.selectedTaskId) return null;
    return normalized.tasks.find((task) => task.id === normalized.selectedTaskId) || null;
  }

  function addTask(board, quadrant, title) {
    const normalized = normalizeBoard(board);
    const cleanedTitle = typeof title === 'string' ? title.trim() : '';
    if (!cleanedTitle || !isValidQuadrant(quadrant)) return normalized;

    const task = normalizeTask({
      id: createId('task'),
      title: cleanedTitle,
      quadrant,
      completed: false,
      createdAt: nowIso(),
      checklist: [],
    });

    return touchBoard(normalized, [...normalized.tasks, task], task.id);
  }

  function selectTask(board, taskId) {
    const normalized = normalizeBoard(board);
    const exists = normalized.tasks.some((task) => task.id === taskId);
    return touchBoard(normalized, normalized.tasks, exists ? taskId : '');
  }

  function toggleTaskCompleted(board, taskId, completed) {
    const normalized = normalizeBoard(board);
    const tasks = normalized.tasks.map((task) => {
      if (task.id !== taskId) return task;
      const nextCompleted = typeof completed === 'boolean' ? completed : !task.completed;
      return normalizeTask({
        ...task,
        completed: nextCompleted,
        completedAt: nextCompleted ? nowIso() : '',
      });
    });
    return touchBoard(normalized, tasks, normalized.selectedTaskId);
  }

  function deleteTask(board, taskId) {
    const normalized = normalizeBoard(board);
    const tasks = normalized.tasks.filter((task) => task.id !== taskId);
    const selectedTaskId = normalized.selectedTaskId === taskId ? '' : normalized.selectedTaskId;
    return touchBoard(normalized, tasks, selectedTaskId);
  }

  function updateTaskTitle(board, taskId, title) {
    const normalized = normalizeBoard(board);
    const cleanedTitle = typeof title === 'string' ? title.trim() : '';
    if (!cleanedTitle) return normalized;

    const tasks = normalized.tasks.map((task) => {
      if (task.id !== taskId) return task;
      return normalizeTask({
        ...task,
        title: cleanedTitle,
      });
    });

    return touchBoard(normalized, tasks, normalized.selectedTaskId);
  }

  function moveTaskToQuadrant(board, taskId, quadrant) {
    const normalized = normalizeBoard(board);
    if (!isValidQuadrant(quadrant)) return normalized;

    const task = normalized.tasks.find((item) => item.id === taskId);
    if (!task || task.quadrant === quadrant) return normalized;

    const tasks = normalized.tasks.map((item) => {
      if (item.id !== taskId) return item;
      return normalizeTask({
        ...item,
        quadrant,
      });
    });

    return touchBoard(normalized, tasks, normalized.selectedTaskId);
  }

  function addChecklistItem(board, taskId, text) {
    const normalized = normalizeBoard(board);
    const cleanedText = typeof text === 'string' ? text.trim() : '';
    if (!cleanedText) return normalized;

    const tasks = normalized.tasks.map((task) => {
      if (task.id !== taskId) return task;
      return normalizeTask({
        ...task,
        checklist: [
          ...task.checklist,
          {
            id: createId('step'),
            text: cleanedText,
            completed: false,
            createdAt: nowIso(),
          },
        ],
      });
    });

    return touchBoard(normalized, tasks, normalized.selectedTaskId);
  }

  function toggleChecklistItemCompleted(board, taskId, itemId, completed) {
    const normalized = normalizeBoard(board);
    const tasks = normalized.tasks.map((task) => {
      if (task.id !== taskId) return task;
      return normalizeTask({
        ...task,
        checklist: task.checklist.map((item) => {
          if (item.id !== itemId) return item;
          const nextCompleted = typeof completed === 'boolean' ? completed : !item.completed;
          return normalizeChecklistItem({
            ...item,
            completed: nextCompleted,
            completedAt: nextCompleted ? nowIso() : '',
          });
        }),
      });
    });

    return touchBoard(normalized, tasks, normalized.selectedTaskId);
  }

  function deleteChecklistItem(board, taskId, itemId) {
    const normalized = normalizeBoard(board);
    const tasks = normalized.tasks.map((task) => {
      if (task.id !== taskId) return task;
      return normalizeTask({
        ...task,
        checklist: task.checklist.filter((item) => item.id !== itemId),
      });
    });

    return touchBoard(normalized, tasks, normalized.selectedTaskId);
  }

  function updateChecklistItemText(board, taskId, itemId, text) {
    const normalized = normalizeBoard(board);
    const cleanedText = typeof text === 'string' ? text.trim() : '';
    if (!cleanedText) return normalized;

    const tasks = normalized.tasks.map((task) => {
      if (task.id !== taskId) return task;
      return normalizeTask({
        ...task,
        checklist: task.checklist.map((item) => {
          if (item.id !== itemId) return item;
          return normalizeChecklistItem({
            ...item,
            text: cleanedText,
          });
        }),
      });
    });

    return touchBoard(normalized, tasks, normalized.selectedTaskId);
  }

  function getChecklistSubtreeEndIndex(checklist, startIndex) {
    const rootItem = checklist[startIndex];
    if (!rootItem) return startIndex;

    let endIndex = startIndex + 1;
    while (endIndex < checklist.length && checklist[endIndex].level > rootItem.level) {
      endIndex += 1;
    }
    return endIndex;
  }

  function moveChecklistItem(board, taskId, itemId, targetItemId, options = {}) {
    const normalized = normalizeBoard(board);
    const { position = 'after', desiredLevel } = options;

    const tasks = normalized.tasks.map((task) => {
      if (task.id !== taskId) return task;

      const checklist = task.checklist;
      const sourceIndex = checklist.findIndex((item) => item.id === itemId);
      if (sourceIndex === -1) return task;

      const sourceEndIndex = getChecklistSubtreeEndIndex(checklist, sourceIndex);
      const movedBlock = checklist.slice(sourceIndex, sourceEndIndex);
      const movedIds = new Set(movedBlock.map((item) => item.id));
      const remaining = checklist.filter((item) => !movedIds.has(item.id));

      let insertionIndex = remaining.length;
      if (targetItemId) {
        const targetIndex = remaining.findIndex((item) => item.id === targetItemId);
        if (targetIndex === -1) return task;
        insertionIndex = position === 'before' ? targetIndex : targetIndex + 1;
      }

      const sourceLevel = movedBlock[0].level;
      const previousItem = insertionIndex > 0 ? remaining[insertionIndex - 1] : null;
      const maxAllowedLevel = previousItem ? previousItem.level + 1 : 0;
      const nextLevel = clampChecklistLevel(
        typeof desiredLevel === 'number' ? Math.min(desiredLevel, maxAllowedLevel) : Math.min(sourceLevel, maxAllowedLevel)
      );
      const levelDelta = nextLevel - sourceLevel;

      const adjustedBlock = movedBlock.map((item) => normalizeChecklistItem({
        ...item,
        level: item.level + levelDelta,
      }));

      return normalizeTask({
        ...task,
        checklist: [
          ...remaining.slice(0, insertionIndex),
          ...adjustedBlock,
          ...remaining.slice(insertionIndex),
        ],
      });
    });

    return touchBoard(normalized, tasks, normalized.selectedTaskId);
  }

  async function getBoards(storage) {
    const result = await storage.get(STORAGE_KEY);
    return result && typeof result === 'object' && result[STORAGE_KEY] && typeof result[STORAGE_KEY] === 'object'
      ? result[STORAGE_KEY]
      : {};
  }

  async function saveBoard(storage, board, existingBoards) {
    const normalized = normalizeBoard(board);
    const boards = existingBoards || await getBoards(storage);
    const nextBoards = {
      ...boards,
      [normalized.date]: normalized,
    };
    await storage.set({ [STORAGE_KEY]: nextBoards });
    return normalized;
  }

  async function getTodayBoard(storage, date = new Date()) {
    const boardDate = getBoardDate(date);
    const boards = await getBoards(storage);
    const existing = boards[boardDate];
    if (existing) return normalizeBoard(existing, boardDate);

    const empty = createEmptyBoard(boardDate);
    await saveBoard(storage, empty, boards);
    return empty;
  }

  async function updateTodayBoard(storage, updater, date = new Date()) {
    const current = await getTodayBoard(storage, date);
    const nextBoard = normalizeBoard(updater(current), current.date);
    await saveBoard(storage, nextBoard);
    return nextBoard;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderProgressLabel(task) {
    const progress = getTaskProgress(task);
    if (progress.total === 0) return '未拆解';
    return `${progress.completed}/${progress.total} 步`;
  }

  function formatPomodoroMs(ms) {
    const safeMs = Math.max(0, Number(ms) || 0);
    const totalSeconds = Math.ceil(safeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function renderQuadrantComposer(quadrant, isActive) {
    if (!isActive) {
      return '<div class="gtd-quadrant-gesture">双击空白处快速添加</div>';
    }

    return `
      <form class="gtd-inline-form" data-gtd-form="add-task" data-quadrant="${quadrant.key}">
        <input type="text" name="title" placeholder="直接输入任务，回车保存" autocomplete="off">
      </form>
    `;
  }

  function renderQuadrantCard(board, quadrant, options = {}) {
    const tasks = getQuadrantTasks(board, quadrant.key);
    const completedCount = tasks.filter((task) => task.completed).length;
    const isComposerActive = options.composerQuadrant === quadrant.key;

    return `
      <section
        class="gtd-quadrant gtd-quadrant-${quadrant.tone}"
        data-quadrant="${quadrant.key}"
        data-gtd-drop-zone="${quadrant.key}"
        data-gtd-action="prompt-add-task"
        title="双击空白处快速添加任务"
      >
        <div class="gtd-quadrant-header">
          <div>
            <div class="gtd-quadrant-title">${quadrant.title}</div>
            <div class="gtd-quadrant-hint">${quadrant.hint}</div>
          </div>
          <div class="gtd-quadrant-count">${completedCount}/${tasks.length || 0}</div>
        </div>
        <div class="gtd-task-list">
          ${tasks.length ? tasks.map((task) => renderTaskItem(board, task, options)).join('') : `
            <div class="gtd-quadrant-empty">${quadrant.empty}</div>
          `}
        </div>
        ${renderQuadrantComposer(quadrant, isComposerActive)}
      </section>
    `;
  }

  function renderTaskItem(board, task, options = {}) {
    const selected = board.selectedTaskId === task.id;
    const progress = renderProgressLabel(task);
    const isEditing = options.editingTaskId === task.id;

    const mainContent = isEditing ? `
      <form class="gtd-task-edit-form" data-gtd-form="edit-task" data-task-id="${task.id}">
        <input
          type="text"
          name="title"
          value="${escapeHtml(task.title)}"
          placeholder="直接修改任务，回车保存"
          autocomplete="off"
        >
        <span class="gtd-task-progress">${progress}</span>
      </form>
    ` : `
      <button
        class="gtd-task-main"
        type="button"
        data-gtd-action="select-task"
        data-task-id="${task.id}"
      >
        <span class="gtd-task-title">${escapeHtml(task.title)}</span>
        <span class="gtd-task-progress">${progress}</span>
      </button>
    `;

    return `
      <div
        class="gtd-task-item${selected ? ' is-selected' : ''}${task.completed ? ' is-completed' : ''}${isEditing ? ' is-editing' : ''}"
        data-task-id="${task.id}"
        data-task-quadrant="${task.quadrant}"
        data-gtd-action="drag-task"
        draggable="${isEditing ? 'false' : 'true'}"
      >
        <input
          class="gtd-task-checkbox"
          type="checkbox"
          aria-label="完成任务"
          data-gtd-action="toggle-task"
          data-task-id="${task.id}"
          ${task.completed ? 'checked' : ''}
        >
        ${mainContent}
        <button
          class="gtd-task-delete"
          type="button"
          aria-label="删除任务"
          data-gtd-action="delete-task"
          data-task-id="${task.id}"
        >
          ×
        </button>
      </div>
    `;
  }

  function renderPomodoroTrack(selectedTask, pomodoro = {}) {
    const totalMs = 25 * 60 * 1000;
    const sameTask = pomodoro.taskId && pomodoro.taskId === selectedTask.id;
    const isRunning = sameTask && pomodoro.status === 'running';
    const isPaused = sameTask && pomodoro.status === 'paused';
    const isCompleted = sameTask && pomodoro.status === 'completed';
    const remainingMs = sameTask ? Math.max(0, Number(pomodoro.remainingMs) || 0) : totalMs;
    const remainingPercent = isCompleted ? 0 : Math.max(0, Math.min(100, Math.round((remainingMs / totalMs) * 1000) / 10));
    const trackStateClass = isRunning ? ' is-running' : isPaused ? ' is-paused' : isCompleted ? ' is-completed' : ' is-idle';
    const ariaLabel = isRunning
      ? `当前番茄钟剩余 ${formatPomodoroMs(remainingMs)}，单击暂停，双击重置`
      : isPaused
        ? `当前番茄钟已暂停，剩余 ${formatPomodoroMs(remainingMs)}，单击继续，双击重置`
      : isCompleted
        ? '已完成一个 25 分钟番茄钟，双击可重置'
        : '25 分钟番茄钟未开始，单击启动，双击重置';

    return `
      <button
        class="gtd-pomodoro-track${trackStateClass}"
        type="button"
        data-gtd-action="toggle-pomodoro-track"
        data-task-id="${selectedTask.id}"
        data-task-title="${escapeHtml(selectedTask.title)}"
        aria-label="${ariaLabel}"
        title="${ariaLabel}"
      >
        <span class="gtd-pomodoro-track-fill" style="width: ${remainingPercent}%"></span>
        <span class="gtd-pomodoro-track-time">${formatPomodoroMs(remainingMs)}</span>
      </button>
    `;
  }

  function renderChecklistPanel(board, options = {}) {
    const selectedTask = getSelectedTask(board);

    if (!selectedTask) {
      return `
        <div class="gtd-detail-card gtd-empty-card">
          <div class="gtd-detail-eyebrow">步骤清单</div>
          <h3>点选左侧任务</h3>
          <p>当你从四象限里选中一个任务后，这里会显示它的执行步骤。先拆出第一步，行动会更轻松。</p>
        </div>
      `;
    }

    const quadrant = QUADRANT_MAP[selectedTask.quadrant];
    const progress = getTaskProgress(selectedTask);
    const pomodoro = options.pomodoro || {};

    return `
      <div class="gtd-detail-card">
        <div class="gtd-detail-title-block">
          <div class="gtd-detail-title-row">
            <h3>${escapeHtml(selectedTask.title)}</h3>
          </div>
          ${renderPomodoroTrack(selectedTask, pomodoro)}
        </div>
        <div class="gtd-detail-meta">
          <span class="gtd-detail-badge">${quadrant.title}</span>
          <span class="gtd-detail-progress">${progress.completed}/${progress.total} 步已完成</span>
        </div>
        <form class="gtd-add-form gtd-step-form" data-gtd-form="add-step" data-task-id="${selectedTask.id}">
          <input type="text" name="text" placeholder="添加一个执行步骤..." autocomplete="off">
          <button type="submit">添加</button>
        </form>
        <div class="gtd-step-list">
          ${selectedTask.checklist.length ? selectedTask.checklist.map((item) => {
            const isEditingStep = options.editingStepId === item.id;
            const stepBody = isEditingStep ? `
              <form class="gtd-step-edit-form" data-gtd-form="edit-step" data-task-id="${selectedTask.id}" data-step-id="${item.id}">
                <input
                  type="text"
                  name="text"
                  value="${escapeHtml(item.text)}"
                  placeholder="直接修改步骤，回车保存"
                  autocomplete="off"
                >
              </form>
            ` : `
              <div class="gtd-step-text">${escapeHtml(item.text)}</div>
            `;

            return `
            <div
              class="gtd-step-item${item.completed ? ' is-completed' : ''}${isEditingStep ? ' is-editing' : ''}"
              data-step-id="${item.id}"
              data-step-level="${item.level}"
              data-task-id="${selectedTask.id}"
              data-gtd-action="drag-step"
              draggable="${isEditingStep ? 'false' : 'true'}"
              style="--gtd-step-level:${item.level}"
            >
              <input
                class="gtd-step-checkbox"
                type="checkbox"
                aria-label="完成步骤"
                data-gtd-action="toggle-step"
                data-task-id="${selectedTask.id}"
                data-step-id="${item.id}"
                ${item.completed ? 'checked' : ''}
              >
              ${stepBody}
              <button
                class="gtd-step-delete"
                type="button"
                aria-label="删除步骤"
                data-gtd-action="delete-step"
                data-task-id="${selectedTask.id}"
                data-step-id="${item.id}"
              >
                ×
              </button>
            </div>
          `;
          }).join('') : `
            <div class="gtd-step-empty">还没有拆解步骤。先加第一步，让任务开始滚动起来。</div>
          `}
        </div>
      </div>
    `;
  }

  function exportBoardToMarkdown(board) {
    const normalized = normalizeBoard(board);
    const completedTasks = normalized.tasks.filter((task) => task.completed).length;
    const lines = [
      '# 今日 GTD 日报',
      '',
      `日期：${normalized.date}`,
      `完成概览：${completedTasks}/${normalized.tasks.length} 任务完成`,
      '',
    ];

    for (const quadrant of QUADRANTS) {
      const tasks = getQuadrantTasks(normalized, quadrant.key);
      lines.push(`## ${quadrant.title}`);
      lines.push('');

      if (!tasks.length) {
        lines.push('- 暂无任务');
        lines.push('');
        continue;
      }

      for (const task of tasks) {
        lines.push(`- [${task.completed ? 'x' : ' '}] ${task.title}`);

        if (task.checklist.length) {
          for (const item of task.checklist) {
            lines.push(`${'  '.repeat(item.level + 1)}- [${item.completed ? 'x' : ' '}] ${item.text}`);
          }
        }
      }

      lines.push('');
    }

    return `${lines.join('\n').trim()}\n`;
  }

  function importBoardFromMarkdown(markdown, options = {}) {
    const text = typeof markdown === 'string' ? markdown.replace(/\r\n?/g, '\n').trim() : '';
    if (!text) {
      throw new Error('导入失败：文件内容为空');
    }

    const targetDate = typeof options.date === 'string' && options.date ? options.date : getBoardDate();
    const tasks = [];
    let currentQuadrant = '';
    let currentTask = null;
    let sawQuadrant = false;

    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;

      const quadrantMatch = line.match(/^##\s+(.+)$/);
      if (quadrantMatch) {
        currentQuadrant = QUADRANT_TITLE_MAP[quadrantMatch[1].trim()] || '';
        currentTask = null;
        sawQuadrant = sawQuadrant || Boolean(currentQuadrant);
        continue;
      }

      if (line === '- 暂无任务' || line.startsWith('# ') || line.startsWith('日期：') || line.startsWith('完成概览：')) {
        continue;
      }

      if (!currentQuadrant) continue;

      const itemMatch = rawLine.match(/^(\s*)- \[([ xX])\] (.+)$/);
      if (!itemMatch) continue;

      const indent = itemMatch[1].length;
      const completed = itemMatch[2].toLowerCase() === 'x';
      const content = itemMatch[3].trim();
      if (!content) continue;

      if (indent === 0) {
        currentTask = {
          title: content,
          quadrant: currentQuadrant,
          completed,
          checklist: [],
        };
        tasks.push(currentTask);
        continue;
      }

      if (!currentTask) continue;
      currentTask.checklist.push({
        text: content,
        completed,
        level: clampChecklistLevel(Math.max(0, Math.floor(indent / 2) - 1)),
      });
    }

    if (!sawQuadrant || !tasks.length) {
      throw new Error('导入失败：不是可识别的 GTD 日报');
    }

    const normalized = normalizeBoard({
      date: targetDate,
      tasks,
      selectedTaskId: '',
      updatedAt: nowIso(),
    }, targetDate);

    return normalizeBoard({
      ...normalized,
      selectedTaskId: normalized.tasks[0]?.id || '',
    }, targetDate);
  }

  function renderWorkspace(board, options = {}) {
    const normalized = normalizeBoard(board);
    const totalTasks = normalized.tasks.length;
    const completedTasks = normalized.tasks.filter((task) => task.completed).length;
    const collapsed = Boolean(options.collapsed);

    return `
      <div class="gtd-shell">
        <div
          class="section-header gtd-section-header is-collapsible${collapsed ? ' is-collapsed' : ''}"
          data-gtd-action="toggle-gtd-section"
          role="button"
          tabindex="0"
          aria-expanded="${collapsed ? 'false' : 'true'}"
        >
          <h2>今日 GTD</h2>
          <div class="section-line"></div>
          <div class="gtd-header-actions">
            <div class="section-count">${completedTasks}/${totalTasks} 已完成</div>
            <div class="gtd-header-buttons">
              <input
                class="gtd-file-input"
                type="file"
                accept=".md,.markdown,text/markdown,text/plain"
                data-gtd-action="import-gtd-file"
                hidden
              >
              <button class="gtd-header-btn" type="button" data-gtd-action="import-gtd-report">导入日报</button>
              <button class="gtd-header-btn" type="button" data-gtd-action="export-gtd-report">导出日报</button>
            </div>
          </div>
        </div>
        ${collapsed ? '' : `
        <div class="gtd-main-row">
          <section class="gtd-board-panel">
            <div class="gtd-quad-grid">
              ${QUADRANTS.map((quadrant) => renderQuadrantCard(normalized, quadrant, options)).join('')}
            </div>
          </section>
          <section class="gtd-detail-panel">
            ${renderChecklistPanel(normalized, options)}
          </section>
        </div>
        `}
      </div>
    `;
  }

  function renderWorkspaceShell(board, options = {}) {
    const activeTab = options.activeTab === 'whiteboard' || options.activeTab === 'notes' || options.activeTab === 'structure'
      ? options.activeTab
      : 'gtd';
    const whiteboardUrl = typeof options.whiteboardUrl === 'string' && options.whiteboardUrl
      ? options.whiteboardUrl
      : 'whiteboard/index.html';
    const notesUrl = typeof options.notesUrl === 'string' && options.notesUrl
      ? options.notesUrl
      : 'notes/index.html';
    const structureboardUrl = typeof options.structureboardUrl === 'string' && options.structureboardUrl
      ? options.structureboardUrl
      : 'structureboard/index.html';

    return `
      <div class="workspace-shell" data-workspace-active-tab="${activeTab}">
        <div class="workspace-tabbar" role="tablist" aria-label="工作台视图">
          <button
            class="workspace-tab${activeTab === 'gtd' ? ' is-active' : ''}"
            type="button"
            role="tab"
            aria-selected="${activeTab === 'gtd' ? 'true' : 'false'}"
            data-gtd-action="switch-workspace-tab"
            data-workspace-tab="gtd"
          >GTD</button>
          <button
            class="workspace-tab${activeTab === 'whiteboard' ? ' is-active' : ''}"
            type="button"
            role="tab"
            aria-selected="${activeTab === 'whiteboard' ? 'true' : 'false'}"
            data-gtd-action="switch-workspace-tab"
            data-workspace-tab="whiteboard"
          >白板</button>
          <button
            class="workspace-tab${activeTab === 'notes' ? ' is-active' : ''}"
            type="button"
            role="tab"
            aria-selected="${activeTab === 'notes' ? 'true' : 'false'}"
            data-gtd-action="switch-workspace-tab"
            data-workspace-tab="notes"
          >笔记</button>
          <button
            class="workspace-tab${activeTab === 'structure' ? ' is-active' : ''}"
            type="button"
            role="tab"
            aria-selected="${activeTab === 'structure' ? 'true' : 'false'}"
            data-gtd-action="switch-workspace-tab"
            data-workspace-tab="structure"
          >结构图</button>
        </div>
        <div class="workspace-panels">
          <section class="workspace-panel workspace-panel-gtd${activeTab === 'gtd' ? ' is-active' : ''}" role="tabpanel">
            ${renderWorkspace(board, options)}
          </section>
          <section class="workspace-panel workspace-panel-whiteboard${activeTab === 'whiteboard' ? ' is-active' : ''}" role="tabpanel">
            <div class="whiteboard-panel-shell">
              <iframe
                class="whiteboard-embed-frame"
                src="${escapeHtml(whiteboardUrl)}"
                title="Excalidraw 白板"
                loading="lazy"
              ></iframe>
            </div>
          </section>
          <section class="workspace-panel workspace-panel-notes${activeTab === 'notes' ? ' is-active' : ''}" role="tabpanel">
            <div class="notes-panel-shell">
              <iframe
                class="notes-embed-frame"
                src="${escapeHtml(notesUrl)}"
                title="Tiptap 笔记"
                loading="lazy"
              ></iframe>
            </div>
          </section>
          <section class="workspace-panel workspace-panel-structure${activeTab === 'structure' ? ' is-active' : ''}" role="tabpanel">
            <div class="structureboard-panel-shell">
              <iframe
                class="structureboard-embed-frame"
                src="${escapeHtml(structureboardUrl)}"
                title="draw.io 结构图"
                loading="lazy"
              ></iframe>
            </div>
          </section>
        </div>
      </div>
    `;
  }

  return {
    STORAGE_KEY,
    QUADRANTS,
    QUADRANT_MAP,
    getBoardDate,
    createEmptyBoard,
    normalizeBoard,
    addTask,
    selectTask,
    toggleTaskCompleted,
    deleteTask,
    updateTaskTitle,
    moveTaskToQuadrant,
    addChecklistItem,
    updateChecklistItemText,
    moveChecklistItem,
    toggleChecklistItemCompleted,
    deleteChecklistItem,
    getSelectedTask,
    getTaskProgress,
    getQuadrantTasks,
    getTodayBoard,
    saveBoard,
    updateTodayBoard,
    exportBoardToMarkdown,
    importBoardFromMarkdown,
    renderWorkspace,
    renderWorkspaceShell,
  };
});
