import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Extension } from '@tiptap/core';

const FALLBACK_STORAGE_KEY = 'tab-out-notes-global-v1';
const MULTI_STORAGE_KEY = 'tab-out-notes-multi-v1';
const FALLBACK_TITLE = '笔记';
const DEFAULT_NOTE_NAMES = ['笔记1', '笔记2', '笔记3'];
const NOTE_COUNT = DEFAULT_NOTE_NAMES.length;
const EMPTY_CONTENT = {
  type: 'doc',
  content: [
    { type: 'paragraph' },
  ],
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isNotesContent(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && value.type === 'doc';
}

function createEmptyNote(title) {
  return {
    title,
    content: cloneJson(EMPTY_CONTENT),
    updatedAt: new Date().toISOString(),
  };
}

function createDefaultMultiState() {
  return {
    activeIndex: 0,
    showToc: true,
    showNumbering: false,
    notes: DEFAULT_NOTE_NAMES.map(createEmptyNote),
  };
}

function createFallbackStateApi() {
  return {
    NOTES_STORAGE_KEY: FALLBACK_STORAGE_KEY,
    DEFAULT_NOTES_TITLE: FALLBACK_TITLE,
    NOTES_EXPORT_MIME_TYPE: 'text/markdown;charset=utf-8',
    createEmptyNotesState() {
      return {
        title: FALLBACK_TITLE,
        type: 'tiptap',
        content: cloneJson(EMPTY_CONTENT),
        updatedAt: new Date().toISOString(),
      };
    },
    normalizeNotesDocument(doc) {
      const safeDoc = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
      const title = typeof safeDoc.title === 'string'
        ? safeDoc.title
          .replace(/\.tiptap\.json$/i, '')
          .replace(/\.json$/i, '')
          .replace(/\.markdown$/i, '')
          .replace(/\.md$/i, '')
          .replace(/\s+/g, ' ')
          .trim()
        : '';

      return {
        title: title || FALLBACK_TITLE,
        type: typeof safeDoc.type === 'string' && safeDoc.type ? safeDoc.type : 'tiptap',
        content: isNotesContent(safeDoc.content) ? cloneJson(safeDoc.content) : cloneJson(EMPTY_CONTENT),
        updatedAt: typeof safeDoc.updatedAt === 'string' && safeDoc.updatedAt
          ? safeDoc.updatedAt
          : new Date().toISOString(),
      };
    },
    importNotesDocument(text, options = {}) {
      const source = typeof text === 'string' ? text.replace(/\r\n?/g, '\n') : '';
      if (!source.trim()) throw new Error('笔记文件为空');

      const titleMatch = source.match(/^---\ntitle:\s*(.+)\n---/m);
      const body = source
        .replace(/^---\n[\s\S]*?\n---\n*/m, '')
        .trim();

      return this.normalizeNotesDocument({
        title: titleMatch?.[1]?.trim() || options.title,
        type: 'tiptap',
        content: body
          ? {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }],
          }
          : cloneJson(EMPTY_CONTENT),
      });
    },
    exportNotesDocument(doc) {
      const normalized = this.normalizeNotesDocument(doc);
      const text = normalized.content?.content?.length
        ? normalized.content.content
          .map((node) => {
            if (node?.type === 'paragraph') {
              return node.content?.map((item) => item.text || '').join('') || '';
            }
            return '';
          })
          .filter(Boolean)
          .join('\n\n')
        : '';
      return `---\ntitle: ${normalized.title}\n---\n\n${text}\n`;
    },
  };
}

const notesStateApi = window.TabOutNotesState || createFallbackStateApi();
const NOTES_EXPORT_MIME_TYPE = notesStateApi.NOTES_EXPORT_MIME_TYPE || 'text/markdown;charset=utf-8';

