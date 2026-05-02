/* ================================================================
   Tab Out — Dashboard App (Pure Extension Edition)

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads open browser tabs directly via chrome.tabs.query()
   2. Groups tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, save for later, focus tab)
   5. Stores "Saved for Later" tabs in chrome.storage.local (no server)
   ================================================================ */

'use strict';


/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS the extension's new tab page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

// All open tabs — populated by fetchOpenTabs()
let openTabs = [];
const GTD_STORAGE_FALLBACK_KEY = 'tab-out-gtd-fallback';
const POMODORO_STORAGE_KEY = 'tab-out-pomodoro';
const UI_PREFS_STORAGE_KEY = 'tab-out-ui-prefs';
const POMODORO_DURATION_MS = 25 * 60 * 1000;
const ENCOURAGEMENT_ROTATION_MS = 20 * 60 * 1000;
const BACKGROUND_THEME_ROTATION_MS = 12 * 60 * 1000;
const BACKGROUND_THEME_GROUPS = {
  epic: [
    'summit-gold',
    'glacier-run',
    'canyon-wind',
    'aurora-arc',
  ],
  sport: [
    'stadium-flare',
    'midnight-track',
    'ocean-sprint',
    'sunrise-motion',
  ],
};
const BACKGROUND_THEME_DIRECTIONS = ['epic', 'sport'];
const BACKGROUND_REMOTE_API_URL = 'https://wallhaven.cc/api/v1/search';
const BACKGROUND_DIRECT_FALLBACK_ROOT = 'https://loremflickr.com/2400/1350';
const BACKGROUND_REMOTE_FETCH_TIMEOUT_MS = 12000;
const BACKGROUND_REMOTE_IMAGE_TIMEOUT_MS = 15000;
const BACKGROUND_RECENT_PHOTO_LIMIT = 18;
const BACKGROUND_MAX_FILE_SIZE_BYTES = 14 * 1024 * 1024;
const BACKGROUND_REMOTE_QUERIES = {
  epic: [
    { key: 'summit-dawn', label: '山海晨光', query: 'alpine sunrise', categories: '100' },
    { key: 'glacier-plain', label: '雪峰冰川', query: 'glacier valley', categories: '100' },
    { key: 'canyon-storm', label: '峡谷长风', query: 'desert canyon', categories: '100' },
    { key: 'aurora-night', label: '极光夜空', query: 'aurora sky', categories: '100' },
    { key: 'ocean-force', label: '海面风暴', query: 'storm ocean', categories: '100' },
    { key: 'forest-ridge', label: '森林山脊', query: 'forest ridge', categories: '100' },
  ],
  sport: [
    { key: 'stadium-lights', label: '球场灯火', query: 'stadium lights', categories: '101' },
    { key: 'track-speed', label: '赛道速度', query: 'running track', categories: '101' },
    { key: 'cycling-surge', label: '骑行冲刺', query: 'cycling race', categories: '101' },
    { key: 'surf-energy', label: '冲浪瞬间', query: 'surf action', categories: '101' },
    { key: 'court-tension', label: '篮场张力', query: 'basketball court', categories: '101' },
    { key: 'marathon-flow', label: '晨跑动势', query: 'marathon city', categories: '101' },
  ],
};
let activeGtdComposerQuadrant = '';
let activeGtdEditingTaskId = '';
let pomodoroState = null;
let pomodoroTickerId = 0;
let pomodoroToggleTimerId = 0;
let backgroundThemeRotationId = 0;
let currentBackgroundDirection = '';
let backgroundPhotoLayerIndex = -1;
let backgroundRequestSequence = 0;
let recentBackgroundPhotoIds = [];
let lastBackgroundQueryByDirection = {
  epic: '',
  sport: '',
};
let encouragementTimeoutId = 0;
let encouragementIntervalId = 0;
let gtdTaskSelectionTimerId = 0;
let gtdCompositionActive = false;
let activeGtdDraggingTaskId = '';
let activeGtdStepDragState = null;
let activeGtdEditingStepId = '';
let pendingGtdRenderOptions = null;
let uiPrefs = {
  gtdCollapsed: false,
  workspaceTab: 'gtd',
};
let optionalConfigLoadPromise = null;

function getExtensionAssetUrl(relativePath) {
  if (typeof chrome !== 'undefined' && chrome?.runtime?.getURL) {
    return chrome.runtime.getURL(relativePath);
  }
  return relativePath;
}

function loadOptionalConfig() {
  if (optionalConfigLoadPromise) return optionalConfigLoadPromise;

  const configUrl = getExtensionAssetUrl('config.local.js');
  optionalConfigLoadPromise = fetch(configUrl, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) return false;

      return new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = configUrl;
        script.async = false;
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
      });
    })
    .catch(() => false);

  return optionalConfigLoadPromise;
}

function initAssetFallbacks() {
  if (document.documentElement.dataset.assetFallbacksBound === 'true') return;
  document.documentElement.dataset.assetFallbacksBound = 'true';

  document.addEventListener('error', (e) => {
    const target = e.target;
    if (target instanceof HTMLImageElement && target.dataset.hideOnError === 'true') {
      target.style.display = 'none';
    }
  }, true);
}

function getGtdStorage() {
  if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
    return chrome.storage.local;
  }

  return {
    async get(key) {
      try {
        const raw = localStorage.getItem(GTD_STORAGE_FALLBACK_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return { [key]: parsed[key] };
      } catch {
        return { [key]: {} };
      }
    },
    async set(payload) {
      try {
        const raw = localStorage.getItem(GTD_STORAGE_FALLBACK_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        localStorage.setItem(GTD_STORAGE_FALLBACK_KEY, JSON.stringify({ ...parsed, ...payload }));
      } catch {
        // ignore dev-only fallback failures
      }
    },
  };
}

function normalizeWorkspaceTab(value) {
  return value === 'whiteboard' || value === 'notes' || value === 'structure' ? value : 'gtd';
}

function loadUiPrefs() {
  try {
    const raw = localStorage.getItem(UI_PREFS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    uiPrefs = {
      ...uiPrefs,
      gtdCollapsed: Boolean(parsed.gtdCollapsed),
      workspaceTab: 'gtd',
    };
  } catch {
    // ignore invalid persisted prefs
  }
}

function saveUiPrefs() {
  try {
    localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify({
      gtdCollapsed: uiPrefs.gtdCollapsed,
    }));
  } catch {
    // ignore local persistence failure
  }
}

function pickRandomFromPool(items, excludePredicate = null) {
  if (!Array.isArray(items) || !items.length) return null;
  const filtered = typeof excludePredicate === 'function' ? items.filter((item) => !excludePredicate(item)) : items;
  const pool = filtered.length ? filtered : items;
  return pool[Math.floor(Math.random() * pool.length)] || null;
}

function getRandomBackgroundThemeFromGroup(direction, currentTheme = '') {
  const themes = BACKGROUND_THEME_GROUPS[direction] || [];
  if (!themes.length) return '';
  if (themes.length === 1) return themes[0];
  const choice = pickRandomFromPool(themes, (theme) => currentTheme && theme === currentTheme);
  return choice || themes[0];
}

function getNextBackgroundDirection(currentDirection = '') {
  if (!BACKGROUND_THEME_DIRECTIONS.length) return '';
  if (!currentDirection || !BACKGROUND_THEME_DIRECTIONS.includes(currentDirection)) {
    return BACKGROUND_THEME_DIRECTIONS[Math.floor(Math.random() * BACKGROUND_THEME_DIRECTIONS.length)];
  }

  const currentIndex = BACKGROUND_THEME_DIRECTIONS.indexOf(currentDirection);
  return BACKGROUND_THEME_DIRECTIONS[(currentIndex + 1) % BACKGROUND_THEME_DIRECTIONS.length];
}

function getNextBackgroundTheme(currentTheme = '', currentDirection = '') {
  const nextDirection = getNextBackgroundDirection(currentDirection);
  const nextTheme = getRandomBackgroundThemeFromGroup(nextDirection, currentTheme);
  return {
    direction: nextDirection,
    theme: nextTheme,
  };
}

function getBackgroundPhotoLayers() {
  return Array.from(document.querySelectorAll('[data-background-photo-layer]'));
}

function getBackgroundCreditElements() {
  return {
    root: document.getElementById('backgroundCredit'),
    label: document.getElementById('backgroundCreditLabel'),
    link: document.getElementById('backgroundCreditLink'),
  };
}

function updateBackgroundCredit(photo) {
  const { root, label, link } = getBackgroundCreditElements();
  if (!root || !label || !link) return;

  if (!photo?.pageUrl) {
    root.hidden = true;
    label.textContent = '';
    link.href = '#';
    root.removeAttribute('title');
    return;
  }

  label.textContent = `背景：${photo.label}`;
  link.href = photo.pageUrl;
  root.title = [photo.label, photo.resolution].filter(Boolean).join(' · ');
  root.hidden = false;
}

function rememberBackgroundPhoto(photoId) {
  if (!photoId) return;
  recentBackgroundPhotoIds = [photoId, ...recentBackgroundPhotoIds.filter((id) => id !== photoId)]
    .slice(0, BACKGROUND_RECENT_PHOTO_LIMIT);
}

function pickBackgroundQuery(direction) {
  const queries = BACKGROUND_REMOTE_QUERIES[direction] || [];
  if (!queries.length) return null;
  const lastKey = lastBackgroundQueryByDirection[direction] || '';
  const choice = pickRandomFromPool(queries, (item) => lastKey && item?.key === lastKey) || queries[0];
  lastBackgroundQueryByDirection = {
    ...lastBackgroundQueryByDirection,
    [direction]: choice?.key || '',
  };
  return choice;
}

function buildWallhavenSearchUrl(direction) {
  const descriptor = pickBackgroundQuery(direction);
  if (!descriptor) return null;

  const params = new URLSearchParams({
    q: descriptor.query,
    categories: descriptor.categories || '100',
    purity: '100',
    sorting: 'random',
    ratios: '16x9,16x10',
    atleast: '1920x1080',
  });

  return {
    descriptor,
    url: `${BACKGROUND_REMOTE_API_URL}?${params.toString()}`,
  };
}

function buildDirectFallbackPhoto(direction) {
  const descriptor = pickBackgroundQuery(direction);
  if (!descriptor) return null;

  const keywordPath = descriptor.query
    .split(/\s+/)
    .map((part) => encodeURIComponent(part))
    .join(',');
  const lock = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id: `fallback-${direction}-${lock}`,
    imageUrl: `${BACKGROUND_DIRECT_FALLBACK_ROOT}/${keywordPath}?lock=${lock}`,
    pageUrl: 'https://loremflickr.com/',
    direction,
    label: `${descriptor.label} · 备用图源`,
    query: descriptor.query,
    resolution: '2400x1350',
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timerId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timerId);
  }
}

