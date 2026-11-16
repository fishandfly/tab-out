(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TabOutPomodoro = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'tab-out-pomodoro';
  const DURATION_MS = 25 * 60 * 1000;

  let _state = null;
  let _tickerId = 0;
  let _toggleTimerId = 0;
  let _storage = null;
  let _onUpdate = null;
  let _onComplete = null;
  let _showToast = null;

  function createIdlePomodoroState() {
    return {
      taskId: '',
      taskTitle: '',
      status: 'idle',
      remainingMs: DURATION_MS,
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
    const remainingMs = Math.max(0, Math.min(DURATION_MS, Number(rawState.remainingMs) || DURATION_MS));

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

  function getState() {
    return _state || createIdlePomodoroState();
  }

  function setState(nextState) {
    _state = nextState;
  }

  async function saveState() {
    if (_storage && typeof _storage.set === 'function') {
      await _storage.set({
        [STORAGE_KEY]: _state || createIdlePomodoroState(),
      });
    }
  }

  function stopTicker() {
    if (!_tickerId) return;
    if (typeof window !== 'undefined') window.clearInterval(_tickerId);
    _tickerId = 0;
  }

  function clearToggleTimer() {
    if (!_toggleTimerId) return;
    if (typeof window !== 'undefined') window.clearTimeout(_toggleTimerId);
    _toggleTimerId = 0;
  }

  async function complete() {
    const completedState = {
      ...(_state || createIdlePomodoroState()),
      status: 'completed',
      remainingMs: 0,
      endAt: 0,
      completedAt: new Date().toISOString(),
    };

    _state = completedState;
    stopTicker();
    await saveState();

    if (typeof _onComplete === 'function') {
      _onComplete(completedState);
    } else if (typeof _onUpdate === 'function') {
      await _onUpdate(completedState, { preserveActiveField: true });
    }

    if (typeof _showToast === 'function') {
      _showToast(completedState.taskTitle ? `番茄钟完成：${completedState.taskTitle}` : '番茄钟完成');
    }
  }

  function syncTicker() {
    stopTicker();
    if (!_state || _state.status !== 'running') return;
    if (typeof window === 'undefined') return;

    _tickerId = window.setInterval(async () => {
      if (!_state || _state.status !== 'running') {
        stopTicker();
        return;
      }

      const remainingMs = Math.max(0, _state.endAt - Date.now());
      if (remainingMs <= 0) {
        await complete();
        return;
      }

      _state = {
        ..._state,
        remainingMs,
      };

      if (typeof _onUpdate === 'function') {
        await _onUpdate(_state, { preserveActiveField: true });
      }
    }, 1000);
  }

  async function loadState(storage) {
    if (storage) _storage = storage;
    if (_storage && typeof _storage.get === 'function') {
      const payload = await _storage.get(STORAGE_KEY);
      _state = normalizePomodoroState(payload?.[STORAGE_KEY]);
      await saveState();
      syncTicker();
    }
    return _state || createIdlePomodoroState();
  }

  async function start(taskId, taskTitle) {
    _state = {
      taskId,
      taskTitle,
      status: 'running',
      remainingMs: DURATION_MS,
      endAt: Date.now() + DURATION_MS,
      completedAt: '',
    };
    await saveState();
    syncTicker();
    if (typeof _onUpdate === 'function') await _onUpdate(_state);
    if (typeof _showToast === 'function') {
      _showToast(taskTitle ? `番茄钟已启动：${taskTitle}` : '番茄钟已启动');
    }
  }

  async function pause() {
    if (!_state || _state.status !== 'running') return;

    _state = {
      ..._state,
      status: 'paused',
      remainingMs: Math.max(0, _state.endAt - Date.now()),
      endAt: 0,
    };
    stopTicker();
    await saveState();
    if (typeof _onUpdate === 'function') await _onUpdate(_state);
    if (typeof _showToast === 'function') {
      _showToast('番茄钟已暂停');
    }
  }

  async function resume() {
    if (!_state || _state.status !== 'paused') return;

    _state = {
      ..._state,
      status: 'running',
      endAt: Date.now() + _state.remainingMs,
    };
    await saveState();
    syncTicker();
    if (typeof _onUpdate === 'function') await _onUpdate(_state);
    if (typeof _showToast === 'function') {
      _showToast('番茄钟已继续');
    }
  }

  async function toggle(taskId, taskTitle) {
    const currentState = normalizePomodoroState(_state);
    const sameTask = currentState.taskId === taskId;

    if (!sameTask || currentState.status === 'idle' || currentState.status === 'completed') {
      await start(taskId, taskTitle);
      return;
    }

    if (currentState.status === 'running') {
      await pause();
      return;
    }

    if (currentState.status === 'paused') {
      await resume();
    }
  }

  function queueToggle(taskId, taskTitle, onBeforeToggle) {
    clearToggleTimer();
    if (typeof window === 'undefined') return;

    _toggleTimerId = window.setTimeout(async () => {
      _toggleTimerId = 0;
      if (typeof onBeforeToggle === 'function') {
        onBeforeToggle();
      }
      await toggle(taskId, taskTitle);
    }, 220);
  }

  async function reset(options = {}) {
    const { skipRender = false, silent = false } = options;
    _state = createIdlePomodoroState();
    stopTicker();
    await saveState();
    if (!skipRender && typeof _onUpdate === 'function') {
      await _onUpdate(_state);
    }
    if (!silent && typeof _showToast === 'function') {
      _showToast('番茄钟已重置');
    }
  }

  function init(options = {}) {
    if (options.storage) _storage = options.storage;
    if (options.onUpdate) _onUpdate = options.onUpdate;
    if (options.onComplete) _onComplete = options.onComplete;
    if (options.showToast) _showToast = options.showToast;
    return loadState(_storage);
  }

  return {
    STORAGE_KEY,
    DURATION_MS,
    createIdlePomodoroState,
    normalizePomodoroState,
    getState,
    setState,
    init,
    loadState,
    start,
    pause,
    resume,
    toggle,
    queueToggle,
    reset,
    syncTicker,
    stopTicker,
    clearToggleTimer,
  };
});