function getNotesStorage() {
  if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
    return chrome.storage.local;
  }

  return {
    async get(key) {
      try {
        const raw = localStorage.getItem(key);
        return { [key]: raw ? JSON.parse(raw) : undefined };
      } catch {
        return { [key]: undefined };
      }
    },
    async set(payload) {
      const [key, value] = Object.entries(payload || {})[0] || [];
      if (!key) return;
      localStorage.setItem(key, JSON.stringify(value));
    },
  };
}

function normalizeTitle(title) {
  const cleaned = typeof title === 'string'
    ? title
      .replace(/\.tiptap\.json$/i, '')
      .replace(/\.json$/i, '')
      .replace(/\.markdown$/i, '')
      .replace(/\.md$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
    : '';
  return cleaned || FALLBACK_TITLE;
}

function sanitizeFilenameTitle(title) {
  const cleaned = normalizeTitle(title)
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || FALLBACK_TITLE;
}

function buildExportFilename(title) {
  return `${sanitizeFilenameTitle(title)}.md`;
}

function getTitleFromFilename(filename) {
  if (typeof filename !== 'string') return FALLBACK_TITLE;
  const cleaned = filename
    .replace(/\.tiptap\.json$/i, '')
    .replace(/\.json$/i, '')
    .replace(/\.markdown$/i, '')
    .replace(/\.md$/i, '');
  return normalizeTitle(cleaned);
}

function downloadTextFile(filename, content, mimeType = NOTES_EXPORT_MIME_TYPE) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function loadMultiNotes() {
  const storage = getNotesStorage();

  // Try new multi-key first
  const result = await storage.get(MULTI_STORAGE_KEY);
  const stored = result?.[MULTI_STORAGE_KEY];
  if (stored && Array.isArray(stored.notes) && stored.notes.length > 0) {
    return {
      showToc: stored.showToc !== false,
      showNumbering: stored.showNumbering === true,
      activeIndex: typeof stored.activeIndex === 'number' && stored.activeIndex < stored.notes.length
        ? stored.activeIndex
        : 0,
      notes: stored.notes.map((n) => ({
        title: normalizeTitle(n.title),
        content: isNotesContent(n.content) ? cloneJson(n.content) : cloneJson(EMPTY_CONTENT),
        updatedAt: typeof n.updatedAt === 'string' ? n.updatedAt : new Date().toISOString(),
      })),
    };
  }

  // Migrate from old single-doc key
  const oldResult = await storage.get(FALLBACK_STORAGE_KEY);
  const oldStored = oldResult?.[FALLBACK_STORAGE_KEY];
  if (oldStored) {
    const normalized = notesStateApi.normalizeNotesDocument(oldStored);
    const multi = createDefaultMultiState();
    multi.notes[0] = {
      title: normalized.title,
      content: normalized.content,
      updatedAt: normalized.updatedAt,
    };
    // Persist migrated state so next load hits the new key
    await storage.set({ [MULTI_STORAGE_KEY]: multi });
    return multi;
  }

  return createDefaultMultiState();
}

async function saveMultiNotesPayload(payload) {
  const storage = getNotesStorage();
  await storage.set({ [MULTI_STORAGE_KEY]: payload });
}

function StrokeIcon({ children, viewBox = '0 0 24 24' }) {
  return (
    <span className="notes-editor-icon" aria-hidden="true">
      <svg viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  );
}

function TextIcon({ children, className = '' }) {
  return (
    <span className={`notes-editor-icon notes-editor-icon-text${className ? ` ${className}` : ''}`} aria-hidden="true">
      {children}
    </span>
  );
}

function ToolbarButton({ label, active = false, disabled = false, onClick, children }) {
  return (
    <button
      className="notes-editor-btn"
      type="button"
      aria-label={label}
      aria-pressed={active ? 'true' : 'false'}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function toggleOrAppendTaskList(editor) {
  if (!editor) return;

  const chain = editor.chain().focus();
  if (editor.isActive('taskList')) {
    chain.splitListItem('taskItem').run();
    return;
  }

  chain.toggleTaskList().run();
}

function canToggleOrAppendTaskList(editor) {
  if (!editor) return false;

  if (editor.isActive('taskList')) {
    return editor.can().chain().focus().splitListItem('taskItem').run();
  }

  return editor.can().chain().focus().toggleTaskList().run();
}

export default function NotesApp() {
  const appHostRef = useRef(null);
  const fileInputRef = useRef(null);
  const titleInputRef = useRef(null);
  const saveTimerRef = useRef(0);
  const titleRef = useRef(FALLBACK_TITLE);
  const notesRef = useRef(null);
  const activeIndexRef = useRef(0);
  const [loaded, setLoaded] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [title, setTitle] = useState(FALLBACK_TITLE);
  const [draftTitle, setDraftTitle] = useState(FALLBACK_TITLE);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [showNumbering, setShowNumbering] = useState(false);
  const showNumberingRef = useRef(showNumbering);
  const showTocRef = useRef(showToc);
  const [tocItems, setTocItems] = useState([]);

  function updateTocFromEditor(e) {
    if (!e) {
      setTocItems([]);
      return;
    }
    const items = [];
    const useNumbering = showNumberingRef.current;
    let h1 = 0, h2 = 0, h3 = 0;
    e.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const level = node.attrs.level;
        if (level === 1) { h1++; h2 = 0; h3 = 0; }
        else if (level === 2) { h2++; h3 = 0; }
        else if (level === 3) { h3++; }

        let prefix = '';
        if (useNumbering) {
          if (level === 1) prefix = `${h1}. `;
          else if (level === 2) prefix = `${h1}.${h2}. `;
          else if (level === 3) prefix = `${h1}.${h2}.${h3}. `;
        }

        items.push({ level, text: prefix + node.textContent, pos });
      }
    });
    setTocItems(items);
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Table.configure({
        resizable: false,
      }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({
        nested: true,
      }).extend({
        content() {
          return '(paragraph | taskList) block*';
        },
      }),
      Extension.create({
        name: 'taskTabGuard',
        addKeyboardShortcuts() {
          return {
            Tab: () => {
              const { editor } = this;
              if (!editor.isActive('taskItem')) return false;
              editor.chain().focus().sinkListItem('taskItem').run();
              return true;
            },
          };
        },
      }),
    ],
    content: cloneJson(EMPTY_CONTENT),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'notes-editor-content',
      },
    },
    onUpdate({ editor: nextEditor }) {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }

      const snapshot = nextEditor.getJSON();
      saveTimerRef.current = window.setTimeout(async () => {
        try {
          const notes = notesRef.current;
          const idx = activeIndexRef.current;
          if (!notes || idx < 0 || idx >= notes.length) return;
          notes[idx] = {
            ...notes[idx],
            content: snapshot,
            updatedAt: new Date().toISOString(),
          };
          notesRef.current = notes;
          await saveMultiNotesPayload({ activeIndex: idx, showToc: showTocRef.current, showNumbering: showNumberingRef.current, notes });
        } catch (err) {
          console.error('[tab-out] Failed to autosave notes:', err);
        }
      }, 360);
    },
  });

  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  useEffect(() => {
    if (!editor) return;
    const handler = () => updateTocFromEditor(editor);
    updateTocFromEditor(editor);
    editor.on('update', handler);
    return () => { editor.off('update', handler); };
  }, [editor]);

  useEffect(() => {
    showNumberingRef.current = showNumbering;
    showTocRef.current = showToc;
  });

  useEffect(() => {
    if (!editor) return;
    editor.view.dom.classList.toggle('show-heading-numbers', showNumbering);
    updateTocFromEditor(editor);
  }, [editor, showNumbering]);

  useEffect(() => {
    if (!loaded) return;
    const notes = notesRef.current;
    const idx = activeIndexRef.current;
    if (!notes) return;
    saveMultiNotesPayload({ activeIndex: idx, showToc, showNumbering, notes });
  }, [showToc, showNumbering, loaded]);

  useEffect(() => {
    let disposed = false;

    loadMultiNotes()
      .then((multi) => {
        if (disposed) return;
        notesRef.current = multi.notes;
        activeIndexRef.current = multi.activeIndex;
        setActiveIndex(multi.activeIndex);
        setShowToc(multi.showToc);
        setShowNumbering(multi.showNumbering);
        setTitle(normalizeTitle(multi.notes[multi.activeIndex].title));
        setDraftTitle(normalizeTitle(multi.notes[multi.activeIndex].title));
        setLoaded(true);
      })
      .catch((err) => {
        console.error('[tab-out] Failed to load notes:', err);
        if (disposed) return;
        const multi = createDefaultMultiState();
        notesRef.current = multi.notes;
        setActiveIndex(0);
        setTitle(normalizeTitle(multi.notes[0].title));
        setDraftTitle(normalizeTitle(multi.notes[0].title));
        setLoaded(true);
      });

    return () => {
      disposed = true;
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  // Set editor content after initial load
  useEffect(() => {
    if (!editor || !loaded || !notesRef.current) return;
    const idx = activeIndexRef.current;
    const note = notesRef.current[idx];
    if (note) {
      editor.commands.setContent(note.content, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, loaded]);

  useEffect(() => {
    if (!isEditingTitle) return;
    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }, [isEditingTitle]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    handleFullscreenChange();
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  async function persistCurrentNote(titleOverride) {
    const nextTitle = titleOverride ? normalizeTitle(titleOverride) : title;
    const notes = notesRef.current;
    const idx = activeIndexRef.current;
    if (!notes || idx < 0 || idx >= notes.length) return;

    notes[idx] = {
      ...notes[idx],
      title: nextTitle,
      content: editor ? editor.getJSON() : notes[idx].content,
      updatedAt: new Date().toISOString(),
    };
    notesRef.current = notes;
    await saveMultiNotesPayload({ activeIndex: idx, showToc, showNumbering, notes });
  }

  async function handleTabSwitch(newIndex) {
    if (newIndex === activeIndex || !editor || !notesRef.current) return;

    // Flush any pending auto-save
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = 0;
    }

    // Save current note content
    const notes = notesRef.current;
    const idx = activeIndexRef.current;
    notes[idx] = {
      ...notes[idx],
      content: editor.getJSON(),
      updatedAt: new Date().toISOString(),
    };

    // Switch
    activeIndexRef.current = newIndex;
    setActiveIndex(newIndex);
    const newNote = notes[newIndex];
    setTitle(newNote.title);
    setDraftTitle(newNote.title);
    setIsEditingTitle(false);

    editor.commands.setContent(newNote.content, false);
    updateTocFromEditor(editor);

    notesRef.current = notes;
    await saveMultiNotesPayload({ activeIndex: newIndex, showToc, showNumbering, notes });
  }

  function scrollToHeading(pos) {
    if (!editor) return;
    editor.chain().focus().setTextSelection(pos).scrollIntoView().run();
  }

  function handleStartTitleEdit() {
    setDraftTitle(title);
    setIsEditingTitle(true);
  }

  async function handleCommitTitleEdit(nextValue = draftTitle) {
    const nextTitle = normalizeTitle(nextValue);
    setTitle(nextTitle);
    setDraftTitle(nextTitle);
    setIsEditingTitle(false);
    try {
      await persistCurrentNote(nextTitle);
    } catch (err) {
      console.error('[tab-out] Failed to save notes title:', err);
    }
  }

  function handleCancelTitleEdit() {
    setDraftTitle(title);
    setIsEditingTitle(false);
  }

  async function handleToggleFullscreen() {
    const host = appHostRef.current;
    if (!host) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await host.requestFullscreen();
      }
    } catch (err) {
      console.error('[tab-out] Failed to toggle notes fullscreen:', err);
    }
  }

  function handlePickImport() {
    fileInputRef.current?.click();
  }

  async function handleImportChange(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      setIsBusy(true);
      const text = await file.text();
      const nextDocument = notesStateApi.importNotesDocument(text, {
        title: getTitleFromFilename(file.name),
      });

      const notes = notesRef.current;
      const idx = activeIndexRef.current;
      if (!notes || idx < 0 || idx >= notes.length) return;

      notes[idx] = {
        ...notes[idx],
        title: nextDocument.title,
        content: nextDocument.content,
        updatedAt: new Date().toISOString(),
      };
      notesRef.current = notes;
      setTitle(nextDocument.title);
      setDraftTitle(nextDocument.title);
      setIsEditingTitle(false);
      if (editor) {
        editor.commands.setContent(nextDocument.content, false);
      }
      await saveMultiNotesPayload({ activeIndex: idx, showToc, showNumbering, notes });
    } catch (err) {
      console.error('[tab-out] Failed to import notes:', err);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleNewDocument() {
    if (!editor || !loaded || !notesRef.current) return;

    const confirmed = confirm('确定要新建笔记并丢弃当前内容吗？此操作不可撤销。');
    if (!confirmed) return;

    try {
      setIsBusy(true);
      const idx = activeIndexRef.current;
      const defaultName = DEFAULT_NOTE_NAMES[idx] || `笔记${idx + 1}`;
      const emptyNote = createEmptyNote(defaultName);

      notesRef.current[idx] = emptyNote;
      setTitle(defaultName);
      setDraftTitle(defaultName);
      setIsEditingTitle(false);
      editor.commands.setContent(emptyNote.content, false);
      updateTocFromEditor(editor);

      await saveMultiNotesPayload({
        activeIndex: idx,
        showToc: showTocRef.current,
        showNumbering: showNumberingRef.current,
        notes: notesRef.current,
      });
    } catch (err) {
      console.error('[tab-out] Failed to create new note:', err);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleExportDocument() {
    const notes = notesRef.current;
    const idx = activeIndexRef.current;
    const currentNote = notes?.[idx];
    if (!notes || !currentNote) return;

    try {
      setIsBusy(true);
      const serialized = notesStateApi.exportNotesDocument({
        ...currentNote,
        title,
        content: editor ? editor.getJSON() : currentNote.content,
      });
      const nextDocument = notesStateApi.importNotesDocument(serialized, { title });
      notes[idx] = {
        ...currentNote,
        title: nextDocument.title,
        content: nextDocument.content,
        updatedAt: new Date().toISOString(),
      };
      notesRef.current = notes;
      await saveMultiNotesPayload({ activeIndex: idx, showToc, showNumbering, notes });
      downloadTextFile(buildExportFilename(title), serialized, NOTES_EXPORT_MIME_TYPE);
    } catch (err) {
      console.error('[tab-out] Failed to export notes:', err);
    } finally {
      setIsBusy(false);
    }
  }

  const isEditorReady = Boolean(editor && loaded);
  const canUndo = Boolean(editor?.can().chain().focus().undo().run());
  const canRedo = Boolean(editor?.can().chain().focus().redo().run());
  const canInsertTable = Boolean(editor?.can().chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run());
  const canToggleTaskList = canToggleOrAppendTaskList(editor);
  const canAddColumn = Boolean(editor?.can().chain().focus().addColumnAfter().run());
  const canAddRow = Boolean(editor?.can().chain().focus().addRowAfter().run());
  const canDeleteColumn = Boolean(editor?.can().chain().focus().deleteColumn().run());
  const canDeleteRow = Boolean(editor?.can().chain().focus().deleteRow().run());
  const canDeleteTable = Boolean(editor?.can().chain().focus().deleteTable().run());
  const canToggleHeaderRow = Boolean(editor?.can().chain().focus().toggleHeaderRow().run());

  const currentNoteName = notesRef.current?.[activeIndex]?.title || title;

  return (
    <div className={`notes-app${isFullscreen ? ' is-fullscreen' : ''}`} ref={appHostRef}>
      <header className="notes-toolbar">
        <div className="notes-toolbar-copy">
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              className="notes-title-input"
              type="text"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={() => {
                void handleCommitTitleEdit();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  handleCancelTitleEdit();
                }
              }}
              aria-label="笔记标题"
            />
          ) : (
            <h1
              className="notes-title"
              onDoubleClick={handleStartTitleEdit}
              onMouseDown={(event) => {
                if (event.detail > 1) {
                  event.preventDefault();
                }
              }}
              title="双击编辑标题"
            >
              {title}
            </h1>
          )}
        </div>

        <div className="notes-toolbar-actions">
          <input
            ref={fileInputRef}
            className="notes-file-input"
            type="file"
            accept=".md,.markdown,text/markdown,text/plain"
            onChange={handleImportChange}
            hidden
          />
          <button
            className="notes-toolbar-btn"
            type="button"
            onClick={handleNewDocument}
            disabled={!loaded || isBusy}
          >
            新建
          </button>
          <button className="notes-toolbar-btn" type="button" onClick={handleToggleFullscreen}>
            {isFullscreen ? '退出全屏' : '全屏'}
          </button>
          <button
            className="notes-toolbar-btn"
            type="button"
            onClick={handlePickImport}
            disabled={!loaded || isBusy}
          >
            导入
          </button>
          <button
            className="notes-toolbar-btn is-primary"
            type="button"
            onClick={handleExportDocument}
            disabled={!loaded || isBusy}
          >
            导出
          </button>
        </div>
      </header>

      <div className="notes-body">
        <section className="notes-editor-shell">
          {isEditorReady ? (
            <>
              <div className="notes-editor-toolbar">
                <ToolbarButton label="撤销" disabled={!canUndo} onClick={() => editor?.chain().focus().undo().run()}>
                  <StrokeIcon>
                    <path d="M9 7H5v4" />
                    <path d="M5 11c2-3 4.5-4 7.5-4 4.6 0 6.5 2.8 6.5 7" />
                  </StrokeIcon>
                </ToolbarButton>
                <ToolbarButton label="重做" disabled={!canRedo} onClick={() => editor?.chain().focus().redo().run()}>
                  <StrokeIcon>
                    <path d="M15 7h4v4" />
                    <path d="M19 11c-2-3-4.5-4-7.5-4C6.9 7 5 9.8 5 14" />
                  </StrokeIcon>
                </ToolbarButton>
                <ToolbarButton
                  label="标题一"
                  active={Boolean(editor?.isActive('heading', { level: 1 }))}
                  disabled={!editor}
                  onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
                >
                  <TextIcon>H1</TextIcon>
                </ToolbarButton>
                <ToolbarButton
                  label="标题二"
                  active={Boolean(editor?.isActive('heading', { level: 2 }))}
                  disabled={!editor}
                  onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
                >
                  <TextIcon>H2</TextIcon>
                </ToolbarButton>
                <ToolbarButton
                  label="粗体"
                  active={Boolean(editor?.isActive('bold'))}
                  disabled={!editor}
                  onClick={() => editor?.chain().focus().toggleBold().run()}
                >
                  <TextIcon>B</TextIcon>
                </ToolbarButton>
                <ToolbarButton
                  label="斜体"
                  active={Boolean(editor?.isActive('italic'))}
                  disabled={!editor}
                  onClick={() => editor?.chain().focus().toggleItalic().run()}
                >
                  <TextIcon className="is-italic">I</TextIcon>
                </ToolbarButton>
                <ToolbarButton
                  label="无序列表"
                  active={Boolean(editor?.isActive('bulletList'))}
                  disabled={!editor}
                  onClick={() => editor?.chain().focus().toggleBulletList().run()}
                >
                  <StrokeIcon>
                    <circle cx="6" cy="7" r="1.3" />
                    <circle cx="6" cy="12" r="1.3" />
                    <circle cx="6" cy="17" r="1.3" />
                    <path d="M10 7h8" />
                    <path d="M10 12h8" />
                    <path d="M10 17h8" />
                  </StrokeIcon>
                </ToolbarButton>
                <ToolbarButton
                  label="有序列表"
                  active={Boolean(editor?.isActive('orderedList'))}
                  disabled={!editor}
                  onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                >
                  <StrokeIcon>
                    <path d="M5.2 6.5h1.6V10" />
                    <path d="M4.8 10h2.4" />
                    <path d="M4.8 14.2c0-1.2 1.8-1.4 1.8-2.6 0-.5-.4-.8-.9-.8-.5 0-.9.2-1.2.6" />
                    <path d="M4.8 16.8h2.2" />
                    <path d="M10 7h8" />
                    <path d="M10 12h8" />
                    <path d="M10 17h8" />
                  </StrokeIcon>
                </ToolbarButton>
                <ToolbarButton
                  label="任务列表"
                  active={Boolean(editor?.isActive('taskList'))}
                  disabled={!canToggleTaskList}
                  onClick={() => toggleOrAppendTaskList(editor)}
                >
                  <StrokeIcon>
                    <rect x="4.8" y="5.2" width="3" height="3" rx="0.45" />
                    <rect x="4.8" y="10.5" width="3" height="3" rx="0.45" />
                    <path d="M10 6.7h8" />
                    <path d="M10 12h8" />
                    <path d="M5.6 12.1l1.1 1.1 1.9-2.2" />
                  </StrokeIcon>
                </ToolbarButton>
                <ToolbarButton
                  label="引用"
                  active={Boolean(editor?.isActive('blockquote'))}
                  disabled={!editor}
                  onClick={() => editor?.chain().focus().toggleBlockquote().run()}
                >
                  <StrokeIcon>
                    <path d="M8.5 8H6.8A1.8 1.8 0 0 0 5 9.8v1.4A1.8 1.8 0 0 0 6.8 13H9v3H6.8A3.8 3.8 0 0 1 3 12.2V9.8A3.8 3.8 0 0 1 6.8 6H9" />
                    <path d="M18.5 8h-1.7A1.8 1.8 0 0 0 15 9.8v1.4A1.8 1.8 0 0 0 16.8 13H19v3h-2.2a3.8 3.8 0 0 1-3.8-3.8V9.8A3.8 3.8 0 0 1 16.8 6H19" />
                  </StrokeIcon>
                </ToolbarButton>
                <ToolbarButton
                  label="代码块"
                  active={Boolean(editor?.isActive('codeBlock'))}
                  disabled={!editor}
                  onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
                >
                  <TextIcon className="is-code">&lt;/&gt;</TextIcon>
                </ToolbarButton>
                <ToolbarButton label="分割线" disabled={!editor} onClick={() => editor?.chain().focus().setHorizontalRule().run()}>
                  <StrokeIcon>
                    <path d="M4 12h16" />
                  </StrokeIcon>
                </ToolbarButton>
                <ToolbarButton label="插入表格" disabled={!canInsertTable} onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
                  <StrokeIcon>
                    <rect x="4" y="5" width="16" height="14" rx="1.5" />
                    <path d="M4 10h16" />
                    <path d="M4 14h16" />
                    <path d="M10 5v14" />
                    <path d="M15 5v14" />
                  </StrokeIcon>
                </ToolbarButton>
                <ToolbarButton label="加列" disabled={!canAddColumn} onClick={() => editor?.chain().focus().addColumnAfter().run()}>
                  <StrokeIcon>
                    <rect x="4" y="6" width="11" height="12" rx="1.5" />
                    <path d="M9.5 6v12" />
                    <path d="M18 9v6" />
                    <path d="M15 12h6" />
                  </StrokeIcon>
                </ToolbarButton>
                <ToolbarButton label="加行" disabled={!canAddRow} onClick={() => editor?.chain().focus().addRowAfter().run()}>
                  <StrokeIcon>
                    <rect x="4" y="5" width="12" height="11" rx="1.5" />
                    <path d="M4 10.5h12" />
                    <path d="M18 16v6" />
                    <path d="M15 19h6" />
                  </StrokeIcon>
                </ToolbarButton>
                <ToolbarButton label="删列" disabled={!canDeleteColumn} onClick={() => editor?.chain().focus().deleteColumn().run()}>
                  <StrokeIcon>
                    <rect x="4" y="6" width="11" height="12" rx="1.5" />
                    <path d="M9.5 6v12" />
                    <path d="M15 12h6" />
                  </StrokeIcon>
                </ToolbarButton>
                <ToolbarButton label="删行" disabled={!canDeleteRow} onClick={() => editor?.chain().focus().deleteRow().run()}>
                  <StrokeIcon>
                    <rect x="4" y="5" width="12" height="11" rx="1.5" />
                    <path d="M4 10.5h12" />
                    <path d="M15 19h6" />
                  </StrokeIcon>
                </ToolbarButton>
                <ToolbarButton
                  label="表头"
                  active={Boolean(editor?.isActive('tableHeader'))}
                  disabled={!canToggleHeaderRow}
                  onClick={() => editor?.chain().focus().toggleHeaderRow().run()}
                >
                  <StrokeIcon>
                    <rect x="4" y="5" width="16" height="14" rx="1.5" />
                    <path d="M4 10h16" />
                    <path d="M10 5v14" />
                    <path d="M15 5v14" />
                    <path d="M4 5h16" />
                  </StrokeIcon>
                </ToolbarButton>
                <ToolbarButton label="删表" disabled={!canDeleteTable} onClick={() => editor?.chain().focus().deleteTable().run()}>
                  <StrokeIcon>
                    <rect x="4" y="5" width="16" height="14" rx="1.5" />
                    <path d="M4 10h16" />
                    <path d="M10 5v14" />
                    <path d="M15 5v14" />
                    <path d="M7 8l10 8" />
                    <path d="M17 8l-10 8" />
                  </StrokeIcon>
                </ToolbarButton>
                <ToolbarButton
                  label="目录"
                  active={showToc}
                  disabled={!editor}
                  onClick={() => setShowToc((v) => !v)}
                >
                  <StrokeIcon>
                    <path d="M4.5 6.5h15" />
                    <path d="M4.5 12h15" />
                    <path d="M4.5 17.5h15" />
                  </StrokeIcon>
                </ToolbarButton>
                <ToolbarButton
                  label="自动编号"
                  active={showNumbering}
                  disabled={!editor}
                  onClick={() => setShowNumbering((v) => !v)}
                >
                  <TextIcon>1.</TextIcon>
                </ToolbarButton>
              </div>
              <div className="notes-editor-surface">
                <EditorContent editor={editor} />
              </div>
            </>
          ) : (
            <div className="notes-loading">正在准备笔记…</div>
          )}
        </section>

        {showToc && (
          <div className="notes-toc-panel">
            {tocItems.length > 0 ? tocItems.map((item) => (
              <button
                key={item.pos}
                className="notes-toc-item"
                style={{ paddingLeft: `${12 + (item.level - 1) * 16}px` }}
                onClick={() => scrollToHeading(item.pos)}
                title={item.text}
              >
                {item.text || '(空标题)'}
              </button>
            )) : (
              <div className="notes-toc-empty">当前笔记无标题</div>
            )}
          </div>
        )}

        <aside className="notes-tabbar" role="tablist" aria-label="笔记标签">
          {DEFAULT_NOTE_NAMES.map((name, index) => {
            const note = notesRef.current?.[index];
            const displayName = note?.title || name;
            const isActive = index === activeIndex;
            return (
              <button
                key={index}
                className={`notes-tab-btn${isActive ? ' is-active' : ''}`}
                role="tab"
                aria-selected={isActive}
                aria-label={displayName}
                title={displayName}
                onClick={() => handleTabSwitch(index)}
              >
                {displayName}
              </button>
            );
          })}
        </aside>
      </div>
    </div>
  );
}