function normalizeWallhavenCandidate(item, options = {}) {
  const { allowRecent = false } = options;
  if (!item || typeof item !== 'object') return null;
  if (!item.path || !item.url || item.purity !== 'sfw') return null;
  if (item.category === 'anime') return null;
  const fileSize = Number(item.file_size) || 0;
  if (fileSize > BACKGROUND_MAX_FILE_SIZE_BYTES) return null;
  if (!allowRecent && recentBackgroundPhotoIds.includes(item.id)) return null;

  return {
    id: typeof item.id === 'string' ? item.id : '',
    imageUrl: item.path,
    pageUrl: item.url,
    favorites: Number(item.favorites) || 0,
    views: Number(item.views) || 0,
    resolution: item.resolution || '',
  };
}

async function fetchRemoteBackground(direction) {
  const request = buildWallhavenSearchUrl(direction);
  if (!request?.url) return null;

  const response = await fetchWithTimeout(request.url, {
    cache: 'no-store',
    credentials: 'omit',
  }, BACKGROUND_REMOTE_FETCH_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`background-search-${response.status}`);
  }

  const payload = await response.json();
  const rawItems = Array.isArray(payload?.data) ? payload.data : [];
  const candidates = rawItems.map((item) => normalizeWallhavenCandidate(item)).filter(Boolean);
  const fallbackCandidates = rawItems
    .map((item) => normalizeWallhavenCandidate(item, { allowRecent: true }))
    .filter(Boolean);

  const usableCandidates = candidates.length ? candidates : fallbackCandidates;

  if (!usableCandidates.length) {
    throw new Error('background-search-empty');
  }

  const ranked = usableCandidates.sort((left, right) => {
    if (right.favorites !== left.favorites) return right.favorites - left.favorites;
    return right.views - left.views;
  });
  const shortlist = ranked.slice(0, Math.min(8, ranked.length));
  const chosen = pickRandomFromPool(shortlist) || ranked[0];

  return {
    ...chosen,
    direction,
    label: request.descriptor.label,
    query: request.descriptor.query,
  };
}

function preloadBackgroundImage(imageUrl) {
  return new Promise((resolve, reject) => {
    if (!imageUrl) {
      reject(new Error('background-image-empty'));
      return;
    }

    const image = new Image();
    const timerId = window.setTimeout(() => {
      reject(new Error('background-image-timeout'));
    }, BACKGROUND_REMOTE_IMAGE_TIMEOUT_MS);

    image.onload = () => {
      window.clearTimeout(timerId);
      resolve(imageUrl);
    };
    image.onerror = () => {
      window.clearTimeout(timerId);
      reject(new Error('background-image-error'));
    };
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.src = imageUrl;
  });
}

