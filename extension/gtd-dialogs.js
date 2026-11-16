(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TabOutGTDDialogs = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  let _getStorage = null;
  let _updateBoard = null;
  let _renderWorkspace = null;
  let _showToast = null;
  let _getActiveScope = null;

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ----------------------------------------------------------------
     REUSE CHECKLIST DIALOG
     ---------------------------------------------------------------- */
  function renderReuseList(container, savedChecklists, query = '') {
    if (!container) return;
    const q = (query || '').trim().toLowerCase();
    const filtered = q
      ? savedChecklists.filter(
          (item) =>
            item.name.toLowerCase().includes(q) ||
            item.taskTitle.toLowerCase().includes(q) ||
            item.items.some((step) => step.text.toLowerCase().includes(q))
        )
      : savedChecklists;

    if (!filtered.length) {
      container.innerHTML = `
        <div class="dialog-empty">
          ${q ? '没有匹配的 checklist' : '暂无保存的 checklist。<br><small style="color:var(--muted)">在任务的步骤面板点击「保存为模板」即可保存。</small>'}
        </div>`;
      return;
    }

    container.innerHTML = filtered
      .map((entry) => {
        const dateStr = entry.createdAt ? entry.createdAt.slice(0, 10) : '';
        const stepCount = entry.items ? entry.items.length : 0;
        const preview = (entry.items || [])
          .slice(0, 3)
          .map((i) => escapeHtml(i.text))
          .join(' · ');

        return `
          <div class="dialog-item" data-checklist-id="${escapeHtml(entry.id)}">
            <div class="dialog-item-info">
              <div class="dialog-item-title">${escapeHtml(entry.name)}</div>
              <div class="dialog-item-preview">${preview}${stepCount > 3 ? ` 等共 ${stepCount} 步` : ''}</div>
              <div class="dialog-item-meta">${dateStr ? `保存于 ${dateStr}` : ''}${entry.taskTitle ? ` · 来自「${escapeHtml(entry.taskTitle)}」` : ''}</div>
            </div>
            <div class="dialog-item-actions">
              <button class="dialog-btn dialog-btn-apply" type="button" data-gtd-action="apply-saved-checklist" data-checklist-id="${escapeHtml(entry.id)}">应用</button>
              <button class="dialog-btn dialog-btn-delete" type="button" data-gtd-action="delete-saved-checklist" data-checklist-id="${escapeHtml(entry.id)}" title="删除此模板">删除</button>
            </div>
          </div>`;
      })
      .join('');
  }

  async function openReuseDialog(taskId) {
    if (!taskId) return;
    const dialog = document.getElementById('reuseDialog');
    const list = document.getElementById('reuseList');
    const search = document.getElementById('reuseSearch');
    if (!dialog || !list) return;

    const storage = _getStorage ? _getStorage() : null;
    const saved = await window.TabOutGTD.getSavedChecklists(storage);
    dialog.dataset.targetTaskId = taskId;
    if (search) search.value = '';
    renderReuseList(list, saved);
    dialog.style.display = 'flex';
    setTimeout(() => search?.focus(), 50);
  }

  function closeReuseDialog() {
    const dialog = document.getElementById('reuseDialog');
    if (dialog) dialog.style.display = 'none';
  }

  /* ----------------------------------------------------------------
     GTD ARCHIVE RETRIEVAL DIALOG
     ---------------------------------------------------------------- */
  async function refreshGtdArchiveList(query = '') {
    const list = document.getElementById('gtdArchiveList');
    const badge = document.getElementById('gtdArchiveCountBadge');
    if (!list) return;
    const storage = _getStorage ? _getStorage() : null;
    const tasks = await window.TabOutGTD.getArchivedTasks(storage, query);
    const quadrantConfig = await window.TabOutGTD.getQuadrantConfig(storage);
    list.innerHTML = window.TabOutGTD.renderArchiveList(tasks, { query, quadrantConfig });
    if (badge) {
      badge.textContent = String(tasks.length);
    }
  }

  async function openGtdArchiveDialog() {
    const dialog = document.getElementById('gtdArchiveDialog');
    if (!dialog) return;
    dialog.style.display = 'flex';
    const search = document.getElementById('gtdArchiveSearch');
    if (search) search.value = '';
    await refreshGtdArchiveList('');
    if (search) search.focus();
  }

  function closeGtdArchiveDialog() {
    const dialog = document.getElementById('gtdArchiveDialog');
    if (dialog) dialog.style.display = 'none';
  }

  /* ----------------------------------------------------------------
     INIT EVENT LISTENERS
     ---------------------------------------------------------------- */
  function init(options = {}) {
    if (options.getStorage) _getStorage = options.getStorage;
    if (options.updateBoard) _updateBoard = options.updateBoard;
    if (options.renderWorkspace) _renderWorkspace = options.renderWorkspace;
    if (options.showToast) _showToast = options.showToast;
    if (options.getActiveScope) _getActiveScope = options.getActiveScope;

    if (typeof document === 'undefined') return;

    // Reuse checklist dialog clicks
    document.addEventListener('click', async (e) => {
      const reuseDialog = document.getElementById('reuseDialog');
      if (reuseDialog && reuseDialog.style.display !== 'none' && e.target === reuseDialog) {
        closeReuseDialog();
        return;
      }

      const actionEl = e.target.closest(
        '[data-gtd-action="close-reuse-dialog"], [data-gtd-action="apply-saved-checklist"], [data-gtd-action="delete-saved-checklist"]'
      );
      if (!actionEl) return;
      const action = actionEl.dataset.gtdAction;

      if (action === 'close-reuse-dialog') {
        closeReuseDialog();
        return;
      }

      if (action === 'apply-saved-checklist') {
        const dialog = document.getElementById('reuseDialog');
        const storage = _getStorage ? _getStorage() : null;
        const saved = await window.TabOutGTD.getSavedChecklists(storage);
        const entry = saved.find((item) => item.id === actionEl.dataset.checklistId);
        if (!entry) return;

        const taskId = dialog?.dataset.targetTaskId || '';
        if (taskId && entry.items.length && typeof _updateBoard === 'function') {
          await _updateBoard((board) => {
            let result = board;
            for (const item of entry.items) {
              result = window.TabOutGTD.addChecklistItem(result, taskId, item.text);
            }
            return result;
          });
          if (typeof _showToast === 'function') _showToast(`已导入 ${entry.items.length} 步`);
        }
        closeReuseDialog();
        return;
      }

      if (action === 'delete-saved-checklist') {
        const checklistId = actionEl.dataset.checklistId;
        if (!checklistId) return;
        if (confirm('确定删除此 checklist 模板吗？')) {
          const storage = _getStorage ? _getStorage() : null;
          await window.TabOutGTD.deleteSavedChecklist(storage, checklistId);
          const list = document.getElementById('reuseList');
          const search = document.getElementById('reuseSearch');
          const remaining = await window.TabOutGTD.getSavedChecklists(storage);
          if (list) renderReuseList(list, remaining, search?.value || '');
          if (typeof _showToast === 'function') _showToast('模板已删除');
        }
      }
    });

    // Reuse dialog search
    document.addEventListener('keyup', (e) => {
      const search = e.target.closest('#reuseSearch');
      if (!search) return;
      const list = document.getElementById('reuseList');
      if (!list) return;
      clearTimeout(search._searchTimer);
      search._searchTimer = setTimeout(async () => {
        const storage = _getStorage ? _getStorage() : null;
        const saved = await window.TabOutGTD.getSavedChecklists(storage);
        renderReuseList(list, saved, search.value);
      }, 150);
    });

    // Archive dialog clicks
    document.addEventListener('click', async (e) => {
      const archiveDialog = document.getElementById('gtdArchiveDialog');
      if (archiveDialog && archiveDialog.style.display !== 'none' && e.target === archiveDialog) {
        closeGtdArchiveDialog();
        return;
      }

      const actionEl = e.target.closest(
        '[data-gtd-action="close-archive-dialog"], [data-gtd-action="restore-archived-task"], [data-gtd-action="delete-archived-task-permanent"]'
      );
      if (!actionEl) return;
      const action = actionEl.dataset.gtdAction;

      if (action === 'close-archive-dialog') {
        closeGtdArchiveDialog();
        return;
      }

      if (action === 'restore-archived-task') {
        const taskId = actionEl.dataset.taskId;
        const boardKey = actionEl.dataset.boardKey;
        if (!taskId || !boardKey) return;

        const storage = _getStorage ? _getStorage() : null;
        const scopeMeta = window.TabOutGTD.getBoardScope(new Date());
        const activeScope = typeof _getActiveScope === 'function' ? _getActiveScope() : 'day';
        const currentScopeInfo = scopeMeta[activeScope || 'day'];

        await window.TabOutGTD.restoreArchivedTask(storage, boardKey, taskId, currentScopeInfo.key);
        if (typeof _renderWorkspace === 'function') await _renderWorkspace();

        const search = document.getElementById('gtdArchiveSearch');
        await refreshGtdArchiveList(search?.value || '');
        if (typeof _showToast === 'function') _showToast('任务已恢复到看板');
        return;
      }

      if (action === 'delete-archived-task-permanent') {
        const taskId = actionEl.dataset.taskId;
        const boardKey = actionEl.dataset.boardKey;
        if (!taskId || !boardKey) return;

        const confirmed = confirm('确定彻底删除该归档任务吗？此操作无法撤销。');
        if (!confirmed) return;

        const storage = _getStorage ? _getStorage() : null;
        await window.TabOutGTD.deleteArchivedTaskPermanent(storage, boardKey, taskId);

        const search = document.getElementById('gtdArchiveSearch');
        await refreshGtdArchiveList(search?.value || '');
        if (typeof _showToast === 'function') _showToast('归档任务已彻底删除');
      }
    });

    // Archive dialog input
    document.addEventListener('input', (e) => {
      const search = e.target.closest('#gtdArchiveSearch');
      if (!search) return;
      clearTimeout(search._searchTimer);
      search._searchTimer = setTimeout(async () => {
        await refreshGtdArchiveList(search.value);
      }, 120);
    });

    // Escape key closes archive dialog
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const archiveDialog = document.getElementById('gtdArchiveDialog');
        if (archiveDialog && archiveDialog.style.display !== 'none') {
          closeGtdArchiveDialog();
        }
        const reuseDialog = document.getElementById('reuseDialog');
        if (reuseDialog && reuseDialog.style.display !== 'none') {
          closeReuseDialog();
        }
      }
    });
  }

  return {
    renderReuseList,
    openReuseDialog,
    closeReuseDialog,
    refreshGtdArchiveList,
    openGtdArchiveDialog,
    closeGtdArchiveDialog,
    init,
  };
});
