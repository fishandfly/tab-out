(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TabOutDeferredTabs = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'deferred';
  let _storage = null;

  function getStorage() {
    if (_storage) return _storage;
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      return chrome.storage.local;
    }
    return {
      async get(key) {
        try {
          const raw = localStorage.getItem('tabout_deferred_fallback');
          const parsed = raw ? JSON.parse(raw) : {};
          return { [key]: parsed[key] };
        } catch {
          return { [key]: [] };
        }
      },
      async set(payload) {
        try {
          const raw = localStorage.getItem('tabout_deferred_fallback');
          const parsed = raw ? JSON.parse(raw) : {};
          localStorage.setItem('tabout_deferred_fallback', JSON.stringify({ ...parsed, ...payload }));
        } catch {}
      },
    };
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const then = new Date(dateStr);
    const now = new Date();
    const diffMins = Math.floor((now - then) / 60000);
    const diffHours = Math.floor((now - then) / 3600000);
    const diffDays = Math.floor((now - then) / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hr${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays === 1) return 'yesterday';
    return `${diffDays} days ago`;
  }

  async function saveTabForLater(tab) {
    const storage = getStorage();
    const payload = await storage.get(STORAGE_KEY);
    const deferred = Array.isArray(payload?.[STORAGE_KEY]) ? payload[STORAGE_KEY] : [];
    deferred.push({
      id: Date.now().toString(),
      url: tab.url,
      title: tab.title,
      savedAt: new Date().toISOString(),
      completed: false,
      dismissed: false,
    });
    await storage.set({ [STORAGE_KEY]: deferred });
  }

  async function getSavedTabs() {
    const storage = getStorage();
    const payload = await storage.get(STORAGE_KEY);
    const deferred = Array.isArray(payload?.[STORAGE_KEY]) ? payload[STORAGE_KEY] : [];
    const visible = deferred.filter((t) => !t.dismissed);
    return {
      active: visible.filter((t) => !t.completed),
      archived: visible.filter((t) => t.completed),
    };
  }

  async function checkOffSavedTab(id) {
    const storage = getStorage();
    const payload = await storage.get(STORAGE_KEY);
    const deferred = Array.isArray(payload?.[STORAGE_KEY]) ? payload[STORAGE_KEY] : [];
    const tab = deferred.find((t) => t.id === id);
    if (tab) {
      tab.completed = true;
      tab.completedAt = new Date().toISOString();
      await storage.set({ [STORAGE_KEY]: deferred });
    }
  }

  async function dismissSavedTab(id) {
    const storage = getStorage();
    const payload = await storage.get(STORAGE_KEY);
    const deferred = Array.isArray(payload?.[STORAGE_KEY]) ? payload[STORAGE_KEY] : [];
    const tab = deferred.find((t) => t.id === id);
    if (tab) {
      tab.dismissed = true;
      await storage.set({ [STORAGE_KEY]: deferred });
    }
  }

  function renderDeferredItem(item) {
    let domain = '';
    try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
    const ago = timeAgo(item.savedAt);

    return `
      <div class="deferred-item" draggable="true" data-deferred-id="${item.id}" data-deferred-url="${(item.url || '').replace(/"/g, '&quot;')}" data-deferred-title="${(item.title || '').replace(/"/g, '&quot;')}">
        <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${item.id}">
        <div class="deferred-info">
          <a href="${item.url}" target="_blank" rel="noopener" class="deferred-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
            <img src="${faviconUrl}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px" data-hide-on-error="true">${item.title || item.url}
          </a>
          <div class="deferred-meta">
            <span>${domain}</span>
            <span>${ago}</span>
          </div>
        </div>
        <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${item.id}" title="Dismiss">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>`;
  }

  function renderArchiveItem(item) {
    const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
    return `
      <div class="archive-item">
        <a href="${item.url}" target="_blank" rel="noopener" class="archive-item-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
          ${item.title || item.url}
        </a>
        <span class="archive-item-date">${ago}</span>
      </div>`;
  }

  async function renderDeferredColumn() {
    if (typeof document === 'undefined') return;
    const column = document.getElementById('deferredColumn');
    const list = document.getElementById('deferredList');
    const empty = document.getElementById('deferredEmpty');
    const countEl = document.getElementById('deferredCount');
    const archiveEl = document.getElementById('deferredArchive');
    const archiveCountEl = document.getElementById('archiveCount');
    const archiveList = document.getElementById('archiveList');

    if (!column) return;

    try {
      const { active, archived } = await getSavedTabs();

      if (active.length === 0 && archived.length === 0) {
        column.style.display = 'none';
        return;
      }

      column.style.display = 'block';

      if (active.length > 0) {
        if (countEl) countEl.textContent = `${active.length} item${active.length !== 1 ? 's' : ''}`;
        if (list) {
          list.innerHTML = active.map((item) => renderDeferredItem(item)).join('');
          list.style.display = 'block';
        }
        if (empty) empty.style.display = 'none';
      } else {
        if (list) list.style.display = 'none';
        if (countEl) countEl.textContent = '';
        if (empty) empty.style.display = 'block';
      }

      if (archived.length > 0) {
        if (archiveCountEl) archiveCountEl.textContent = `(${archived.length})`;
        if (archiveList) archiveList.innerHTML = archived.map((item) => renderArchiveItem(item)).join('');
        if (archiveEl) archiveEl.style.display = 'block';
      } else {
        if (archiveEl) archiveEl.style.display = 'none';
      }
    } catch (err) {
      console.warn('[tab-out] Could not load saved tabs:', err);
      column.style.display = 'none';
    }
  }

  function init(options = {}) {
    if (options.storage) _storage = options.storage;
    return renderDeferredColumn();
  }

  return {
    STORAGE_KEY,
    timeAgo,
    saveTabForLater,
    getSavedTabs,
    checkOffSavedTab,
    dismissSavedTab,
    renderDeferredItem,
    renderArchiveItem,
    renderDeferredColumn,
    init,
  };
});
