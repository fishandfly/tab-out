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
let activeGtdComposerQuadrant = '';
let activeGtdEditingTaskId = '';
let activeGtdEditingQuadrantKey = '';
let pomodoroState = null;
let encouragementTimeoutId = 0;
let encouragementIntervalId = 0;
let gtdTaskSelectionTimerId = 0;
let gtdCompositionActive = false;
let activeGtdDraggingTaskId = '';
let activeGtdStepDragState = null;
let activeGtdKanbanDragState = null;
let activeGtdEditingStepId = '';
let activeGtdBatchStepTaskId = '';
let pendingGtdRenderOptions = null;
// checklist 面板拖拽宽度的合法上下限（像素），超出按默认布局处理
const GTD_DETAIL_MIN_WIDTH = 280;
const GTD_DETAIL_MAX_WIDTH = 1200;
let uiPrefs = {
  gtdCollapsed: false,
  workspaceTab: 'gtd',
  activeGtdScope: 'day',
  activeMemoTag: '',
  gtdDetailCollapsed: false,
  gtdDetailWidth: 0,
  expandedCompletedQuadrants: {},
  expandedCompletedSteps: {},
  expandedKanbanTasks: {},
  expandedKanbanCompletedSteps: {},
  expandedChecklistSteps: {},
  gtdViewMode: 'quadrant',
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
  return value === 'whiteboard' || value === 'notes' || value === 'structure' || value === 'backup' || value === 'memo' ? value : 'gtd';
}

function normalizeGtdDetailWidth(value) {
  const width = Math.round(Number(value));
  if (!Number.isFinite(width) || width < GTD_DETAIL_MIN_WIDTH || width > GTD_DETAIL_MAX_WIDTH) return 0;
  return width;
}

function loadUiPrefs() {
  try {
    const raw = localStorage.getItem(UI_PREFS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    const validScopes = { day: 1, week: 1, month: 1 };
    uiPrefs = {
      ...uiPrefs,
      gtdCollapsed: Boolean(parsed.gtdCollapsed),
      workspaceTab: 'gtd',
      activeGtdScope: validScopes[parsed.activeGtdScope] ? parsed.activeGtdScope : 'day',
      gtdDetailCollapsed: Boolean(parsed.gtdDetailCollapsed),
      gtdDetailWidth: normalizeGtdDetailWidth(parsed.gtdDetailWidth),
      expandedCompletedQuadrants: parsed.expandedCompletedQuadrants && typeof parsed.expandedCompletedQuadrants === 'object' ? parsed.expandedCompletedQuadrants : {},
      expandedCompletedSteps: parsed.expandedCompletedSteps && typeof parsed.expandedCompletedSteps === 'object' ? parsed.expandedCompletedSteps : {},
      expandedKanbanTasks: parsed.expandedKanbanTasks && typeof parsed.expandedKanbanTasks === 'object' ? parsed.expandedKanbanTasks : {},
      expandedKanbanCompletedSteps: parsed.expandedKanbanCompletedSteps && typeof parsed.expandedKanbanCompletedSteps === 'object' ? parsed.expandedKanbanCompletedSteps : {},
      expandedChecklistSteps: parsed.expandedChecklistSteps && typeof parsed.expandedChecklistSteps === 'object' ? parsed.expandedChecklistSteps : {},
      gtdViewMode: parsed.gtdViewMode === 'kanban' ? 'kanban' : 'quadrant',
    };
  } catch {
    // ignore invalid persisted prefs
  }
}

function saveUiPrefs() {
  try {
    localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify({
      gtdCollapsed: uiPrefs.gtdCollapsed,
      activeGtdScope: uiPrefs.activeGtdScope,
      gtdDetailCollapsed: uiPrefs.gtdDetailCollapsed,
      gtdDetailWidth: uiPrefs.gtdDetailWidth,
      expandedCompletedQuadrants: uiPrefs.expandedCompletedQuadrants || {},
      expandedCompletedSteps: uiPrefs.expandedCompletedSteps || {},
      expandedKanbanTasks: uiPrefs.expandedKanbanTasks || {},
      expandedKanbanCompletedSteps: uiPrefs.expandedKanbanCompletedSteps || {},
      expandedChecklistSteps: uiPrefs.expandedChecklistSteps || {},
      gtdViewMode: uiPrefs.gtdViewMode || 'quadrant',
    }));
  } catch {
    // ignore local persistence failure
  }
}

/* ----------------------------------------------------------------
   DYNAMIC BACKGROUND — Delegated to TabOutBackgroundManager
   ---------------------------------------------------------------- */
function initDynamicBackground() {
  if (window.TabOutBackgroundManager?.initDynamicBackground) {
    window.TabOutBackgroundManager.initDynamicBackground();
  }
}

function clearGtdDragState(root = document.getElementById('gtdWorkspace')) {
  activeGtdDraggingTaskId = '';
  activeGtdStepDragState = null;
  activeGtdKanbanDragState = null;
  if (!root) return;

  root.querySelectorAll('.gtd-task-item.is-dragging, .gtd-kanban-task-card.is-dragging, .gtd-kanban-step-card.is-dragging, .gtd-kanban-anchor-title.is-dragging, .is-kanban-dragging').forEach((item) => {
    item.classList.remove('is-dragging', 'is-kanban-dragging');
  });
  root.querySelectorAll('.gtd-quadrant.is-drop-target, .gtd-kanban-lane.is-drop-target').forEach((item) => {
    item.classList.remove('is-drop-target');
  });
  root.querySelectorAll('.gtd-step-item.is-dragging, .gtd-step-item.is-drop-before, .gtd-step-item.is-drop-after').forEach((item) => {
    item.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after');
  });
  root.querySelectorAll('.gtd-step-list.is-drop-end').forEach((item) => {
    item.classList.remove('is-drop-end');
  });
}

