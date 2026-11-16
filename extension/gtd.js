(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TabOutGTD = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'gtdBoards';
  const CHECKLIST_MAX_LEVEL = 6;
  const SAVED_CHECKLISTS_KEY = 'tab-out-saved-checklists-v1';
  const QUADRANT_CONFIG_KEY = 'tab-out-gtd-quadrants-v1';
  const QUICK_LINKS_KEY = 'tab-out-quick-links-v1';
  const DEFAULT_QUICK_LINKS_PARTITION_ID = 'default';
  const DEFAULT_QUICK_LINKS_PARTITION_NAME = '常用';

  const DEFAULT_QUADRANT_TITLES = {
    importantUrgent: '重要且紧急',
    importantNotUrgent: '重要不紧急',
    urgentNotImportant: '紧急不重要',
    notImportantNotUrgent: '不重要不紧急',
  };

  const DEFAULT_QUADRANT_ORDER = [
    'importantUrgent',
    'importantNotUrgent',
    'urgentNotImportant',
    'notImportantNotUrgent',
  ];

  const KANBAN_LANES = [
    { key: 'todo', title: '待完成', tone: 'muted', empty: '暂无待完成事项' },
    { key: 'planned', title: '今日计划', tone: 'alert', empty: '把今天打算推进的事项拖拽至此' },
    { key: 'doing', title: '开始工作', tone: 'steady', empty: '当前正在进行中的事项' },
    { key: 'done', title: '已完成', tone: 'critical', empty: '今天已完成的事项' },
  ];

  const KANBAN_LANE_MAP = Object.fromEntries(KANBAN_LANES.map((item) => [item.key, item]));
  const VALID_KANBAN_STATUSES = new Set(['todo', 'planned', 'doing', 'done']);

  function normalizeKanbanStatus(status, completed = false) {
    if (completed) return 'done';
    if (typeof status === 'string' && VALID_KANBAN_STATUSES.has(status)) return status;
    return 'todo';
  }

  function normalizeQuadrantOrder(order) {
    if (!Array.isArray(order)) return [...DEFAULT_QUADRANT_ORDER];
    const valid = new Set(DEFAULT_QUADRANT_ORDER);
    const result = [];
    for (const key of order) {
      if (valid.has(key) && !result.includes(key)) {
        result.push(key);
      }
    }
    for (const key of DEFAULT_QUADRANT_ORDER) {
      if (!result.includes(key)) {
        result.push(key);
      }
    }
    return result;
  }

  function swapQuadrantOrder(order, sourceKey, targetKey) {
    const list = normalizeQuadrantOrder(order);
    const srcIdx = list.indexOf(sourceKey);
    const dstIdx = list.indexOf(targetKey);
    if (srcIdx === -1 || dstIdx === -1 || srcIdx === dstIdx) {
      return list;
    }
    const next = [...list];
    next[srcIdx] = targetKey;
    next[dstIdx] = sourceKey;
    return next;
  }

  const QUADRANTS = [
    {
      key: 'importantUrgent',
      title: '重要且紧急',
      empty: '先把今天最不能拖的事情放进来',
      tone: 'critical',
    },
    {
      key: 'importantNotUrgent',
      title: '重要不紧急',
      empty: '把值得提前推进的任务安排进来',
      tone: 'steady',
    },
    {
      key: 'urgentNotImportant',
      title: '紧急不重要',
      empty: '只放那些必须回应的外部事项',
      tone: 'alert',
    },
    {
      key: 'notImportantNotUrgent',
      title: '不重要不紧急',
      empty: '如果这里很多，说明今天的焦点跑偏了',
      tone: 'muted',
    },
  ];

  const QUADRANT_MAP = Object.fromEntries(QUADRANTS.map((item) => [item.key, item]));
  const QUADRANT_TITLE_MAP = Object.fromEntries(QUADRANTS.map((item) => [item.title, item.key]));

  function normalizeQuadrantConfig(config) {
    const raw = config && typeof config === 'object' ? config : {};
    const res = {
      importantUrgent: typeof raw.importantUrgent === 'string' && raw.importantUrgent.trim() ? raw.importantUrgent.trim() : DEFAULT_QUADRANT_TITLES.importantUrgent,
      importantNotUrgent: typeof raw.importantNotUrgent === 'string' && raw.importantNotUrgent.trim() ? raw.importantNotUrgent.trim() : DEFAULT_QUADRANT_TITLES.importantNotUrgent,
      urgentNotImportant: typeof raw.urgentNotImportant === 'string' && raw.urgentNotImportant.trim() ? raw.urgentNotImportant.trim() : DEFAULT_QUADRANT_TITLES.urgentNotImportant,
      notImportantNotUrgent: typeof raw.notImportantNotUrgent === 'string' && raw.notImportantNotUrgent.trim() ? raw.notImportantNotUrgent.trim() : DEFAULT_QUADRANT_TITLES.notImportantNotUrgent,
    };
    if (raw.order) {
      res.order = normalizeQuadrantOrder(raw.order);
    }
    return res;
  }

  async function getQuadrantConfig(storage) {
    if (!storage || typeof storage.get !== 'function') return { ...DEFAULT_QUADRANT_TITLES };
    const result = await storage.get(QUADRANT_CONFIG_KEY);
    return normalizeQuadrantConfig(result && result[QUADRANT_CONFIG_KEY]);
  }

  async function saveQuadrantConfig(storage, config) {
    const normalized = normalizeQuadrantConfig(config);
    if (storage && typeof storage.set === 'function') {
      await storage.set({ [QUADRANT_CONFIG_KEY]: normalized });
    }
    return normalized;
  }

  function getQuadrants(quadrantConfig) {
    const config = normalizeQuadrantConfig(quadrantConfig);
    const order = config.order ? normalizeQuadrantOrder(config.order) : DEFAULT_QUADRANT_ORDER;
    return order.map((key) => {
      const q = QUADRANT_MAP[key] || QUADRANTS[0];
      return {
        ...q,
        title: config[q.key] || q.title,
      };
    });
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function getBoardDate(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function getIsoWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  function getBoardScope(date = new Date()) {
    const weekNum = getIsoWeekNumber(date);
    const weekStr = `W${String(weekNum).padStart(2, '0')}`;
    return {
      day: { key: getBoardDate(date), label: '今日 GTD' },
      week: { key: `week-${date.getFullYear()}-${weekStr}`, label: `第 ${weekStr} 周` },
      month: { key: `month-${date.getFullYear()}-${pad(date.getMonth() + 1)}`, label: `${date.getMonth() + 1} 月 GTD` },
    };
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

  function getCompletedTimeValue(item) {
    if (!item) return 0;
    const raw = item.completedAt || item.createdAt || '';
    if (!raw) return 0;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : 0;
  }

  function sortCompletedDesc(items) {
    if (!Array.isArray(items) || items.length <= 1) return Array.isArray(items) ? [...items] : [];
    return items
      .map((item, originalIndex) => ({ item, originalIndex }))
      .sort((a, b) => {
        const timeDiff = getCompletedTimeValue(b.item) - getCompletedTimeValue(a.item);
        if (timeDiff !== 0) return timeDiff;
        const rawA = a.item?.completedAt || a.item?.createdAt || '';
        const rawB = b.item?.completedAt || b.item?.createdAt || '';
        const strCmp = rawB.localeCompare(rawA);
        if (strCmp !== 0) return strCmp;
        return b.originalIndex - a.originalIndex;
      })
      .map((wrapper) => wrapper.item);
  }

  function normalizeChecklistItem(item) {
    const completed = Boolean(item?.completed);
    const status = normalizeKanbanStatus(item?.status, completed);
    return {
      id: typeof item?.id === 'string' && item.id ? item.id : createId('step'),
      text: typeof item?.text === 'string' ? item.text.trim() : '',
      level: clampChecklistLevel(item?.level),
      completed: status === 'done' || completed,
      status,
      emoji: typeof item?.emoji === 'string' ? item.emoji.trim() : '',
      createdAt: item?.createdAt || nowIso(),
      completedAt: (status === 'done' || completed) ? (item?.completedAt || item?.createdAt || nowIso()) : '',
    };
  }

  function normalizeTask(task) {
    const checklist = Array.isArray(task?.checklist)
      ? task.checklist.map(normalizeChecklistItem).filter((item) => item.text)
      : [];
    const completed = Boolean(task?.completed);
    const status = normalizeKanbanStatus(task?.status, completed);

    return {
      id: typeof task?.id === 'string' && task.id ? task.id : createId('task'),
      title: typeof task?.title === 'string' ? task.title.trim() : '',
      quadrant: isValidQuadrant(task?.quadrant) ? task.quadrant : 'importantUrgent',
      completed: status === 'done' || completed,
      status,
      emoji: typeof task?.emoji === 'string' ? task.emoji.trim() : '',
      archived: Boolean(task?.archived),
      createdAt: task?.createdAt || nowIso(),
      completedAt: (status === 'done' || completed) ? (task?.completedAt || task?.createdAt || nowIso()) : '',
      archivedAt: task?.archived ? (task?.archivedAt || nowIso()) : '',
      checklist,
    };
  }

  function normalizeBoard(board, fallbackDate = getBoardDate()) {
    const tasks = Array.isArray(board?.tasks)
      ? board.tasks.map(normalizeTask).filter((task) => task.title)
      : [];
    const visibleTasks = tasks.filter((task) => !task.archived);
    const selectedTaskId = typeof board?.selectedTaskId === 'string' ? board.selectedTaskId : '';
    const selectedExists = selectedTaskId && visibleTasks.some((task) => task.id === selectedTaskId);

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
    return normalizeBoard(board).tasks.filter((task) => !task.archived && task.quadrant === quadrant);
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
    return normalized.tasks.find((task) => !task.archived && task.id === normalized.selectedTaskId) || null;
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
      archived: false,
      createdAt: nowIso(),
      checklist: [],
    });

    return touchBoard(normalized, [...normalized.tasks, task], task.id);
  }

  function selectTask(board, taskId) {
    const normalized = normalizeBoard(board);
    const exists = normalized.tasks.some((task) => !task.archived && task.id === taskId);
    return touchBoard(normalized, normalized.tasks, exists ? taskId : '');
  }

  function toggleTaskCompleted(board, taskId, completed) {
    const normalized = normalizeBoard(board);
    const tasks = normalized.tasks.map((task) => {
      if (task.id !== taskId) return task;
      const nextCompleted = typeof completed === 'boolean' ? completed : !task.completed;
      const justCompleted = nextCompleted && !task.completed;
      return normalizeTask({
        ...task,
        completed: nextCompleted,
        status: nextCompleted ? 'done' : (task.status === 'done' ? 'todo' : task.status),
        completedAt: nextCompleted ? (justCompleted ? nowIso() : (task.completedAt || nowIso())) : '',
      });
    });
    return touchBoard(normalized, tasks, normalized.selectedTaskId);
  }

  function archiveTask(board, taskId, archived = true) {
    const normalized = normalizeBoard(board);
    const isArchived = Boolean(archived);
    const tasks = normalized.tasks.map((task) => {
      if (task.id !== taskId) return task;
      return normalizeTask({
        ...task,
        archived: isArchived,
        archivedAt: isArchived ? (task.archivedAt || nowIso()) : '',
      });
    });
    const selectedTaskId = normalized.selectedTaskId === taskId && isArchived ? '' : normalized.selectedTaskId;
    return touchBoard(normalized, tasks, selectedTaskId);
  }

  function restoreTask(board, taskId) {
    return archiveTask(board, taskId, false);
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

  // 将多行文本按折行拆分为步骤文本，忽略空行并去掉首尾空白
  function splitBatchStepLines(raw) {
    if (typeof raw !== 'string') return [];
    return raw
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line);
  }

  // 按文本数组为任务批量追加 checklist 步骤
  function addChecklistItems(board, taskId, texts) {
    const cleanedTexts = Array.isArray(texts)
      ? texts.map((text) => (typeof text === 'string' ? text.trim() : '')).filter((text) => text)
      : [];
    if (!cleanedTexts.length) return normalizeBoard(board);

    const normalized = normalizeBoard(board);
    const tasks = normalized.tasks.map((task) => {
      if (task.id !== taskId) return task;
      return normalizeTask({
        ...task,
        checklist: [
          ...task.checklist,
          ...cleanedTexts.map((text) => ({
            id: createId('step'),
            text,
            completed: false,
            createdAt: nowIso(),
          })),
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
          const justCompleted = nextCompleted && !item.completed;
          return normalizeChecklistItem({
            ...item,
            completed: nextCompleted,
            status: nextCompleted ? 'done' : (item.status === 'done' ? 'todo' : item.status),
            completedAt: nextCompleted ? (justCompleted ? nowIso() : (item.completedAt || nowIso())) : '',
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

  function updateTaskKanbanStatus(board, taskId, nextStatus) {
    const normalized = normalizeBoard(board);
    const status = normalizeKanbanStatus(nextStatus, nextStatus === 'done');
    const isDone = status === 'done';

    const tasks = normalized.tasks.map((task) => {
      if (task.id !== taskId) return task;
      const taskJustCompleted = isDone && !task.completed;
      const taskWasDone = task.status === 'done' || task.completed;

      // 整体移动任务时：把整个任务包括下面的步骤都拖拽过去
      const nextChecklist = Array.isArray(task.checklist) ? task.checklist.map((item) => {
        // 1. 拖到「已完成」泳道：整个任务包括其所有子步骤全部标记为完成，归入已完成泳道
        if (isDone) {
          const itemJustCompleted = !item.completed;
          return normalizeChecklistItem({
            ...item,
            status: 'done',
            completed: true,
            completedAt: item.completed && item.completedAt ? item.completedAt : nowIso(),
          });
        }

        // 2. 从「已完成」泳道拖回活跃泳道 (todo / planned / doing)：重新激活任务及步骤
        if (taskWasDone) {
          return normalizeChecklistItem({
            ...item,
            status,
            completed: false,
            completedAt: '',
          });
        }

        // 3. 在活跃泳道之间移动 (todo <-> planned <-> doing)：
        // - 之前已经完成的步骤（已在已完成泳道）：保持已完成状态与时间戳，不改动已完成 checklist 的状态
        if (item.completed || item.status === 'done') {
          return item;
        }

        // - 未完成的步骤：跟随任务整体移动到目标泳道！
        return normalizeChecklistItem({
          ...item,
          status,
          completed: false,
          completedAt: '',
        });
      }) : [];

      return normalizeTask({
        ...task,
        status,
        completed: isDone,
        completedAt: isDone ? (taskJustCompleted ? nowIso() : (task.completedAt || nowIso())) : '',
        checklist: nextChecklist,
      });
    });

    return touchBoard(normalized, tasks, normalized.selectedTaskId);
  }

  function updateChecklistItemKanbanStatus(board, taskId, itemId, nextStatus) {
    const normalized = normalizeBoard(board);
    const status = normalizeKanbanStatus(nextStatus, nextStatus === 'done');
    const isDone = status === 'done';

    const tasks = normalized.tasks.map((task) => {
      if (task.id !== taskId) return task;
      return normalizeTask({
        ...task,
        checklist: task.checklist.map((item) => {
          if (item.id !== itemId) return item;
          const justCompleted = isDone && !item.completed;
          return normalizeChecklistItem({
            ...item,
            status,
            completed: isDone,
            completedAt: isDone ? (justCompleted ? nowIso() : (item.completedAt || nowIso())) : '',
          });
        }),
      });
    });

    return touchBoard(normalized, tasks, normalized.selectedTaskId);
  }

  function updateTaskEmoji(board, taskId, emoji) {
    const normalized = normalizeBoard(board);
    const cleanEmoji = typeof emoji === 'string' ? emoji.trim() : '';
    const tasks = normalized.tasks.map((task) => {
      if (task.id !== taskId) return task;
      return normalizeTask({
        ...task,
        emoji: cleanEmoji,
      });
    });
    return touchBoard(normalized, tasks, normalized.selectedTaskId);
  }

  function updateChecklistItemEmoji(board, taskId, itemId, emoji) {
    const normalized = normalizeBoard(board);
    const cleanEmoji = typeof emoji === 'string' ? emoji.trim() : '';
    const tasks = normalized.tasks.map((task) => {
      if (task.id !== taskId) return task;
      return normalizeTask({
        ...task,
        checklist: task.checklist.map((item) => {
          if (item.id !== itemId) return item;
          return normalizeChecklistItem({
            ...item,
            emoji: cleanEmoji,
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

  function computeStepTreeVisibility(steps, expandedStepIds = {}, options = {}) {
    if (!Array.isArray(steps) || steps.length === 0) return [];
    const editingStepId = options.editingStepId;
    const count = steps.length;
    const meta = new Array(count);

    for (let i = 0; i < count; i += 1) {
      const current = steps[i];
      let childCount = 0;
      let j = i + 1;
      while (j < count && steps[j].level > current.level) {
        childCount += 1;
        j += 1;
      }
      meta[i] = {
        hasChildren: childCount > 0,
        childCount,
        isExpanded: Boolean(expandedStepIds?.[current.id]),
        isVisible: true,
      };
    }

    if (editingStepId) {
      const editIdx = steps.findIndex((s) => s.id === editingStepId);
      if (editIdx !== -1) {
        let curLevel = steps[editIdx].level;
        for (let k = editIdx - 1; k >= 0; k -= 1) {
          if (steps[k].level < curLevel) {
            meta[k].isExpanded = true;
            curLevel = steps[k].level;
          }
        }
      }
    }

    const stack = [];
    for (let i = 0; i < count; i += 1) {
      const current = steps[i];
      while (stack.length > 0 && stack[stack.length - 1].level >= current.level) {
        stack.pop();
      }
      const isHiddenByAncestor = stack.some((anc) => !anc.isExpanded);
      meta[i].isVisible = !isHiddenByAncestor;

      if (meta[i].hasChildren) {
        stack.push({
          level: current.level,
          isExpanded: meta[i].isExpanded,
        });
      }
    }

    return meta;
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
    return getScopeBoard(storage, boardDate);
  }

  async function updateTodayBoard(storage, updater, date = new Date()) {
    const current = await getTodayBoard(storage, date);
    const nextBoard = normalizeBoard(updater(current), current.date);
    await saveBoard(storage, nextBoard);
    return nextBoard;
  }

  async function getScopeBoard(storage, boardKey) {
    const boards = await getBoards(storage);
    const existing = boards[boardKey];
    if (existing) return normalizeBoard(existing, boardKey);

    let scopeType = '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(boardKey)) {
      scopeType = 'day';
    } else if (/^week-/.test(boardKey)) {
      scopeType = 'week';
    } else if (/^month-/.test(boardKey)) {
      scopeType = 'month';
    }

    if (scopeType) {
      const keys = Object.keys(boards).filter((k) => {
        if (scopeType === 'day') return /^\d{4}-\d{2}-\d{2}$/.test(k);
        if (scopeType === 'week') return /^week-/.test(k);
        if (scopeType === 'month') return /^month-/.test(k);
        return false;
      }).sort().reverse();

      for (const k of keys) {
        const boardTasks = boards[k]?.tasks || [];
        const activeTasks = boardTasks.filter((t) => !t.archived);
        if (activeTasks.length) {
          const result = normalizeBoard({
            ...boards[k],
            tasks: activeTasks,
          }, boardKey);
          result.date = boardKey;
          result.updatedAt = nowIso();
          await saveBoard(storage, result, boards);
          return result;
        }
      }
    }

    const empty = createEmptyBoard(boardKey);
    await saveBoard(storage, empty, boards);
    return empty;
  }

  async function saveScopeBoard(storage, board) {
    const normalized = normalizeBoard(board);
    await saveBoard(storage, normalized);
    return normalized;
  }

  async function updateScopeBoard(storage, boardKey, updater) {
    const current = await getScopeBoard(storage, boardKey);
    const nextBoard = normalizeBoard(updater(current), current.date);
    await saveBoard(storage, nextBoard);
    return nextBoard;
  }

  async function getSavedChecklists(storage) {
    const result = await storage.get(SAVED_CHECKLISTS_KEY);
    const raw = result && typeof result === 'object' && result[SAVED_CHECKLISTS_KEY];
    if (!Array.isArray(raw)) return [];
    return raw.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async function saveSavedChecklist(storage, name, items, taskTitle) {
    const all = await getSavedChecklists(storage);
    const entry = {
      id: createId('scl'),
      name,
      items: items.map((item) => ({ text: item.text, level: item.level })),
      taskTitle: taskTitle || '',
      createdAt: nowIso(),
    };
    all.unshift(entry);
    await storage.set({ [SAVED_CHECKLISTS_KEY]: all });
    return entry;
  }

  async function deleteSavedChecklist(storage, id) {
    const all = await getSavedChecklists(storage);
    await storage.set({ [SAVED_CHECKLISTS_KEY]: all.filter((item) => item.id !== id) });
  }

  function normalizeQuickLinksState(raw) {
    if (!raw || typeof raw !== 'object') {
      return {
        partitions: [
          { id: DEFAULT_QUICK_LINKS_PARTITION_ID, name: DEFAULT_QUICK_LINKS_PARTITION_NAME, links: [] },
        ],
      };
    }

    let partitions = Array.isArray(raw.partitions) ? raw.partitions : [];
    if (partitions.length === 0) {
      partitions = [
        { id: DEFAULT_QUICK_LINKS_PARTITION_ID, name: DEFAULT_QUICK_LINKS_PARTITION_NAME, links: [] },
      ];
    }

    const normalizedPartitions = [];
    const seenPartitionIds = new Set();

    for (const part of partitions) {
      if (!part || typeof part !== 'object') continue;
      let id = typeof part.id === 'string' && part.id.trim() ? part.id.trim() : createId('part');
      if (seenPartitionIds.has(id)) {
        id = `${id}_${Math.random().toString(36).slice(2, 6)}`;
      }
      seenPartitionIds.add(id);

      const name = typeof part.name === 'string' && part.name.trim() ? part.name.trim() : '分区';
      const rawLinks = Array.isArray(part.links) ? part.links : [];
      const normalizedLinks = [];
      const seenLinkIds = new Set();

      for (const link of rawLinks) {
        if (!link || typeof link !== 'object') continue;
        const url = typeof link.url === 'string' ? link.url.trim() : '';
        if (!url) continue;

        let linkId = typeof link.id === 'string' && link.id.trim() ? link.id.trim() : createId('ql');
        if (seenLinkIds.has(linkId)) {
          linkId = `${linkId}_${Math.random().toString(36).slice(2, 6)}`;
        }
        seenLinkIds.add(linkId);

        let title = typeof link.title === 'string' && link.title.trim() ? link.title.trim() : '';
        if (!title) {
          try {
            title = new URL(url).hostname.replace(/^www\./, '');
          } catch {
            title = url;
          }
        }

        normalizedLinks.push({
          id: linkId,
          title,
          url,
        });
      }

      normalizedPartitions.push({
        id,
        name,
        links: normalizedLinks,
      });
    }

    if (normalizedPartitions.length === 0) {
      normalizedPartitions.push({
        id: DEFAULT_QUICK_LINKS_PARTITION_ID,
        name: DEFAULT_QUICK_LINKS_PARTITION_NAME,
        links: [],
      });
    }

    return { partitions: normalizedPartitions };
  }

  async function getQuickLinks(storage) {
    if (!storage || typeof storage.get !== 'function') {
      return normalizeQuickLinksState(null);
    }
    const result = await storage.get(QUICK_LINKS_KEY);
    return normalizeQuickLinksState(result && typeof result === 'object' ? result[QUICK_LINKS_KEY] : null);
  }

  async function saveQuickLinks(storage, state) {
    const normalized = normalizeQuickLinksState(state);
    if (storage && typeof storage.set === 'function') {
      await storage.set({ [QUICK_LINKS_KEY]: normalized });
    }
    return normalized;
  }

  function addQuickLink(state, partitionId, linkData) {
    const next = normalizeQuickLinksState(state);
    if (!linkData || typeof linkData !== 'object' || !linkData.url) return next;

    let targetPart = next.partitions.find((p) => p.id === partitionId);
    if (!targetPart) {
      targetPart = next.partitions[0];
    }

    const url = String(linkData.url).trim();
    if (!url) return next;

    let title = typeof linkData.title === 'string' && linkData.title.trim() ? linkData.title.trim() : '';
    if (!title) {
      try {
        title = new URL(url).hostname.replace(/^www\./, '');
      } catch {
        title = url;
      }
    }

    const newLink = {
      id: typeof linkData.id === 'string' && linkData.id.trim() ? linkData.id.trim() : createId('ql'),
      title,
      url,
    };

    const existingIndex = targetPart.links.findIndex((l) => l.url === url);
    if (existingIndex >= 0) {
      targetPart.links[existingIndex].title = title;
    } else {
      targetPart.links.push(newLink);
    }

    return next;
  }

  function removeQuickLink(state, partitionId, linkId) {
    const next = normalizeQuickLinksState(state);
    if (!linkId) return next;

    for (const part of next.partitions) {
      if (!partitionId || part.id === partitionId) {
        part.links = part.links.filter((l) => l.id !== linkId);
      }
    }
    return next;
  }

  function moveQuickLink(state, linkId, targetPartitionId, targetIndex = -1) {
    const next = normalizeQuickLinksState(state);
    if (!linkId) return next;

    let foundLink = null;
    for (const part of next.partitions) {
      const idx = part.links.findIndex((l) => l.id === linkId);
      if (idx >= 0) {
        foundLink = part.links.splice(idx, 1)[0];
        break;
      }
    }

    if (!foundLink) return next;

    let targetPart = next.partitions.find((p) => p.id === targetPartitionId);
    if (!targetPart) {
      targetPart = next.partitions[0];
    }

    if (typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex <= targetPart.links.length) {
      targetPart.links.splice(targetIndex, 0, foundLink);
    } else {
      targetPart.links.push(foundLink);
    }

    return next;
  }

  function addQuickLinksPartition(state, name) {
    const next = normalizeQuickLinksState(state);
    const trimmed = typeof name === 'string' ? name.trim() : '';
    const partName = trimmed || `分区 ${next.partitions.length + 1}`;
    next.partitions.push({
      id: createId('part'),
      name: partName,
      links: [],
    });
    return next;
  }

  function removeQuickLinksPartition(state, partitionId) {
    const next = normalizeQuickLinksState(state);
    if (next.partitions.length <= 1) return next;

    const partIndex = next.partitions.findIndex((p) => p.id === partitionId);
    if (partIndex < 0) return next;

    const removed = next.partitions.splice(partIndex, 1)[0];
    if (removed && removed.links.length > 0 && next.partitions.length > 0) {
      for (const link of removed.links) {
        if (!next.partitions[0].links.some((l) => l.url === link.url)) {
          next.partitions[0].links.push(link);
        }
      }
    }

    return next;
  }

  function renameQuickLinksPartition(state, partitionId, newName) {
    const next = normalizeQuickLinksState(state);
    const trimmed = typeof newName === 'string' ? newName.trim() : '';
    if (!trimmed) return next;

    const targetPart = next.partitions.find((p) => p.id === partitionId);
    if (targetPart) {
      targetPart.name = trimmed;
    }
    return next;
  }

  function renderQuickLinksBar(quickLinksState, options = {}) {
    const state = normalizeQuickLinksState(quickLinksState);
    const partitions = state.partitions;

    return `
      <div
        class="gtd-quick-links-bar"
        data-gtd-component="quick-links-bar"
        data-gtd-drop-zone="quick-links-bar"
        role="region"
        aria-label="常用链接"
      >
        <div class="gtd-quick-links-header">
          <div class="gtd-quick-links-badge" title="常用链接：拖拽标签至此添加，拖拽到外部删除">
            <svg class="gtd-quick-links-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-1.428 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
            </svg>
            <span class="gtd-quick-links-title">常用链接</span>
          </div>
        </div>

        <div class="gtd-quick-links-partitions-track">
          ${partitions.map((partition) => `
            <div
              class="gtd-quick-links-partition"
              data-partition-id="${escapeHtml(partition.id)}"
              data-gtd-drop-zone="quick-links-partition"
            >
              <div
                class="gtd-partition-pill"
                data-partition-id="${escapeHtml(partition.id)}"
                data-partition-name="${escapeHtml(partition.name)}"
                title="双击重命名分区"
              >
                <span class="gtd-partition-pill-name">${escapeHtml(partition.name)}</span>
                ${partitions.length > 1 ? `
                  <button
                    class="gtd-partition-pill-del"
                    type="button"
                    data-gtd-action="delete-quick-links-partition"
                    data-partition-id="${escapeHtml(partition.id)}"
                    data-partition-name="${escapeHtml(partition.name)}"
                    title="删除分区「${escapeHtml(partition.name)}」"
                  >&times;</button>
                ` : ''}
              </div>
              <div class="gtd-partition-links-group" data-partition-id="${escapeHtml(partition.id)}">
                ${partition.links.length === 0 ? `
                  <span
                    class="gtd-partition-drop-hint"
                    data-partition-id="${escapeHtml(partition.id)}"
                    title="可将标签拖拽到此分区"
                  >拖拽标签至此</span>
                ` : partition.links.map((link) => {
                  let domain = '';
                  try { domain = new URL(link.url).hostname; } catch {}
                  const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=16` : '';
                  return `
                    <button
                      class="gtd-quick-link-btn"
                      type="button"
                      draggable="true"
                      data-gtd-action="open-quick-link"
                      data-link-id="${escapeHtml(link.id)}"
                      data-partition-id="${escapeHtml(partition.id)}"
                      data-link-url="${escapeHtml(link.url)}"
                      data-link-title="${escapeHtml(link.title)}"
                      title="${escapeHtml(link.title)}&#10;${escapeHtml(link.url)}&#10;提示：拖拽到外部即可删除，拖拽到其他分区可分类"
                    >
                      ${faviconUrl ? `<img class="gtd-quick-link-favicon" src="${faviconUrl}" alt="" data-hide-on-error="true" />` : `
                        <svg class="gtd-quick-link-icon-fallback" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
                        </svg>
                      `}
                      <span class="gtd-quick-link-text">${escapeHtml(link.title)}</span>
                    </button>
                  `;
                }).join('')}
              </div>
            </div>
          `).join('')}

          <button
            class="gtd-quick-links-add-partition-btn"
            type="button"
            data-gtd-action="add-quick-links-partition"
            title="添加新分区"
          >
            <svg class="gtd-quick-links-plus-icon" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 3a1 1 0 0 1 1 1v5h5a1 1 0 1 1 0 2h-5v5a1 1 0 1 1-2 0v-5H4a1 1 0 1 1 0-2h5V4a1 1 0 0 1 1-1z" clip-rule="evenodd" />
            </svg>
            <span>分区</span>
          </button>
        </div>
      </div>
    `;
  }

  function formatScopeDate(key) {
    if (!key) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      return key;
    }
    const weekMatch = key.match(/^week-(\d{4})-W(\d+)$/);
    if (weekMatch) {
      return `${weekMatch[1]}年第${weekMatch[2]}周`;
    }
    const monthMatch = key.match(/^month-(\d{4})-(\d{2})$/);
    if (monthMatch) {
      return `${monthMatch[1]}年${Number(monthMatch[2])}月`;
    }
    return key;
  }

  function formatArchiveTime(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return '';
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    } catch {
      return '';
    }
  }

  async function getArchivedTasks(storage, query = '') {
    const boards = await getBoards(storage);
    const results = [];
    const lowerQuery = (query || '').trim().toLowerCase();
    const seenTaskIds = new Set();

    const boardKeys = Object.keys(boards).sort().reverse();
    for (const key of boardKeys) {
      const board = boards[key];
      if (!board || !Array.isArray(board.tasks)) continue;

      for (const task of board.tasks) {
        if (!task.archived) continue;
        if (seenTaskIds.has(task.id)) continue;
        seenTaskIds.add(task.id);

        if (lowerQuery) {
          const matchTitle = (task.title || '').toLowerCase().includes(lowerQuery);
          const matchStep = Array.isArray(task.checklist) && task.checklist.some((item) =>
            (item.text || '').toLowerCase().includes(lowerQuery)
          );
          const matchDate = (key || '').toLowerCase().includes(lowerQuery);
          const matchQuadrant = (DEFAULT_QUADRANT_TITLES[task.quadrant] || '').toLowerCase().includes(lowerQuery);
          if (!matchTitle && !matchStep && !matchDate && !matchQuadrant) continue;
        }

        results.push({
          ...task,
          boardKey: key,
          boardDate: board.date || key,
        });
      }
    }

    results.sort((a, b) => {
      const timeA = a.archivedAt || a.createdAt || '';
      const timeB = b.archivedAt || b.createdAt || '';
      return timeB.localeCompare(timeA);
    });

    return results;
  }

  async function restoreArchivedTask(storage, boardKey, taskId, currentScopeKey = '') {
    const boards = await getBoards(storage);
    const sourceBoard = boards[boardKey];
    if (!sourceBoard || !Array.isArray(sourceBoard.tasks)) return null;

    const taskIndex = sourceBoard.tasks.findIndex((t) => t.id === taskId);
    if (taskIndex === -1) return null;
    const task = sourceBoard.tasks[taskIndex];

    if (!currentScopeKey || currentScopeKey === boardKey) {
      const nextSourceBoard = archiveTask(sourceBoard, taskId, false);
      nextSourceBoard.selectedTaskId = taskId;
      await saveBoard(storage, nextSourceBoard, boards);
      return nextSourceBoard;
    }

    const currentBoard = boards[currentScopeKey]
      ? normalizeBoard(boards[currentScopeKey], currentScopeKey)
      : createEmptyBoard(currentScopeKey);

    const unarchivedTask = normalizeTask({
      ...task,
      archived: false,
      archivedAt: '',
    });

    const nextSourceBoard = normalizeBoard({
      ...sourceBoard,
      tasks: sourceBoard.tasks.filter((t) => t.id !== taskId),
    }, boardKey);

    const nextCurrentBoard = normalizeBoard({
      ...currentBoard,
      tasks: [...currentBoard.tasks, unarchivedTask],
      selectedTaskId: unarchivedTask.id,
    }, currentScopeKey);

    const updatedBoards = {
      ...boards,
      [boardKey]: nextSourceBoard,
      [currentScopeKey]: nextCurrentBoard,
    };
    await storage.set({ [STORAGE_KEY]: updatedBoards });
    return nextCurrentBoard;
  }

  async function deleteArchivedTaskPermanent(storage, boardKey, taskId) {
    const boards = await getBoards(storage);
    const board = boards[boardKey];
    if (!board || !Array.isArray(board.tasks)) return null;

    const nextBoard = deleteTask(board, taskId);
    await saveBoard(storage, nextBoard, boards);
    return nextBoard;
  }

  async function recoverTaskChecklistFromHistory(storage, currentBoard, targetTaskIdOrTitle = '') {
    if (!currentBoard || !Array.isArray(currentBoard.tasks)) {
      return { success: false, count: 0, details: [], board: currentBoard };
    }

    const cleanText = (str) => {
      if (typeof str !== 'string') return '';
      return str
        .trim()
        .toLowerCase()
        .replace(/^[0-9]+[.\u3001\uff0e\s\-]+/, '')
        .replace(/\s+/g, '');
    };

    let targetTasks = [];
    if (targetTaskIdOrTitle && targetTaskIdOrTitle !== 'all') {
      const targetQuery = cleanText(targetTaskIdOrTitle);
      const matched = currentBoard.tasks.find((t) =>
        t.id === targetTaskIdOrTitle ||
        (t.title && cleanText(t.title) === targetQuery)
      );
      if (matched) {
        targetTasks = [matched];
      }
    } else {
      targetTasks = currentBoard.tasks.filter((t) =>
        Array.isArray(t.checklist) && t.checklist.some((item) => !item.completed)
      );
    }

    if (!targetTasks.length) {
      return { success: true, count: 0, details: [], board: currentBoard };
    }

    const boards = await getBoards(storage);
    const candidateBoards = [];

    // 1. Current board archived tasks
    const currentArchived = currentBoard.tasks.filter((t) => t.archived);
    if (currentArchived.length) {
      candidateBoards.push({
        source: 'current-archived',
        board: { tasks: currentArchived },
      });
    }

    // 2. Historical boards in storage
    const boardKeys = Object.keys(boards).filter((k) => k !== currentBoard.date);
    boardKeys.sort().reverse();
    for (const k of boardKeys) {
      if (boards[k] && Array.isArray(boards[k].tasks)) {
        candidateBoards.push({
          source: `board:${k}`,
          board: boards[k],
        });
      }
    }

    // 3. Backups in IndexedDB (if runtime supports it)
    if (typeof indexedDB !== 'undefined' && typeof JSZip !== 'undefined') {
      try {
        const backupEntries = await new Promise((resolve) => {
          const req = indexedDB.open('TabOutBackups', 1);
          req.onsuccess = () => {
            const db = req.result;
            try {
              const tx = db.transaction('backups', 'readonly');
              const store = tx.objectStore('backups');
              const getReq = store.getAll();
              getReq.onsuccess = () => {
                db.close();
                resolve(getReq.result || []);
              };
              getReq.onerror = () => {
                db.close();
                resolve([]);
              };
            } catch (_) {
              db.close();
              resolve([]);
            }
          };
          req.onerror = () => resolve([]);
        });

        backupEntries.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        for (const entry of backupEntries) {
          if (!entry.blob) continue;
          try {
            const zip = await JSZip.loadAsync(entry.blob);
            const gtdJsonFile = zip.file('gtdBoards.json');
            if (gtdJsonFile) {
              const jsonStr = await gtdJsonFile.async('string');
              const parsed = JSON.parse(jsonStr);
              if (parsed && typeof parsed === 'object') {
                Object.keys(parsed).forEach((k) => {
                  if (parsed[k] && Array.isArray(parsed[k].tasks)) {
                    candidateBoards.push({
                      source: `backup:${entry.date}:${k}`,
                      board: parsed[k],
                    });
                  }
                });
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
    }

    // 4. Saved checklist templates
    try {
      const saved = await getSavedChecklists(storage);
      if (Array.isArray(saved) && saved.length > 0) {
        candidateBoards.push({
          source: 'saved-checklists',
          savedTemplates: saved,
        });
      }
    } catch (_) {}

    let totalRecoveredCount = 0;
    const recoveredDetails = [];

    const nextTasks = currentBoard.tasks.map((task) => {
      const isTarget = targetTasks.some((t) => t.id === task.id);
      if (!isTarget || !Array.isArray(task.checklist) || !task.checklist.length) {
        return task;
      }

      const taskTitleClean = cleanText(task.title);
      let recoveredInTask = 0;

      const nextChecklist = task.checklist.map((item) => {
        if (item.completed) return item;

        const itemTextClean = cleanText(item.text);
        const itemId = item.id;

        for (const candidate of candidateBoards) {
          if (candidate.board && Array.isArray(candidate.board.tasks)) {
            for (const histTask of candidate.board.tasks) {
              const histTitleClean = cleanText(histTask.title);
              const titleMatches = histTask.id === task.id ||
                histTitleClean === taskTitleClean ||
                (histTitleClean && taskTitleClean && (histTitleClean.includes(taskTitleClean) || taskTitleClean.includes(histTitleClean)));

              if (!titleMatches || !Array.isArray(histTask.checklist)) continue;

              const histStep = histTask.checklist.find((hs) => {
                if (itemId && hs.id === itemId) return true;
                const hsTextClean = cleanText(hs.text);
                return (itemTextClean && hsTextClean && (hsTextClean === itemTextClean || hsTextClean.includes(itemTextClean) || itemTextClean.includes(hsTextClean)));
              });

              if (histStep && (histStep.completed || histStep.status === 'done')) {
                recoveredInTask++;
                totalRecoveredCount++;
                recoveredDetails.push({
                  taskId: task.id,
                  taskTitle: task.title,
                  stepId: item.id,
                  stepText: item.text,
                  source: candidate.source,
                  completedAt: histStep.completedAt,
                });
                return {
                  ...item,
                  completed: true,
                  status: 'done',
                  completedAt: histStep.completedAt || nowIso(),
                  emoji: item.emoji || histStep.emoji || '',
                };
              }
            }
          } else if (candidate.savedTemplates && Array.isArray(candidate.savedTemplates)) {
            for (const tmpl of candidate.savedTemplates) {
              const tmplTitleClean = cleanText(tmpl.taskTitle || tmpl.name);
              const titleMatches = tmplTitleClean === taskTitleClean ||
                (tmplTitleClean && taskTitleClean && (tmplTitleClean.includes(taskTitleClean) || taskTitleClean.includes(tmplTitleClean)));

              if (!titleMatches || !Array.isArray(tmpl.items)) continue;

              const histStep = tmpl.items.find((hs) => {
                if (itemId && hs.id === itemId) return true;
                const hsTextClean = cleanText(hs.text);
                return (itemTextClean && hsTextClean && (hsTextClean === itemTextClean || hsTextClean.includes(itemTextClean) || itemTextClean.includes(hsTextClean)));
              });

              if (histStep && (histStep.completed || histStep.status === 'done')) {
                recoveredInTask++;
                totalRecoveredCount++;
                recoveredDetails.push({
                  taskId: task.id,
                  taskTitle: task.title,
                  stepId: item.id,
                  stepText: item.text,
                  source: 'saved-template',
                  completedAt: histStep.completedAt,
                });
                return {
                  ...item,
                  completed: true,
                  status: 'done',
                  completedAt: histStep.completedAt || nowIso(),
                  emoji: item.emoji || histStep.emoji || '',
                };
              }
            }
          }
        }

        return item;
      });

      if (recoveredInTask > 0) {
        return normalizeTask({
          ...task,
          checklist: nextChecklist,
        });
      }

      return task;
    });

    if (totalRecoveredCount > 0) {
      const nextBoard = normalizeBoard({
        ...currentBoard,
        tasks: nextTasks,
        updatedAt: nowIso(),
      }, currentBoard.date);

      await saveBoard(storage, nextBoard);
      return {
        success: true,
        count: totalRecoveredCount,
        details: recoveredDetails,
        board: nextBoard,
      };
    }

    return {
      success: true,
      count: 0,
      details: [],
      board: currentBoard,
    };
  }

  function renderArchiveList(archivedTasks = [], options = {}) {
    const query = typeof options.query === 'string' ? options.query.trim() : '';
    const quadrantConfig = normalizeQuadrantConfig(options.quadrantConfig);

    if (!archivedTasks.length) {
      if (query) {
        return `<div class="dialog-empty">未找到匹配“${escapeHtml(query)}”的归档任务</div>`;
      }
      return `<div class="dialog-empty">暂无归档任务。<br><span style="font-size:12px;opacity:0.75;margin-top:6px;display:inline-block;">在 GTD 中点击任务的 × 即可将任务归档到此处。</span></div>`;
    }

    return archivedTasks.map((task) => {
      const quadrantTitle = quadrantConfig[task.quadrant] || DEFAULT_QUADRANT_TITLES[task.quadrant] || '象限任务';
      const scopeLabel = formatScopeDate(task.boardKey || task.boardDate);
      const timeLabel = formatArchiveTime(task.archivedAt || task.createdAt);
      const checklist = Array.isArray(task.checklist) ? task.checklist : [];
      const completedSteps = checklist.filter((item) => item.completed).length;

      let stepsHtml = '';
      if (checklist.length > 0) {
        stepsHtml = `
          <details class="gtd-archive-steps-details">
            <summary class="gtd-archive-steps-summary">
              ${checklist.length} 个子步骤 (${completedSteps}/${checklist.length} 完成)
            </summary>
            <ul class="gtd-archive-steps-sublist">
              ${checklist.map((step) => `
                <li class="gtd-archive-step-item${step.completed ? ' is-completed' : ''}" style="margin-left: ${step.level * 14}px">
                  <span class="gtd-archive-step-checkbox">${step.completed ? '✓' : '○'}</span>
                  <span class="gtd-archive-step-text">${escapeHtml(step.text)}</span>
                </li>
              `).join('')}
            </ul>
          </details>
        `;
      }

      return `
        <div class="gtd-archive-item" data-task-id="${escapeHtml(task.id)}" data-board-key="${escapeHtml(task.boardKey || task.boardDate || '')}">
          <div class="gtd-archive-item-meta">
            <span class="gtd-archive-quadrant-badge is-${escapeHtml(task.quadrant)}">${escapeHtml(quadrantTitle)}</span>
            ${scopeLabel ? `<span class="gtd-archive-date-badge">${escapeHtml(scopeLabel)}</span>` : ''}
            ${task.completed ? '<span class="gtd-archive-status-badge is-completed">已完成</span>' : ''}
            ${timeLabel ? `<span class="gtd-archive-time" title="归档时间">${escapeHtml(timeLabel)}</span>` : ''}
          </div>
          <div class="gtd-archive-item-content">
            <div class="gtd-archive-item-title${task.completed ? ' is-completed' : ''}">${escapeHtml(task.title)}</div>
            <div class="gtd-archive-item-actions">
              <button
                class="gtd-archive-action-btn gtd-archive-restore-btn"
                type="button"
                data-gtd-action="restore-archived-task"
                data-task-id="${escapeHtml(task.id)}"
                data-board-key="${escapeHtml(task.boardKey || task.boardDate || '')}"
                title="恢复到看板"
              >
                恢复
              </button>
              <button
                class="gtd-archive-action-btn gtd-archive-delete-btn"
                type="button"
                data-gtd-action="delete-archived-task-permanent"
                data-task-id="${escapeHtml(task.id)}"
                data-board-key="${escapeHtml(task.boardKey || task.boardDate || '')}"
                title="彻底删除"
              >
                删除
              </button>
            </div>
          </div>
          ${stepsHtml}
        </div>
      `;
    }).join('');
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

  const DEFAULT_QUADRANT_SHORT_CHARS = {
    importantUrgent: '急',
    importantNotUrgent: '重',
    urgentNotImportant: '杂',
    notImportantNotUrgent: '闲',
  };

  function getQuadrantShortChar(quadrantKey, titleConfig = {}) {
    const key = isValidQuadrant(quadrantKey) ? quadrantKey : 'importantUrgent';
    const customTitle = titleConfig[key];
    if (typeof customTitle === 'string' && customTitle.trim() && customTitle.trim() !== DEFAULT_QUADRANT_TITLES[key]) {
      return customTitle.trim().charAt(0);
    }
    return DEFAULT_QUADRANT_SHORT_CHARS[key] || '重';
  }

  function renderQuadrantRibbon(quadrantKey, titleConfig = {}) {
    const key = isValidQuadrant(quadrantKey) ? quadrantKey : 'importantUrgent';
    const quadTitle = titleConfig[key] || DEFAULT_QUADRANT_TITLES[key] || '任务';
    const shortChar = getQuadrantShortChar(key, titleConfig);
    return `
      <span class="gtd-quadrant-ribbon gtd-quadrant-ribbon-${key}" title="四象限分类：${escapeHtml(quadTitle)}">
        <span class="gtd-ribbon-text">${escapeHtml(shortChar)}</span>
      </span>
    `.trim();
  }

  // 别名保留以兼容历史调用
  const renderQuadrantFlag = renderQuadrantRibbon;

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
    const isEditingTitle = options.editingQuadrantKey === quadrant.key;

    const titleElement = isEditingTitle ? `
      <form class="gtd-quadrant-title-edit-form" data-gtd-form="edit-quadrant-title" data-quadrant="${quadrant.key}">
        <input
          type="text"
          name="title"
          value="${escapeHtml(quadrant.title)}"
          placeholder="输入象限标题，回车保存"
          autocomplete="off"
        >
      </form>
    ` : `
      <div
        class="gtd-quadrant-title"
        data-gtd-action="edit-quadrant-title"
        data-quadrant="${quadrant.key}"
        title="双击修改标题"
      >${escapeHtml(quadrant.title)}</div>
    `;

    const activeTasks = tasks.filter((task) => !task.completed);
    const completedTasks = sortCompletedDesc(tasks.filter((task) => task.completed));
    const hasEditingTask = completedTasks.some((t) => t.id === options.editingTaskId);
    const isExpanded = Boolean(options.expandedCompletedQuadrants?.[quadrant.key]) || hasEditingTask;

    const completedSection = completedTasks.length ? `
      <div class="gtd-completed-section" data-completed-quadrant="${quadrant.key}">
        <button
          class="gtd-completed-toggle"
          type="button"
          data-gtd-action="toggle-completed-tasks"
          data-quadrant="${quadrant.key}"
          aria-expanded="${isExpanded ? 'true' : 'false'}"
          title="${isExpanded ? '收起已完成任务' : '展开已完成任务'}"
        >
          <span class="gtd-completed-toggle-title">
            <span class="gtd-completed-toggle-icon">${isExpanded ? '▾' : '▸'}</span>
            已完成 (${completedTasks.length})
          </span>
          <span class="gtd-completed-toggle-hint">${isExpanded ? '收起' : '展开'}</span>
        </button>
        <div class="gtd-completed-list${isExpanded ? ' is-expanded' : ' is-collapsed'}">
          ${completedTasks.map((task) => renderTaskItem(board, task, options)).join('')}
        </div>
      </div>
    ` : '';

    const contentHtml = tasks.length === 0
      ? `<div class="gtd-quadrant-empty">${quadrant.empty}</div>`
      : `${activeTasks.map((task) => renderTaskItem(board, task, options)).join('')}${completedSection}`;

    return `
      <section
        class="gtd-quadrant gtd-quadrant-${quadrant.tone}"
        data-quadrant="${quadrant.key}"
        data-gtd-drop-zone="${quadrant.key}"
        data-gtd-action="prompt-add-task"
        title="双击空白处快速添加任务"
      >
        <div class="gtd-quadrant-header">
          <div class="gtd-quadrant-header-left">
            <span
              class="gtd-quadrant-drag-handle"
              data-gtd-action="drag-quadrant"
              data-quadrant="${quadrant.key}"
              draggable="true"
              title="拖拽调换四象限位置"
            >⋮⋮</span>
            ${titleElement}
          </div>
          <div class="gtd-quadrant-count">${completedCount}/${tasks.length || 0}</div>
        </div>
        <div class="gtd-task-list">
          ${contentHtml}
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
      </form>
    ` : `
      <button
        class="gtd-task-main"
        type="button"
        data-gtd-action="select-task"
        data-task-id="${task.id}"
      >
        <span class="gtd-task-title-wrap">
          <span class="gtd-task-title">${escapeHtml(task.title)}</span>
        </span>
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
        <button
          class="gtd-emoji-btn${task.emoji ? ' has-emoji' : ' is-empty'}"
          type="button"
          data-gtd-action="pick-emoji"
          data-task-id="${task.id}"
          title="选择表情图标"
        >${task.emoji || '🙂'}</button>
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
          aria-label="归档任务"
          title="归档任务"
          data-gtd-action="archive-task"
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

  // 渲染批量添加步骤面板：多行文本按折行拆分为多个步骤
  function renderBatchStepPanel(task, options = {}) {
    if (options.batchStepTaskId !== task.id) return '';

    return `
      <form class="gtd-step-batch" data-gtd-form="add-batch-steps" data-task-id="${task.id}">
        <textarea
          class="gtd-step-batch-textarea"
          name="batchText"
          rows="6"
          placeholder="每行一个步骤，例如：&#10;收集相关素材&#10;整理内容提纲&#10;完成初稿撰写"
        ></textarea>
        <div class="gtd-step-batch-hint">按折行拆分，每行生成一个步骤，空行会被忽略；Cmd/Ctrl + Enter 快速添加</div>
        <div class="gtd-step-batch-actions">
          <button class="gtd-step-batch-cancel" type="button" data-gtd-action="close-batch-steps">取消</button>
          <button class="gtd-step-batch-submit" type="submit">确认添加</button>
        </div>
      </form>
    `;
  }

  function renderStepItem(selectedTask, item, options = {}, meta = {}) {
    const isEditingStep = options.editingStepId === item.id;
    const hasChildren = Boolean(meta.hasChildren);
    const isExpanded = Boolean(meta.isExpanded);
    const isVisible = meta.isVisible !== false;

    const toggleBtn = hasChildren ? `
      <button
        class="gtd-step-toggle-btn"
        type="button"
        data-gtd-action="toggle-step-collapse"
        data-task-id="${selectedTask.id}"
        data-step-id="${item.id}"
        aria-expanded="${isExpanded ? 'true' : 'false'}"
        title="${isExpanded ? '收起子步骤' : `展开子步骤 (${meta.childCount})`}"
      >
        <span class="gtd-step-toggle-icon">${isExpanded ? '▾' : '▸'}</span>
      </button>
    ` : `<span class="gtd-step-toggle-placeholder"></span>`;

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
        class="gtd-step-item${item.completed ? ' is-completed' : ''}${isEditingStep ? ' is-editing' : ''}${isVisible ? '' : ' is-step-collapsed'}"
        data-step-id="${item.id}"
        data-step-level="${item.level}"
        data-task-id="${selectedTask.id}"
        data-gtd-action="drag-step"
        draggable="${isEditingStep ? 'false' : 'true'}"
        style="${isVisible ? '' : 'display: none; '}--gtd-step-level:${item.level}"
      >
        ${toggleBtn}
        <button
          class="gtd-emoji-btn${item.emoji ? ' has-emoji' : ' is-empty'}"
          type="button"
          data-gtd-action="pick-emoji"
          data-task-id="${selectedTask.id}"
          data-step-id="${item.id}"
          title="选择表情图标"
        >${item.emoji || '🙂'}</button>
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
  }

  function renderChecklistPanel(board, options = {}) {
    const selectedTask = getSelectedTask(board);

    if (!selectedTask) {
      return `
        <div class="gtd-detail-card gtd-empty-card">
          <div class="gtd-detail-eyebrow">checklist</div>
          <h3>点选左侧任务</h3>
          <p>当你从四象限里选中一个任务后，这里会显示它的执行步骤。先拆出第一步，行动会更轻松。</p>
        </div>
      `;
    }

    const quadrant = QUADRANT_MAP[selectedTask.quadrant];
    const progress = getTaskProgress(selectedTask);
    const pomodoro = options.pomodoro || {};
    const hasItems = selectedTask.checklist.length > 0;
    const titleConfig = normalizeQuadrantConfig(options.quadrantConfig);

    const activeSteps = selectedTask.checklist.filter((item) => !item.completed);
    const completedSteps = sortCompletedDesc(selectedTask.checklist.filter((item) => item.completed));
    const hasEditingStep = completedSteps.some((s) => s.id === options.editingStepId);
    const isExpanded = Boolean(options.expandedCompletedSteps?.[selectedTask.id]) || hasEditingStep;

    const activeStepMeta = computeStepTreeVisibility(activeSteps, options.expandedChecklistSteps, options);
    const completedStepMeta = completedSteps.map(() => ({
      hasChildren: false,
      childCount: 0,
      isExpanded: false,
      isVisible: true,
    }));

    const completedSection = completedSteps.length ? `
      <div class="gtd-completed-section gtd-step-completed-section" data-completed-task="${selectedTask.id}">
        <button
          class="gtd-completed-toggle"
          type="button"
          data-gtd-action="toggle-completed-steps"
          data-task-id="${selectedTask.id}"
          aria-expanded="${isExpanded ? 'true' : 'false'}"
          title="${isExpanded ? '收起已完成步骤' : '展开已完成步骤'}"
        >
          <span class="gtd-completed-toggle-title">
            <span class="gtd-completed-toggle-icon">${isExpanded ? '▾' : '▸'}</span>
            已完成步骤 (${completedSteps.length})
          </span>
          <span class="gtd-completed-toggle-hint">${isExpanded ? '收起' : '展开'}</span>
        </button>
        <div class="gtd-completed-list gtd-completed-steps-list${isExpanded ? ' is-expanded' : ' is-collapsed'}">
          ${completedSteps.map((item, index) => renderStepItem(selectedTask, item, options, completedStepMeta[index])).join('')}
        </div>
      </div>
    ` : '';

    const stepsContentHtml = selectedTask.checklist.length === 0
      ? `<div class="gtd-step-empty">还没有拆解步骤。先加第一步，让任务开始滚动起来。</div>`
      : `${activeSteps.map((item, index) => renderStepItem(selectedTask, item, options, activeStepMeta[index])).join('')}${completedSection}`;

    return `
      <div class="gtd-detail-card">
        <div class="gtd-detail-title-block">
          <div class="gtd-detail-title-row">
            <div class="gtd-detail-title-wrapper">
              <button
                class="gtd-emoji-btn${selectedTask.emoji ? ' has-emoji' : ' is-empty'}"
                type="button"
                data-gtd-action="pick-emoji"
                data-task-id="${selectedTask.id}"
                title="选择表情图标"
              >${selectedTask.emoji || '🙂'}</button>
              <h3>${escapeHtml(selectedTask.title)}</h3>
              ${renderQuadrantRibbon(selectedTask.quadrant, titleConfig)}
            </div>
            <div class="gtd-detail-actions">
              ${hasItems ? `<button class="gtd-detail-save-checklist" type="button" data-gtd-action="save-checklist" data-task-id="${selectedTask.id}" title="保存 checklist 以便复用">保存 checklist</button>` : ''}
              ${hasItems ? `<button class="gtd-detail-recover-checklist" type="button" data-gtd-action="recover-checklist-history" data-task-id="${selectedTask.id}" title="根据历史看板与备份恢复已完成步骤">从历史恢复</button>` : ''}
            </div>
          </div>
          ${renderPomodoroTrack(selectedTask, pomodoro)}
        </div>
        <div class="gtd-detail-meta">
          <span class="gtd-detail-badge">checklist</span>
          <span class="gtd-detail-progress">${progress.completed}/${progress.total} 步已完成</span>
        </div>
        <form class="gtd-add-form gtd-step-form" data-gtd-form="add-step" data-task-id="${selectedTask.id}">
          <input type="text" name="text" placeholder="添加一个执行步骤..." autocomplete="off">
          <button type="submit">添加</button>
          <button class="gtd-step-reuse-btn" type="button" data-gtd-action="open-reuse-checklist" data-task-id="${selectedTask.id}" title="从已保存的 checklist 中导入">复用</button>
          <button class="gtd-step-reuse-btn" type="button" data-gtd-action="recover-checklist-history" data-task-id="${selectedTask.id}" title="根据历史看板与备份恢复已完成步骤">历史恢复</button>
          <button class="gtd-step-reuse-btn${options.batchStepTaskId === selectedTask.id ? ' is-active' : ''}" type="button" data-gtd-action="toggle-batch-steps" data-task-id="${selectedTask.id}" title="按折行批量添加步骤">批量</button>
        </form>
        ${renderBatchStepPanel(selectedTask, options)}
        <div class="gtd-step-list">
          ${stepsContentHtml}
        </div>
      </div>
    `;
  }

  function exportBoardToMarkdown(board, quadrantConfig) {
    const normalized = normalizeBoard(board);
    const visibleTasks = normalized.tasks.filter((task) => !task.archived);
    const completedTasks = visibleTasks.filter((task) => task.completed).length;
    const quadrants = getQuadrants(quadrantConfig);
    const lines = [
      '# 今日 GTD 日报',
      '',
      `日期：${normalized.date}`,
      `完成概览：${completedTasks}/${visibleTasks.length} 任务完成`,
      '',
    ];

    for (const quadrant of quadrants) {
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

    const titleMap = { ...QUADRANT_TITLE_MAP };
    if (options.quadrantConfig) {
      const customConfig = normalizeQuadrantConfig(options.quadrantConfig);
      Object.entries(customConfig).forEach(([key, title]) => {
        if (title) titleMap[title] = key;
      });
    }

    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;

      const quadrantMatch = line.match(/^##\s+(.+)$/);
      if (quadrantMatch) {
        currentQuadrant = titleMap[quadrantMatch[1].trim()] || '';
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

  function renderScopeTabbar(activeScope) {
    const tabs = [
      { scope: 'day', label: '日' },
      { scope: 'week', label: '周' },
      { scope: 'month', label: '月' },
    ];
    return `
      <span class="gtd-scope-tabbar" role="tablist" aria-label="时间范围">
        ${tabs.map((t) => `
          <button
            class="gtd-scope-tab${activeScope === t.scope ? ' is-active' : ''}"
            type="button"
            role="tab"
            aria-selected="${activeScope === t.scope ? 'true' : 'false'}"
            data-gtd-action="switch-scope"
            data-scope="${t.scope}"
          >${t.label}</button>
        `).join('')}
      </span>
    `;
  }

  // 渲染四象限与 checklist 之间的分隔条：中间按钮折叠/展开，其余区域可拖拽调宽
  function renderGtdPanelDivider(options = {}) {
    const collapsed = Boolean(options.detailCollapsed);
    const label = collapsed ? '展开 checklist 面板' : '折叠 checklist 面板';

    return `
      <div class="gtd-panel-divider${collapsed ? ' is-collapsed' : ''}">
        <button
          class="gtd-divider-toggle"
          type="button"
          data-gtd-action="toggle-gtd-detail"
          aria-label="${label}"
          title="${label}"
        >${collapsed ? '«' : '»'}</button>
      </div>
    `;
  }

  // 渲染主行：四象限 + 分隔条 + checklist 面板，支持折叠与自定义宽度
  function renderGtdMainRow(board, quadrants, options = {}) {
    const collapsed = Boolean(options.detailCollapsed);
    const width = Number(options.detailWidth);
    const widthStyle = Number.isFinite(width) && width > 0
      ? ` style="--gtd-detail-width:${Math.round(width)}px"`
      : '';

    return `
      <div class="gtd-main-row${collapsed ? ' is-detail-collapsed' : ''}">
        <section class="gtd-board-panel">
          <div class="gtd-quad-grid">
            ${quadrants.map((quadrant) => renderQuadrantCard(board, quadrant, options)).join('')}
          </div>
        </section>
        ${renderGtdPanelDivider(options)}
        <section class="gtd-detail-panel${Number.isFinite(width) && width > 0 ? ' has-custom-width' : ''}"${widthStyle}>
          ${renderChecklistPanel(board, options)}
        </section>
      </div>
    `;
  }

  function renderKanbanStepCard(task, step, meta = {}) {
    const isGrandchild = step.level >= 1;
    const isStepVisible = meta.isVisible !== false;
    const hasStepChildren = Boolean(meta.hasChildren);
    const isStepExpanded = Boolean(meta.isExpanded);

    return `
      <div
        class="gtd-kanban-step-card${step.completed ? ' is-completed' : ''}${isGrandchild ? ' is-grandchild' : ' is-child'}${isStepVisible ? '' : ' is-step-collapsed'}"
        data-gtd-action="drag-kanban-item"
        data-task-id="${task.id}"
        data-step-id="${step.id}"
        data-step-level="${step.level}"
        draggable="true"
        title="${escapeHtml(step.text)}"
        style="${isStepVisible ? '' : 'display: none; '}--kanban-step-level:${step.level}"
      >
        ${hasStepChildren ? `
          <button
            class="gtd-step-toggle-btn"
            type="button"
            data-gtd-action="toggle-step-collapse"
            data-task-id="${task.id}"
            data-step-id="${step.id}"
            aria-expanded="${isStepExpanded ? 'true' : 'false'}"
            title="${isStepExpanded ? '收起子步骤' : `展开子步骤 (${meta.childCount})`}"
          >
            <span class="gtd-step-toggle-icon">${isStepExpanded ? '▾' : '▸'}</span>
          </button>
        ` : `
          <span class="gtd-step-toggle-placeholder"></span>
        `}
        <button
          class="gtd-emoji-btn${step.emoji ? ' has-emoji' : ' is-empty'}"
          type="button"
          data-gtd-action="pick-emoji"
          data-task-id="${task.id}"
          data-step-id="${step.id}"
          title="设置步骤表情"
        >${step.emoji || '🙂'}</button>
        <input
          class="gtd-step-checkbox"
          type="checkbox"
          aria-label="完成步骤"
          data-gtd-action="toggle-step"
          data-task-id="${task.id}"
          data-step-id="${step.id}"
          ${step.completed ? 'checked' : ''}
        >
        <span class="gtd-kanban-step-text" title="${escapeHtml(step.text)}" data-full-text="${escapeHtml(step.text)}">${escapeHtml(step.text)}</span>
      </div>
    `;
  }

  function renderKanbanBoard(board, options = {}) {
    const normalized = normalizeBoard(board);
    const visibleTasks = normalized.tasks.filter((task) => !task.archived);
    const quadrantConfig = options.quadrantConfig;
    const titleConfig = normalizeQuadrantConfig(quadrantConfig);

    return `
      <div class="gtd-kanban-board">
        ${KANBAN_LANES.map((lane) => {
          let laneItemCount = 0;
          const groupHtmls = [];

          let laneTasks = visibleTasks;
          if (lane.key === 'done') {
            laneTasks = [...visibleTasks].sort((a, b) => {
              const timeA = Math.max(
                a.status === 'done' ? getCompletedTimeValue(a) : 0,
                ...a.checklist.filter((s) => s.status === 'done').map(getCompletedTimeValue),
                0
              );
              const timeB = Math.max(
                b.status === 'done' ? getCompletedTimeValue(b) : 0,
                ...b.checklist.filter((s) => s.status === 'done').map(getCompletedTimeValue),
                0
              );
              return timeB - timeA;
            });
          }

          for (const task of laneTasks) {
            const isTaskInLane = task.status === lane.key;
            let laneSteps = [];

            if (lane.key === 'done') {
              laneSteps = sortCompletedDesc(task.checklist.filter((item) => item.status === 'done' || item.completed));
            } else {
              laneSteps = task.checklist.filter((item) => !item.completed && item.status === lane.key);
            }

            if (isTaskInLane) laneItemCount += 1;
            laneItemCount += laneSteps.length;

            if (isTaskInLane || laneSteps.length > 0) {
              const quadTitle = titleConfig[task.quadrant] || DEFAULT_QUADRANT_TITLES[task.quadrant] || '任务';
              const taskKey = `${lane.key}:${task.id}`;
              const isTaskExpanded = Boolean(options.expandedKanbanTasks?.[taskKey] || options.expandedKanbanTasks?.[task.id]);

              const laneStepMeta = lane.key === 'done'
                ? laneSteps.map(() => ({ isVisible: true, hasChildren: false, isExpanded: false }))
                : computeStepTreeVisibility(laneSteps, options.expandedChecklistSteps, options);

              groupHtmls.push(`
                <div class="gtd-kanban-group" data-task-id="${task.id}">
                  <div class="gtd-kanban-group-header${isTaskInLane ? ' is-task-in-lane' : ' is-task-anchor'}">
                    <div class="gtd-kanban-task-header-row">
                      <button
                        class="gtd-emoji-btn${task.emoji ? ' has-emoji' : ' is-empty'}"
                        type="button"
                        data-gtd-action="pick-emoji"
                        data-task-id="${task.id}"
                        title="设置任务表情"
                      >${task.emoji || '🙂'}</button>
                      ${isTaskInLane ? `
                        <div
                          class="gtd-kanban-task-card"
                          data-gtd-action="drag-kanban-item"
                          data-task-id="${task.id}"
                          draggable="true"
                          title="${escapeHtml(task.title)}"
                        >
                          <input
                            class="gtd-task-checkbox"
                            type="checkbox"
                            aria-label="完成任务"
                            data-gtd-action="toggle-task"
                            data-task-id="${task.id}"
                            ${task.completed ? 'checked' : ''}
                          >
                          <span class="gtd-kanban-task-title">${escapeHtml(task.title)}</span>
                          ${renderQuadrantRibbon(task.quadrant, titleConfig)}
                        </div>
                      ` : `
                        <div
                          class="gtd-kanban-anchor-title"
                          data-gtd-action="drag-kanban-item"
                          data-task-id="${task.id}"
                          draggable="true"
                          title="所属任务：${escapeHtml(task.title)}（拖拽可移动任务及子步骤）"
                        >
                          <span class="gtd-kanban-anchor-label">所属任务:</span>
                          <span class="gtd-kanban-anchor-text" title="${escapeHtml(task.title)}" data-full-text="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span>
                          ${renderQuadrantRibbon(task.quadrant, titleConfig)}
                        </div>
                      `}
                      ${laneSteps.length > 0 ? `
                        <button
                          class="gtd-kanban-toggle-btn"
                          type="button"
                          data-gtd-action="toggle-kanban-task-collapse"
                          data-task-id="${task.id}"
                          data-lane="${lane.key}"
                          aria-expanded="${isTaskExpanded ? 'true' : 'false'}"
                          title="${isTaskExpanded ? '收起步骤' : `展开步骤 (${laneSteps.length})`}"
                        >
                          <span class="gtd-kanban-toggle-icon">${isTaskExpanded ? '▾' : '▸'}</span>
                          <span class="gtd-kanban-toggle-count">${laneSteps.length}</span>
                        </button>
                      ` : ''}
                    </div>
                  </div>
                  ${laneSteps.length > 0 ? `
                    <div class="gtd-kanban-group-steps${isTaskExpanded ? ' is-expanded' : ' is-collapsed'}"${isTaskExpanded ? '' : ' style="display: none;"'}>
                      ${laneSteps.map((step, sIdx) => renderKanbanStepCard(task, step, laneStepMeta[sIdx])).join('')}
                    </div>
                  ` : ''}
                </div>
              `);
            }
          }

          const bodyContent = groupHtmls.length > 0
            ? groupHtmls.join('')
            : `<div class="gtd-kanban-lane-empty">${lane.empty}</div>`;

          return `
            <section class="gtd-kanban-lane gtd-kanban-lane-${lane.tone}" data-gtd-drop-lane="${lane.key}">
              <div class="gtd-kanban-lane-header">
                <div class="gtd-kanban-lane-title">
                  <span class="gtd-kanban-lane-dot"></span>
                  <span>${lane.title}</span>
                </div>
                <span class="gtd-kanban-lane-count">${laneItemCount}</span>
              </div>
              <div class="gtd-kanban-lane-body">
                ${bodyContent}
              </div>
            </section>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderWorkspace(board, options = {}) {
    const normalized = normalizeBoard(board);
    const visibleTasks = normalized.tasks.filter((task) => !task.archived);
    const totalTasks = visibleTasks.length;
    const completedTasks = visibleTasks.filter((task) => task.completed).length;
    const collapsed = Boolean(options.collapsed);
    const activeScope = options.activeScope || 'day';
    const scopeLabel = options.scopeLabel || '今日 GTD';
    const quadrants = getQuadrants(options.quadrantConfig);
    const viewMode = options.viewMode === 'kanban' ? 'kanban' : 'quadrant';

    return `
      <div class="gtd-shell gtd-shell-${activeScope} gtd-view-${viewMode}">
        ${renderQuickLinksBar(options.quickLinks, options)}
        <div
          class="section-header gtd-section-header is-collapsible${collapsed ? ' is-collapsed' : ''}"
          data-gtd-action="toggle-gtd-section"
          role="button"
          tabindex="0"
          aria-expanded="${collapsed ? 'false' : 'true'}"
        >
          <h2>${escapeHtml(scopeLabel)}</h2>
          <div class="section-line"></div>
          <div class="gtd-header-actions">
            <div class="section-count">${completedTasks}/${totalTasks} 已完成</div>
            <div class="gtd-header-buttons">
              ${renderScopeTabbar(activeScope)}
              <div class="gtd-view-switcher" role="group" aria-label="GTD 视图模式">
                <button
                  class="gtd-view-btn${viewMode === 'quadrant' ? ' is-active' : ''}"
                  type="button"
                  data-gtd-action="switch-gtd-view"
                  data-view="quadrant"
                  title="切换到四象限视图"
                >四象限</button>
                <button
                  class="gtd-view-btn${viewMode === 'kanban' ? ' is-active' : ''}"
                  type="button"
                  data-gtd-action="switch-gtd-view"
                  data-view="kanban"
                  title="切换到看板模式"
                >看板</button>
              </div>
              ${activeScope === 'day' ? `
                <input
                  class="gtd-file-input"
                  type="file"
                  accept=".md,.markdown,text/markdown,text/plain"
                  data-gtd-action="import-gtd-file"
                  hidden
                >
                <button class="gtd-header-btn" type="button" data-gtd-action="import-gtd-report">导入日报</button>
                <button class="gtd-header-btn" type="button" data-gtd-action="export-gtd-report">导出日报</button>
              ` : ''}
              <button class="gtd-header-btn" type="button" data-gtd-action="open-gtd-archive">检索归档</button>
              <button class="gtd-header-btn gtd-header-btn-danger" type="button" data-gtd-action="clear-gtd-board">清空</button>
            </div>
          </div>
        </div>
        ${collapsed ? '' : (viewMode === 'kanban' ? renderKanbanBoard(normalized, options) : renderGtdMainRow(normalized, quadrants, options))}
      </div>
    `;
  }

  function renderWorkspaceShell(board, options = {}) {
    const activeTab = options.activeTab === 'whiteboard' || options.activeTab === 'notes' || options.activeTab === 'structure' || options.activeTab === 'backup' || options.activeTab === 'memo'
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
            class="workspace-tab${activeTab === 'memo' ? ' is-active' : ''}"
            type="button"
            role="tab"
            aria-selected="${activeTab === 'memo' ? 'true' : 'false'}"
            data-gtd-action="switch-workspace-tab"
            data-workspace-tab="memo"
          >微笔记</button>
          <button
            class="workspace-tab${activeTab === 'structure' ? ' is-active' : ''}"
            type="button"
            role="tab"
            aria-selected="${activeTab === 'structure' ? 'true' : 'false'}"
            data-gtd-action="switch-workspace-tab"
            data-workspace-tab="structure"
          >结构图</button>
          <button
            class="workspace-tab${activeTab === 'backup' ? ' is-active' : ''}"
            type="button"
            role="tab"
            aria-selected="${activeTab === 'backup' ? 'true' : 'false'}"
            data-gtd-action="switch-workspace-tab"
            data-workspace-tab="backup"
          >备份</button>
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
          <section class="workspace-panel workspace-panel-memo${activeTab === 'memo' ? ' is-active' : ''}" role="tabpanel">
            <div class="memo-panel-shell" id="memoPanel"></div>
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
          <section class="workspace-panel workspace-panel-backup${activeTab === 'backup' ? ' is-active' : ''}" role="tabpanel">
            <div class="backup-panel-shell" id="backupPanel"></div>
          </section>
        </div>
      </div>
    `;
  }

  return {
    STORAGE_KEY,
    QUADRANTS,
    QUADRANT_MAP,
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
    KANBAN_LANE_MAP,
    VALID_KANBAN_STATUSES,
    normalizeKanbanStatus,
    updateTaskKanbanStatus,
    updateChecklistItemKanbanStatus,
    updateTaskEmoji,
    updateChecklistItemEmoji,
    getBoardDate,
    createEmptyBoard,
    normalizeBoard,
    addTask,
    selectTask,
    toggleTaskCompleted,
    archiveTask,
    restoreTask,
    deleteTask,
    getArchivedTasks,
    restoreArchivedTask,
    deleteArchivedTaskPermanent,
    renderArchiveList,
    formatScopeDate,
    formatArchiveTime,
    updateTaskTitle,
    moveTaskToQuadrant,
    addChecklistItem,
    addChecklistItems,
    splitBatchStepLines,
    updateChecklistItemText,
    moveChecklistItem,
    toggleChecklistItemCompleted,
    deleteChecklistItem,
    getSelectedTask,
    getTaskProgress,
    getQuadrantTasks,
    getBoards,
    getTodayBoard,
    saveBoard,
    updateTodayBoard,
    getBoardScope,
    getScopeBoard,
    saveScopeBoard,
    updateScopeBoard,
    getSavedChecklists,
    saveSavedChecklist,
    deleteSavedChecklist,
    recoverTaskChecklistFromHistory,
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
    exportBoardToMarkdown,
    importBoardFromMarkdown,
    computeStepTreeVisibility,
    DEFAULT_QUADRANT_SHORT_CHARS,
    getQuadrantShortChar,
    renderQuadrantRibbon,
    renderQuadrantFlag,
    getCompletedTimeValue,
    sortCompletedDesc,
    renderKanbanStepCard,
    renderKanbanBoard,
    renderWorkspace,
    renderWorkspaceShell,
  };
});
