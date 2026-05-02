(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TabOutWhiteboardState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const WHITEBOARD_STORAGE_KEY = 'tab-out-whiteboard-global-v1';
  const DEFAULT_WHITEBOARD_TITLE = '白板';

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeWhiteboardTitle(title) {
    const cleanedTitle = typeof title === 'string'
      ? title.replace(/\s+/g, ' ').trim()
      : '';
    return cleanedTitle || DEFAULT_WHITEBOARD_TITLE;
  }

  function createEmptyWhiteboardState() {
    return {
      title: DEFAULT_WHITEBOARD_TITLE,
      type: 'excalidraw',
      version: 2,
      source: 'tab-out',
      elements: [],
      appState: {},
      files: {},
      updatedAt: nowIso(),
    };
  }

  function clonePlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return { ...value };
  }

  function normalizeWhiteboardScene(scene) {
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) {
      throw new Error('白板文件无效');
    }

    return {
      title: normalizeWhiteboardTitle(scene.title),
      type: typeof scene.type === 'string' && scene.type ? scene.type : 'excalidraw',
      version: Number.isFinite(Number(scene.version)) ? Number(scene.version) : 2,
      source: typeof scene.source === 'string' && scene.source ? scene.source : 'tab-out',
      elements: Array.isArray(scene.elements) ? scene.elements : [],
      appState: clonePlainObject(scene.appState),
      files: clonePlainObject(scene.files),
      updatedAt: typeof scene.updatedAt === 'string' && scene.updatedAt ? scene.updatedAt : nowIso(),
    };
  }

  function exportWhiteboardScene(scene) {
    return JSON.stringify(normalizeWhiteboardScene(scene), null, 2);
  }

  function importWhiteboardScene(text) {
    try {
      return normalizeWhiteboardScene(JSON.parse(text));
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error('白板文件无法解析');
      }
      throw err;
    }
  }

  return {
    WHITEBOARD_STORAGE_KEY,
    DEFAULT_WHITEBOARD_TITLE,
    createEmptyWhiteboardState,
    normalizeWhiteboardScene,
    exportWhiteboardScene,
    importWhiteboardScene,
  };
});
