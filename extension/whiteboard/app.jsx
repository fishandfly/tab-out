import { useEffect, useRef, useState } from 'react';
import { Excalidraw, loadFromBlob, serializeAsJSON } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

const FALLBACK_STORAGE_KEY = 'tab-out-whiteboard-global-v1';
const FALLBACK_TITLE = '白板';
const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';

function getIsSystemDarkMode() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia(SYSTEM_THEME_QUERY).matches;
}

function createFallbackStateApi() {
  return {
    WHITEBOARD_STORAGE_KEY: FALLBACK_STORAGE_KEY,
    createEmptyWhiteboardState() {
      return {
        title: FALLBACK_TITLE,
        type: 'excalidraw',
        version: 2,
        source: 'tab-out',
        elements: [],
        appState: {},
        files: {},
        updatedAt: new Date().toISOString(),
      };
    },
    normalizeWhiteboardScene(scene) {
      const safeScene = scene && typeof scene === 'object' && !Array.isArray(scene) ? scene : {};
      const title = typeof safeScene.title === 'string'
        ? safeScene.title.replace(/\s+/g, ' ').trim()
        : '';
      return {
        title: title || FALLBACK_TITLE,
        type: typeof safeScene.type === 'string' && safeScene.type ? safeScene.type : 'excalidraw',
        version: Number.isFinite(Number(safeScene.version)) ? Number(safeScene.version) : 2,
        source: typeof safeScene.source === 'string' && safeScene.source ? safeScene.source : 'tab-out',
        elements: Array.isArray(safeScene.elements) ? safeScene.elements : [],
        appState: safeScene.appState && typeof safeScene.appState === 'object' && !Array.isArray(safeScene.appState)
          ? safeScene.appState
          : {},
        files: safeScene.files && typeof safeScene.files === 'object' && !Array.isArray(safeScene.files)
          ? safeScene.files
          : {},
        updatedAt: typeof safeScene.updatedAt === 'string' && safeScene.updatedAt
          ? safeScene.updatedAt
          : new Date().toISOString(),
      };
    },
    importWhiteboardScene(text) {
      return this.normalizeWhiteboardScene(JSON.parse(text));
    },
  };
}

const whiteboardStateApi = window.TabOutWhiteboardState || createFallbackStateApi();
const WHITEBOARD_STORAGE_KEY = whiteboardStateApi.WHITEBOARD_STORAGE_KEY || FALLBACK_STORAGE_KEY;
const DEFAULT_WHITEBOARD_TITLE = whiteboardStateApi.DEFAULT_WHITEBOARD_TITLE || FALLBACK_TITLE;

function getWhiteboardStorage() {
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
    ? title.replace(/\s+/g, ' ').trim()
    : '';
  return cleaned || DEFAULT_WHITEBOARD_TITLE;
}

function sanitizeFilenameTitle(title) {
  const cleaned = normalizeTitle(title)
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || DEFAULT_WHITEBOARD_TITLE;
}

function buildExportFilename(title) {
  return `${sanitizeFilenameTitle(title)}.excalidraw`;
}

function getTitleFromFilename(filename) {
  if (typeof filename !== 'string') return DEFAULT_WHITEBOARD_TITLE;
  const cleaned = filename.replace(/\.excalidraw$/i, '');
  return normalizeTitle(cleaned);
}

