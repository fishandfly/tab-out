(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TabOutAI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CONFIG_STORAGE_KEY = 'tab-out-ai-config-v1';
  const HISTORY_STORAGE_KEY = 'tab-out-ai-messages-v1';
  const MAX_HISTORY_MESSAGES = 80;
  const DEFAULT_CONFIG = {
    provider: 'openai-compatible',
    baseUrl: '',
    apiKey: '',
    model: '',
  };
  const QUADRANT_FALLBACK = 'importantNotUrgent';
  const VALID_QUADRANTS = new Set([
    'importantUrgent',
    'importantNotUrgent',
    'urgentNotImportant',
    'notImportantNotUrgent',
  ]);
  const QUADRANT_ALIASES = [
    { key: 'notImportantNotUrgent', patterns: ['不重要不紧急', '不紧急不重要', 'not important not urgent', 'later'] },
    { key: 'importantUrgent', patterns: ['重要且紧急', '重要紧急', '紧急重要', 'important urgent', 'urgent important'] },
    { key: 'importantNotUrgent', patterns: ['重要不紧急', '重要但不紧急', 'important not urgent', 'important'] },
    { key: 'urgentNotImportant', patterns: ['紧急不重要', '紧急但不重要', 'urgent not important', 'urgent'] },
  ];

  let runtime = null;
  let state = {
    open: false,
    mode: 'chat',
    busy: false,
    config: { ...DEFAULT_CONFIG },
    messages: [],
    attachments: [],
  };

  function normalizeMessage(message) {
    const role = message?.role === 'user' ? 'user' : 'assistant';
    const content = String(message?.content || '').trim();
    if (!content) return null;
    return {
      role,
      content,
      createdAt: typeof message?.createdAt === 'string' && message.createdAt ? message.createdAt : new Date().toISOString(),
    };
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeNewlines(value) {
    return typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : '';
  }

  function stripCodeFence(text) {
    const source = normalizeNewlines(text).trim();
    const match = source.match(/^```(?:json|javascript|js)?\s*([\s\S]*?)\s*```$/i);
    return match ? match[1].trim() : source;
  }

  function normalizeQuadrant(value) {
    const raw = String(value || '').trim();
    if (VALID_QUADRANTS.has(raw)) return raw;
    const lowered = raw.toLowerCase();
    const hit = QUADRANT_ALIASES.find((item) => item.patterns.some((pattern) => lowered.includes(pattern.toLowerCase())));
    return hit ? hit.key : QUADRANT_FALLBACK;
  }

  function normalizeChecklist(items, level = 0) {
    if (!Array.isArray(items)) return [];
    const result = [];
    for (const item of items) {
      if (typeof item === 'string') {
        const text = item.trim();
        if (text) result.push({ text, completed: false, level });
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const text = String(item.text || item.title || item.content || '').trim();
      if (text) {
        result.push({
          text,
          completed: Boolean(item.completed || item.done),
          level: Math.max(0, Math.min(6, Number.isFinite(Number(item.level)) ? Number(item.level) : level)),
        });
      }
      const children = item.children || item.steps || item.checklist || item.items;
      result.push(...normalizeChecklist(children, Math.min(6, level + 1)));
    }
    return result;
  }

  function normalizePlanTask(task, fallbackQuadrant = QUADRANT_FALLBACK) {
    if (typeof task === 'string') {
      const title = task.trim();
      if (!title) return null;
      return { title, quadrant: fallbackQuadrant, completed: false, checklist: [] };
    }
    if (!task || typeof task !== 'object') return null;

    const title = String(task.title || task.name || task.task || task.content || '').trim();
    if (!title) return null;

    return {
      title,
      quadrant: normalizeQuadrant(task.quadrant || task.category || task.section || fallbackQuadrant),
      completed: Boolean(task.completed || task.done),
      checklist: normalizeChecklist(task.checklist || task.steps || task.items || []),
    };
  }

  function pickPlanPayload(value, scope) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return { tasks: value };
    if (Array.isArray(value.tasks)) return value;
    if (value.plan && typeof value.plan === 'object') return pickPlanPayload(value.plan, scope);
    if (scope && value[scope]) return pickPlanPayload(value[scope], scope);
    if (value.day) return pickPlanPayload(value.day, scope);
    if (value.week) return pickPlanPayload(value.week, scope);
    if (value.month) return pickPlanPayload(value.month, scope);
    return value;
  }

  function normalizeAiPlan(value, options = {}) {
    const scope = options.scope === 'week' || options.scope === 'month' ? options.scope : 'day';
    const payload = pickPlanPayload(value, scope);
    const taskSources = Array.isArray(payload?.tasks)
      ? payload.tasks
      : Array.isArray(payload?.items)
        ? payload.items
        : [];
    const tasks = [];

    for (const task of taskSources) {
      const normalized = normalizePlanTask(task, normalizeQuadrant(payload?.quadrant || payload?.section || QUADRANT_FALLBACK));
      if (normalized) tasks.push(normalized);
    }

    return {
      scope,
      title: String(payload?.title || value?.title || '').trim(),
      tasks,
    };
  }

  function parseMarkdownPlan(text, options = {}) {
    const source = normalizeNewlines(text);
    const scope = options.scope === 'week' || options.scope === 'month' ? options.scope : 'day';
    const tasks = [];
    let currentQuadrant = QUADRANT_FALLBACK;
    let currentTask = null;

    for (const rawLine of source.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;

      const bulletMatch = rawLine.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s*)?(.+)$/);

      // Check if this line is just a quadrant name (possibly with decorations like **, #, or colons)
      const cleanLine = line.replace(/[*#_\s：:]/g, '');
      const matchedQuadrant = QUADRANT_ALIASES.find((item) =>
        item.patterns.some((pattern) => cleanLine === pattern || cleanLine.includes(pattern))
      );
      if (matchedQuadrant && !bulletMatch) {
        currentQuadrant = matchedQuadrant.key;
        currentTask = null;
        continue;
      }

      const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
      if (headingMatch) {
        const heading = headingMatch[1].replace(/[：:]\s*$/, '').trim();
        currentQuadrant = normalizeQuadrant(heading);
        currentTask = null;
        continue;
      }

      const colonSection = line.match(/^(.+?)[：:]$/);
      if (colonSection) {
        currentQuadrant = normalizeQuadrant(colonSection[1]);
        currentTask = null;
        continue;
      }

      if (!bulletMatch) continue;

      const indent = bulletMatch[1].replace(/\t/g, '  ').length;
      const completed = (bulletMatch[2] || '').toLowerCase() === 'x';
      const content = bulletMatch[3].trim();
      if (!content || content === '暂无任务') continue;

      if (indent === 0 || !currentTask) {
        currentTask = {
          title: content,
          quadrant: currentQuadrant,
          completed,
          checklist: [],
        };
        tasks.push(currentTask);
        continue;
      }

      currentTask.checklist.push({
        text: content,
        completed,
        level: Math.max(0, Math.min(6, Math.floor(indent / 2) - 1)),
      });
    }

    return { scope, title: '', tasks };
  }

  function parseInlineNumberedPlan(text, options = {}) {
    let body = normalizeNewlines(text).trim();
    const firstNumberedItem = body.match(/(?:^|[\s；;])\d+[.、)]\s+/);
    if (firstNumberedItem && firstNumberedItem.index > 0) {
      const prefix = body.slice(0, firstNumberedItem.index).trim();
      const rest = body.slice(firstNumberedItem.index).trimStart();
      const prefixLooksLikeInstruction = /写入|导入|录入|填入|添加|加入|保存|替换|覆盖|计划|gtd/i.test(prefix);
      const taskAfterInstruction = prefixLooksLikeInstruction
        ? prefix.split(/[：:]/).pop().trim()
        : prefix;
      body = taskAfterInstruction ? `- ${taskAfterInstruction}\n${rest}` : rest;
    }

    const source = body
      .replace(/([；;])\s*(?=\d+[.、)])\s*/g, '\n')
      .replace(/\s+(?=\d+[.、)]\s+)/g, '\n');
    return parseMarkdownPlan(source, options);
  }

  function preprocessChineseNumbering(text) {
    let result = String(text || '');

    // 1. Replace "一是", "二是" ... "十是"
    const chineseIsPatterns = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    chineseIsPatterns.forEach((char, index) => {
      const regex = new RegExp(`(?:^|[\\s；;，,])(?:${char}是|第${char}|${char}、)\\s*`, 'g');
      result = result.replace(regex, `\n- `);
    });

    // 2. Replace circled numbers ① to ⑩
    const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
    circledNumbers.forEach((char) => {
      const regex = new RegExp(`(?:^|[\\s；;，,])\\s*${char}\\s*`, 'g');
      result = result.replace(regex, `\n- `);
    });

    // 3. Replace number followed by ideographic comma (1、, 2、) or dot without space
    result = result.replace(/(?:^|[\s；;，,])\s*(\d+)[、.)]\s*/g, '\n- ');

    let trimmed = result.trim();
    if (trimmed.includes('\n- ') && !trimmed.startsWith('-')) {
      trimmed = `- ${trimmed}`;
    }
    return trimmed;
  }

  function parsePlanText(text, options = {}) {
    const source = stripCodeFence(text);
    if (!source) return { scope: options.scope || 'day', title: '', tasks: [] };

    try {
      return normalizeAiPlan(JSON.parse(source), options);
    } catch {
      const markdownPlan = parseMarkdownPlan(source, options);
      if (markdownPlan.tasks.length) return markdownPlan;

      const preprocessed = preprocessChineseNumbering(source);
      const preprocessedPlan = parseMarkdownPlan(preprocessed, options);
      if (preprocessedPlan.tasks.length) return preprocessedPlan;

      return parseInlineNumberedPlan(source, options);
    }
  }

  function detectPlanIntent(text, options = {}) {
    const source = String(text || '').trim();
    if (!source) return null;
    const hasWriteVerb = /写入|导入|录入|填入|添加|加入|保存|替换|覆盖|重写|生成.*计划|更新|修改|设置|重置|安排|规划|设计|新建|import|add|save|replace|overwrite|update|set|modify|reset/.test(source);
    const hasPlanWord = /计划|gtd|任务|清单|日程|待办|时间表|plan|tasks?|todo|list|schedule/.test(source);
    if (!hasWriteVerb || !hasPlanWord) return null;

    let scope = options.defaultScope === 'week' || options.defaultScope === 'month' ? options.defaultScope : 'day';
    if (/周计划|本周|week|weekly|第\s*w?\d+\s*周/i.test(source)) scope = 'week';
    if (/月计划|本月|month|monthly|\d+\s*月/i.test(source)) scope = 'month';
    if (/日计划|今日|今天|明天|day|daily/i.test(source)) scope = 'day';

    const mode = /替换|覆盖|重写|清空后|更新|重置|设置|规划.*为|replace|overwrite|reset/.test(source) && !/添加|加入|追加|add|append/.test(source) ? 'replace' : 'append';
    return { scope, mode };
  }

  function createBoardFromPlan(plan, options = {}) {
    const gtd = options.gtd || (typeof window !== 'undefined' ? window.TabOutGTD : null);
    if (!gtd?.normalizeBoard) {
      throw new Error('GTD 模块未加载');
    }

    const existing = options.existingBoard || null;
    const boardKey = options.boardKey || existing?.date || gtd.getBoardDate?.() || '';
    const mode = options.mode === 'replace' ? 'replace' : 'append';
    const importedTasks = (plan?.tasks || [])
      .map((task) => normalizePlanTask(task))
      .filter(Boolean);
    const tasks = mode === 'append' && Array.isArray(existing?.tasks)
      ? [...existing.tasks, ...importedTasks]
      : importedTasks;

    const normalized = gtd.normalizeBoard({
      date: boardKey,
      tasks,
      selectedTaskId: mode === 'append' ? (existing?.selectedTaskId || '') : '',
      updatedAt: new Date().toISOString(),
    }, boardKey);

    if (!normalized.selectedTaskId && normalized.tasks[0]) {
      normalized.selectedTaskId = normalized.tasks[0].id;
    }

    return normalized;
  }

  function getStorage() {
    if (runtime?.storage) return runtime.storage;
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) return chrome.storage.local;
    return null;
  }

  async function storageGet(keys) {
    const storage = getStorage();
    if (!storage) return {};
    return storage.get(keys);
  }

  async function storageSet(payload) {
    const storage = getStorage();
    if (!storage) return;
    await storage.set(payload);
  }

  async function loadConfig() {
    const payload = await storageGet(CONFIG_STORAGE_KEY);
    const saved = payload?.[CONFIG_STORAGE_KEY] || {};
    state.config = {
      ...DEFAULT_CONFIG,
      ...saved,
      provider: saved.provider || DEFAULT_CONFIG.provider,
    };
    return state.config;
  }

  async function loadHistory() {
    const payload = await storageGet(HISTORY_STORAGE_KEY);
    const saved = payload?.[HISTORY_STORAGE_KEY];
    state.messages = Array.isArray(saved)
      ? saved.map(normalizeMessage).filter(Boolean).slice(-MAX_HISTORY_MESSAGES)
      : [];
    return state.messages;
  }

  async function saveHistory() {
    const messages = state.messages.map(normalizeMessage).filter(Boolean).slice(-MAX_HISTORY_MESSAGES);
    state.messages = messages;
    await storageSet({ [HISTORY_STORAGE_KEY]: messages });
    return messages;
  }

  async function addMessage(role, content) {
    const message = normalizeMessage({ role, content });
    if (!message) return null;
    state.messages.push(message);
    await saveHistory();
    return message;
  }

  async function saveConfig(config) {
    state.config = {
      ...DEFAULT_CONFIG,
      ...config,
      baseUrl: String(config.baseUrl || '').trim(),
      apiKey: String(config.apiKey || '').trim(),
      model: String(config.model || '').trim(),
    };
    await storageSet({ [CONFIG_STORAGE_KEY]: state.config });
    return state.config;
  }

  function extractTextFromTiptap(node, bucket = []) {
    if (!node || typeof node !== 'object') return bucket;
    if (node.type === 'text' && node.text) bucket.push(node.text);
    if (Array.isArray(node.content)) {
      for (const child of node.content) extractTextFromTiptap(child, bucket);
    }
    return bucket;
  }

  function summarizeBoard(board, label) {
    const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
    const done = tasks.filter((task) => task.completed).length;
    const steps = tasks.flatMap((task) => Array.isArray(task.checklist) ? task.checklist : []);
    const stepDone = steps.filter((step) => step.completed).length;
    return {
      label,
      date: board?.date || '',
      tasks: tasks.length,
      completedTasks: done,
      steps: steps.length,
      completedSteps: stepDone,
      openTaskTitles: tasks.filter((task) => !task.completed).slice(0, 12).map((task) => task.title),
    };
  }

  async function buildTapOutContext() {
    const gtd = typeof window !== 'undefined' ? window.TabOutGTD : null;
    const keys = [
      'gtdBoards',
      'tab-out-memos-v1',
      'deferred',
      'tab-out-notes-global-v1',
      'tab-out-whiteboard-global-v1',
      'tab-out-structureboard-global-v1',
    ];
    const payload = await storageGet(keys);
    const boards = payload.gtdBoards && typeof payload.gtdBoards === 'object' ? payload.gtdBoards : {};
    const scopeMeta = gtd?.getBoardScope ? gtd.getBoardScope(new Date()) : {};
    const todayKey = scopeMeta.day?.key || '';
    const weekKey = scopeMeta.week?.key || '';
    const monthKey = scopeMeta.month?.key || '';
    const boardEntries = Object.entries(boards).sort((a, b) => b[0].localeCompare(a[0]));
    const memos = Array.isArray(payload['tab-out-memos-v1']) ? payload['tab-out-memos-v1'] : [];
    const deferred = Array.isArray(payload.deferred) ? payload.deferred.filter((item) => !item.dismissed) : [];
    const notes = payload['tab-out-notes-global-v1'] || {};
    const whiteboard = payload['tab-out-whiteboard-global-v1'] || {};
    const structureboard = payload['tab-out-structureboard-global-v1'] || {};
    const openTabs = typeof chrome !== 'undefined' && chrome?.tabs?.query
      ? await chrome.tabs.query({}).catch(() => [])
      : [];

    return {
      generatedAt: new Date().toISOString(),
      app: 'TapOut / Tab Out Chrome new-tab workspace',
      gtd: {
        today: summarizeBoard(boards[todayKey], '今日'),
        week: summarizeBoard(boards[weekKey], '本周'),
        month: summarizeBoard(boards[monthKey], '本月'),
        recentBoards: boardEntries.slice(0, 20).map(([key, board]) => summarizeBoard(board, key)),
      },
      memos: memos.slice(0, 40).map((memo) => ({
        content: memo.content,
        tags: memo.tags || [],
        createdAt: memo.createdAt,
      })),
      deferredTabs: deferred.slice(0, 30).map((tab) => ({
        title: tab.title,
        url: tab.url,
        completed: Boolean(tab.completed),
      })),
      notes: {
        title: notes.title || '',
        updatedAt: notes.updatedAt || '',
        excerpt: extractTextFromTiptap(notes.content).join('\n').slice(0, 4000),
      },
      whiteboard: {
        title: whiteboard.title || '',
        updatedAt: whiteboard.updatedAt || '',
        elements: Array.isArray(whiteboard.elements) ? whiteboard.elements.length : 0,
      },
      structureboard: {
        title: structureboard.title || '',
        updatedAt: structureboard.updatedAt || '',
        hasXml: Boolean(structureboard.xml || structureboard.content),
      },
      openTabs: openTabs.slice(0, 80).map((tab) => ({ title: tab.title, url: tab.url })),
    };
  }

  function getChatEndpoint(config) {
    const base = String(config.baseUrl || '').trim().replace(/\/+$/, '');
    if (!base) return '';
    if (/\/chat\/completions$/i.test(base)) return base;
    return `${base}/chat/completions`;
  }

  function buildMessagesForRequest(context, userText) {
    const system = [
      '你是 TapOut 新标签页工作台内的 AI 助手。',
      '你具有直接更新和规划用户 GTD 看板（包括今日计划、本周计划、本月计划）的强大能力。',
      '如果你认为用户的言语指示中包含更新/规划日计划、周计划、月计划的意图，请务必在你的回复中输出一个格式清晰的四象限任务列表，以便系统能够自动识别并为你自动录入。',
      '四象限的标准称呼是：「重要且紧急」、「重要不紧急」、「紧急不重要」、「不重要不紧急」。',
      '你可以通过 Markdown 格式列出任务，例如：',
      '### 重要且紧急',
      '- [ ] 任务1',
      '  - [ ] 子步骤1.1',
      '### 重要不紧急',
      '- [ ] 任务2',
      '回答要简洁、直接、以中文为主。如果用户询问完成情况，请根据提供的上下文计算，不要编造不存在的数据。',
    ].join('\n');

    const content = [
      { type: 'text', text: userText },
      { type: 'text', text: `TapOut 当前上下文 JSON：\n${JSON.stringify(context, null, 2)}` },
    ];

    for (const item of state.attachments) {
      if (item.dataUrl) {
        content.push({ type: 'image_url', image_url: { url: item.dataUrl } });
      }
    }

    return [
      { role: 'system', content: system },
      ...state.messages.slice(-8).map((message) => ({ role: message.role, content: message.content })),
      { role: 'user', content },
    ];
  }

  async function callChatModel(userText) {
    const config = state.config;
    const endpoint = getChatEndpoint(config);
    if (!endpoint || !config.apiKey || !config.model) {
      throw new Error('请先完成模型配置');
    }

    const context = await buildTapOutContext();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: buildMessagesForRequest(context, userText),
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`模型请求失败：${response.status}${text ? ` ${text.slice(0, 160)}` : ''}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('模型没有返回内容');
    return content;
  }

  function getRoot() {
    return typeof document !== 'undefined' ? document.getElementById('aiAssistantRoot') : null;
  }

  function renderMessage(message) {
    return `
      <div class="ai-message ai-message-${escapeHtml(message.role)}">
        <div class="ai-message-role">${message.role === 'user' ? '我' : 'AI'}</div>
        <div class="ai-message-body">${escapeHtml(message.content).replace(/\n/g, '<br>')}</div>
      </div>
    `;
  }

  function renderAssistant() {
    const rootEl = getRoot();
    if (!rootEl) return;

    if (typeof document !== 'undefined') {
      if (state.open) {
        document.body.classList.add('ai-sidebar-open');
      } else {
        document.body.classList.remove('ai-sidebar-open');
      }
    }

    const cfg = state.config;
    rootEl.innerHTML = `
      <button class="ai-fab${state.open ? ' is-active' : ''}" type="button" data-ai-action="toggle" aria-label="打开 AI 助手" title="AI 助手">
        <span class="ai-fab-mark">AI</span>
      </button>
      <section class="ai-panel${state.open ? ' is-open' : ''}" aria-label="AI 助手对话框">
        <div class="ai-panel-header">
          <div>
            <div class="ai-panel-kicker">TapOut Agent</div>
            <h2>AI 助手</h2>
          </div>
          <div class="ai-panel-tools">
            <button class="ai-tool-btn" type="button" data-ai-action="clear-history">新建</button>
            <button class="ai-icon-btn" type="button" data-ai-action="toggle" aria-label="关闭 AI 助手">×</button>
          </div>
        </div>
        <div class="ai-modebar">
          <button class="ai-mode-btn${state.mode === 'chat' ? ' is-active' : ''}" type="button" data-ai-action="switch-mode" data-ai-mode="chat">对话</button>
          <button class="ai-mode-btn${state.mode === 'import' ? ' is-active' : ''}" type="button" data-ai-action="switch-mode" data-ai-mode="import">导入计划</button>
          <button class="ai-mode-btn${state.mode === 'settings' ? ' is-active' : ''}" type="button" data-ai-action="switch-mode" data-ai-mode="settings">模型</button>
        </div>
        <div class="ai-panel-body">
          ${state.mode === 'chat' ? `
            <div class="ai-context-strip">
              <span>已接入 GTD、微笔记、标签页、笔记、白板与结构图摘要</span>
            </div>
            ${state.attachments.length ? `
              <div class="ai-attachment-row">
                ${state.attachments.map((item, index) => `
                  <button class="ai-attachment" type="button" data-ai-action="remove-image" data-ai-index="${index}" title="移除图片">
                    <img src="${escapeHtml(item.dataUrl)}" alt="">
                    <span>${escapeHtml(item.name)}</span>
                  </button>
                `).join('')}
              </div>
            ` : ''}
            <div class="ai-message-list" id="aiMessageList">
              ${state.messages.length ? state.messages.map(renderMessage).join('') : `
                <div class="ai-empty-state">
                  你可以问我今日/本周完成情况，也可以让我根据 TapOut 内的记录帮你梳理下一步。
                </div>
              `}
            </div>
            <form class="ai-compose" data-ai-form="chat">
              <div class="ai-compose-input-wrapper">
                <label class="ai-upload-btn" title="上传图片">
                  <svg class="ai-icon-upload" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                    <polyline points="21 15 16 10 5 21"></polyline>
                  </svg>
                  <input type="file" accept="image/*" multiple data-ai-action="upload-images" style="display: none;">
                </label>
                <textarea name="message" placeholder="输入问题..." ${state.busy ? 'disabled' : ''}></textarea>
                <button type="submit" class="ai-send-btn" ${state.busy ? 'disabled' : ''} title="发送">
                  <svg class="ai-icon-send" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                  </svg>
                </button>
              </div>
            </form>
          ` : ''}
          ${state.mode === 'import' ? `
            <form class="ai-import-form" data-ai-form="import-plan">
              <div class="ai-form-row">
                <label>写入范围
                  <select name="scope">
                    <option value="day">今日计划</option>
                    <option value="week">本周计划</option>
                    <option value="month">本月计划</option>
                  </select>
                </label>
                <label>写入方式
                  <select name="mode">
                    <option value="append">追加</option>
                    <option value="replace">替换</option>
                  </select>
                </label>
              </div>
              <textarea name="planText" rows="12" placeholder="粘贴其他 AI 生成的计划。支持 JSON，也支持按四象限标题组织的 Markdown 列表。"></textarea>
              <button type="submit">解析并写入 GTD</button>
            </form>
          ` : ''}
          ${state.mode === 'settings' ? `
            <form class="ai-settings-form" data-ai-form="settings">
              <label>供应商
                <select name="provider">
                  <option value="openai-compatible" ${cfg.provider === 'openai-compatible' ? 'selected' : ''}>OpenAI Compatible</option>
                  <option value="openai" ${cfg.provider === 'openai' ? 'selected' : ''}>OpenAI</option>
                  <option value="deepseek" ${cfg.provider === 'deepseek' ? 'selected' : ''}>DeepSeek</option>
                  <option value="custom" ${cfg.provider === 'custom' ? 'selected' : ''}>自定义</option>
                </select>
              </label>
              <label>URL
                <input name="baseUrl" value="${escapeHtml(cfg.baseUrl)}" placeholder="https://api.openai.com/v1">
              </label>
              <label>API Key
                <input name="apiKey" type="password" value="${escapeHtml(cfg.apiKey)}" placeholder="sk-...">
              </label>
              <label>模型
                <input name="model" value="${escapeHtml(cfg.model)}" placeholder="gpt-4.1-mini / deepseek-chat">
              </label>
              <button type="submit">保存配置</button>
            </form>
          ` : ''}
        </div>
      </section>
    `;

    const messageList = typeof document !== 'undefined' ? document.getElementById('aiMessageList') : null;
    if (messageList) messageList.scrollTop = messageList.scrollHeight;
  }

  async function applyPlanToGtd(planText, options = {}) {
    const gtd = typeof window !== 'undefined' ? window.TabOutGTD : null;
    if (!gtd?.getBoardScope || !gtd?.getScopeBoard || !gtd?.saveScopeBoard) {
      throw new Error('GTD 模块未加载');
    }

    const plan = parsePlanText(planText, { scope: options.scope });
    if (!plan.tasks.length) throw new Error('没有识别到可写入的任务');

    const scopeMeta = gtd.getBoardScope(new Date());
    const requestedScope = options.scope === 'week' || options.scope === 'month' ? options.scope : plan.scope;
    const targetScope = requestedScope === 'week' || requestedScope === 'month' ? requestedScope : 'day';
    const scopeInfo = scopeMeta[targetScope] || scopeMeta.day;
    const storage = getStorage();
    const existingBoard = await gtd.getScopeBoard(storage, scopeInfo.key);
    const board = createBoardFromPlan(plan, {
      gtd,
      existingBoard,
      boardKey: scopeInfo.key,
      mode: options.mode,
    });
    await gtd.saveScopeBoard(storage, board);
    await runtime?.refreshGtd?.();
    return { plan: { ...plan, scope: targetScope }, board, scopeInfo };
  }

  async function applyPlanFromConversation(userText, assistantText, intent) {
    const scope = intent?.scope || 'day';
    const mode = intent?.mode || 'append';
    const userPlan = parsePlanText(userText, { scope });
    const sourceText = userPlan.tasks.length ? userText : assistantText;
    const result = await applyPlanToGtd(sourceText, { scope, mode });
    const scopeLabel = result.plan.scope === 'week' ? '本周' : result.plan.scope === 'month' ? '本月' : '今日';
    return {
      ...result,
      message: `已把 ${result.plan.tasks.length} 个任务写入${scopeLabel} GTD（${result.scopeInfo?.label || result.board.date}）。`,
    };
  }

  async function readImageFiles(files) {
    const selected = Array.from(files || []).filter((file) => file.type.startsWith('image/')).slice(0, 4);
    const readers = selected.map((file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, dataUrl: String(reader.result || '') });
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    }));
    return Promise.all(readers);
  }

  function bindAssistantEvents(rootEl) {
    // 监听输入框变化，自适应动态调整高度，最大高度被 CSS 限制在 4 行
    rootEl.addEventListener('input', (event) => {
      const textarea = event.target.closest('.ai-compose textarea');
      if (!textarea) return;
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    });

    // 监听按键事件，支持 Enter 直接发送，Shift+Enter 正常换行
    rootEl.addEventListener('keydown', (event) => {
      const textarea = event.target.closest('.ai-compose textarea');
      if (!textarea) return;
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const form = textarea.closest('form');
        if (form) {
          const submitEvent = new Event('submit', { cancelable: true, bubbles: true });
          form.dispatchEvent(submitEvent);
        }
      }
    });

    rootEl.addEventListener('click', async (event) => {
      const actionEl = event.target.closest('[data-ai-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.aiAction;

      if (action === 'toggle') {
        state.open = !state.open;
        renderAssistant();
        return;
      }

      if (action === 'switch-mode') {
        state.mode = actionEl.dataset.aiMode || 'chat';
        renderAssistant();
        return;
      }

      if (action === 'remove-image') {
        const index = Number(actionEl.dataset.aiIndex);
        if (Number.isInteger(index)) state.attachments.splice(index, 1);
        renderAssistant();
        return;
      }

      if (action === 'clear-history') {
        if (confirm('确定要清空当前的 AI 对话历史，开启一个全新的会话吗？')) {
          state.messages = [];
          await saveHistory();
          renderAssistant();
          runtime?.showToast?.('已新建 AI 会话');
        }
      }
    });

    rootEl.addEventListener('change', async (event) => {
      const input = event.target.closest('[data-ai-action="upload-images"]');
      if (!input) return;
      try {
        const images = await readImageFiles(input.files);
        state.attachments = [...state.attachments, ...images].slice(0, 4);
        renderAssistant();
      } catch (err) {
        runtime?.showToast?.(err?.message || '图片读取失败');
      }
    });

    rootEl.addEventListener('submit', async (event) => {
      const form = event.target.closest('form[data-ai-form]');
      if (!form) return;
      event.preventDefault();

      const formType = form.dataset.aiForm;
      const data = new FormData(form);

      try {
        if (formType === 'settings') {
          await saveConfig({
            provider: data.get('provider'),
            baseUrl: data.get('baseUrl'),
            apiKey: data.get('apiKey'),
            model: data.get('model'),
          });
          runtime?.showToast?.('AI 模型配置已保存');
          renderAssistant();
          return;
        }

        if (formType === 'import-plan') {
          const result = await applyPlanToGtd(String(data.get('planText') || ''), {
            scope: String(data.get('scope') || 'day'),
            mode: String(data.get('mode') || 'append'),
          });
          runtime?.showToast?.(`已写入 ${result.plan.tasks.length} 个任务`);
          state.mode = 'chat';
          await addMessage('assistant', `已把 ${result.plan.tasks.length} 个任务写入${result.plan.scope === 'week' ? '本周' : result.plan.scope === 'month' ? '本月' : '今日'} GTD。`);
          renderAssistant();
          return;
        }

        if (formType === 'chat') {
          const message = String(data.get('message') || '').trim();
          if (!message) return;
          await addMessage('user', message);
          state.busy = true;
          renderAssistant();
          const intent = detectPlanIntent(message, {
            defaultScope: runtime?.getActiveScope?.(),
          });
          const directPlan = intent ? parsePlanText(message, { scope: intent.scope }) : null;
          if (intent && directPlan?.tasks?.length) {
            const result = await applyPlanFromConversation(message, '', intent);
            await addMessage('assistant', result.message);
            runtime?.showToast?.(`已写入 ${result.plan.tasks.length} 个任务`);
            state.busy = false;
            renderAssistant();
            return;
          }

          const answer = await callChatModel(message);
          if (intent) {
            try {
              const result = await applyPlanFromConversation(message, answer, intent);
              await addMessage('assistant', `${answer}\n\n${result.message}`);
              runtime?.showToast?.(`已写入 ${result.plan.tasks.length} 个任务`);
              state.busy = false;
              renderAssistant();
              return;
            } catch (err) {
              await addMessage('assistant', `${answer}\n\n我理解你想写入计划，但没有识别到可落库的任务。可以切到「导入计划」粘贴 JSON 或 Markdown，或让模型输出明确的任务列表。`);
              state.busy = false;
              renderAssistant();
              return;
            }
          }

          await addMessage('assistant', answer);
          state.busy = false;
          renderAssistant();
        }
      } catch (err) {
        state.busy = false;
        runtime?.showToast?.(err?.message || 'AI 助手处理失败');
        renderAssistant();
      }
    });
  }

  async function init(options = {}) {
    runtime = {
      storage: options.storage || null,
      refreshGtd: options.refreshGtd || null,
      getActiveScope: options.getActiveScope || null,
      showToast: options.showToast || null,
    };

    const rootEl = getRoot();
    if (!rootEl || rootEl.dataset.aiBound === 'true') return;
    rootEl.dataset.aiBound = 'true';
    await loadConfig();
    await loadHistory();
    bindAssistantEvents(rootEl);
    renderAssistant();
  }

  return {
    CONFIG_STORAGE_KEY,
    HISTORY_STORAGE_KEY,
    DEFAULT_CONFIG,
    normalizeQuadrant,
    normalizeAiPlan,
    parsePlanText,
    preprocessChineseNumbering,
    detectPlanIntent,
    createBoardFromPlan,
    buildTapOutContext,
    getChatEndpoint,
    init,
  };
});