function setGtdKanbanDropTarget(laneKey, root = document.getElementById('gtdWorkspace')) {
  if (!root) return;

  root.querySelectorAll('.gtd-kanban-lane.is-drop-target').forEach((item) => {
    if (item.dataset.gtdDropLane !== laneKey) {
      item.classList.remove('is-drop-target');
    }
  });

  const target = laneKey
    ? root.querySelector(`.gtd-kanban-lane[data-gtd-drop-lane="${laneKey}"]`)
    : null;
  if (target) target.classList.add('is-drop-target');
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

/* ----------------------------------------------------------------
   POMODORO TIMER — Delegated to TabOutPomodoro
   ---------------------------------------------------------------- */
function getPomodoroState() {
  return window.TabOutPomodoro ? window.TabOutPomodoro.getState() : (pomodoroState || createIdlePomodoroState());
}

function createIdlePomodoroState() {
  return window.TabOutPomodoro ? window.TabOutPomodoro.createIdlePomodoroState() : {
    taskId: '',
    taskTitle: '',
    status: 'idle',
    remainingMs: POMODORO_DURATION_MS,
    endAt: 0,
    completedAt: '',
  };
}

function normalizePomodoroState(rawState, now = Date.now()) {
  return window.TabOutPomodoro ? window.TabOutPomodoro.normalizePomodoroState(rawState, now) : createIdlePomodoroState();
}

function stopPomodoroTicker() {
  if (window.TabOutPomodoro?.stopTicker) {
    window.TabOutPomodoro.stopTicker();
  }
}

function clearPomodoroToggleTimer() {
  if (window.TabOutPomodoro?.clearToggleTimer) {
    window.TabOutPomodoro.clearToggleTimer();
  }
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
    activeGtdEditingStepId = '';
    await updateGtdBoard((board) => window.TabOutGTD.selectTask(board, taskId));
  }, 220);
}

async function loadPomodoroState() {
  if (window.TabOutPomodoro?.loadState) {
    pomodoroState = await window.TabOutPomodoro.loadState(getGtdStorage());
  }
}

async function startPomodoro(taskId, taskTitle) {
  if (window.TabOutPomodoro?.start) {
    await window.TabOutPomodoro.start(taskId, taskTitle);
  }
}

async function pausePomodoro() {
  if (window.TabOutPomodoro?.pause) {
    await window.TabOutPomodoro.pause();
  }
}

async function resumePomodoro() {
  if (window.TabOutPomodoro?.resume) {
    await window.TabOutPomodoro.resume();
  }
}

async function togglePomodoro(taskId, taskTitle) {
  if (window.TabOutPomodoro?.toggle) {
    await window.TabOutPomodoro.toggle(taskId, taskTitle);
  }
}

function queuePomodoroToggle(taskId, taskTitle) {
  if (window.TabOutPomodoro?.queueToggle) {
    window.TabOutPomodoro.queueToggle(taskId, taskTitle, () => {
      activeGtdComposerQuadrant = '';
      activeGtdEditingTaskId = '';
    });
  }
}

async function resetPomodoro(options = {}) {
  if (window.TabOutPomodoro?.reset) {
    await window.TabOutPomodoro.reset(options);
  }
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
/* ----------------------------------------------------------------
   SAVED FOR LATER — Delegated to TabOutDeferredTabs
   ---------------------------------------------------------------- */
async function saveTabForLater(tab) {
  if (window.TabOutDeferredTabs) return window.TabOutDeferredTabs.saveTabForLater(tab);
}

async function getSavedTabs() {
  if (window.TabOutDeferredTabs) return window.TabOutDeferredTabs.getSavedTabs();
  return { active: [], archived: [] };
}

async function checkOffSavedTab(id) {
  if (window.TabOutDeferredTabs) return window.TabOutDeferredTabs.checkOffSavedTab(id);
}

async function dismissSavedTab(id) {
  if (window.TabOutDeferredTabs) return window.TabOutDeferredTabs.dismissSavedTab(id);
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

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
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
    '先做好', '稳稳推进', '今天先完成', '把心收回到', '认真完成',
    '专注做好', '先拿下', '安心推进', '沉住气做好', '温柔地完成',
    '踏实做好', '全力以赴做好', '耐心地做完', '聚焦于', '从容应对'
  ];
  const focuses = [
    '最重要的一件事', '今天的关键任务', '手头最值钱的事', '眼前最该做的事',
    '真正重要的工作', '你今天的重点', '能带来结果的事', '让自己安心的事',
    '值得投入的任务', '决定成效的那一步', '最能带来成就感的事', '真正有长远价值的事',
    '能让你踏实的前行一步', '手边最基础也最核心的细节', '那个能打破僵局的任务'
  ];
  const endings = [
    '，今天会更顺。', '，状态会跟上来。', '，进度会更稳。',
    '，其余的交给时间。', '，一切都在变好。', '，你会更有掌控感。',
    '，哪怕是一小步也很有意义。', '，世界会为你让步。'
  ];

  const quotes = [];
  for (const opening of openings) {
    for (const focus of focuses) {
      for (const ending of endings) {
        quotes.push(`${opening}${focus}${ending}`);
      }
    }
  }

  const classicQuotes = [
    '每一个不起舞的日子，都是对生命的辜负。 — 尼采',
    '专注你所能控制的，其余的顺其自然。',
    '慢步前行，但决不后退。 — 林肯',
    '最暗的夜，才能看见最亮的星。',
    '博观而约取，厚积而薄发。 — 苏轼',
    '所谓无底深渊，下去也是前程万里。 — 木心',
    '志在山顶的人，不会贪恋山腰的风景。',
    '少做无谓的纠结，多做笃定的推进。',
    '答案在路上，自由在风里。',
    '流水不争先，争的是滔滔不绝。',
    '与其焦虑未来，不如专注当下能写下的这一笔。',
    '专注是一种力量，它能把普通的一天变成非凡。',
    '你每前进一步，焦虑就会减少一分。',
    '做好眼前事，珍惜当下人。',
    '既然目标是地平线，留给世界的只能是背影。 — 汪国真',
    '追风赶月莫停留，平芜尽处是春山。',
    '凡是过往，皆为序章。 — 莎士比亚',
    '不积跬步，无以至千里。 — 荀子',
    '心有所期，全力以赴；定有所成，不负韶华。',
    '种一棵树最好的时间是十年前，其次是现在。',
    '把你的精力和时间，用在真正能让你成长的事情上。',
    '生活就在这一刻，而不是那个你想达到的终点。',
    '保持专注，安静地把事情做好，这本身就是最强大的姿态。',
    '不必行色匆匆，不必光芒四射，只管像松柏一样沉稳挺拔。',
    '精进自己，是解决一切焦虑最有效的解药。',
    '不要因为走得太远，而忘记为什么出发。',
    '成功的秘诀是把平凡的事做得极不平凡。 — 洛克菲勒',
    '行百里者半九十，坚持到最后的才是风景。',
    '当你的才华还撑不起你的野心时，就应该静下心来学习。',
    '越是黑暗的地方，光芒就越耀眼。',
    '把注意力留给自己，把情绪留给风景。',
    '路虽远，行则将至；事虽难，做则必成。 — 《荀子·修身》'
  ];

  const allQuotes = [];
  let qIdx = 0;
  let cIdx = 0;
  while (qIdx < quotes.length || cIdx < classicQuotes.length) {
    if (qIdx < quotes.length) allQuotes.push(quotes[qIdx++]);
    if (qIdx < quotes.length) allQuotes.push(quotes[qIdx++]);
    if (cIdx < classicQuotes.length) {
      allQuotes.push(classicQuotes[cIdx++]);
    } else {
      cIdx = 0;
      allQuotes.push(classicQuotes[cIdx++]);
    }
    if (qIdx >= quotes.length && cIdx >= classicQuotes.length) break;
  }

  return allQuotes.slice(0, 1600);
}

