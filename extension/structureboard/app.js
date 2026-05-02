(function () {
  'use strict';

  const DRAWIO_EMBED_URL = 'https://embed.diagrams.net/?embed=1&proto=json&spin=1&ui=min&libraries=1&saveAndExit=0&noExitBtn=1&modified=0&format=0&sidebar=0';
  const FALLBACK_STORAGE_KEY = 'tab-out-structureboard-global-v1';
  const DEFAULT_STRUCTUREBOARD_TITLE = '结构图';
  const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';

  function createFallbackStateApi() {
    const emptyXml = '<?xml version="1.0" encoding="UTF-8"?><mxfile host="app.diagrams.net" version="24.7.17"><diagram id="tabout-structure" name="Page-1"><mxGraphModel dx="1280" dy="720" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1200" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

    return {
      STRUCTUREBOARD_STORAGE_KEY: FALLBACK_STORAGE_KEY,
      DEFAULT_STRUCTUREBOARD_TITLE,
      createEmptyStructureboardState() {
        return {
          title: DEFAULT_STRUCTUREBOARD_TITLE,
          type: 'drawio',
          xml: emptyXml,
          updatedAt: new Date().toISOString(),
        };
      },
      normalizeStructureboardDocument(doc) {
        const safeDoc = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
        const title = typeof safeDoc.title === 'string'
          ? safeDoc.title.replace(/\.drawio$/i, '').replace(/\.xml$/i, '').replace(/\s+/g, ' ').trim()
          : '';
        const xml = typeof safeDoc.xml === 'string' && /<mxfile[\s>]/i.test(safeDoc.xml)
          ? safeDoc.xml.trim()
          : emptyXml;

        return {
          title: title || DEFAULT_STRUCTUREBOARD_TITLE,
          type: typeof safeDoc.type === 'string' && safeDoc.type ? safeDoc.type : 'drawio',
          xml,
          updatedAt: typeof safeDoc.updatedAt === 'string' && safeDoc.updatedAt
            ? safeDoc.updatedAt
            : new Date().toISOString(),
        };
      },
      importStructureboardDocument(text, options = {}) {
        if (typeof text !== 'string' || !/<mxfile[\s>]/i.test(text)) {
          throw new Error('结构图文件无法解析');
        }

        return this.normalizeStructureboardDocument({
          title: options.title,
          type: 'drawio',
          xml: text,
        });
      },
      exportStructureboardDocument(doc) {
        return this.normalizeStructureboardDocument(doc).xml;
      },
    };
  }

  const structureboardStateApi = window.TabOutStructureboardState || createFallbackStateApi();
  const STRUCTUREBOARD_STORAGE_KEY = structureboardStateApi.STRUCTUREBOARD_STORAGE_KEY || FALLBACK_STORAGE_KEY;

  function getStructureboardStorage() {
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
      ? title.replace(/\.drawio$/i, '').replace(/\.xml$/i, '').replace(/\s+/g, ' ').trim()
      : '';
    return cleaned || DEFAULT_STRUCTUREBOARD_TITLE;
  }

  function sanitizeFilenameTitle(title) {
    const cleaned = normalizeTitle(title)
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || DEFAULT_STRUCTUREBOARD_TITLE;
  }

  function buildExportFilename(title) {
    return `${sanitizeFilenameTitle(title)}.drawio`;
  }

  function getTitleFromFilename(filename) {
    if (typeof filename !== 'string') return DEFAULT_STRUCTUREBOARD_TITLE;
    return normalizeTitle(filename);
  }

  function downloadTextFile(filename, content, mimeType = 'application/xml;charset=utf-8') {
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

  async function loadPersistedDocument() {
    const storage = getStructureboardStorage();
    const result = await storage.get(STRUCTUREBOARD_STORAGE_KEY);
    const stored = result?.[STRUCTUREBOARD_STORAGE_KEY];
    if (!stored) {
      return structureboardStateApi.createEmptyStructureboardState();
    }
    return structureboardStateApi.normalizeStructureboardDocument(stored);
  }

  async function savePersistedDocument(doc) {
    const storage = getStructureboardStorage();
    const normalized = structureboardStateApi.normalizeStructureboardDocument(doc);
    await storage.set({
      [STRUCTUREBOARD_STORAGE_KEY]: normalized,
    });
    return normalized;
  }

  let currentDocument = structureboardStateApi.createEmptyStructureboardState();
  let persistTimerId = 0;
  let exportFallbackTimerId = 0;
  let exportPending = false;
  let isEditingTitle = false;
  let isFullscreen = false;
  let frameEl = null;
  let frameSessionId = 0;
  let isDarkMode = typeof window.matchMedia === 'function'
    ? window.matchMedia(SYSTEM_THEME_QUERY).matches
    : false;
  const systemThemeQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia(SYSTEM_THEME_QUERY)
    : null;

  const appHostEl = document.getElementById('structureboardApp');
  const titleEl = document.getElementById('structureboardTitle');
  const titleInputEl = document.getElementById('structureboardTitleInput');
  const canvasEl = document.getElementById('structureboardCanvas');
  const loadingEl = document.getElementById('structureboardLoading');
  const fullscreenBtnEl = document.getElementById('structureboardFullscreenBtn');
  const importBtnEl = document.getElementById('structureboardImportBtn');
  const exportBtnEl = document.getElementById('structureboardExportBtn');
  const importInputEl = document.getElementById('structureboardImportInput');

  function syncThemeMarker() {
    document.documentElement.dataset.theme = isDarkMode ? 'dark' : 'light';
  }

  function setLoadingVisible(visible) {
    loadingEl.classList.toggle('is-hidden', !visible);
  }

  function setBusy(isBusy) {
    importBtnEl.disabled = isBusy;
    exportBtnEl.disabled = isBusy;
    fullscreenBtnEl.disabled = isBusy;
  }

  function renderTitle() {
    const title = normalizeTitle(currentDocument.title);
    titleEl.textContent = title;
    titleInputEl.value = title;
    titleEl.hidden = isEditingTitle;
    titleInputEl.hidden = !isEditingTitle;
  }

  function queuePersistDocument(nextDocument) {
    currentDocument = structureboardStateApi.normalizeStructureboardDocument(nextDocument);
    renderTitle();

    if (persistTimerId) {
      window.clearTimeout(persistTimerId);
    }

    persistTimerId = window.setTimeout(() => {
      persistTimerId = 0;
      savePersistedDocument(currentDocument).catch((err) => {
        console.error('[tab-out] Failed to autosave structureboard:', err);
      });
    }, 320);
  }

  function commitTitle(nextTitle) {
    isEditingTitle = false;
    currentDocument = structureboardStateApi.normalizeStructureboardDocument({
      ...currentDocument,
      title: nextTitle,
    });
    renderTitle();
    savePersistedDocument(currentDocument).catch((err) => {
      console.error('[tab-out] Failed to save structureboard title:', err);
    });
  }

  function postToEditor(payload) {
    if (!frameEl?.contentWindow) return false;
    frameEl.contentWindow.postMessage(JSON.stringify(payload), 'https://embed.diagrams.net');
    return true;
  }

  function remountEditor() {
    frameSessionId += 1;
    frameEl = document.createElement('iframe');
    frameEl.className = 'structureboard-embed-frame';
    frameEl.src = `${DRAWIO_EMBED_URL}&dark=${isDarkMode ? '1' : '0'}&taboutSession=${frameSessionId}`;
    frameEl.title = 'draw.io 结构图';
    frameEl.setAttribute('loading', 'lazy');
    canvasEl.innerHTML = '';
    canvasEl.appendChild(frameEl);
    setLoadingVisible(true);
  }

  function handleSystemThemeChange(event) {
    const nextIsDarkMode = Boolean(event.matches);
    if (nextIsDarkMode === isDarkMode) return;

    isDarkMode = nextIsDarkMode;
    syncThemeMarker();
    remountEditor();
  }

  function finalizeExport(xml) {
    exportPending = false;
    if (exportFallbackTimerId) {
      window.clearTimeout(exportFallbackTimerId);
      exportFallbackTimerId = 0;
    }
    setBusy(false);

    const nextDocument = structureboardStateApi.normalizeStructureboardDocument({
      ...currentDocument,
      xml: xml || currentDocument.xml,
    });
    currentDocument = nextDocument;
    renderTitle();
    savePersistedDocument(nextDocument).catch((err) => {
      console.error('[tab-out] Failed to persist structureboard before export:', err);
    });
    downloadTextFile(
      buildExportFilename(nextDocument.title),
      structureboardStateApi.exportStructureboardDocument(nextDocument)
    );
  }

  async function handleImportFile(file) {
    const text = await file.text();
    currentDocument = structureboardStateApi.importStructureboardDocument(text, {
      title: getTitleFromFilename(file.name),
    });
    renderTitle();
    await savePersistedDocument(currentDocument);
    remountEditor();
  }

  async function toggleFullscreen() {
    if (!appHostEl) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await appHostEl.requestFullscreen();
      }
    } catch (err) {
      console.error('[tab-out] Failed to toggle structureboard fullscreen:', err);
    }
  }

  titleEl.addEventListener('dblclick', () => {
    isEditingTitle = true;
    renderTitle();
    requestAnimationFrame(() => {
      titleInputEl.focus();
      titleInputEl.select();
    });
  });

  titleInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitTitle(titleInputEl.value);
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      isEditingTitle = false;
      renderTitle();
    }
  });

  titleInputEl.addEventListener('blur', () => {
    if (!isEditingTitle) return;
    commitTitle(titleInputEl.value);
  });

  fullscreenBtnEl.addEventListener('click', () => {
    toggleFullscreen();
  });

  importBtnEl.addEventListener('click', () => {
    importInputEl.click();
  });

  importInputEl.addEventListener('change', async () => {
    const file = importInputEl.files?.[0];
    importInputEl.value = '';
    if (!file) return;

    setBusy(true);
    try {
      await handleImportFile(file);
    } catch (err) {
      console.error('[tab-out] Failed to import structureboard:', err);
    } finally {
      setBusy(false);
    }
  });

  exportBtnEl.addEventListener('click', () => {
    if (exportPending) return;

    if (!frameEl?.contentWindow) {
      finalizeExport(currentDocument.xml);
      return;
    }

    exportPending = true;
    setBusy(true);
    const dispatched = postToEditor({
      action: 'export',
      format: 'xmlsvg',
    });

    if (!dispatched) {
      finalizeExport(currentDocument.xml);
      return;
    }

    exportFallbackTimerId = window.setTimeout(() => {
      if (!exportPending) return;
      finalizeExport(currentDocument.xml);
    }, 1600);
  });

  document.addEventListener('fullscreenchange', () => {
    isFullscreen = Boolean(document.fullscreenElement);
    fullscreenBtnEl.textContent = isFullscreen ? '退出全屏' : '全屏';
  });

  window.addEventListener('message', (event) => {
    if (event.origin !== 'https://embed.diagrams.net') return;
    if (!frameEl?.contentWindow || event.source !== frameEl.contentWindow) return;

    let payload = event.data;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        return;
      }
    }

    if (!payload || typeof payload !== 'object') return;

    if (payload.event === 'init') {
      postToEditor({
        action: 'load',
        autosave: 1,
        title: normalizeTitle(currentDocument.title),
        xml: currentDocument.xml,
      });
      setLoadingVisible(false);
      return;
    }

    if (payload.event === 'autosave' || payload.event === 'save') {
      if (typeof payload.xml !== 'string' || !payload.xml) return;
      queuePersistDocument({
        ...currentDocument,
        xml: payload.xml,
      });
      return;
    }

    if (payload.event === 'export') {
      finalizeExport(typeof payload.xml === 'string' && payload.xml ? payload.xml : currentDocument.xml);
      return;
    }

    if (payload.event === 'openLink' && typeof payload.href === 'string' && payload.href) {
      window.open(payload.href, payload.target || '_blank', 'noopener');
    }
  });

  window.addEventListener('beforeunload', () => {
    if (persistTimerId) {
      window.clearTimeout(persistTimerId);
      persistTimerId = 0;
    }

    if (exportFallbackTimerId) {
      window.clearTimeout(exportFallbackTimerId);
      exportFallbackTimerId = 0;
    }

    if (systemThemeQuery) {
      if (typeof systemThemeQuery.removeEventListener === 'function') {
        systemThemeQuery.removeEventListener('change', handleSystemThemeChange);
      } else {
        systemThemeQuery.removeListener(handleSystemThemeChange);
      }
    }
  });

  syncThemeMarker();

  if (systemThemeQuery) {
    if (typeof systemThemeQuery.addEventListener === 'function') {
      systemThemeQuery.addEventListener('change', handleSystemThemeChange);
    } else {
      systemThemeQuery.addListener(handleSystemThemeChange);
    }
  }

  loadPersistedDocument()
    .then((doc) => {
      currentDocument = structureboardStateApi.normalizeStructureboardDocument(doc);
      renderTitle();
      remountEditor();
    })
    .catch((err) => {
      console.error('[tab-out] Failed to load structureboard document:', err);
      currentDocument = structureboardStateApi.createEmptyStructureboardState();
      renderTitle();
      remountEditor();
    });
})();