function buildBackgroundPhotoCss(photo) {
  const escapedUrl = String(photo?.imageUrl || '').replace(/"/g, '\\"');
  const directionTint = photo?.direction === 'sport'
    ? 'linear-gradient(125deg, rgba(7, 14, 28, 0.24), rgba(18, 11, 15, 0.52))'
    : 'linear-gradient(125deg, rgba(9, 16, 28, 0.2), rgba(21, 15, 12, 0.46))';
  const depthGlow = 'radial-gradient(circle at 18% 18%, rgba(255, 255, 255, 0.16), transparent 34%)';
  return `${directionTint}, ${depthGlow}, url("${escapedUrl}")`;
}

function applyBackgroundPhoto(photo) {
  const layers = getBackgroundPhotoLayers();
  if (!layers.length || !photo?.imageUrl) return;

  const nextIndex = backgroundPhotoLayerIndex < 0
    ? 0
    : (backgroundPhotoLayerIndex + 1) % layers.length;
  const nextLayer = layers[nextIndex];

  nextLayer.style.backgroundImage = buildBackgroundPhotoCss(photo);
  nextLayer.dataset.direction = photo.direction || '';
  nextLayer.classList.add('is-active');

  layers.forEach((layer, index) => {
    if (index === nextIndex) return;
    layer.classList.remove('is-active');
  });

  backgroundPhotoLayerIndex = nextIndex;
  document.body.classList.add('has-background-photo');
  rememberBackgroundPhoto(photo.id);
  updateBackgroundCredit(photo);
}

function clearBackgroundPhoto() {
  const layers = getBackgroundPhotoLayers();
  layers.forEach((layer) => {
    layer.classList.remove('is-active');
    layer.style.backgroundImage = '';
    delete layer.dataset.direction;
  });
  backgroundPhotoLayerIndex = -1;
  document.body.classList.remove('has-background-photo');
  updateBackgroundCredit(null);
}

function applyBackgroundTheme(theme, direction = '') {
  if (!theme) return;
  document.body.dataset.bgTheme = theme;
  if (direction) document.body.dataset.bgDirection = direction;
}

async function rotateBackgroundScene() {
  const nextTheme = getNextBackgroundTheme(document.body.dataset.bgTheme || '', currentBackgroundDirection);
  currentBackgroundDirection = nextTheme.direction;
  applyBackgroundTheme(nextTheme.theme, nextTheme.direction);

  const requestSequence = ++backgroundRequestSequence;

  try {
    const photo = await fetchRemoteBackground(nextTheme.direction);
    await preloadBackgroundImage(photo.imageUrl);
    if (requestSequence !== backgroundRequestSequence) return;
    applyBackgroundPhoto(photo);
  } catch (err) {
    if (requestSequence !== backgroundRequestSequence) return;
    try {
      const fallbackPhoto = buildDirectFallbackPhoto(nextTheme.direction);
      if (!fallbackPhoto) throw err;
      await preloadBackgroundImage(fallbackPhoto.imageUrl);
      if (requestSequence !== backgroundRequestSequence) return;
      applyBackgroundPhoto(fallbackPhoto);
    } catch (fallbackErr) {
      if (!document.body.classList.contains('has-background-photo')) {
        clearBackgroundPhoto();
      }
    }
  }
}

function clearGtdDragState(root = document.getElementById('gtdWorkspace')) {
  activeGtdDraggingTaskId = '';
  activeGtdStepDragState = null;
  if (!root) return;

  root.querySelectorAll('.gtd-task-item.is-dragging').forEach((item) => {
    item.classList.remove('is-dragging');
  });
  root.querySelectorAll('.gtd-quadrant.is-drop-target').forEach((item) => {
    item.classList.remove('is-drop-target');
  });
  root.querySelectorAll('.gtd-step-item.is-dragging, .gtd-step-item.is-drop-before, .gtd-step-item.is-drop-after').forEach((item) => {
    item.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after');
  });
  root.querySelectorAll('.gtd-step-list.is-drop-end').forEach((item) => {
    item.classList.remove('is-drop-end');
  });
}

function setGtdDropTarget(quadrantKey, root = document.getElementById('gtdWorkspace')) {
  if (!root) return;

  root.querySelectorAll('.gtd-quadrant.is-drop-target').forEach((item) => {
    if (item.dataset.gtdDropZone !== quadrantKey) {
      item.classList.remove('is-drop-target');
    }
  });

  const target = quadrantKey
    ? root.querySelector(`.gtd-quadrant[data-gtd-drop-zone="${quadrantKey}"]`)
    : null;
  if (target) target.classList.add('is-drop-target');
}

function setGtdStepDropTarget(stepId = '', position = 'after', root = document.getElementById('gtdWorkspace')) {
  if (!root) return;

  root.querySelectorAll('.gtd-step-item.is-drop-before, .gtd-step-item.is-drop-after').forEach((item) => {
    item.classList.remove('is-drop-before', 'is-drop-after');
  });
  root.querySelectorAll('.gtd-step-list.is-drop-end').forEach((item) => {
    item.classList.remove('is-drop-end');
  });

  if (!stepId) {
    const stepList = root.querySelector('.gtd-step-list');
    if (stepList) stepList.classList.add('is-drop-end');
    return;
  }

  const target = root.querySelector(`.gtd-step-item[data-step-id="${stepId}"]`);
  if (!target) return;
  target.classList.add(position === 'before' ? 'is-drop-before' : 'is-drop-after');
}

function initDynamicBackground() {
  void rotateBackgroundScene();
  if (backgroundThemeRotationId) window.clearInterval(backgroundThemeRotationId);
  backgroundThemeRotationId = window.setInterval(() => {
    void rotateBackgroundScene();
  }, BACKGROUND_THEME_ROTATION_MS);
}

function createIdlePomodoroState() {
  return {
    taskId: '',
    taskTitle: '',
    status: 'idle',
    remainingMs: POMODORO_DURATION_MS,
    endAt: 0,
    completedAt: '',
  };
}

function normalizePomodoroState(rawState, now = Date.now()) {
  const baseState = createIdlePomodoroState();
  if (!rawState || typeof rawState !== 'object') return baseState;

  const taskId = typeof rawState.taskId === 'string' ? rawState.taskId : '';
  const taskTitle = typeof rawState.taskTitle === 'string' ? rawState.taskTitle : '';
  const status = rawState.status === 'running' || rawState.status === 'paused' || rawState.status === 'completed'
    ? rawState.status
    : 'idle';
  const endAt = Number.isFinite(Number(rawState.endAt)) ? Number(rawState.endAt) : 0;
  const completedAt = typeof rawState.completedAt === 'string' ? rawState.completedAt : '';
  const remainingMs = Math.max(0, Math.min(POMODORO_DURATION_MS, Number(rawState.remainingMs) || POMODORO_DURATION_MS));

  if (!taskId || status === 'idle') return baseState;

  if (status === 'running') {
    const liveRemainingMs = Math.max(0, endAt - now);
    if (liveRemainingMs <= 0) {
      return {
        taskId,
        taskTitle,
        status: 'completed',
        remainingMs: 0,
        endAt: 0,
        completedAt: completedAt || new Date(now).toISOString(),
      };
    }

    return {
      taskId,
      taskTitle,
      status: 'running',
      remainingMs: liveRemainingMs,
      endAt,
      completedAt,
    };
  }

  if (status === 'paused') {
    return {
      taskId,
      taskTitle,
      status: 'paused',
      remainingMs,
      endAt: 0,
      completedAt: '',
    };
  }

  return {
    taskId,
    taskTitle,
    status: 'completed',
    remainingMs: 0,
    endAt: 0,
    completedAt,
  };
}

async function savePomodoroState() {
  const storage = getGtdStorage();
  await storage.set({
    [POMODORO_STORAGE_KEY]: pomodoroState || createIdlePomodoroState(),
  });
}

function stopPomodoroTicker() {
  if (!pomodoroTickerId) return;
  window.clearInterval(pomodoroTickerId);
  pomodoroTickerId = 0;
}

function clearPomodoroToggleTimer() {
  if (!pomodoroToggleTimerId) return;
  window.clearTimeout(pomodoroToggleTimerId);
  pomodoroToggleTimerId = 0;
}

function clearGtdTaskSelectionTimer() {
  if (!gtdTaskSelectionTimerId) return;
  window.clearTimeout(gtdTaskSelectionTimerId);
  gtdTaskSelectionTimerId = 0;
}

function queueGtdTaskSelection(taskId) {
  clearGtdTaskSelectionTimer();
  gtdTaskSelectionTimerId = window.setTimeout(async () => {
    gtdTaskSelectionTimerId = 0;
    activeGtdComposerQuadrant = '';
    activeGtdEditingTaskId = '';
    await updateGtdBoard((board) => window.TabOutGTD.selectTask(board, taskId));
  }, 220);
}

async function completePomodoro() {
  const completedState = {
    ...(pomodoroState || createIdlePomodoroState()),
    status: 'completed',
    remainingMs: 0,
    endAt: 0,
    completedAt: new Date().toISOString(),
  };

  pomodoroState = completedState;
  stopPomodoroTicker();
  await savePomodoroState();
  await renderGtdWorkspace({ preserveActiveField: true });
  shootConfetti(window.innerWidth * 0.72, Math.max(120, window.innerHeight * 0.24));
  showToast(completedState.taskTitle ? `番茄钟完成：${completedState.taskTitle}` : '番茄钟完成');
}

function syncPomodoroTicker() {
  stopPomodoroTicker();
  if (!pomodoroState || pomodoroState.status !== 'running') return;

  pomodoroTickerId = window.setInterval(async () => {
    if (!pomodoroState || pomodoroState.status !== 'running') {
      stopPomodoroTicker();
      return;
    }

    const remainingMs = Math.max(0, pomodoroState.endAt - Date.now());
    if (remainingMs <= 0) {
      await completePomodoro();
      return;
    }

    pomodoroState = {
      ...pomodoroState,
      remainingMs,
    };
    await renderGtdWorkspace({ preserveActiveField: true });
  }, 1000);
}

async function loadPomodoroState() {
  const storage = getGtdStorage();
  const payload = await storage.get(POMODORO_STORAGE_KEY);
  pomodoroState = normalizePomodoroState(payload?.[POMODORO_STORAGE_KEY]);
  await savePomodoroState();
  syncPomodoroTicker();
}

async function startPomodoro(taskId, taskTitle) {
  pomodoroState = {
    taskId,
    taskTitle,
    status: 'running',
    remainingMs: POMODORO_DURATION_MS,
    endAt: Date.now() + POMODORO_DURATION_MS,
    completedAt: '',
  };
  await savePomodoroState();
  syncPomodoroTicker();
  await renderGtdWorkspace();
  showToast(taskTitle ? `番茄钟已启动：${taskTitle}` : '番茄钟已启动');
}

async function pausePomodoro() {
  if (!pomodoroState || pomodoroState.status !== 'running') return;

  pomodoroState = {
    ...pomodoroState,
    status: 'paused',
    remainingMs: Math.max(0, pomodoroState.endAt - Date.now()),
    endAt: 0,
  };
  stopPomodoroTicker();
  await savePomodoroState();
  await renderGtdWorkspace();
  showToast('番茄钟已暂停');
}

async function resumePomodoro() {
  if (!pomodoroState || pomodoroState.status !== 'paused') return;

  pomodoroState = {
    ...pomodoroState,
    status: 'running',
    endAt: Date.now() + pomodoroState.remainingMs,
  };
  await savePomodoroState();
  syncPomodoroTicker();
  await renderGtdWorkspace();
  showToast('番茄钟已继续');
}

async function togglePomodoro(taskId, taskTitle) {
  const currentState = normalizePomodoroState(pomodoroState);
  const sameTask = currentState.taskId === taskId;

  if (!sameTask || currentState.status === 'idle' || currentState.status === 'completed') {
    await startPomodoro(taskId, taskTitle);
    return;
  }

  if (currentState.status === 'running') {
    await pausePomodoro();
    return;
  }

  if (currentState.status === 'paused') {
    await resumePomodoro();
  }
}

function queuePomodoroToggle(taskId, taskTitle) {
  clearPomodoroToggleTimer();
  pomodoroToggleTimerId = window.setTimeout(async () => {
    pomodoroToggleTimerId = 0;
    activeGtdComposerQuadrant = '';
    activeGtdEditingTaskId = '';
    await togglePomodoro(taskId, taskTitle);
  }, 220);
}

async function resetPomodoro(options = {}) {
  const { skipRender = false, silent = false } = options;
  pomodoroState = createIdlePomodoroState();
  stopPomodoroTicker();
  await savePomodoroState();
  if (!skipRender) await renderGtdWorkspace();
  if (!silent) showToast('番茄钟已重置');
}

/**
 * fetchOpenTabs()
 *
 * Reads all currently open browser tabs directly from Chrome.
 * Sets the extensionId flag so we can identify Tab Out's own pages.
 */
async function fetchOpenTabs() {
  try {
    const extensionId = chrome.runtime.id;
    // The new URL for this page is now index.html (not newtab.html)
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;

    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:       t.id,
      url:      t.url,
      title:    t.title,
      windowId: t.windowId,
      active:   t.active,
      // Flag Tab Out's own pages so we can detect duplicate new tabs
      isTabOut: t.url === newtabUrl || t.url === 'chrome://newtab/',
    }));
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
  }
}

/**
 * closeTabsByUrls(urls)
 *
 * Closes all open tabs whose hostname matches any of the given URLs.
 * After closing, re-fetches the tab list to keep our state accurate.
 *
 * Special case: file:// URLs are matched exactly (they have no hostname).
 */
async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return;

  // Separate file:// URLs (exact match) from regular URLs (hostname match)
  const targetHostnames = [];
  const exactUrls = new Set();

  for (const u of urls) {
    if (u.startsWith('file://')) {
      exactUrls.add(u);
    } else {
      try { targetHostnames.push(new URL(u).hostname); }
      catch { /* skip unparseable */ }
    }
  }

  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs
    .filter(tab => {
      const tabUrl = tab.url || '';
      if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;
      try {
        const tabHostname = new URL(tabUrl).hostname;
        return tabHostname && targetHostnames.includes(tabHostname);
      } catch { return false; }
    })
    .map(tab => tab.id);

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabsExact(urls)
 *
 * Closes tabs by exact URL match (not hostname). Used for landing pages
 * so closing "Gmail inbox" doesn't also close individual email threads.
 */
async function closeTabsExact(urls) {
  if (!urls || urls.length === 0) return;
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs.filter(t => urlSet.has(t.url)).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * focusTab(url)
 *
 * Switches Chrome to the tab with the given URL (exact match first,
 * then hostname fallback). Also brings the window to the front.
 */
async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  // Try exact URL match first
  let matches = allTabs.filter(t => t.url === url);

  // Fall back to hostname match
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch {}
  }

  if (matches.length === 0) return;

  // Prefer a match in a different window so it actually switches windows
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

/**
 * closeDuplicateTabs(urls, keepOne)
 *
 * Closes duplicate tabs for the given list of URLs.
 * keepOne=true → keep one copy of each, close the rest.
 * keepOne=false → close all copies.
 */
async function closeDuplicateTabs(urls, keepOne = true) {
  const allTabs = await chrome.tabs.query({});
  const toClose = [];

  for (const url of urls) {
    const matching = allTabs.filter(t => t.url === url);
    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) {
        if (tab.id !== keep.id) toClose.push(tab.id);
      }
    } else {
      for (const tab of matching) toClose.push(tab.id);
    }
  }

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabOutDupes()
 *
 * Closes all duplicate Tab Out new-tab pages except the current one.
 */