const ENCOURAGEMENT_QUOTES = buildEncouragementQuotes();

function getDailyEncouragement() {
  return ENCOURAGEMENT_QUOTES[Math.floor(Math.random() * ENCOURAGEMENT_QUOTES.length)];
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
    return `<div class="page-chip clickable${chipClass}" draggable="true" data-action="focus-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="${safeTitle}">
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
    return `<div class="page-chip clickable${chipClass}" draggable="true" data-action="focus-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="${safeTitle}">
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
   SAVED FOR LATER — Render Checklist Column (Delegated)
   ---------------------------------------------------------------- */
async function renderDeferredColumn() {
  if (window.TabOutDeferredTabs) return window.TabOutDeferredTabs.renderDeferredColumn();
}

function renderDeferredItem(item) {
  return window.TabOutDeferredTabs ? window.TabOutDeferredTabs.renderDeferredItem(item) : '';
}

function renderArchiveItem(item) {
  return window.TabOutDeferredTabs ? window.TabOutDeferredTabs.renderArchiveItem(item) : '';
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

// 开始拖拽 GTD 分隔条：实时调整 checklist 面板宽度，松手后持久化
function beginGtdDividerDrag(row, startClientX) {
  const rowRect = row.getBoundingClientRect();
  if (!rowRect.width) return;
  // 拖拽上限同时受面板最小宽约束，保证四象限区域可用
  const maxWidth = Math.max(GTD_DETAIL_MIN_WIDTH, Math.round(rowRect.width * 0.6));

  const clampWidth = (clientX) => Math.round(
    Math.min(Math.max(rowRect.right - clientX, GTD_DETAIL_MIN_WIDTH), maxWidth)
  );

  let lastWidth = clampWidth(startClientX);
  const onMove = (ev) => {
    lastWidth = clampWidth(ev.clientX);
    row.style.setProperty('--gtd-detail-width', `${lastWidth}px`);
  };

  const onUp = async () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.classList.remove('gtd-divider-dragging');
    if (lastWidth === uiPrefs.gtdDetailWidth) return;
    uiPrefs.gtdDetailWidth = lastWidth;
    saveUiPrefs();
    try {
      await renderGtdWorkspace();
    } catch (err) {
      console.error('[tab-out] GTD divider resize failed:', err);
      showToast('调整面板宽度失败');
    }
  };

  document.body.classList.add('gtd-divider-dragging');
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
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
    const scopeMeta = window.TabOutGTD.getBoardScope(new Date());
    const activeScope = uiPrefs.activeGtdScope || 'day';
    const scopeInfo = scopeMeta[activeScope];
    const board = await window.TabOutGTD.getScopeBoard(storage, scopeInfo.key);
    const quadrantConfig = await window.TabOutGTD.getQuadrantConfig(storage);
    const quickLinks = window.TabOutQuickLinks
      ? await window.TabOutQuickLinks.getQuickLinks(storage)
      : await window.TabOutGTD.getQuickLinks(storage);
    root.innerHTML = window.TabOutGTD.renderWorkspaceShell(board, {
      composerQuadrant: activeGtdComposerQuadrant,
      editingTaskId: activeGtdEditingTaskId,
      editingStepId: activeGtdEditingStepId,
      batchStepTaskId: activeGtdBatchStepTaskId,
      editingQuadrantKey: activeGtdEditingQuadrantKey,
      quadrantConfig,
      quickLinks,
      pomodoro: getPomodoroState(),
      collapsed: uiPrefs.gtdCollapsed,
      detailCollapsed: uiPrefs.gtdDetailCollapsed,
      detailWidth: uiPrefs.gtdDetailWidth,
      expandedCompletedQuadrants: uiPrefs.expandedCompletedQuadrants || {},
      expandedCompletedSteps: uiPrefs.expandedCompletedSteps || {},
      expandedKanbanTasks: uiPrefs.expandedKanbanTasks || {},
      expandedKanbanCompletedSteps: uiPrefs.expandedKanbanCompletedSteps || {},
      expandedChecklistSteps: uiPrefs.expandedChecklistSteps || {},
      viewMode: uiPrefs.gtdViewMode || 'quadrant',
      activeTab: uiPrefs.workspaceTab,
      activeScope,
      scopeLabel: scopeInfo.label,
      whiteboardUrl: getExtensionAssetUrl('whiteboard/dist/index.html'),
      notesUrl: getExtensionAssetUrl('notes/dist/index.html'),
      structureboardUrl: getExtensionAssetUrl('structureboard/index.html'),
    });
    syncWorkspaceTabbarMount(root);
    if (uiPrefs.workspaceTab === 'backup') {
      renderBackupPanel();
    }
    if (uiPrefs.workspaceTab === 'memo') {
      renderMemoPanel();
    }
    const restoredField = restoreGtdFieldState(root, fieldState);

    if (!restoredField && activeGtdEditingQuadrantKey) {
      const editInput = root.querySelector(
        `form[data-gtd-form="edit-quadrant-title"][data-quadrant="${activeGtdEditingQuadrantKey}"] input[name="title"]`
      );
      if (editInput) {
        requestAnimationFrame(() => {
          editInput.focus();
          editInput.select();
        });
      } else {
        activeGtdEditingQuadrantKey = '';
      }
    } else if (!restoredField && activeGtdEditingTaskId) {
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

async function renderBackupPanel() {
  const panel = document.getElementById('backupPanel');
  if (!panel) return;

  if (!window.TabOutBackup) {
    panel.innerHTML = '<div class="backup-empty">备份模块未加载</div>';
    return;
  }

  try {
    const backups = await window.TabOutBackup.listBackups();
    const today = new Date().toISOString().slice(0, 10);
    const hasToday = backups.some(b => b.date === today);

    let html = `
      <div class="backup-header">
        <h2>每日备份</h2>
        <button class="backup-btn is-primary" id="backupNowBtn">立即备份</button>
      </div>
    `;

    if (backups.length === 0) {
      html += '<div class="backup-empty">暂无备份记录。点击「立即备份」创建第一份备份。</div>';
    } else {
      html += '<div class="backup-list">';
      backups.sort((a, b) => b.date.localeCompare(a.date));
      backups.forEach(b => {
        const sizeLabel = formatBackupSize(b.size);
        html += `
          <div class="backup-item">
            <div class="backup-item-info">
              <div class="backup-item-top">
                <span class="backup-item-date">${b.date}</span>
                <span class="backup-item-size">${sizeLabel}</span>
              </div>
              ${b.summary ? `<div class="backup-item-summary">${escapeHtml(b.summary)}</div>` : ''}
            </div>
            <div class="backup-item-actions">
              <button class="backup-download-btn" data-date="${b.date}">下载</button>
            </div>
          </div>
        `;
      });
      html += '</div>';
    }

    panel.innerHTML = html;

    const backupNowBtn = document.getElementById('backupNowBtn');
    if (backupNowBtn) {
      backupNowBtn.addEventListener('click', async () => {
        backupNowBtn.disabled = true;
        backupNowBtn.textContent = '备份中…';
        await window.TabOutBackup.runNow();
        renderBackupPanel();
      });
    }

    panel.querySelectorAll('.backup-download-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const date = btn.dataset.date;
        btn.disabled = true;
        btn.textContent = '下载中…';
        try {
          const blob = await window.TabOutBackup.getBackup(date);
          if (blob) {
            downloadBlob(blob, `tab-out-backup-${date}.zip`);
          }
        } finally {
          btn.disabled = false;
          btn.textContent = '下载';
        }
      });
    });
  } catch (_) {
    panel.innerHTML = '<div class="backup-empty">备份列表加载失败</div>';
  }
}

function formatBackupSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function renderMemoPanel() {
  const panel = document.getElementById('memoPanel');
  if (!panel || !window.TabOutMemo) return;

  try {
    const storage = getGtdStorage();
    const memos = await window.TabOutMemo.getMemos(storage);
    panel.innerHTML = window.TabOutMemo.renderMemoPanel(memos, {
      activeTag: uiPrefs.activeMemoTag || '',
    });
  } catch (err) {
    console.error('[tab-out] Failed to render memo panel:', err);
    panel.innerHTML = '<div class="memo-empty">微笔记加载失败</div>';
  }
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderReuseList(container, savedChecklists, query = '') {
  const q = query.trim().toLowerCase();
  const filtered = q ? savedChecklists.filter((item) =>
    item.name.toLowerCase().includes(q) ||
    (item.taskTitle || '').toLowerCase().includes(q)
  ) : savedChecklists;

  if (!filtered.length) {
    container.innerHTML = '<div class="dialog-empty">暂无匹配的 checklist</div>';
    return;
  }

  container.innerHTML = filtered.map((item) => `
    <div class="dialog-item" data-gtd-action="apply-saved-checklist" data-checklist-id="${item.id}">
      <div class="dialog-item-title">${escapeHtml(item.name)}</div>
      <div class="dialog-item-meta">
        ${item.taskTitle ? `<span>任务: ${escapeHtml(item.taskTitle)}</span>` : ''}
        <span>${item.items.length} 步</span>
        <span>${new Date(item.createdAt).toLocaleDateString('zh-CN')}</span>
      </div>
    </div>
  `).join('');
}

async function updateGtdBoard(mutator) {
  const storage = getGtdStorage();
  const scopeMeta = window.TabOutGTD.getBoardScope(new Date());
  const activeScope = uiPrefs.activeGtdScope || 'day';
  const scopeInfo = scopeMeta[activeScope];
  const current = await window.TabOutGTD.getScopeBoard(storage, scopeInfo.key);
  const nextBoard = window.TabOutGTD.normalizeBoard(mutator(current), current.date);
  await window.TabOutGTD.saveScopeBoard(storage, nextBoard);
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
    const kanbanItem = e.target.closest('[data-gtd-action="drag-kanban-item"][draggable="true"]');
    if (kanbanItem) {
      if (e.target.closest('input, button, textarea, select')) {
        e.preventDefault();
        return;
      }

      clearGtdTaskSelectionTimer();
      clearPomodoroToggleTimer();
      clearGtdDragState(root);

      const taskId = kanbanItem.dataset.taskId || '';
      const stepId = kanbanItem.dataset.stepId || '';
      const laneEl = kanbanItem.closest('.gtd-kanban-lane[data-gtd-drop-lane]');
      const sourceLane = laneEl?.dataset.gtdDropLane || '';

      activeGtdKanbanDragState = {
        taskId,
        stepId,
        sourceLane,
      };

      kanbanItem.classList.add('is-dragging', 'is-kanban-dragging');

      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', stepId || taskId);
        e.dataTransfer.setData('application/json', JSON.stringify({
          type: stepId ? 'kanban-step' : 'kanban-task',
          taskId,
          stepId,
          sourceLane,
        }));
      }
      return;
    }

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
    if (activeGtdKanbanDragState) {
      const laneEl = e.target.closest('.gtd-kanban-lane[data-gtd-drop-lane]');
      if (!laneEl) {
        setGtdKanbanDropTarget('', root);
        return;
      }

      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      setGtdKanbanDropTarget(laneEl.dataset.gtdDropLane || '', root);
      return;
    }

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
    const laneEl = e.target.closest('.gtd-kanban-lane[data-gtd-drop-lane]');
    if (laneEl) {
      let dragState = activeGtdKanbanDragState;
      if (!dragState) {
        try {
          const raw = e.dataTransfer?.getData('application/json');
          if (raw) dragState = JSON.parse(raw);
        } catch {}
      }

      if (dragState?.taskId) {
        e.preventDefault();
        const targetLane = laneEl.dataset.gtdDropLane || '';
        const { taskId, stepId, sourceLane } = dragState;
        clearGtdDragState(root);

        if (!targetLane || !taskId) return;
        if (sourceLane === targetLane && !stepId) return;

        const laneTitleMap = {
          todo: '待完成',
          planned: '今日计划',
          doing: '开始工作',
          done: '已完成',
        };
        const targetLaneTitle = laneTitleMap[targetLane] || targetLane;

        try {
          if (stepId) {
            await updateGtdBoard((board) =>
              window.TabOutGTD.updateChecklistItemKanbanStatus(board, taskId, stepId, targetLane)
            );
            showToast(`步骤已移动至「${targetLaneTitle}」`);
          } else {
            const nextBoard = await updateGtdBoard((board) =>
              window.TabOutGTD.updateTaskKanbanStatus(board, taskId, targetLane)
            );
            if (targetLane === 'done' && nextBoard.tasks.length > 0 && nextBoard.tasks.every((task) => task.completed)) {
              shootConfetti(window.innerWidth / 2, Math.max(140, window.innerHeight * 0.2));
              showToast('今天四象限已全部完成');
            } else {
              showToast(`任务及子步骤已移动至「${targetLaneTitle}」`);
            }
          }
        } catch (err) {
          console.error('[tab-out] Kanban drop failed:', err);
          showToast('移动看板事项失败');
        }
        return;
      }
    }

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
      if (formType === 'edit-quadrant-title') {
        const quadrantKey = form.dataset.quadrant;
        const input = form.querySelector('input[name="title"]');
        const title = input?.value?.trim();
        if (!title) {
          input?.focus();
          return;
        }

        const storage = getGtdStorage();
        const currentConfig = await window.TabOutGTD.getQuadrantConfig(storage);
        const nextConfig = {
          ...currentConfig,
          [quadrantKey]: title,
        };
        await window.TabOutGTD.saveQuadrantConfig(storage, nextConfig);
        activeGtdEditingQuadrantKey = '';
        await renderGtdWorkspace();
        showToast('象限标题已更新');
        return;
      }

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
        activeGtdEditingQuadrantKey = '';
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
        activeGtdEditingQuadrantKey = '';
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
        activeGtdEditingQuadrantKey = '';
        await updateGtdBoard((board) => window.TabOutGTD.updateChecklistItemText(board, taskId, stepId, text));
        showToast('步骤已更新');
        return;
      }

      if (formType === 'add-batch-steps') {
        const taskId = form.dataset.taskId;
        const textarea = form.querySelector('textarea[name="batchText"]');
        const texts = window.TabOutGTD.splitBatchStepLines(textarea?.value || '');
        if (!texts.length) {
          textarea?.focus();
          return;
        }

        activeGtdBatchStepTaskId = '';
        await updateGtdBoard((board) => window.TabOutGTD.addChecklistItems(board, taskId, texts));
        showToast(`已批量添加 ${texts.length} 个步骤`);
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

  root.addEventListener('focusout', async (e) => {
    const stepForm = e.target.closest('form[data-gtd-form="edit-step"]');
    if (stepForm) {
      if (e.relatedTarget && stepForm.contains(e.relatedTarget)) return;
      const stepId = stepForm.dataset.stepId;
      if (!activeGtdEditingStepId || activeGtdEditingStepId !== stepId) return;

      const taskId = stepForm.dataset.taskId;
      const input = stepForm.querySelector('input[name="text"]');
      const text = input?.value?.trim();

      activeGtdEditingStepId = '';
      try {
        if (text) {
          const storage = getGtdStorage();
          const scopeMeta = window.TabOutGTD.getBoardScope(new Date());
          const scopeInfo = scopeMeta[uiPrefs.activeGtdScope || 'day'];
          const board = await window.TabOutGTD.getScopeBoard(storage, scopeInfo.key);
          const task = (board.tasks || []).find((t) => t.id === taskId);
          const step = task?.checklist?.find((s) => s.id === stepId);
          if (step && step.text !== text) {
            await updateGtdBoard((b) => window.TabOutGTD.updateChecklistItemText(b, taskId, stepId, text));
            showToast('步骤已更新');
            return;
          }
        }
        await renderGtdWorkspace();
      } catch (_) {
        await renderGtdWorkspace();
      }
      return;
    }

    const taskForm = e.target.closest('form[data-gtd-form="edit-task"]');
    if (taskForm) {
      if (e.relatedTarget && taskForm.contains(e.relatedTarget)) return;
      const taskId = taskForm.dataset.taskId;
      if (!activeGtdEditingTaskId || activeGtdEditingTaskId !== taskId) return;

      const input = taskForm.querySelector('input[name="title"]');
      const title = input?.value?.trim();

      activeGtdEditingTaskId = '';
      try {
        if (title) {
          const storage = getGtdStorage();
          const scopeMeta = window.TabOutGTD.getBoardScope(new Date());
          const scopeInfo = scopeMeta[uiPrefs.activeGtdScope || 'day'];
          const board = await window.TabOutGTD.getScopeBoard(storage, scopeInfo.key);
          const task = (board.tasks || []).find((t) => t.id === taskId);
          if (task && task.title !== title) {
            await updateGtdBoard((b) => window.TabOutGTD.updateTaskTitle(b, taskId, title));
            showToast('任务已更新');
            return;
          }
        }
        await renderGtdWorkspace();
      } catch (_) {
        await renderGtdWorkspace();
      }
      return;
    }

    const form = e.target.closest('form[data-gtd-form="edit-quadrant-title"]');
    if (!form) return;
    if (e.relatedTarget && form.contains(e.relatedTarget)) return;

    const quadrantKey = form.dataset.quadrant;
    const input = form.querySelector('input[name="title"]');
    const title = input?.value?.trim();
    if (!title || !activeGtdEditingQuadrantKey) {
      activeGtdEditingQuadrantKey = '';
      await renderGtdWorkspace();
      return;
    }

    try {
      const storage = getGtdStorage();
      const currentConfig = await window.TabOutGTD.getQuadrantConfig(storage);
      if (currentConfig[quadrantKey] !== title) {
        const nextConfig = { ...currentConfig, [quadrantKey]: title };
        await window.TabOutGTD.saveQuadrantConfig(storage, nextConfig);
        showToast('象限标题已更新');
      }
      activeGtdEditingQuadrantKey = '';
      await renderGtdWorkspace();
    } catch (_) {
      activeGtdEditingQuadrantKey = '';
      await renderGtdWorkspace();
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
        activeGtdEditingQuadrantKey = '';
        if (pomodoroState?.status && pomodoroState.status !== 'idle') {
          await resetPomodoro({ skipRender: true, silent: true });
        }

        const storage = getGtdStorage();
        const quadrantConfig = await window.TabOutGTD.getQuadrantConfig(storage);
        const board = window.TabOutGTD.importBoardFromMarkdown(markdown, {
          date: window.TabOutGTD.getBoardDate(),
          quadrantConfig,
        });
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
    if (activeGtdEditingStepId && !e.target.closest('form[data-gtd-form="edit-step"]')) {
      const form = root.querySelector(`form[data-gtd-form="edit-step"][data-step-id="${activeGtdEditingStepId}"]`);
      const stepId = activeGtdEditingStepId;
      activeGtdEditingStepId = '';
      const actionEl = e.target.closest('[data-gtd-action]');
      if (form) {
        const taskId = form.dataset.taskId;
        const input = form.querySelector('input[name="text"]');
        const text = input?.value?.trim();
        try {
          if (text) {
            const storage = getGtdStorage();
            const scopeMeta = window.TabOutGTD.getBoardScope(new Date());
            const scopeInfo = scopeMeta[uiPrefs.activeGtdScope || 'day'];
            const board = await window.TabOutGTD.getScopeBoard(storage, scopeInfo.key);
            const task = (board.tasks || []).find((t) => t.id === taskId);
            const step = task?.checklist?.find((s) => s.id === stepId);
            if (step && step.text !== text) {
              await updateGtdBoard((b) => window.TabOutGTD.updateChecklistItemText(b, taskId, stepId, text));
              showToast('步骤已更新');
            } else if (!actionEl) {
              await renderGtdWorkspace();
            }
          } else if (!actionEl) {
            await renderGtdWorkspace();
          }
        } catch (_) {
          if (!actionEl) await renderGtdWorkspace();
        }
      } else if (!actionEl) {
        await renderGtdWorkspace();
      }
    }

    if (activeGtdEditingTaskId && !e.target.closest('form[data-gtd-form="edit-task"]')) {
      const form = root.querySelector(`form[data-gtd-form="edit-task"][data-task-id="${activeGtdEditingTaskId}"]`);
      const taskId = activeGtdEditingTaskId;
      activeGtdEditingTaskId = '';
      const actionEl = e.target.closest('[data-gtd-action]');
      if (form) {
        const input = form.querySelector('input[name="title"]');
        const title = input?.value?.trim();
        try {
          if (title) {
            const storage = getGtdStorage();
            const scopeMeta = window.TabOutGTD.getBoardScope(new Date());
            const scopeInfo = scopeMeta[uiPrefs.activeGtdScope || 'day'];
            const board = await window.TabOutGTD.getScopeBoard(storage, scopeInfo.key);
            const task = (board.tasks || []).find((t) => t.id === taskId);
            if (task && task.title !== title) {
              await updateGtdBoard((b) => window.TabOutGTD.updateTaskTitle(b, taskId, title));
              showToast('任务已更新');
            } else if (!actionEl) {
              await renderGtdWorkspace();
            }
          } else if (!actionEl) {
            await renderGtdWorkspace();
          }
        } catch (_) {
          if (!actionEl) await renderGtdWorkspace();
        }
      } else if (!actionEl) {
        await renderGtdWorkspace();
      }
    }

    const actionEl = e.target.closest('[data-gtd-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.gtdAction;
    if (action === 'toggle-task' || action === 'toggle-step') return;

    try {
      if (action === 'switch-gtd-view') {
        const nextView = actionEl.dataset.view;
        if (nextView === 'kanban' || nextView === 'quadrant') {
          uiPrefs.gtdViewMode = nextView;
          saveUiPrefs();
          await renderGtdWorkspace();
        }
        return;
      }

      if (action === 'toggle-kanban-task-collapse') {
        const taskId = actionEl.dataset.taskId;
        const lane = actionEl.dataset.lane || '';
        if (!taskId) return;
        const key = lane ? `${lane}:${taskId}` : taskId;
        uiPrefs.expandedKanbanTasks = uiPrefs.expandedKanbanTasks || {};
        uiPrefs.expandedKanbanTasks[key] = !uiPrefs.expandedKanbanTasks[key];
        saveUiPrefs();
        await renderGtdWorkspace();
        return;
      }

      if (action === 'toggle-kanban-completed-steps') {
        const taskId = actionEl.dataset.taskId;
        const lane = actionEl.dataset.lane || '';
        if (!taskId) return;
        const key = lane ? `${lane}:${taskId}` : taskId;
        uiPrefs.expandedKanbanCompletedSteps = uiPrefs.expandedKanbanCompletedSteps || {};
        uiPrefs.expandedKanbanCompletedSteps[key] = !uiPrefs.expandedKanbanCompletedSteps[key];
        saveUiPrefs();
        await renderGtdWorkspace();
        return;
      }

      if (action === 'toggle-step-collapse') {
        const stepId = actionEl.dataset.stepId;
        if (!stepId) return;
        uiPrefs.expandedChecklistSteps = uiPrefs.expandedChecklistSteps || {};
        uiPrefs.expandedChecklistSteps[stepId] = !uiPrefs.expandedChecklistSteps[stepId];
        saveUiPrefs();
        await renderGtdWorkspace();
        return;
      }

      if (action === 'toggle-completed-tasks') {
        const quadrant = actionEl.dataset.quadrant;
        if (!quadrant) return;
        uiPrefs.expandedCompletedQuadrants = uiPrefs.expandedCompletedQuadrants || {};
        uiPrefs.expandedCompletedQuadrants[quadrant] = !uiPrefs.expandedCompletedQuadrants[quadrant];
        saveUiPrefs();
        await renderGtdWorkspace();
        return;
      }

      if (action === 'toggle-completed-steps') {
        const taskId = actionEl.dataset.taskId;
        if (!taskId) return;
        uiPrefs.expandedCompletedSteps = uiPrefs.expandedCompletedSteps || {};
        uiPrefs.expandedCompletedSteps[taskId] = !uiPrefs.expandedCompletedSteps[taskId];
        saveUiPrefs();
        await renderGtdWorkspace();
        return;
      }
      if (action === 'import-gtd-report') {
        const fileInput = root.querySelector('[data-gtd-action="import-gtd-file"]');
        fileInput?.click();
        return;
      }

      if (action === 'export-gtd-report') {
        if (uiPrefs.activeGtdScope !== 'day') return;
        const storage = getGtdStorage();
        const board = await window.TabOutGTD.getTodayBoard(storage);
        const quadrantConfig = await window.TabOutGTD.getQuadrantConfig(storage);
        const markdown = window.TabOutGTD.exportBoardToMarkdown(board, quadrantConfig);
        downloadTextFile(`gtd-daily-report-${board.date}.md`, markdown, 'text/markdown;charset=utf-8');
        showToast('日报已导出为 Markdown');
        return;
      }

      if (action === 'open-gtd-archive') {
        await openGtdArchiveDialog();
        return;
      }

      if (action === 'clear-gtd-board') {
        const scopeLabels = { day: '今天', week: '本周', month: '本月' };
        const scopeLabel = scopeLabels[uiPrefs.activeGtdScope] || '今天';
        const confirmed = confirm(`确定清空${scopeLabel}的所有 GTD 任务吗？此操作不可撤销。`);
        if (!confirmed) return;
        const storage = getGtdStorage();
        const scopeMeta = window.TabOutGTD.getBoardScope(new Date());
        const scopeInfo = scopeMeta[uiPrefs.activeGtdScope || 'day'];
        const board = await window.TabOutGTD.getScopeBoard(storage, scopeInfo.key);
        board.tasks = (board.tasks || []).filter((t) => t.archived);
        board.selectedTaskId = '';
        board.updatedAt = new Date().toISOString();
        await window.TabOutGTD.saveScopeBoard(storage, board);
        await renderGtdWorkspace();
        showToast(`${scopeLabel} GTD 已清空`);
        return;
      }

      if (action === 'switch-scope') {
        const scope = actionEl.dataset.scope;
        if (scope !== 'day' && scope !== 'week' && scope !== 'month') return;
        if (uiPrefs.activeGtdScope === scope) return;
        activeGtdComposerQuadrant = '';
        activeGtdEditingTaskId = '';
        activeGtdEditingStepId = '';
        activeGtdEditingQuadrantKey = '';
        if (pomodoroState?.status && pomodoroState.status !== 'idle') {
          await resetPomodoro({ skipRender: true, silent: true });
        }
        uiPrefs.activeGtdScope = scope;
        saveUiPrefs();
        await renderGtdWorkspace();
        showToast(scope === 'day' ? '切换日视图' : scope === 'week' ? '切换周视图' : '切换月视图');
        return;
      }

      if (action === 'toggle-gtd-section') {
        uiPrefs.gtdCollapsed = !uiPrefs.gtdCollapsed;
        saveUiPrefs();
        await renderGtdWorkspace();
        return;
      }

      if (action === 'toggle-gtd-detail') {
        uiPrefs.gtdDetailCollapsed = !uiPrefs.gtdDetailCollapsed;
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
        activeGtdEditingQuadrantKey = '';
        await togglePomodoro(taskId, actionEl.dataset.taskTitle || '');
        return;
      }

      if (action === 'toggle-pomodoro-track') {
        const taskId = actionEl.dataset.taskId || '';
        if (!taskId) return;
        queuePomodoroToggle(taskId, actionEl.dataset.taskTitle || '');
        return;
      }

      if (action === 'delete-task' || action === 'archive-task') {
        const taskId = actionEl.dataset.taskId;
        activeGtdComposerQuadrant = '';
        activeGtdEditingTaskId = '';
        activeGtdEditingStepId = '';
        activeGtdEditingQuadrantKey = '';
        if (pomodoroState?.taskId === taskId) {
          await resetPomodoro({ skipRender: true, silent: true });
        }
        await updateGtdBoard((board) => window.TabOutGTD.archiveTask(board, taskId));
        showToast('任务已归档');
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

      if (action === 'save-checklist') {
        const taskId = actionEl.dataset.taskId;
        if (!taskId) return;
        const storage = getGtdStorage();
        const scopeMeta = window.TabOutGTD.getBoardScope(new Date());
        const scopeInfo = scopeMeta[uiPrefs.activeGtdScope || 'day'];
        const board = await window.TabOutGTD.getScopeBoard(storage, scopeInfo.key);
        const task = board.tasks.find((t) => t.id === taskId);
        if (!task || !task.checklist.length) return;
        const name = `${task.title} (${task.checklist.length} 步)`;
        await window.TabOutGTD.saveSavedChecklist(storage, name, task.checklist, task.title);
        showToast('checklist 已保存');
      }

      if (action === 'toggle-batch-steps') {
        const taskId = actionEl.dataset.taskId;
        if (!taskId) return;
        activeGtdBatchStepTaskId = activeGtdBatchStepTaskId === taskId ? '' : taskId;
        await renderGtdWorkspace();
        if (activeGtdBatchStepTaskId) {
          const textarea = document.querySelector('form[data-gtd-form="add-batch-steps"] textarea[name="batchText"]');
          if (textarea) requestAnimationFrame(() => textarea.focus());
        }
        return;
      }

      if (action === 'close-batch-steps') {
        activeGtdBatchStepTaskId = '';
        await renderGtdWorkspace();
        return;
      }

      if (action === 'open-reuse-checklist') {
        const taskId = actionEl.dataset.taskId;
        if (!taskId) return;
        await openReuseDialog(taskId);
        return;
      }
    } catch (err) {
      console.error('[tab-out] GTD click failed:', err);
      showToast('处理 GTD 操作失败');
    }
  });

  root.addEventListener('dblclick', async (e) => {
    const titleEl = e.target.closest('.gtd-quadrant-title, [data-gtd-action="edit-quadrant-title"]');
    if (titleEl && !e.target.closest('.gtd-quadrant-title-edit-form')) {
      const quadrantKey = titleEl.dataset.quadrant || '';
      if (quadrantKey) {
        try {
          clearGtdTaskSelectionTimer();
          clearPomodoroToggleTimer();
          activeGtdComposerQuadrant = '';
          activeGtdEditingTaskId = '';
          activeGtdEditingStepId = '';
          activeGtdEditingQuadrantKey = quadrantKey;
          await renderGtdWorkspace();
        } catch (err) {
          console.error('[tab-out] GTD quadrant title edit failed:', err);
          showToast('打开象限标题编辑失败');
        }
        return;
      }
    }

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
        activeGtdEditingQuadrantKey = '';

        const storage = getGtdStorage();
        const scopeMeta = window.TabOutGTD.getBoardScope(new Date());
        const scopeInfo = scopeMeta[uiPrefs.activeGtdScope || 'day'];
        const board = await window.TabOutGTD.getScopeBoard(storage, scopeInfo.key);
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
        activeGtdEditingQuadrantKey = '';
        await renderGtdWorkspace();
      } catch (err) {
        console.error('[tab-out] GTD step edit failed:', err);
        showToast('打开步骤编辑失败');
      }
      return;
    }

    const quadrantEl = e.target.closest('.gtd-quadrant[data-gtd-action="prompt-add-task"]');
    if (!quadrantEl) return;

    if (e.target.closest('.gtd-task-item, .gtd-task-main, .gtd-task-checkbox, .gtd-task-delete, .gtd-inline-form, .gtd-task-edit-form, .gtd-quadrant-title-edit-form')) {
      return;
    }

    try {
      activeGtdEditingTaskId = '';
      activeGtdEditingStepId = '';
      activeGtdEditingQuadrantKey = '';
      activeGtdComposerQuadrant = quadrantEl.dataset.quadrant || '';
      clearPomodoroToggleTimer();
      await renderGtdWorkspace();
    } catch (err) {
      console.error('[tab-out] GTD double click failed:', err);
      showToast('打开任务输入框失败');
    }
  });

  root.addEventListener('mousedown', (e) => {
    const divider = e.target.closest('.gtd-panel-divider');
    // 只响应分隔条空白区域的拖拽，折叠按钮仍走点击逻辑
    if (!divider || e.target.closest('[data-gtd-action="toggle-gtd-detail"]')) return;
    if (divider.classList.contains('is-collapsed')) return;

    const row = divider.closest('.gtd-main-row');
    if (!row) return;
    e.preventDefault();
    beginGtdDividerDrag(row, e.clientX);
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
      if (form.dataset.gtdForm === 'add-batch-steps') {
        activeGtdBatchStepTaskId = '';
      }
      if (form.dataset.gtdForm === 'edit-quadrant-title') {
        activeGtdEditingQuadrantKey = '';
      }
      await renderGtdWorkspace();
    }
  });

  /* -- Memo (微笔记) event handlers -- */
  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-memo-form="add-memo"]');
    if (!form) return;
    e.preventDefault();

    const textarea = form.querySelector('textarea[name="content"]');
    const content = textarea?.value?.trim();
    if (!content) return;

    try {
      const storage = getGtdStorage();
      await window.TabOutMemo.addMemo(storage, content);
      textarea.value = '';
      await renderGtdWorkspace();
      showToast('微笔记已记录');
    } catch (err) {
      console.error('[tab-out] Failed to add memo:', err);
      showToast('记录失败');
    }
  });

  root.addEventListener('keydown', async (e) => {
    const textarea = e.target.closest('textarea[name="content"]');
    if (!textarea) return;
    if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;

    const form = textarea.closest('form[data-memo-form="add-memo"]');
    if (!form) return;

    e.preventDefault();
    form.requestSubmit();
  });

  root.addEventListener('keydown', (e) => {
    const textarea = e.target.closest('textarea[name="batchText"]');
    if (!textarea) return;
    if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;

    const form = textarea.closest('form[data-gtd-form="add-batch-steps"]');
    if (!form) return;

    e.preventDefault();
    form.requestSubmit();
  });

  root.addEventListener('click', async (e) => {
    const actionEl = e.target.closest('[data-memo-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.memoAction;

    if (action === 'delete-memo') {
      const memoId = actionEl.dataset.memoId;
      if (!memoId) return;

      try {
        const storage = getGtdStorage();
        await window.TabOutMemo.deleteMemo(storage, memoId);
        await renderGtdWorkspace();
        showToast('微笔记已删除');
      } catch (err) {
        console.error('[tab-out] Failed to delete memo:', err);
        showToast('删除失败');
      }
      return;
    }

    if (action === 'filter-tag') {
      const tag = actionEl.dataset.memoTag || '';
      uiPrefs.activeMemoTag = tag || '';
      await renderGtdWorkspace();
      if (tag) {
        const textarea = document.querySelector('#memoPanel textarea[name="content"]');
        if (textarea) {
          textarea.value = '#' + tag + ' ';
          textarea.focus();
        }
      }
      return;
    }
  });
}

