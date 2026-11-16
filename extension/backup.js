/* ================================================================
   Tab Out — Daily Auto Backup
   ================================================================
   Silently creates a daily ZIP backup of all extension data
   (GTD, Whiteboard/Excalidraw, Structureboard/draw.io, Notes,
   Pomodoro, Deferred tabs) and stores it in IndexedDB.

   Keeps the last 30 backups, purges older ones.
   ================================================================ */

'use strict';

(function () {
  let _backupTimer = null;
  let _backupRunning = false;

  // ── IndexedDB ──────────────────────────────────────────────
  const DB_NAME = 'TabOutBackups';
  const DB_VERSION = 1;
  const STORE_NAME = 'backups';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'date' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // ── Storage keys to back up ────────────────────────────────
  const BACKUP_KEYS = [
    'gtdBoards',
    'tab-out-gtd-quadrants-v1',
    'tab-out-quick-links-v1',
    'tab-out-whiteboard-global-v1',
    'tab-out-structureboard-global-v1',
    'tab-out-notes-multi-v1',
    'tab-out-notes-global-v1',
    'tab-out-pomodoro',
    'deferred',
    'tab-out-ui-prefs',
    'tab-out-ai-messages-v1',
  ];

  // ── Helpers ────────────────────────────────────────────────
  function getToday() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  // ── Purge backups older than the last 30 days ─────────────
  async function purgeOldBackups() {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    return new Promise((resolve) => {
      const req = store.getAllKeys();
      req.onsuccess = () => {
        const keys = req.result.sort().reverse();
        if (keys.length > 30) {
          const toRemove = keys.slice(30);
          let removed = 0;
          toRemove.forEach((k) => {
            store.delete(k);
          });
        }
        db.close();
        resolve();
      };
      req.onerror = () => {
        db.close();
        resolve();
      };
    });
  }

  // ── ProseMirror doc → Markdown converter ────────────────────
  function serializeMark(marks, text) {
    if (!marks || !marks.length) return text;
    let result = text;
    for (const m of marks) {
      if (m.type === 'bold') result = `**${result}**`;
      else if (m.type === 'italic') result = `*${result}*`;
      else if (m.type === 'code') result = `\`${result}\``;
      else if (m.type === 'strike') result = `~~${result}~~`;
      else if (m.type === 'link' && m.attrs?.href) result = `[${result}](${m.attrs.href})`;
    }
    return result;
  }

  function serializeInlineContent(content) {
    if (!content || !content.length) return '';
    return content.map(n => {
      if (n.type === 'text') return serializeMark(n.marks, n.text);
      if (n.type === 'hardBreak') return '\n';
      return '';
    }).join('');
  }

  function serializeHeading(node) {
    const level = node.attrs?.level || 1;
    const prefix = '#'.repeat(level);
    return `${prefix} ${serializeInlineContent(node.content)}\n`;
  }

  function serializeParagraph(node) {
    const text = serializeInlineContent(node.content);
    return text ? `${text}\n\n` : '\n';
  }

  function serializeCodeBlock(node) {
    const lang = node.attrs?.language || '';
    const code = node.content?.map(n => n.text).join('') || '';
    return '```' + lang + '\n' + code + '\n```\n\n';
  }

  function serializeBlockquote(node) {
    const inner = serializeBlocks(node.content);
    return inner.split('\n').map(l => l ? `> ${l}` : '>').join('\n') + '\n\n';
  }

  function serializeList(node, depth) {
    const indent = '  '.repeat(depth);
    const ordered = node.type === 'orderedList';
    let start = node.attrs?.start;
    let result = '';
    const items = node.content || [];
    items.forEach((item, i) => {
      const prefix = ordered ? `${(start || 1) + i}.` : '-';
      const itemContent = serializeBlocks(item.content, depth + 1);
      result += `${indent}${prefix} ${itemContent.trimStart()}\n`;
    });
    return result + '\n';
  }

  function serializeTaskList(node, depth) {
    const indent = '  '.repeat(depth);
    let result = '';
    const items = node.content || [];
    items.forEach((item) => {
      const checked = item.attrs?.checked ? 'x' : ' ';
      const itemContent = serializeBlocks(item.content, depth + 1);
      result += `${indent}- [${checked}] ${itemContent.trimStart()}\n`;
    });
    return result + '\n';
  }

  function serializeTableCell(node) {
    return serializeInlineContent(node.content);
  }

  function serializeTableRow(node) {
    const cells = (node.content || []).map(c => serializeTableCell(c));
    return `| ${cells.join(' | ')} |`;
  }

  function serializeTable(node) {
    const rows = node.content || [];
    if (!rows.length) return '';
    const headerRow = rows[0];
    const headerCells = (headerRow.content || []).length;
    const sep = `| ${Array(headerCells).fill('---').join(' | ')} |`;
    return [serializeTableRow(headerRow), sep, ...rows.slice(1).map(r => serializeTableRow(r))].join('\n') + '\n\n';
  }

  function serializeBlocks(nodes, depth = 0) {
    if (!nodes || !nodes.length) return '';
    return nodes.map(node => {
      switch (node.type) {
        case 'heading': return serializeHeading(node);
        case 'paragraph': return serializeParagraph(node);
        case 'codeBlock': return serializeCodeBlock(node);
        case 'blockquote': return serializeBlockquote(node);
        case 'bulletList':
        case 'orderedList': return serializeList(node, depth);
        case 'taskList': return serializeTaskList(node, depth);
        case 'table': return serializeTable(node);
        case 'horizontalRule': return '---\n\n';
        case 'listItem': return serializeBlocks(node.content, depth);
        default: return '';
      }
    }).join('');
  }

  function notesDocToMarkdown(doc, title) {
    const frontmatter = `---\ntitle: ${title}\n---\n\n`;
    const body = serializeBlocks(doc.content || []);
    return body ? frontmatter + body + '\n' : frontmatter + '\n';
  }

  // ── Helper to add GTD markdown files to ZIP ────────────────
  function addGtdMarkdown(zip, gtdData) {
    if (!gtdData || typeof gtdData !== 'object') return;
    if (typeof window.TabOutGTD?.exportBoardToMarkdown !== 'function') return;
    const folder = zip.folder('gtd');
    if (!folder) return;
    Object.keys(gtdData).forEach((date) => {
      const board = gtdData[date];
      if (board && typeof board === 'object' && board.date) {
        try {
          const md = window.TabOutGTD.exportBoardToMarkdown(board);
          folder.file(`gtd-${date}.md`, md);
        } catch (_) { /* skip single board on error */ }
      }
    });
  }

  // ── Helper to add note markdown files to ZIP ────────────────
  function addNotesMarkdown(zip, notesData) {
    const notes = notesData?.notes;
    if (!Array.isArray(notes)) return;
    const folder = zip.folder('notes');
    if (!folder) return;
    notes.forEach((note, i) => {
      const title = note?.title || `笔记${i + 1}`;
      const content = note?.content;
      if (content && content.type === 'doc') {
        const md = notesDocToMarkdown(content, title);
        folder.file(`${title}.md`, md);
      }
    });
  }

  // ── Helper to add AI history markdown files to ZIP ───────────
  function addAiHistoryMarkdown(zip, historyData) {
    if (!Array.isArray(historyData) || !historyData.length) return;
    let md = '# AI 助手对话历史\n\n';
    historyData.forEach((msg) => {
      const roleLabel = msg.role === 'user' ? '我' : 'AI 助手';
      const timeLabel = msg.createdAt ? ` [${new Date(msg.createdAt).toLocaleString('zh-CN')}]` : '';
      md += `### 🗣️ ${roleLabel}${timeLabel}\n\n${msg.content}\n\n---\n\n`;
    });
    zip.file('ai-history.md', md);
  }

  // ── Debounced auto-backup (5s, resets on each call) ───────
  function scheduleBackup() {
    if (_backupTimer) clearTimeout(_backupTimer);
    _backupTimer = setTimeout(() => { _backupTimer = null; runBackup(); }, 5000);
  }

  // ── Build backup summary from titles ──────────────────────
  function buildBackupSummary(all) {
    const parts = [];

    // GTD: collect task titles from today's board
    const gtdData = all['gtdBoards'];
    if (gtdData && typeof gtdData === 'object') {
      const titles = [];
      Object.values(gtdData).forEach((board) => {
        if (board && Array.isArray(board.tasks)) {
          board.tasks.forEach((t) => {
            if (t && t.title) titles.push(t.title);
          });
        }
      });
      if (titles.length) {
        const max = 6;
        const shown = titles.slice(0, max);
        const label = shown.join('、');
        parts.push(`GTD: ${label}${titles.length > max ? '…' : ''}`);
      }
    }

    // Notes: collect note titles
    const notesData = all['tab-out-notes-multi-v1'];
    if (notesData && Array.isArray(notesData.notes)) {
      const titles = notesData.notes.map((n) => n?.title || '').filter(Boolean);
      if (titles.length) {
        const max = 6;
        const shown = titles.slice(0, max);
        const label = shown.join('、');
        parts.push(`笔记: ${label}${titles.length > max ? '…' : ''}`);
      }
    }

    return parts.join(' · ') || '';
  }

  // ── Main backup logic ─────────────────────────────────────
  async function runBackup() {
    if (_backupRunning) return;
    _backupRunning = true;
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      if (typeof JSZip === 'undefined') return;

      // Read all data from chrome.storage.local
      const all = await chrome.storage.local.get(BACKUP_KEYS);
      const today = getToday();
      const zip = new JSZip();

      const summary = buildBackupSummary(all);

      BACKUP_KEYS.forEach((key) => {
        const data = all[key];
        if (data !== undefined) {
          // Convert to pretty-printed JSON
          const json = JSON.stringify(data, null, 2);
          zip.file(`${key}.json`, json);
        }
      });

      // Also add notes as Markdown files for easy reading
      addNotesMarkdown(zip, all['tab-out-notes-multi-v1']);

      // Also add GTD boards as Markdown files
      addGtdMarkdown(zip, all['gtdBoards']);

      // Also add AI dialogue history as a Markdown file
      addAiHistoryMarkdown(zip, all['tab-out-ai-messages-v1']);

      // Also include the date metadata
      zip.file('_backup-meta.json', JSON.stringify({
        created_at: new Date().toISOString(),
        date: today,
        version: 1,
      }, null, 2));

      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });

      // Store in IndexedDB
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ date: today, blob, createdAt: Date.now(), summary });
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(new Error('transaction aborted'));
      });
      db.close();

      // Cleanup old backups
      await purgeOldBackups();
    } catch (_) {
      // Silently fail — this is a best-effort background task
    } finally {
      _backupRunning = false;
    }
  }

  // ── Export API for manual retrieval ───────────────────────
  window.TabOutBackup = {
    runNow: () => runBackup(),
    async listBackups() {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          db.close();
          resolve((req.result || []).map((r) => ({
            date: r.date,
            size: r.blob ? r.blob.size : 0,
            summary: r.summary || '',
          })));
        };
        req.onerror = () => {
          db.close();
          resolve([]);
        };
      });
    },
    async getBackup(date) {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(date);
        req.onsuccess = () => {
          db.close();
          resolve(req.result ? req.result.blob : null);
        };
        req.onerror = () => {
          db.close();
          resolve(null);
        };
      });
    },
  };

  // ── Run on page load (debounced, so rapid tab opens only trigger once) ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleBackup);
  } else {
    scheduleBackup();
  }
})();
