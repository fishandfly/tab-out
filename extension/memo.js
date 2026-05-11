(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TabOutMemo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'tab-out-memos-v1';

  function nowIso() {
    return new Date().toISOString();
  }

  function createId() {
    return `memo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function extractTags(content) {
    const tags = [];
    const regex = /#([^\s#]+)/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const tag = match[1].trim();
      if (tag) tags.push(tag);
    }
    return [...new Set(tags)];
  }

  function normalizeMemo(raw) {
    return {
      id: typeof raw?.id === 'string' && raw.id ? raw.id : createId(),
      content: typeof raw?.content === 'string' ? raw.content.trim() : '',
      tags: Array.isArray(raw?.tags) ? raw.tags : extractTags(raw?.content || ''),
      createdAt: raw?.createdAt || nowIso(),
      updatedAt: raw?.updatedAt || nowIso(),
    };
  }

  function getAllTags(memos) {
    const tagSet = new Set();
    for (const memo of memos) {
      for (const tag of memo.tags) {
        tagSet.add(tag);
      }
    }
    return [...tagSet].sort((a, b) => a.localeCompare(b));
  }

  function getTagTree(tags) {
    const tree = {};
    for (const tag of tags) {
      const parts = tag.split('/');
      let current = tree;
      for (let i = 0; i < parts.length; i++) {
        const key = parts.slice(0, i + 1).join('/');
        if (!current[key]) current[key] = {};
        current = current[key];
      }
    }
    return tree;
  }

  async function getMemos(storage) {
    const result = await storage.get(STORAGE_KEY);
    const raw = result && typeof result === 'object' && result[STORAGE_KEY];
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeMemo).filter((m) => m.content).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async function saveMemos(storage, memos) {
    await storage.set({ [STORAGE_KEY]: memos });
  }

  async function addMemo(storage, content) {
    const cleaned = typeof content === 'string' ? content.trim() : '';
    if (!cleaned) return null;

    const memo = normalizeMemo({ content: cleaned, tags: extractTags(cleaned) });
    const all = await getMemos(storage);
    all.unshift(memo);
    await saveMemos(storage, all.map(normalizeMemo));
    return memo;
  }

  async function deleteMemo(storage, memoId) {
    const all = await getMemos(storage);
    const filtered = all.filter((m) => m.id !== memoId);
    await saveMemos(storage, filtered);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function relativeTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins} 分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} 天前`;
    return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  }

  function renderMemoContent(content) {
    return escapeHtml(content).replace(/#([^\s#]+)/g, (_, tag) => {
      return `<a class="memo-tag-link" href="#" data-memo-action="filter-tag" data-memo-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</a>`;
    });
  }

  function getMonthlyStats(memos) {
    const stats = {};
    for (const memo of memos) {
      const key = memo.createdAt ? memo.createdAt.slice(0, 7) : '';
      if (key) stats[key] = (stats[key] || 0) + 1;
    }
    return Object.entries(stats)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, count]) => ({ month, count }));
  }

  function renderMonthlyStats(monthlyStats) {
    if (!monthlyStats.length) return '';
    return `
      <div class="memo-monthly-stats">
        ${monthlyStats.map(({ month, count }) => `
          <div class="memo-stat-row">
            <span class="memo-stat-month">${escapeHtml(month)}</span>
            <span class="memo-stat-count">${count}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderTagTree(tags, activeTag) {
    const tree = getTagTree(tags);
    const keys = Object.keys(tree);
    if (!keys.length) return '';

    const tagButtons = tags.map((tag) => `
      <button
        class="memo-tag-btn${activeTag === tag ? ' is-active' : ''}"
        type="button"
        data-memo-action="filter-tag"
        data-memo-tag="${escapeHtml(tag)}"
      >#${escapeHtml(tag)}</button>
    `).join('');

    return `
      <div class="memo-tags-panel">
        <button
          class="memo-tag-btn${!activeTag ? ' is-active' : ''}"
          type="button"
          data-memo-action="filter-tag"
          data-memo-tag=""
        >全部</button>
        ${tagButtons}
      </div>
    `;
  }

  function renderMemoPanel(memos, options = {}) {
    const activeTag = typeof options.activeTag === 'string' ? options.activeTag : '';
    const filtered = activeTag ? memos.filter((m) => m.tags.includes(activeTag)) : memos;
    const tags = getAllTags(memos);
    const monthlyStats = getMonthlyStats(memos);

    return `
      <div class="memo-shell">
        <div class="memo-sidebar">
          ${renderMonthlyStats(monthlyStats)}
          ${monthlyStats.length ? '<div class="memo-sidebar-sep"></div>' : ''}
          ${renderTagTree(tags, activeTag)}
        </div>
        <div class="memo-main">
          <form class="memo-input-form" data-memo-form="add-memo">
            <div class="memo-input-wrap">
              <textarea
                class="memo-input"
                name="content"
                placeholder="记录此刻的想法... 用 #标签 归类"
                rows="2"
                autocomplete="off"
              ></textarea>
              <button class="memo-send-btn" type="submit" aria-label="发送">发送</button>
            </div>
          </form>
          <div class="memo-timeline">
            ${filtered.length ? filtered.map((memo) => `
              <div class="memo-card" data-memo-id="${memo.id}">
                <div class="memo-card-content">${renderMemoContent(memo.content)}</div>
                <div class="memo-card-footer">
                  <span class="memo-card-time">${relativeTime(memo.createdAt)}</span>
                  <button
                    class="memo-card-delete"
                    type="button"
                    aria-label="删除"
                    data-memo-action="delete-memo"
                    data-memo-id="${memo.id}"
                  >×</button>
                </div>
              </div>
            `).join('') : `
              <div class="memo-empty">
                ${activeTag ? '该标签下还没有记录' : '还没有记录，开始记录想法吧'}
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  }

  return {
    STORAGE_KEY,
    getMemos,
    addMemo,
    deleteMemo,
    getAllTags,
    renderMemoPanel,
  };
});