async function closeTabOutDupes() {
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/index.html`;

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const tabOutTabs = allTabs.filter(t =>
    t.url === newtabUrl || t.url === 'chrome://newtab/'
  );

  if (tabOutTabs.length <= 1) return;

  // Keep the active Tab Out tab in the CURRENT window — that's the one the
  // user is looking at right now. Falls back to any active one, then the first.
  const keep =
    tabOutTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    tabOutTabs.find(t => t.active) ||
    tabOutTabs[0];
  const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — chrome.storage.local

   Replaces the old server-side SQLite + REST API with Chrome's
   built-in key-value storage. Data persists across browser sessions
   and doesn't require a running server.

   Data shape stored under the "deferred" key:
   [
     {
       id: "1712345678901",          // timestamp-based unique ID
       url: "https://example.com",
       title: "Example Page",
       savedAt: "2026-04-04T10:00:00.000Z",  // ISO date string
       completed: false,             // true = checked off (archived)
       dismissed: false              // true = dismissed without reading
     },
     ...
   ]
   ---------------------------------------------------------------- */

/**
 * saveTabForLater(tab)
 *
 * Saves a single tab to the "Saved for Later" list in chrome.storage.local.
 * @param {{ url: string, title: string }} tab
 */
async function saveTabForLater(tab) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  deferred.push({
    id:        Date.now().toString(),
    url:       tab.url,
    title:     tab.title,
    savedAt:   new Date().toISOString(),
    completed: false,
    dismissed: false,
  });
  await chrome.storage.local.set({ deferred });
}

/**
 * getSavedTabs()
 *
 * Returns all saved tabs from chrome.storage.local.
 * Filters out dismissed items (those are gone for good).
 * Splits into active (not completed) and archived (completed).
 */
async function getSavedTabs() {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const visible = deferred.filter(t => !t.dismissed);
  return {
    active:   visible.filter(t => !t.completed),
    archived: visible.filter(t => t.completed),
  };
}

/**
 * checkOffSavedTab(id)
 *
 * Marks a saved tab as completed (checked off). It moves to the archive.
 */
async function checkOffSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.completed = true;
    tab.completedAt = new Date().toISOString();
    await chrome.storage.local.set({ deferred });
  }
}

/**
 * dismissSavedTab(id)
 *
 * Marks a saved tab as dismissed (removed from all lists).
 */
async function dismissSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.dismissed = true;
    await chrome.storage.local.set({ deferred });
  }
}


/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

/**
 * playCloseSound()
 *
 * Plays a clean "swoosh" sound when tabs are closed.
 * Built entirely with the Web Audio API — no sound files needed.
 * A filtered noise sweep that descends in pitch, like air moving.
 */
function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Swoosh: shaped white noise through a sweeping bandpass filter
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate noise with a natural envelope (quick attack, smooth decay)
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      // Envelope: ramps up fast in first 10%, then fades out smoothly
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter sweeps from high to low — creates the "swoosh" character
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);

    // Volume
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio not supported — fail silently
  }
}

/**
 * shootConfetti(x, y)
 *
 * Shoots a burst of colorful confetti particles from the given screen
 * coordinates (typically the center of a card being closed).
 * Pure CSS + JS, no libraries.
 */
function shootConfetti(x, y) {
  const colors = [
    '#c8713a', // amber
    '#e8a070', // amber light
    '#5a7a62', // sage
    '#8aaa92', // sage light
    '#5a6b7a', // slate
    '#8a9baa', // slate light
    '#d4b896', // warm paper
    '#b35a5a', // rose
  ];

  const particleCount = 17;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');

    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6; // 5–11px
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    // Physics: random angle and speed for the outward burst
    const angle   = Math.random() * Math.PI * 2;
    const speed   = 60 + Math.random() * 120;
    const vx      = Math.cos(angle) * speed;
    const vy      = Math.sin(angle) * speed - 80; // bias upward
    const gravity = 200;

    const startTime = performance.now();
    const duration  = 700 + Math.random() * 200; // 700–900ms

    function frame(now) {
      const elapsed  = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);

      if (progress >= 1) { el.remove(); return; }

      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate  = elapsed * 200 * (isCircle ? 0 : 1);

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
}

/**
 * animateCardOut(card)
 *
 * Smoothly removes a mission card: fade + scale down, then confetti.
 * After the animation, checks if the grid is now empty.
 */
function animateCardOut(card) {
  if (!card) return;

  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 300);
}

/**
 * showToast(message)
 *
 * Brief pop-up notification at the bottom of the screen.
 */
function showToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

function downloadTextFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
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

/**
 * checkAndShowEmptyState()
 *
 * Shows a cheerful "Inbox zero" message when all domain cards are gone.
 */
function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;

  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;

  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">Inbox zero, but for tabs.</div>
      <div class="empty-subtitle">You're free.</div>
    </div>
  `;

  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = '0 domains';
}

/**
 * timeAgo(dateStr)
 *
 * Converts an ISO date string into a human-friendly relative time.
 * "2026-04-04T10:00:00Z" → "2 hrs ago" or "yesterday"
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now  = new Date();
  const diffMins  = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays  = Math.floor((now - then) / 86400000);

  if (diffMins < 1)   return 'just now';
  if (diffMins < 60)  return diffMins + ' min ago';
  if (diffHours < 24) return diffHours + ' hr' + (diffHours !== 1 ? 's' : '') + ' ago';
  if (diffDays === 1) return 'yesterday';
  return diffDays + ' days ago';
}

function buildEncouragementQuotes() {
  const openings = [
    '先做好',
    '稳稳推进',
    '今天先完成',
    '把心收回到',
    '认真完成',
    '专注做好',
    '先拿下',
    '安心推进',
    '沉住气做好',
    '温柔地完成',
  ];
  const focuses = [
    '最重要的一件事',
    '今天的关键任务',
    '手头最值钱的事',
    '眼前最该做的事',
    '真正重要的工作',
    '你今天的重点',
    '能带来结果的事',
    '让自己安心的事',
    '值得投入的任务',
    '决定成效的那一步',
  ];
  const endings = [
    '，今天会更顺。',
    '，状态会跟上来。',
    '，进度会更稳。',
  ];

  const quotes = [];
  for (const opening of openings) {
    for (const focus of focuses) {
      for (const ending of endings) {
        quotes.push(`${opening}${focus}${ending}`);
      }
    }
  }
  return quotes.slice(0, 300);
}

const ENCOURAGEMENT_QUOTES = buildEncouragementQuotes();

function getDailyEncouragement(date = new Date()) {
  const rotationIndex = Math.floor(date.getTime() / ENCOURAGEMENT_ROTATION_MS);
  return ENCOURAGEMENT_QUOTES[rotationIndex % ENCOURAGEMENT_QUOTES.length];
}

function renderHeaderEncouragement(date = new Date()) {
  const greetingEl = document.getElementById('greeting');
  const dateEl = document.getElementById('dateDisplay');
  if (greetingEl) greetingEl.textContent = getDailyEncouragement(date);
  if (dateEl) {
    dateEl.textContent = '';
    dateEl.style.display = 'none';
  }
}

function scheduleHeaderEncouragementRotation() {
  renderHeaderEncouragement();

  if (encouragementTimeoutId) window.clearTimeout(encouragementTimeoutId);
  if (encouragementIntervalId) window.clearInterval(encouragementIntervalId);

  const now = Date.now();
  const elapsedInWindow = now % ENCOURAGEMENT_ROTATION_MS;
  const waitMs = elapsedInWindow === 0 ? ENCOURAGEMENT_ROTATION_MS : ENCOURAGEMENT_ROTATION_MS - elapsedInWindow;

  encouragementTimeoutId = window.setTimeout(() => {
    renderHeaderEncouragement();
    encouragementIntervalId = window.setInterval(() => {
      renderHeaderEncouragement();
    }, ENCOURAGEMENT_ROTATION_MS);
  }, waitMs + 80);
}


/* ----------------------------------------------------------------
   DOMAIN & TITLE CLEANUP HELPERS
   ---------------------------------------------------------------- */

// Map of known hostnames → friendly display names.
const FRIENDLY_DOMAINS = {
  'github.com':           'GitHub',
  'www.github.com':       'GitHub',
  'gist.github.com':      'GitHub Gist',
  'youtube.com':          'YouTube',
  'www.youtube.com':      'YouTube',
  'music.youtube.com':    'YouTube Music',
  'x.com':                'X',
  'www.x.com':            'X',
  'twitter.com':          'X',
  'www.twitter.com':      'X',
  'reddit.com':           'Reddit',
  'www.reddit.com':       'Reddit',
  'old.reddit.com':       'Reddit',
  'substack.com':         'Substack',
  'www.substack.com':     'Substack',
  'medium.com':           'Medium',
  'www.medium.com':       'Medium',
  'linkedin.com':         'LinkedIn',
  'www.linkedin.com':     'LinkedIn',
  'stackoverflow.com':    'Stack Overflow',
  'www.stackoverflow.com':'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com':           'Google',
  'www.google.com':       'Google',
  'mail.google.com':      'Gmail',
  'docs.google.com':      'Google Docs',
  'drive.google.com':     'Google Drive',
  'calendar.google.com':  'Google Calendar',
  'meet.google.com':      'Google Meet',
  'gemini.google.com':    'Gemini',
  'chatgpt.com':          'ChatGPT',
  'www.chatgpt.com':      'ChatGPT',
  'chat.openai.com':      'ChatGPT',
  'claude.ai':            'Claude',
  'www.claude.ai':        'Claude',
  'code.claude.com':      'Claude Code',
  'notion.so':            'Notion',
  'www.notion.so':        'Notion',
  'figma.com':            'Figma',
  'www.figma.com':        'Figma',
  'slack.com':            'Slack',
  'app.slack.com':        'Slack',
  'discord.com':          'Discord',
  'www.discord.com':      'Discord',
  'wikipedia.org':        'Wikipedia',
  'en.wikipedia.org':     'Wikipedia',
  'amazon.com':           'Amazon',
  'www.amazon.com':       'Amazon',
  'netflix.com':          'Netflix',
  'www.netflix.com':      'Netflix',
  'spotify.com':          'Spotify',
  'open.spotify.com':     'Spotify',
  'vercel.com':           'Vercel',
  'www.vercel.com':       'Vercel',
  'npmjs.com':            'npm',
  'www.npmjs.com':        'npm',
  'developer.mozilla.org':'MDN',
  'arxiv.org':            'arXiv',
  'www.arxiv.org':        'arXiv',
  'huggingface.co':       'Hugging Face',
  'www.huggingface.co':   'Hugging Face',
  'producthunt.com':      'Product Hunt',
  'www.producthunt.com':  'Product Hunt',
  'xiaohongshu.com':      'RedNote',
  'www.xiaohongshu.com':  'RedNote',
  'local-files':          'Local Files',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return capitalize(hostname.replace('.substack.com', '')) + "'s Substack";
  }
  if (hostname.endsWith('.github.io')) {
    return capitalize(hostname.replace('.github.io', '')) + ' (GitHub Pages)';
  }

  let clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');

  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function stripTitleNoise(title) {
  if (!title) return '';
  // Strip leading notification count: "(2) Title"
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  // Strip inline counts like "Inbox (16,359)"
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  // Strip email addresses (privacy + cleaner display)
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  // Clean X/Twitter format
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain   = hostname.replace(/^www\./, '');
  const seps     = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix     = title.slice(idx + sep.length).trim();
    const suffixLow  = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; }
  catch { return title || ''; }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull'   && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return `r/${parts[subIdx + 1]} post`;
    }
  }

  return title || url;
}