/* ----------------------------------------------------------------
   GTD DIALOGS — Delegated to TabOutGTDDialogs
   ---------------------------------------------------------------- */
async function openReuseDialog(taskId) {
  if (window.TabOutGTDDialogs) return window.TabOutGTDDialogs.openReuseDialog(taskId);
}

function closeReuseDialog() {
  if (window.TabOutGTDDialogs) return window.TabOutGTDDialogs.closeReuseDialog();
}

async function openGtdArchiveDialog() {
  if (window.TabOutGTDDialogs) return window.TabOutGTDDialogs.openGtdArchiveDialog();
}

function closeGtdArchiveDialog() {
  if (window.TabOutGTDDialogs) return window.TabOutGTDDialogs.closeGtdArchiveDialog();
}

async function refreshGtdArchiveList(query = '') {
  if (window.TabOutGTDDialogs) return window.TabOutGTDDialogs.refreshGtdArchiveList(query);
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


// Tab drag support: allows dragging open tabs from cards onto GTD quick links bar
document.addEventListener('dragstart', (e) => {
  const chip = e.target.closest('.page-chip[data-tab-url]');
  if (!chip) return;
  const url = chip.dataset.tabUrl;
  const title = chip.dataset.tabTitle || chip.querySelector('.chip-text')?.textContent || url;
  if (e.dataTransfer && url) {
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('application/tabout-tab', JSON.stringify({ url, title }));
    e.dataTransfer.setData('application/json', JSON.stringify({ url, title }));
    e.dataTransfer.setData('text/plain', url);
    e.dataTransfer.setData('text/uri-list', url);
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
  if (window.TabOutQuickLinks?.init) {
    window.TabOutQuickLinks.init({
      getStorage: getGtdStorage,
      refresh: renderGtdWorkspace,
      showToast,
    });
  }
  if (window.TabOutGTDDialogs?.init) {
    window.TabOutGTDDialogs.init({
      getStorage: getGtdStorage,
      updateBoard: updateGtdBoard,
      renderWorkspace: renderGtdWorkspace,
      showToast,
      getActiveScope: () => uiPrefs.activeGtdScope || 'day',
    });
  }
  if (window.TabOutPomodoro?.init) {
    await window.TabOutPomodoro.init({
      storage: getGtdStorage(),
      onUpdate: (state) => {
        pomodoroState = state;
        renderGtdWorkspace({ preserveActiveField: true });
      },
      onComplete: () => {
        shootConfetti(window.innerWidth * 0.72, Math.max(120, window.innerHeight * 0.24));
      },
      showToast,
    });
  }
  if (window.TabOutDeferredTabs?.init) {
    await window.TabOutDeferredTabs.init({
      storage: typeof chrome !== 'undefined' && chrome?.storage?.local ? chrome.storage.local : getGtdStorage(),
    });
  }
  if (window.TabOutAI?.init) {
    await window.TabOutAI.init({
      storage: getGtdStorage(),
      refreshGtd: renderGtdWorkspace,
      getActiveScope: () => uiPrefs.activeGtdScope || 'day',
      showToast,
    });
  }
  if (window.TabOutCodexReset?.init) {
    window.TabOutCodexReset.init({
      storage: getGtdStorage(),
    });
  }
  scheduleHeaderEncouragementRotation();
  await renderDashboard();
}

initializeDashboard();
