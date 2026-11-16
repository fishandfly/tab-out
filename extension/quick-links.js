(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TabOutQuickLinks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const QUICK_LINKS_KEY = 'tab-out-quick-links-v1';
  const DEFAULT_PARTITION_ID = 'default';
  const DEFAULT_PARTITION_NAME = '常用';

  function createId(prefix = 'ql') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeQuickLinksState(raw) {
    if (!raw || typeof raw !== 'object') {
      return {
        partitions: [
          { id: DEFAULT_PARTITION_ID, name: DEFAULT_PARTITION_NAME, links: [] },
        ],
      };
    }

    let partitions = Array.isArray(raw.partitions) ? raw.partitions : [];
    if (partitions.length === 0) {
      partitions = [
        { id: DEFAULT_PARTITION_ID, name: DEFAULT_PARTITION_NAME, links: [] },
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
        id: DEFAULT_PARTITION_ID,
        name: DEFAULT_PARTITION_NAME,
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

  function _isStorage(obj) {
    return obj && typeof obj.get === 'function' && typeof obj.set === 'function';
  }

  function pureAddQuickLink(state, partitionId, linkData) {
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

  function addQuickLink(stateOrStorage, partitionId, linkData) {
    if (_isStorage(stateOrStorage)) {
      return (async () => {
        const state = await getQuickLinks(stateOrStorage);
        const next = pureAddQuickLink(state, partitionId, linkData);
        await saveQuickLinks(stateOrStorage, next);
        return next;
      })();
    }
    return pureAddQuickLink(stateOrStorage, partitionId, linkData);
  }

  function pureRemoveQuickLink(state, partitionId, linkId) {
    const next = normalizeQuickLinksState(state);
    const targetLinkId = linkId || (typeof partitionId === 'string' && !linkId ? partitionId : '');
    const targetPartId = linkId ? partitionId : '';
    if (!targetLinkId) return next;

    for (const part of next.partitions) {
      if (!targetPartId || part.id === targetPartId) {
        part.links = part.links.filter((l) => l.id !== targetLinkId);
      }
    }
    return next;
  }

  function removeQuickLink(stateOrStorage, partitionId, linkId) {
    if (_isStorage(stateOrStorage)) {
      return (async () => {
        const state = await getQuickLinks(stateOrStorage);
        const next = pureRemoveQuickLink(state, partitionId, linkId);
        await saveQuickLinks(stateOrStorage, next);
        return next;
      })();
    }
    return pureRemoveQuickLink(stateOrStorage, partitionId, linkId);
  }

  function pureMoveQuickLink(state, linkId, targetPartitionId, targetIndex = -1) {
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

  function moveQuickLink(stateOrStorage, linkId, targetPartitionId, targetIndex = -1) {
    if (_isStorage(stateOrStorage)) {
      return (async () => {
        const state = await getQuickLinks(stateOrStorage);
        const next = pureMoveQuickLink(state, linkId, targetPartitionId, targetIndex);
        await saveQuickLinks(stateOrStorage, next);
        return next;
      })();
    }
    return pureMoveQuickLink(stateOrStorage, linkId, targetPartitionId, targetIndex);
  }

  function pureAddQuickLinksPartition(state, name) {
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

  function addQuickLinksPartition(stateOrStorage, name) {
    if (_isStorage(stateOrStorage)) {
      return (async () => {
        const state = await getQuickLinks(stateOrStorage);
        const next = pureAddQuickLinksPartition(state, name);
        await saveQuickLinks(stateOrStorage, next);
        return next;
      })();
    }
    return pureAddQuickLinksPartition(stateOrStorage, name);
  }

  function pureRemoveQuickLinksPartition(state, partitionId) {
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

  function removeQuickLinksPartition(stateOrStorage, partitionId) {
    if (_isStorage(stateOrStorage)) {
      return (async () => {
        const state = await getQuickLinks(stateOrStorage);
        const next = pureRemoveQuickLinksPartition(state, partitionId);
        await saveQuickLinks(stateOrStorage, next);
        return next;
      })();
    }
    return pureRemoveQuickLinksPartition(stateOrStorage, partitionId);
  }

  function pureRenameQuickLinksPartition(state, partitionId, newName) {
    const next = normalizeQuickLinksState(state);
    const trimmed = typeof newName === 'string' ? newName.trim() : '';
    if (!trimmed) return next;

    const targetPart = next.partitions.find((p) => p.id === partitionId);
    if (targetPart) {
      targetPart.name = trimmed;
    }
    return next;
  }

  function renameQuickLinksPartition(stateOrStorage, partitionId, newName) {
    if (_isStorage(stateOrStorage)) {
      return (async () => {
        const state = await getQuickLinks(stateOrStorage);
        const next = pureRenameQuickLinksPartition(state, partitionId, newName);
        await saveQuickLinks(stateOrStorage, next);
        return next;
      })();
    }
    return pureRenameQuickLinksPartition(stateOrStorage, partitionId, newName);
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

  function extractTabInfo(dataTransfer) {
    if (!dataTransfer) return null;
    let url = '';
    let title = '';

    try {
      const custom = dataTransfer.getData('application/tabout-tab') || dataTransfer.getData('application/json');
      if (custom) {
        const parsed = JSON.parse(custom);
        if (parsed && typeof parsed.url === 'string') {
          url = parsed.url;
          title = parsed.title || '';
        }
      }
    } catch {}

    if (!url) {
      const uriList = dataTransfer.getData('text/uri-list');
      if (uriList) {
        const lines = uriList.split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
        if (lines.length > 0) url = lines[0];
      }
    }

    if (!url) {
      const plain = dataTransfer.getData('text/plain');
      if (plain && /^(https?|chrome|edge|brave|file):\/\//i.test(plain.trim())) {
        url = plain.trim();
      }
    }

    if (url && !title) {
      const html = dataTransfer.getData('text/html');
      if (html) {
        const match = html.match(/<a\b[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/i);
        if (match) {
          const linkText = match[2].replace(/<[^>]+>/g, '').trim();
          if (linkText) title = linkText;
        }
      }
    }

    if (url && !title) {
      try {
        const parsed = new URL(url);
        title = parsed.hostname.replace(/^www\./, '');
        if (parsed.pathname && parsed.pathname !== '/') {
          const seg = parsed.pathname.split('/').filter(Boolean).pop();
          if (seg) title = `${title}/${seg}`;
        }
      } catch {
        title = url;
      }
    }

    return url ? { url, title: title || url } : null;
  }

  let _storage = null;
  let _refresh = null;
  let _showToast = null;
  let _activeDraggingLink = null;
  let _dragDropHandled = false;
  let _initialized = false;

  function init(options = {}) {
    if (options.getStorage) _storage = options.getStorage();
    else if (options.storage) _storage = options.storage;
    if (options.refresh) _refresh = options.refresh;
    if (options.showToast) _showToast = options.showToast;

    if (_initialized) return;
    if (typeof document === 'undefined') return;
    _initialized = true;

    // Click handler for quick links bar
    document.addEventListener('click', async (e) => {
      // 1. Click quick link button to open URL
      const linkBtn = e.target.closest('.gtd-quick-link-btn[data-link-url]');
      if (linkBtn) {
        const url = linkBtn.dataset.linkUrl;
        if (url) {
          if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
            chrome.tabs.create({ url });
          } else {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
        }
        return;
      }

      // 2. Add partition button
      const addPartitionBtn = e.target.closest('[data-gtd-action="add-quick-links-partition"]');
      if (addPartitionBtn) {
        const name = window.prompt('请输入新分区名称：', '');
        if (name && name.trim()) {
          const storage = _storage || (typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null);
          await addQuickLinksPartition(storage, name.trim());
          if (_refresh) await _refresh();
          if (_showToast) _showToast(`已添加分区「${name.trim()}」`);
        }
        return;
      }

      // 3. Delete partition button
      const delPartitionBtn = e.target.closest('[data-gtd-action="delete-quick-links-partition"]');
      if (delPartitionBtn) {
        e.stopPropagation();
        const partId = delPartitionBtn.dataset.partitionId;
        const partName = delPartitionBtn.dataset.partitionName || '分区';
        if (window.confirm(`确定删除分区「${partName}」吗？分区内的链接将被删除。`)) {
          const storage = _storage || (typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null);
          await removeQuickLinksPartition(storage, partId);
          if (_refresh) await _refresh();
          if (_showToast) _showToast(`已删除分区「${partName}」`);
        }
        return;
      }
    });

    // Double click partition pill to rename
    document.addEventListener('dblclick', async (e) => {
      const pill = e.target.closest('.gtd-partition-pill[data-partition-id]');
      if (!pill) return;
      if (e.target.closest('.gtd-partition-pill-del')) return;
      const partId = pill.dataset.partitionId;
      const oldName = pill.dataset.partitionName || '';
      const newName = window.prompt('请输入分区新名称：', oldName);
      if (newName && newName.trim() && newName.trim() !== oldName) {
        const storage = _storage || (typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null);
        await renameQuickLinksPartition(storage, partId, newName.trim());
        if (_refresh) await _refresh();
        if (_showToast) _showToast(`分区已重命名为「${newName.trim()}」`);
      }
    });

    // Dragstart for quick link buttons
    document.addEventListener('dragstart', (e) => {
      const btn = e.target.closest('.gtd-quick-link-btn[data-link-id]');
      if (!btn) return;
      _activeDraggingLink = {
        id: btn.dataset.linkId,
        partitionId: btn.dataset.partitionId,
        url: btn.dataset.linkUrl,
        title: btn.dataset.linkTitle || btn.dataset.linkUrl,
      };
      _dragDropHandled = false;
      document.body.classList.add('is-dragging-quick-link');
      btn.classList.add('is-dragging');

      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData('application/tabout-quick-link', JSON.stringify(_activeDraggingLink));
        e.dataTransfer.setData('text/plain', _activeDraggingLink.url);
        e.dataTransfer.setData('text/uri-list', _activeDraggingLink.url);
      }
    });

    // Dragover on quick links bar or partition
    document.addEventListener('dragover', (e) => {
      const bar = e.target.closest('.gtd-quick-links-bar');
      if (!bar) {
        return;
      }
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';

      const partition = e.target.closest('.gtd-quick-links-partition');
      document.querySelectorAll('.gtd-quick-links-partition.is-drop-target').forEach((el) => {
        if (el !== partition) el.classList.remove('is-drop-target');
      });
      if (partition) {
        partition.classList.add('is-drop-target');
      }
    });

    document.addEventListener('dragleave', (e) => {
      const partition = e.target.closest('.gtd-quick-links-partition');
      if (partition && !partition.contains(e.relatedTarget)) {
        partition.classList.remove('is-drop-target');
      }
    });

    // Drop handler
    document.addEventListener('drop', async (e) => {
      const bar = e.target.closest('.gtd-quick-links-bar');
      if (!bar) return; // dropped outside quick links bar

      const partition = e.target.closest('.gtd-quick-links-partition');
      e.preventDefault();
      document.querySelectorAll('.gtd-quick-links-partition.is-drop-target').forEach((el) => {
        el.classList.remove('is-drop-target');
      });

      const targetPartitionId = partition ? partition.dataset.partitionId : DEFAULT_PARTITION_ID;
      const storage = _storage || (typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null);

      // Case 1: Moving an existing quick link
      if (_activeDraggingLink) {
        _dragDropHandled = true;
        await moveQuickLink(storage, _activeDraggingLink.id, targetPartitionId);
        if (_refresh) await _refresh();
        if (_showToast) _showToast('已调整常用链接分类');
        return;
      }

      // Case 2: Adding a new link from dragged tab / browser URL
      const info = extractTabInfo(e.dataTransfer);
      if (info && info.url) {
        _dragDropHandled = true;
        await addQuickLink(storage, targetPartitionId, info);
        if (_refresh) await _refresh();
        if (_showToast) _showToast(`已添加常用链接：${info.title}`);
      }
    });

    // Dragend for quick link buttons: if dropped outside quick links bar, delete it!
    document.addEventListener('dragend', async (e) => {
      const draggingBtn = document.querySelector('.gtd-quick-link-btn.is-dragging');
      if (draggingBtn) draggingBtn.classList.remove('is-dragging');
      document.body.classList.remove('is-dragging-quick-link');
      document.querySelectorAll('.gtd-quick-links-partition.is-drop-target').forEach((el) => {
        el.classList.remove('is-drop-target');
      });

      if (_activeDraggingLink && !_dragDropHandled) {
        // Dropped outside quick links bar -> Delete!
        const storage = _storage || (typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null);
        const removed = _activeDraggingLink;
        _activeDraggingLink = null;
        await removeQuickLink(storage, removed.id);
        if (_refresh) await _refresh();
        if (_showToast) _showToast(`已删除常用链接：${removed.title}`);
      } else {
        _activeDraggingLink = null;
      }
    });
  }

  return {
    QUICK_LINKS_KEY,
    DEFAULT_PARTITION_ID,
    DEFAULT_PARTITION_NAME,
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
    extractTabInfo,
    init,
  };
});