/* ----------------------------------------------------------------
   SVG ICON STRINGS
   ---------------------------------------------------------------- */
const ICONS = {
  tabs:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
};


/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];


/* ----------------------------------------------------------------
   HELPER: filter out browser-internal pages
   ---------------------------------------------------------------- */

/**
 * getRealTabs()
 *
 * Returns tabs that are real web pages — no chrome://, extension
 * pages, about:blank, etc.
 */
function getRealTabs() {
  return openTabs.filter(t => {
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://')
    );
  });
}

/**
 * checkTabOutDupes()
 *
 * Counts how many Tab Out pages are open. If more than 1,
 * shows a banner offering to close the extras.
 */
function checkTabOutDupes() {
  const tabOutTabs = openTabs.filter(t => t.isTabOut);
  const banner  = document.getElementById('tabOutDupeBanner');
  const countEl = document.getElementById('tabOutDupeCount');
  if (!banner) return;

  if (tabOutTabs.length > 1) {
    if (countEl) countEl.textContent = tabOutTabs.length;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}


/* ----------------------------------------------------------------
   OVERFLOW CHIPS ("+N more" expand button in domain cards)
   ---------------------------------------------------------------- */

function buildOverflowChips(hiddenTabs, urlCounts = {}) {
  const hiddenChips = hiddenTabs.map(tab => {
    const label    = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    const count    = urlCounts[tab.url] || 1;
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl   = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" data-hide-on-error="true">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">+${hiddenTabs.length} more</span>
    </div>`;
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderDomainCard(group, groupIndex)
 *
 * Builds the HTML for one domain group card.
 * group = { domain: string, tabs: [{ url, title, id, windowId, active }] }
 */
function renderDomainCard(group) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId  = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');

  // Count duplicates (exact URL match)
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls   = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes   = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${tabCount} tab${tabCount !== 1 ? 's' : ''} open
  </span>`;

  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge" style="color:var(--accent-amber);background:rgba(200,113,58,0.08);">
        ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </span>`
    : '';

  // Deduplicate for display: show each URL once, with (Nx) badge if duped
  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); }
  }

  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount  = uniqueTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => {
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group.domain);
    // For localhost tabs, prepend port number so you can tell projects apart
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
    } catch {}
    const count    = urlCounts[tab.url];
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl   = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" data-hide-on-error="true">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts) : '');

  let actionsHtml = `
    <button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.close}
      Close all ${tabCount} tab${tabCount !== 1 ? 's' : ''}
    </button>`;

  if (hasDupes) {
    const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actionsHtml += `
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        Close ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </button>`;
  }

  return `
    <div class="mission-card domain-card ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">${isLanding ? 'Homepages' : (group.label || friendlyDomain(group.domain))}</span>
          ${tabBadge}
          ${dupeBadge}
        </div>
        <div class="mission-pages">${pageChips}</div>
        <div class="actions">${actionsHtml}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">tabs</div>
      </div>
    </div>`;
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — Render Checklist Column
   ---------------------------------------------------------------- */

/**
 * renderDeferredColumn()
 *
 * Reads saved tabs from chrome.storage.local and renders the right-side
 * "Saved for Later" checklist column. Shows active items as a checklist
 * and completed items in a collapsible archive.
 */
async function renderDeferredColumn() {
  const column         = document.getElementById('deferredColumn');
  const list           = document.getElementById('deferredList');
  const empty          = document.getElementById('deferredEmpty');
  const countEl        = document.getElementById('deferredCount');
  const archiveEl      = document.getElementById('deferredArchive');
  const archiveCountEl = document.getElementById('archiveCount');
  const archiveList    = document.getElementById('archiveList');

  if (!column) return;

  try {
    const { active, archived } = await getSavedTabs();

    // Hide the entire column if there's nothing to show
    if (active.length === 0 && archived.length === 0) {
      column.style.display = 'none';
      return;
    }

    column.style.display = 'block';

    // Render active checklist items
    if (active.length > 0) {
      countEl.textContent = `${active.length} item${active.length !== 1 ? 's' : ''}`;
      list.innerHTML = active.map(item => renderDeferredItem(item)).join('');
      list.style.display = 'block';
      empty.style.display = 'none';
    } else {
      list.style.display = 'none';
      countEl.textContent = '';
      empty.style.display = 'block';
    }

    // Render archive section
    if (archived.length > 0) {
      archiveCountEl.textContent = `(${archived.length})`;
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      archiveEl.style.display = 'block';
    } else {
      archiveEl.style.display = 'none';
    }

  } catch (err) {
    console.warn('[tab-out] Could not load saved tabs:', err);
    column.style.display = 'none';
  }
}

/**
 * renderDeferredItem(item)
 *
 * Builds HTML for one active checklist item: checkbox, title link,
 * domain, time ago, dismiss button.
 */
function renderDeferredItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  const ago = timeAgo(item.savedAt);

  return `
    <div class="deferred-item" data-deferred-id="${item.id}">
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

/**
 * renderArchiveItem(item)
 *
 * Builds HTML for one completed/archived item (simpler: just title + date).
 */
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


/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderStaticDashboard()
 *
 * The main render function:
 * 1. Paints the daily encouragement line
 * 2. Fetches open tabs via chrome.tabs.query()
 * 3. Groups tabs by domain (with landing pages pulled out to their own group)
 * 4. Renders domain cards
 * 5. Updates footer stats
 * 6. Renders the "Saved for Later" checklist
 */
async function renderStaticDashboard() {
  // --- Header ---
  renderHeaderEncouragement();

  // --- Fetch tabs ---
  await fetchOpenTabs();
  const realTabs = getRealTabs();

  // --- Group tabs by domain ---
  // Landing pages (Gmail inbox, Twitter home, etc.) get their own special group
  // so they can be closed together without affecting content tabs on the same domain.
  const LANDING_PAGE_PATTERNS = [
    { hostname: 'mail.google.com', test: (p, h) =>
        !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com',               pathExact: ['/home'] },
    { hostname: 'www.linkedin.com',    pathExact: ['/'] },
    { hostname: 'github.com',          pathExact: ['/'] },
    { hostname: 'www.youtube.com',     pathExact: ['/'] },
    // Merge personal patterns from config.local.js (if it exists)
    ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
  ];

  function isLandingPage(url) {
    try {
      const parsed = new URL(url);
      return LANDING_PAGE_PATTERNS.some(p => {
        // Support both exact hostname and suffix matching (for wildcard subdomains)
        const hostnameMatch = p.hostname
          ? parsed.hostname === p.hostname
          : p.hostnameEndsWith
            ? parsed.hostname.endsWith(p.hostnameEndsWith)
            : false;
        if (!hostnameMatch) return false;
        if (p.test)       return p.test(parsed.pathname, url);
        if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
        if (p.pathExact)  return p.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch { return false; }
  }

  domainGroups = [];
  const groupMap    = {};
  const landingTabs = [];

  // Custom group rules from config.local.js (if any)
  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];

  // Check if a URL matches a custom group rule; returns the rule or null
  function matchCustomGroup(url) {
    try {
      const parsed = new URL(url);
      return customGroups.find(r => {
        const hostMatch = r.hostname
          ? parsed.hostname === r.hostname
          : r.hostnameEndsWith
            ? parsed.hostname.endsWith(r.hostnameEndsWith)
            : false;
        if (!hostMatch) return false;
        if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
        return true; // hostname matched, no path filter
      }) || null;
    } catch { return null; }
  }

  for (const tab of realTabs) {
    try {
      if (isLandingPage(tab.url)) {
        landingTabs.push(tab);
        continue;
      }

      // Check custom group rules first (e.g. merge subdomains, split by path)
      const customRule = matchCustomGroup(tab.url);
      if (customRule) {
        const key = customRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
        groupMap[key].tabs.push(tab);
        continue;
      }

      let hostname;
      if (tab.url && tab.url.startsWith('file://')) {
        hostname = 'local-files';
      } else {
        hostname = new URL(tab.url).hostname;
      }
      if (!hostname) continue;

      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {
      // Skip malformed URLs
    }
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  // Sort: landing pages first, then domains from landing page sites, then by tab count
  // Collect exact hostnames and suffix patterns for priority sorting
  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
  const landingSuffixes = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(s => domain.endsWith(s));
  }
  domainGroups = Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;

    const aIsPriority = isLandingDomain(a.domain);
    const bIsPriority = isLandingDomain(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;

    return b.tabs.length - a.tabs.length;
  });

  // --- Render domain cards ---
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  if (domainGroups.length > 0 && openTabsSection) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = 'Open tabs';
    openTabsSectionCount.innerHTML = `${domainGroups.length} domain${domainGroups.length !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} Close all ${realTabs.length} tabs</button>`;
    openTabsMissionsEl.innerHTML = domainGroups.map(g => renderDomainCard(g)).join('');
    openTabsSection.style.display = 'block';
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
  }

  // --- Footer stats ---
  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = openTabs.length;

  // --- Check for duplicate Tab Out tabs ---
  checkTabOutDupes();

  // --- Render "Saved for Later" column ---
  await renderDeferredColumn();
}

async function renderDashboard() {
  await renderGtdWorkspace();
  await renderStaticDashboard();
}

function queueDeferredGtdRender(options = {}) {
  pendingGtdRenderOptions = {
    ...(pendingGtdRenderOptions || {}),
    ...options,
  };
}

async function flushDeferredGtdRender() {
  if (gtdCompositionActive || !pendingGtdRenderOptions) return;
  const nextOptions = pendingGtdRenderOptions;
  pendingGtdRenderOptions = null;
  await renderGtdWorkspace({
    ...nextOptions,
    bypassCompositionGuard: true,
  });
}

function captureGtdFieldState(root) {
  const activeField = document.activeElement;
  if (!activeField || !root.contains(activeField)) return null;
  if (!(activeField instanceof HTMLInputElement || activeField instanceof HTMLTextAreaElement)) return null;
  if (!activeField.name) return null;

  const form = activeField.closest('form[data-gtd-form]');
  if (!form?.dataset?.gtdForm) return null;

  const selector = [
    `form[data-gtd-form="${form.dataset.gtdForm}"]`,
    form.dataset.taskId ? `[data-task-id="${form.dataset.taskId}"]` : '',
    form.dataset.quadrant ? `[data-quadrant="${form.dataset.quadrant}"]` : '',
    ` ${activeField.tagName.toLowerCase()}[name="${activeField.name}"]`,
  ].join('');

  return {
    selector,
    value: activeField.value,
    selectionStart: typeof activeField.selectionStart === 'number' ? activeField.selectionStart : null,
    selectionEnd: typeof activeField.selectionEnd === 'number' ? activeField.selectionEnd : null,
  };
}

function restoreGtdFieldState(root, fieldState) {
  if (!fieldState?.selector) return false;
  const field = root.querySelector(fieldState.selector);
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return false;

  field.value = fieldState.value;
  requestAnimationFrame(() => {
    field.focus();
    if (typeof field.setSelectionRange === 'function' && fieldState.selectionStart !== null && fieldState.selectionEnd !== null) {
      field.setSelectionRange(fieldState.selectionStart, fieldState.selectionEnd);
    }
  });
  return true;
}

function syncWorkspaceTabbarMount(root) {
  const mount = document.getElementById('workspaceTabbarMount');
  if (!mount) return;

  mount.innerHTML = '';
  const tabbar = root?.querySelector('.workspace-tabbar');
  if (tabbar) mount.appendChild(tabbar);
}

async function renderGtdWorkspace(options = {}) {
  const root = document.getElementById('gtdWorkspace');
  if (!root || !window.TabOutGTD) return;
  if (gtdCompositionActive && !options.bypassCompositionGuard) {
    queueDeferredGtdRender(options);
    return;
  }

  const storage = getGtdStorage();
  const fieldState = options.preserveActiveField ? captureGtdFieldState(root) : null;

  try {
    const board = await window.TabOutGTD.getTodayBoard(storage);
    root.innerHTML = window.TabOutGTD.renderWorkspaceShell(board, {
      composerQuadrant: activeGtdComposerQuadrant,
      editingTaskId: activeGtdEditingTaskId,
      editingStepId: activeGtdEditingStepId,
      pomodoro: pomodoroState || createIdlePomodoroState(),
      collapsed: uiPrefs.gtdCollapsed,
      activeTab: uiPrefs.workspaceTab,
      whiteboardUrl: getExtensionAssetUrl('whiteboard/dist/index.html'),
      notesUrl: getExtensionAssetUrl('notes/dist/index.html'),
      structureboardUrl: getExtensionAssetUrl('structureboard/index.html'),
    });
    syncWorkspaceTabbarMount(root);
    const restoredField = restoreGtdFieldState(root, fieldState);

    if (!restoredField && activeGtdEditingTaskId) {
      const editInput = root.querySelector(
        `form[data-gtd-form="edit-task"][data-task-id="${activeGtdEditingTaskId}"] input[name="title"]`
      );
      if (editInput) {
        requestAnimationFrame(() => {
          editInput.focus();
          editInput.select();
        });
      } else {
        activeGtdEditingTaskId = '';
      }
    } else if (!restoredField && activeGtdEditingStepId) {
      const editInput = root.querySelector(
        `form[data-gtd-form="edit-step"][data-step-id="${activeGtdEditingStepId}"] input[name="text"]`
      );
      if (editInput) {
        requestAnimationFrame(() => {
          editInput.focus();
          editInput.select();
        });
      } else {
        activeGtdEditingStepId = '';
      }
    } else if (!restoredField && activeGtdComposerQuadrant) {
      const input = root.querySelector(
        `form[data-gtd-form="add-task"][data-quadrant="${activeGtdComposerQuadrant}"] input[name="title"]`
      );
      if (input) requestAnimationFrame(() => input.focus());
    }
  } catch (err) {
    console.error('[tab-out] Failed to render GTD workspace:', err);
    root.innerHTML = `
      <div class="gtd-shell">
        <div class="gtd-board-panel">
          <div class="gtd-detail-card gtd-empty-card">
            <div class="gtd-detail-eyebrow">GTD</div>
            <h3>暂时无法加载今天的任务</h3>
            <p>请刷新页面后重试。</p>
          </div>
        </div>
      </div>
    `;
    syncWorkspaceTabbarMount(root);
  }
}

async function updateGtdBoard(mutator) {
  const storage = getGtdStorage();
  const current = await window.TabOutGTD.getTodayBoard(storage);
  const nextBoard = window.TabOutGTD.normalizeBoard(mutator(current), current.date);
  await window.TabOutGTD.saveBoard(storage, nextBoard);
  await renderGtdWorkspace();
  return nextBoard;
}

function initGtdWorkspace() {
  const root = document.getElementById('gtdWorkspace');
  if (!root || root.dataset.bound === 'true') return;
  root.dataset.bound = 'true';

  const tabbarMount = document.getElementById('workspaceTabbarMount');
  tabbarMount?.addEventListener('click', async (e) => {
    const actionEl = e.target.closest('[data-gtd-action="switch-workspace-tab"]');
    if (!actionEl) return;

    const nextTab = normalizeWorkspaceTab(actionEl.dataset.workspaceTab);
    if (uiPrefs.workspaceTab === nextTab) return;

    uiPrefs.workspaceTab = nextTab;
    saveUiPrefs();
    await renderGtdWorkspace();
  });

  root.addEventListener('compositionstart', (e) => {
    const field = e.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
    if (!field.closest('form[data-gtd-form]')) return;
    gtdCompositionActive = true;
  });

  root.addEventListener('compositionend', async (e) => {
    const field = e.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
    if (!field.closest('form[data-gtd-form]')) return;
    gtdCompositionActive = false;
    await flushDeferredGtdRender();
  });

  root.addEventListener('dragstart', (e) => {
    const taskItem = e.target.closest('.gtd-task-item[draggable="true"][data-task-id]');
    if (!taskItem) return;

    clearGtdTaskSelectionTimer();
    clearPomodoroToggleTimer();
    activeGtdDraggingTaskId = taskItem.dataset.taskId || '';
    clearGtdDragState(root);
    activeGtdDraggingTaskId = taskItem.dataset.taskId || '';
    taskItem.classList.add('is-dragging');

    if (e.dataTransfer && activeGtdDraggingTaskId) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', activeGtdDraggingTaskId);
    }
  });

  root.addEventListener('dragstart', (e) => {
    const stepItem = e.target.closest('.gtd-step-item[draggable="true"][data-step-id][data-task-id]');
    if (!stepItem) return;

    clearGtdTaskSelectionTimer();
    clearPomodoroToggleTimer();
    const stepId = stepItem.dataset.stepId || '';
    const taskId = stepItem.dataset.taskId || '';
    const stepLevel = Number(stepItem.dataset.stepLevel) || 0;
    clearGtdDragState(root);
    activeGtdStepDragState = {
      stepId,
      taskId,
      stepLevel,
      startX: e.clientX || 0,
      currentX: e.clientX || 0,
      targetStepId: '',
      position: 'after',
    };
    stepItem.classList.add('is-dragging');

    if (e.dataTransfer && stepId) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', stepId);
    }
  });

  root.addEventListener('dragover', (e) => {
    if (activeGtdStepDragState?.stepId) {
      const stepList = e.target.closest('.gtd-step-list');
      if (!stepList) return;

      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      activeGtdStepDragState = {
        ...activeGtdStepDragState,
        currentX: e.clientX || activeGtdStepDragState.currentX,
      };

      const targetStep = e.target.closest('.gtd-step-item[data-step-id]');
      if (!targetStep) {
        activeGtdStepDragState = {
          ...activeGtdStepDragState,
          targetStepId: '',
          position: 'end',
        };
        setGtdStepDropTarget('', 'end', root);
        return;
      }

      const rect = targetStep.getBoundingClientRect();
      const position = e.clientY < rect.top + (rect.height / 2) ? 'before' : 'after';
      activeGtdStepDragState = {
        ...activeGtdStepDragState,
        targetStepId: targetStep.dataset.stepId || '',
        position,
      };
      setGtdStepDropTarget(targetStep.dataset.stepId || '', position, root);
      return;
    }

    const quadrantEl = e.target.closest('.gtd-quadrant[data-gtd-drop-zone]');
    if (!quadrantEl || !activeGtdDraggingTaskId) return;

    const sourceTask = root.querySelector(`.gtd-task-item[data-task-id="${activeGtdDraggingTaskId}"]`);
    if (sourceTask?.dataset.taskQuadrant === quadrantEl.dataset.gtdDropZone) return;

    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    setGtdDropTarget(quadrantEl.dataset.gtdDropZone || '', root);
  });

  root.addEventListener('drop', async (e) => {
    if (activeGtdStepDragState?.stepId) {
      const { stepId, taskId, stepLevel, startX, currentX, targetStepId, position } = activeGtdStepDragState;
      e.preventDefault();
      clearGtdDragState(root);

      const desiredLevel = stepLevel + Math.round(((currentX || startX) - startX) / 28);

      try {
        await updateGtdBoard((board) => window.TabOutGTD.moveChecklistItem(board, taskId, stepId, targetStepId, {
          position: position === 'before' ? 'before' : 'after',
          desiredLevel,
        }));
        showToast('步骤顺序已调整');
      } catch (err) {
        console.error('[tab-out] GTD step drop failed:', err);
        showToast('调整步骤失败');
      }
      return;
    }

    const quadrantEl = e.target.closest('.gtd-quadrant[data-gtd-drop-zone]');
    if (!quadrantEl) return;

    const taskId = activeGtdDraggingTaskId || e.dataTransfer?.getData('text/plain') || '';
    if (!taskId) return;

    e.preventDefault();
    const targetQuadrant = quadrantEl.dataset.gtdDropZone || '';
    const sourceTask = root.querySelector(`.gtd-task-item[data-task-id="${taskId}"]`);
    const sourceQuadrant = sourceTask?.dataset.taskQuadrant || '';
    clearGtdDragState(root);

    if (!targetQuadrant || sourceQuadrant === targetQuadrant) return;

    try {
      await updateGtdBoard((board) => window.TabOutGTD.moveTaskToQuadrant(board, taskId, targetQuadrant));
      const targetTitle = window.TabOutGTD.QUADRANT_MAP?.[targetQuadrant]?.title || '新象限';
      showToast(`任务已移动到「${targetTitle}」`);
    } catch (err) {
      console.error('[tab-out] GTD task drop failed:', err);
      showToast('移动任务失败');
    }
  });

  root.addEventListener('dragend', () => {
    clearGtdDragState(root);
  });

  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-gtd-form]');
    if (!form) return;
    e.preventDefault();

    const formType = form.dataset.gtdForm;

    try {
      if (formType === 'add-task') {
        const quadrant = form.dataset.quadrant;
        const input = form.querySelector('input[name="title"]');
        const title = input?.value?.trim();
        if (!title) {
          input?.focus();
          return;
        }

        activeGtdEditingTaskId = '';
        activeGtdEditingStepId = '';
        activeGtdComposerQuadrant = '';
        await updateGtdBoard((board) => window.TabOutGTD.addTask(board, quadrant, title));
        showToast('任务已加入今日四象限');
        return;
      }

      if (formType === 'edit-task') {
        const taskId = form.dataset.taskId;
        const input = form.querySelector('input[name="title"]');
        const title = input?.value?.trim();
        if (!title) {
          input?.focus();
          return;
        }

        activeGtdComposerQuadrant = '';
        activeGtdEditingTaskId = '';
        activeGtdEditingStepId = '';
        await updateGtdBoard((board) => window.TabOutGTD.updateTaskTitle(board, taskId, title));
        showToast('任务已更新');
        return;
      }

      if (formType === 'edit-step') {
        const taskId = form.dataset.taskId;
        const stepId = form.dataset.stepId;
        const input = form.querySelector('input[name="text"]');
        const text = input?.value?.trim();
        if (!text) {
          input?.focus();
          return;
        }

        activeGtdEditingStepId = '';
        await updateGtdBoard((board) => window.TabOutGTD.updateChecklistItemText(board, taskId, stepId, text));
        showToast('步骤已更新');
        return;
      }

      if (formType === 'add-step') {
        const taskId = form.dataset.taskId;
        const input = form.querySelector('input[name="text"]');
        const text = input?.value?.trim();
        if (!text) {
          input?.focus();
          return;
        }

        await updateGtdBoard((board) => window.TabOutGTD.addChecklistItem(board, taskId, text));
        showToast('步骤已添加');
      }
    } catch (err) {
      console.error('[tab-out] GTD form submit failed:', err);
      showToast('保存 GTD 失败');
    }
  });

  root.addEventListener('change', async (e) => {
    const actionEl = e.target.closest('[data-gtd-action]');
    if (!actionEl) return;

    clearGtdTaskSelectionTimer();
    clearPomodoroToggleTimer();
    const action = actionEl.dataset.gtdAction;

    try {
      if (action === 'import-gtd-file') {
        const file = actionEl.files?.[0];
        actionEl.value = '';
        if (!file) return;

        const markdown = await file.text();
        activeGtdComposerQuadrant = '';
        activeGtdEditingTaskId = '';
        activeGtdEditingStepId = '';
        if (pomodoroState?.status && pomodoroState.status !== 'idle') {
          await resetPomodoro({ skipRender: true, silent: true });
        }

        const board = window.TabOutGTD.importBoardFromMarkdown(markdown, {
          date: window.TabOutGTD.getBoardDate(),
        });
        const storage = getGtdStorage();
        await window.TabOutGTD.saveBoard(storage, board);
        await renderGtdWorkspace();
        showToast('日报已导入到今天');
        return;
      }

      if (action === 'toggle-task') {
        const taskId = actionEl.dataset.taskId;
        const nextBoard = await updateGtdBoard((board) =>
          window.TabOutGTD.toggleTaskCompleted(board, taskId, actionEl.checked)
        );

        if (actionEl.checked && nextBoard.tasks.length > 0 && nextBoard.tasks.every((task) => task.completed)) {
          shootConfetti(window.innerWidth / 2, Math.max(140, window.innerHeight * 0.2));
          showToast('今天四象限已全部完成');
        } else {
          showToast(actionEl.checked ? '任务已完成' : '任务已重新打开');
        }
        return;
      }

      if (action === 'toggle-step') {
        const taskId = actionEl.dataset.taskId;
        const stepId = actionEl.dataset.stepId;
        await updateGtdBoard((board) =>
          window.TabOutGTD.toggleChecklistItemCompleted(board, taskId, stepId, actionEl.checked)
        );
        showToast(actionEl.checked ? '步骤已完成' : '步骤已取消勾选');
      }
    } catch (err) {
      console.error('[tab-out] GTD change failed:', err);
      showToast(action === 'import-gtd-file' ? (err?.message || '导入失败，请重试') : '更新 GTD 失败');
    }
  });

  root.addEventListener('click', async (e) => {
    const actionEl = e.target.closest('[data-gtd-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.gtdAction;
    if (action === 'toggle-task' || action === 'toggle-step') return;

    try {
      if (action === 'import-gtd-report') {
        const fileInput = root.querySelector('[data-gtd-action="import-gtd-file"]');
        fileInput?.click();
        return;
      }

      if (action === 'export-gtd-report') {
        const storage = getGtdStorage();
        const board = await window.TabOutGTD.getTodayBoard(storage);
        const markdown = window.TabOutGTD.exportBoardToMarkdown(board);
        downloadTextFile(`gtd-daily-report-${board.date}.md`, markdown, 'text/markdown;charset=utf-8');
        showToast('日报已导出为 Markdown');
        return;
      }

      if (action === 'toggle-gtd-section') {
        uiPrefs.gtdCollapsed = !uiPrefs.gtdCollapsed;
        saveUiPrefs();
        await renderGtdWorkspace();
        return;
      }

      if (action === 'switch-workspace-tab') {
        const nextTab = normalizeWorkspaceTab(actionEl.dataset.workspaceTab);
        if (uiPrefs.workspaceTab === nextTab) return;
        uiPrefs.workspaceTab = nextTab;
        saveUiPrefs();
        await renderGtdWorkspace();
        return;
      }

      if (action === 'select-task') {
        const taskId = actionEl.dataset.taskId || '';
        if (!taskId) return;
        queueGtdTaskSelection(taskId);
        return;
      }

      clearGtdTaskSelectionTimer();
      clearPomodoroToggleTimer();

      if (action === 'toggle-pomodoro') {
        const taskId = actionEl.dataset.taskId || '';
        if (!taskId) return;
        activeGtdComposerQuadrant = '';
        activeGtdEditingTaskId = '';
        activeGtdEditingStepId = '';
        await togglePomodoro(taskId, actionEl.dataset.taskTitle || '');
        return;
      }

      if (action === 'toggle-pomodoro-track') {
        const taskId = actionEl.dataset.taskId || '';
        if (!taskId) return;
        queuePomodoroToggle(taskId, actionEl.dataset.taskTitle || '');
        return;
      }

      if (action === 'delete-task') {
        const taskId = actionEl.dataset.taskId;
        activeGtdComposerQuadrant = '';
        activeGtdEditingTaskId = '';
        activeGtdEditingStepId = '';
        if (pomodoroState?.taskId === taskId) {
          await resetPomodoro({ skipRender: true, silent: true });
        }
        await updateGtdBoard((board) => window.TabOutGTD.deleteTask(board, taskId));
        showToast('任务已删除');
        return;
      }

      if (action === 'delete-step') {
        const taskId = actionEl.dataset.taskId;
        const stepId = actionEl.dataset.stepId;
        if (activeGtdEditingStepId === stepId) {
          activeGtdEditingStepId = '';
        }
        await updateGtdBoard((board) => window.TabOutGTD.deleteChecklistItem(board, taskId, stepId));
        showToast('步骤已删除');
      }
    } catch (err) {
      console.error('[tab-out] GTD click failed:', err);
      showToast('处理 GTD 操作失败');
    }
  });

  root.addEventListener('dblclick', async (e) => {
    const pomodoroTrack = e.target.closest('[data-gtd-action="toggle-pomodoro-track"]');
    if (pomodoroTrack) {
      try {
        clearPomodoroToggleTimer();
        if (pomodoroState?.taskId === (pomodoroTrack.dataset.taskId || '')) {
          await resetPomodoro();
        }
      } catch (err) {
        console.error('[tab-out] Pomodoro reset failed:', err);
        showToast('重置番茄钟失败');
      }
      return;
    }

    const taskItem = e.target.closest('.gtd-task-item[data-task-id]');
    if (taskItem && !e.target.closest('.gtd-task-checkbox, .gtd-task-delete, .gtd-task-edit-form')) {
      const taskId = taskItem.dataset.taskId || '';
      if (!taskId) return;

      try {
        clearGtdTaskSelectionTimer();
        clearPomodoroToggleTimer();
        activeGtdComposerQuadrant = '';
        activeGtdEditingTaskId = taskId;
        activeGtdEditingStepId = '';

        const storage = getGtdStorage();
        const board = await window.TabOutGTD.getTodayBoard(storage);
        if (board.selectedTaskId !== taskId) {
          await updateGtdBoard((currentBoard) => window.TabOutGTD.selectTask(currentBoard, taskId));
        } else {
          await renderGtdWorkspace();
        }
      } catch (err) {
        console.error('[tab-out] GTD task edit failed:', err);
        showToast('打开任务编辑失败');
      }
      return;
    }

    const stepItem = e.target.closest('.gtd-step-item[data-step-id]');
    if (stepItem && !e.target.closest('.gtd-step-checkbox, .gtd-step-delete, .gtd-step-edit-form')) {
      const stepId = stepItem.dataset.stepId || '';
      if (!stepId) return;

      try {
        clearGtdTaskSelectionTimer();
        clearPomodoroToggleTimer();
        activeGtdComposerQuadrant = '';
        activeGtdEditingTaskId = '';
        activeGtdEditingStepId = stepId;
        await renderGtdWorkspace();
      } catch (err) {
        console.error('[tab-out] GTD step edit failed:', err);
        showToast('打开步骤编辑失败');
      }
      return;
    }

    const quadrantEl = e.target.closest('.gtd-quadrant[data-gtd-action="prompt-add-task"]');
    if (!quadrantEl) return;

    if (e.target.closest('.gtd-task-item, .gtd-task-main, .gtd-task-checkbox, .gtd-task-delete, .gtd-inline-form, .gtd-task-edit-form')) {
      return;
    }

    try {
      activeGtdEditingTaskId = '';
      activeGtdEditingStepId = '';
      activeGtdComposerQuadrant = quadrantEl.dataset.quadrant || '';
      clearPomodoroToggleTimer();
      await renderGtdWorkspace();
    } catch (err) {
      console.error('[tab-out] GTD double click failed:', err);
      showToast('打开任务输入框失败');
    }
  });

  root.addEventListener('keydown', async (e) => {
    const form = e.target.closest('form[data-gtd-form]');
    if (!form) return;

    if (e.key === 'Escape') {
      clearPomodoroToggleTimer();
      if (form.dataset.gtdForm === 'add-task') {
        activeGtdComposerQuadrant = '';
      }
      if (form.dataset.gtdForm === 'edit-task') {
        activeGtdEditingTaskId = '';
      }
      if (form.dataset.gtdForm === 'edit-step') {
        activeGtdEditingStepId = '';
      }
      await renderGtdWorkspace();
    }
  });
}

/* ----------------------------------------------------------------
   EVENT HANDLERS — using event delegation

   One listener on document handles ALL button clicks.
   Think of it as one security guard watching the whole building
   instead of one per door.
   ---------------------------------------------------------------- */

document.addEventListener('click', async (e) => {
  // Walk up the DOM to find the nearest element with data-action
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  // ---- Close duplicate Tab Out tabs ----
  if (action === 'close-tabout-dupes') {
    await closeTabOutDupes();
    playCloseSound();
    const banner = document.getElementById('tabOutDupeBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast('Closed extra Tab Out tabs');
    return;
  }

  const card = actionEl.closest('.mission-card');

  // ---- Expand overflow chips ("+N more") ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // ---- Focus a specific tab ----
  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;

    // Close the tab in Chrome directly
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();

    playCloseSound();

    // Animate the chip row out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        // If the card now has no tabs, remove it too
        const parentCard = document.querySelector('.mission-card:has(.mission-pages:empty)');
        if (parentCard) animateCardOut(parentCard);
        document.querySelectorAll('.mission-card').forEach(c => {
          if (c.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) {
            animateCardOut(c);
          }
        });
      }, 200);
    }

    // Update footer
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;

    showToast('Tab closed');
    return;
  }

  // ---- Save a single tab for later (then close it) ----
  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl   = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;

    // Save to chrome.storage.local
    try {
      await saveTabForLater({ url: tabUrl, title: tabTitle });
    } catch (err) {
      console.error('[tab-out] Failed to save tab:', err);
      showToast('Failed to save tab');
      return;
    }

    // Close the tab in Chrome
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();

    // Animate chip out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => chip.remove(), 200);
    }

    showToast('Saved for later');
    await renderDeferredColumn();
    return;
  }

  // ---- Check off a saved tab (moves it to archive) ----
  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await checkOffSavedTab(id);

    // Animate: strikethrough first, then slide out
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => {
          item.remove();
          renderDeferredColumn(); // refresh counts and archive
        }, 300);
      }, 800);
    }
    return;
  }

  // ---- Dismiss a saved tab (removes it entirely) ----
  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await dismissSavedTab(id);

    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        renderDeferredColumn();
      }, 300);
    }
    return;
  }

  // ---- Close all tabs in a domain group ----
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group    = domainGroups.find(g => {
      return 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId;
    });
    if (!group) return;

    const urls      = group.tabs.map(t => t.url);
    // Landing pages and custom groups (whose domain key isn't a real hostname)
    // must use exact URL matching to avoid closing unrelated tabs
    const useExact  = group.domain === '__landing-pages__' || !!group.label;

    if (useExact) {
      await closeTabsExact(urls);
    } else {
      await closeTabsByUrls(urls);
    }

    if (card) {
      playCloseSound();
      animateCardOut(card);
    }

    // Remove from in-memory groups
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    const groupLabel = group.domain === '__landing-pages__' ? 'Homepages' : (group.label || friendlyDomain(group.domain));
    showToast(`Closed ${urls.length} tab${urls.length !== 1 ? 's' : ''} from ${groupLabel}`);

    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;
    return;
  }

  // ---- Close duplicates, keep one copy ----
  if (action === 'dedup-keep-one') {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    await closeDuplicateTabs(urls, true);
    playCloseSound();

    // Hide the dedup button
    actionEl.style.transition = 'opacity 0.2s';
    actionEl.style.opacity    = '0';
    setTimeout(() => actionEl.remove(), 200);

    // Remove dupe badges from the card
    if (card) {
      card.querySelectorAll('.chip-dupe-badge').forEach(b => {
        b.style.transition = 'opacity 0.2s';
        b.style.opacity    = '0';
        setTimeout(() => b.remove(), 200);
      });
      card.querySelectorAll('.open-tabs-badge').forEach(badge => {
        if (badge.textContent.includes('duplicate')) {
          badge.style.transition = 'opacity 0.2s';
          badge.style.opacity    = '0';
          setTimeout(() => badge.remove(), 200);
        }
      });
      card.classList.remove('has-amber-bar');
      card.classList.add('has-neutral-bar');
    }

    showToast('Closed duplicates, kept one copy each');
    return;
  }

  // ---- Close ALL open tabs ----
  if (action === 'close-all-open-tabs') {
    const allUrls = openTabs
      .filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'))
      .map(t => t.url);
    await closeTabsByUrls(allUrls);
    playCloseSound();

    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
      shootConfetti(
        c.getBoundingClientRect().left + c.offsetWidth / 2,
        c.getBoundingClientRect().top  + c.offsetHeight / 2
      );
      animateCardOut(c);
    });

    showToast('All tabs closed. Fresh start.');
    return;
  }
});

// ---- Archive toggle — expand/collapse the archive section ----
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#archiveToggle');
  if (!toggle) return;

  toggle.classList.toggle('open');
  const body = document.getElementById('archiveBody');
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
});

// ---- Archive search — filter archived items as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'archiveSearch') return;

  const q = e.target.value.trim().toLowerCase();
  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;

  try {
    const { archived } = await getSavedTabs();

    if (q.length < 2) {
      // Show all archived items
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      return;
    }

    // Filter by title or URL containing the query string
    const results = archived.filter(item =>
      (item.title || '').toLowerCase().includes(q) ||
      (item.url  || '').toLowerCase().includes(q)
    );

    archiveList.innerHTML = results.map(item => renderArchiveItem(item)).join('')
      || '<div style="font-size:12px;color:var(--muted);padding:8px 0">No results</div>';
  } catch (err) {
    console.warn('[tab-out] Archive search failed:', err);
  }
});


/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
async function initializeDashboard() {
  await loadOptionalConfig();
  loadUiPrefs();
  initAssetFallbacks();
  initGtdWorkspace();
  initDynamicBackground();
  await loadPomodoroState();
  scheduleHeaderEncouragementRotation();
  await renderDashboard();
}

initializeDashboard();