function downloadTextFile(filename, content, mimeType = 'application/vnd.excalidraw+json;charset=utf-8') {
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

async function loadPersistedScene() {
  const storage = getWhiteboardStorage();
  const result = await storage.get(WHITEBOARD_STORAGE_KEY);
  const stored = result?.[WHITEBOARD_STORAGE_KEY];
  if (!stored) {
    return whiteboardStateApi.createEmptyWhiteboardState();
  }
  return whiteboardStateApi.normalizeWhiteboardScene(stored);
}

async function savePersistedScene(scene) {
  const storage = getWhiteboardStorage();
  const normalized = whiteboardStateApi.normalizeWhiteboardScene(scene);
  await storage.set({
    [WHITEBOARD_STORAGE_KEY]: normalized,
  });
  return normalized;
}

function sceneFromApi(api) {
  const serialized = serializeAsJSON(
    api.getSceneElementsIncludingDeleted(),
    api.getAppState(),
    api.getFiles(),
    'local'
  );
  return whiteboardStateApi.importWhiteboardScene(serialized);
}

export default function WhiteboardApp() {
  const appHostRef = useRef(null);
  const apiRef = useRef(null);
  const fileInputRef = useRef(null);
  const titleInputRef = useRef(null);
  const saveTimerRef = useRef(0);
  const [initialScene, setInitialScene] = useState(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(getIsSystemDarkMode);
  const [title, setTitle] = useState(DEFAULT_WHITEBOARD_TITLE);
  const [draftTitle, setDraftTitle] = useState(DEFAULT_WHITEBOARD_TITLE);
  const [isEditingTitle, setIsEditingTitle] = useState(false);

  useEffect(() => {
    let disposed = false;

    loadPersistedScene()
      .then((scene) => {
        if (disposed) return;
        setInitialScene(scene);
        setTitle(normalizeTitle(scene.title));
        setDraftTitle(normalizeTitle(scene.title));
      })
      .catch((err) => {
        console.error('[tab-out] Failed to load whiteboard scene:', err);
        if (disposed) return;
        const fallbackScene = whiteboardStateApi.createEmptyWhiteboardState();
        setInitialScene(fallbackScene);
        setTitle(normalizeTitle(fallbackScene.title));
        setDraftTitle(normalizeTitle(fallbackScene.title));
      });

    return () => {
      disposed = true;
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isEditingTitle) return;
    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }, [isEditingTitle]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;

    const mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY);
    const handleChange = (event) => {
      setIsDarkMode(event.matches);
    };

    setIsDarkMode(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

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

  async function persistCurrentScene(nextTitle = title) {
    const normalizedTitle = normalizeTitle(nextTitle);
    const api = apiRef.current;
    if (!api) {
      if (!initialScene) return null;
      const nextScene = {
        ...initialScene,
        title: normalizedTitle,
      };
      setInitialScene(nextScene);
      return savePersistedScene(nextScene);
    }

    const nextScene = {
      ...sceneFromApi(api),
      title: normalizedTitle,
    };
    setInitialScene(nextScene);
    return savePersistedScene(nextScene);
  }

  function handleSceneChange(elements, appState, files) {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(async () => {
      try {
        const scene = whiteboardStateApi.normalizeWhiteboardScene({
          ...whiteboardStateApi.importWhiteboardScene(
            serializeAsJSON(elements, appState, files, 'local')
          ),
          title,
        });
        setInitialScene(scene);
        await savePersistedScene(scene);
      } catch (err) {
        console.error('[tab-out] Failed to autosave whiteboard:', err);
      }
    }, 480);
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
      console.error('[tab-out] Failed to toggle fullscreen:', err);
    }
  }

  function handlePickImport() {
    fileInputRef.current?.click();
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
      await persistCurrentScene(nextTitle);
    } catch (err) {
      console.error('[tab-out] Failed to save whiteboard title:', err);
    }
  }

  function handleCancelTitleEdit() {
    setDraftTitle(title);
    setIsEditingTitle(false);
  }

  async function handleImportChange(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const api = apiRef.current;
    if (!api) return;

    try {
      setIsBusy(true);
      const restoredScene = await loadFromBlob(
        file,
        api.getAppState(),
        api.getSceneElementsIncludingDeleted(),
      );

      api.updateScene(restoredScene);
      api.history.clear();

      const nextTitle = getTitleFromFilename(file.name);
      setTitle(nextTitle);
      setDraftTitle(nextTitle);
      setIsEditingTitle(false);
      await persistCurrentScene(nextTitle);
    } catch (err) {
      console.error('[tab-out] Failed to import whiteboard:', err);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleExportScene() {
    const api = apiRef.current;
    if (!api) return;

    try {
      setIsBusy(true);
      const serialized = serializeAsJSON(
        api.getSceneElementsIncludingDeleted(),
        api.getAppState(),
        api.getFiles(),
        'local'
      );
      await savePersistedScene(whiteboardStateApi.normalizeWhiteboardScene({
        ...whiteboardStateApi.importWhiteboardScene(serialized),
        title,
      }));
      downloadTextFile(buildExportFilename(title), serialized);
    } catch (err) {
      console.error('[tab-out] Failed to export whiteboard:', err);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className={`whiteboard-app${isFullscreen ? ' is-fullscreen' : ''}`} ref={appHostRef}>
      <header className="whiteboard-toolbar">
        <div className="whiteboard-toolbar-copy">
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              className="whiteboard-title-input"
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
              aria-label="白板标题"
            />
          ) : (
            <h1 className="whiteboard-title" onDoubleClick={handleStartTitleEdit} title="双击编辑标题">
              {title}
            </h1>
          )}
        </div>

        <div className="whiteboard-toolbar-actions">
          <input
            ref={fileInputRef}
            className="whiteboard-file-input"
            type="file"
            accept=".excalidraw,application/json,application/vnd.excalidraw+json"
            onChange={handleImportChange}
            hidden
          />
          <button className="whiteboard-toolbar-btn" type="button" onClick={handleToggleFullscreen}>
            {isFullscreen ? '退出全屏' : '全屏'}
          </button>
          <button
            className="whiteboard-toolbar-btn"
            type="button"
            onClick={handlePickImport}
            disabled={!initialScene || isBusy}
          >
            导入 .excalidraw
          </button>
          <button
            className="whiteboard-toolbar-btn is-primary"
            type="button"
            onClick={handleExportScene}
            disabled={!initialScene || isBusy}
          >
            导出 .excalidraw
          </button>
        </div>
      </header>

      <section className="whiteboard-canvas-shell">
        {initialScene ? (
          <div className="whiteboard-canvas">
            <Excalidraw
              initialData={{
                ...initialScene,
                scrollToContent: true,
              }}
              excalidrawAPI={(api) => {
                apiRef.current = api;
              }}
              onChange={handleSceneChange}
              theme={isDarkMode ? 'dark' : 'light'}
            />
          </div>
        ) : (
          <div className="whiteboard-loading">正在准备 Excalidraw…</div>
        )}
      </section>
    </div>
  );
}
