(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TabOutCodexReset = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_API_KEY = 'bat_c8302bf1e2423beddd841ceafee96cac87892def69c20a82';
  const PRIMARY_API_URL = 'https://api.aitrend.us/api/v1/reset-predictions?providers=codex';
  const FALLBACK_API_URL = 'https://api.aitrend.us/api/v1/reset-predictions';
  const CACHE_STORAGE_KEY = 'tab-out-codex-reset-cache-v1';
  const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache to preserve quota

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatStateLabel(state) {
    const map = {
      scheduled: '计划中',
      confirmed: '已确认',
      elapsed_unconfirmed: '窗口期内',
      completed: '已重置',
      open: '开放中',
      unknown: '待确认',
    };
    return map[state] || '待确认';
  }

  function getProbabilityLevel(prob) {
    if (prob === null || prob === undefined || prob === '') return 'unknown';
    const num = Number(prob);
    if (isNaN(num)) return 'unknown';
    if (num >= 80) return 'high';
    if (num >= 45) return 'medium';
    return 'low';
  }

  function formatWindowStatusLabel(status) {
    const map = {
      scheduled: '已定档',
      elapsed_unconfirmed: '窗口期内（待兑现）',
      completed: '已兑现',
      confirmed: '已确认',
      unknown: '时间待确认',
    };
    return map[status] || '待确认';
  }

  function formatUtcToLocal(isoString) {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return isoString;
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${month}/${day} ${hours}:${minutes}`;
    } catch {
      return isoString;
    }
  }

  function parseCodexResetResponse(raw) {
    if (!raw || typeof raw !== 'object') return null;

    let codexItem = null;

    // Structure from /api/v1/reset-predictions?providers=codex or /reset-predictions
    if (raw.data && Array.isArray(raw.data.items)) {
      codexItem = raw.data.items.find((item) => item?.provider === 'codex') || raw.data.items[0];
    } else if (Array.isArray(raw.items)) {
      codexItem = raw.items.find((item) => item?.provider === 'codex') || raw.items[0];
    } else if (raw.provider === 'codex' || typeof raw.probability === 'number') {
      codexItem = raw;
    }

    if (!codexItem) return null;

    const current = codexItem.current || {};
    const probability = typeof codexItem.probability === 'number'
      ? codexItem.probability
      : (typeof current.probability === 'number' ? current.probability : null);

    const title = current.title || codexItem.title || 'Codex 额度重置预测';
    const summary = current.summary || codexItem.summary || '';
    const windowText = codexItem.windowText || current.windowText || '';
    const windowStart = codexItem.windowStart || current.windowStart || '';
    const windowEnd = codexItem.windowEnd || current.windowEnd || '';
    const windowStatus = codexItem.windowStatus || current.windowStatus || '';
    const hasTimePrediction = Boolean(codexItem.hasTimePrediction ?? (windowText && windowText !== '时间待确认'));
    const state = current.state || codexItem.state || 'unknown';
    const plans = Array.isArray(current.plans) ? current.plans : (Array.isArray(codexItem.plans) ? codexItem.plans : []);
    const sourceLabel = current.sourceLabel || codexItem.sourceLabel || '';
    const sourceUrl = current.sourceUrl || codexItem.sourceUrl || '';
    const checkedAt = current.checkedAt || codexItem.checkedAt || raw.meta?.generatedAt || '';
    const lastCompletedAt = current.lastCompletedAt || codexItem.lastCompletedAt || '';

    return {
      provider: 'codex',
      probability,
      title,
      summary,
      windowText,
      windowStart,
      windowEnd,
      windowStatus,
      windowStatusLabel: formatWindowStatusLabel(windowStatus),
      hasTimePrediction,
      state,
      stateLabel: formatStateLabel(state),
      level: getProbabilityLevel(probability),
      plans,
      sourceLabel,
      sourceUrl,
      checkedAt,
      lastCompletedAt,
      updatedAt: current.updatedAt || codexItem.updatedAt || new Date().toISOString(),
    };
  }

  async function getCachedData(storage) {
    try {
      if (storage?.get) {
        const result = await storage.get(CACHE_STORAGE_KEY);
        const record = result?.[CACHE_STORAGE_KEY];
        if (record && typeof record === 'object' && record.data) {
          return record;
        }
      } else if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(CACHE_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.data) return parsed;
        }
      }
    } catch {
      // ignore storage errors
    }
    return null;
  }

  async function setCachedData(storage, data) {
    const payload = {
      data,
      timestamp: Date.now(),
    };
    try {
      if (storage?.set) {
        await storage.set({ [CACHE_STORAGE_KEY]: payload });
      } else if (typeof localStorage !== 'undefined') {
        localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(payload));
      }
    } catch {
      // ignore storage errors
    }
  }

  async function fetchCodexReset(options = {}) {
    const apiKey = options.apiKey || DEFAULT_API_KEY;
    let url = options.url || PRIMARY_API_URL;
    if (typeof url === 'string' && url.includes('/api/v1/feed')) {
      url = PRIMARY_API_URL;
    }
    const timeoutMs = options.timeoutMs || 8000;

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': apiKey,
          'Accept': 'application/json',
        },
        signal: controller ? controller.signal : undefined,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json = await response.json();
      const parsed = parseCodexResetResponse(json);
      if (!parsed) {
        throw new Error('无法解析 Codex 重置预测数据');
      }

      if (options.storage) {
        await setCachedData(options.storage, parsed);
      }

      return parsed;
    } catch (err) {
      // If primary failed and fallback is different, try fallback
      if (url === PRIMARY_API_URL && FALLBACK_API_URL) {
        try {
          const fbResponse = await fetch(FALLBACK_API_URL, {
            headers: { 'X-API-Key': apiKey },
          });
          if (fbResponse.ok) {
            const fbJson = await fbResponse.json();
            const parsed = parseCodexResetResponse(fbJson);
            if (parsed) {
              if (options.storage) await setCachedData(options.storage, parsed);
              return parsed;
            }
          }
        } catch {
          // fallback also failed
        }
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function renderPillHtml(data, state = 'loaded') {
    if (state === 'loading') {
      return `
        <button class="codex-reset-pill is-loading" type="button" aria-expanded="false" title="正在查询 Codex 重置概率...">
          <span class="codex-reset-spark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
          </span>
          <span class="codex-reset-label">Codex 重置</span>
          <span class="codex-reset-value">...</span>
        </button>
      `;
    }

    if (state === 'error' && !data) {
      return `
        <button class="codex-reset-pill is-error" type="button" aria-expanded="false" title="点击重试加载 Codex 重置概率">
          <span class="codex-reset-spark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>
          </span>
          <span class="codex-reset-label">Codex 重置</span>
          <span class="codex-reset-value">点击重试</span>
        </button>
      `;
    }

    const prob = data?.probability;
    const probDisplay = typeof prob === 'number' ? `${prob}%` : '待确认';
    const level = data?.level || 'unknown';
    const windowText = data?.windowText || '';

    return `
      <button class="codex-reset-pill level-${escapeHtml(level)}" type="button" aria-expanded="false" title="查看 Codex 重置预测详情">
        <span class="codex-reset-spark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
        </span>
        <span class="codex-reset-label">Codex 重置</span>
        <span class="codex-reset-value">${escapeHtml(probDisplay)}</span>
        ${windowText ? `
          <span class="codex-reset-time-divider" aria-hidden="true"></span>
          <span class="codex-reset-time-chip" title="预测重置时间：${escapeHtml(windowText)}">
            <span class="codex-time-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </span>
            <span class="codex-time-text">${escapeHtml(windowText)}</span>
          </span>
        ` : ''}
        <span class="codex-reset-chevron">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </span>
      </button>
    `;
  }

  function renderPopoverHtml(data, isRefreshing = false) {
    if (!data) return '';

    const prob = data.probability;
    const probDisplay = typeof prob === 'number' ? `${prob}%` : '待定';
    const level = data.level || 'unknown';
    const plansHtml = (data.plans || [])
      .map((p) => `<span class="codex-plan-chip">${escapeHtml(p)}</span>`)
      .join('');

    const sourceLinkHtml = data.sourceUrl
      ? `<a class="codex-source-link" href="${escapeHtml(data.sourceUrl)}" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(data.sourceLabel || '查看来源')}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="codex-ext-icon">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>
          </svg>
        </a>`
      : '';

    return `
      <div class="codex-reset-popover" role="dialog" aria-modal="false">
        <div class="codex-popover-header">
          <div class="codex-popover-brand">
            <span class="codex-brand-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
            </span>
            <div class="codex-brand-meta">
              <span class="codex-brand-name">Codex 额度重置预测</span>
              <span class="codex-status-tag status-${escapeHtml(data.state)}">${escapeHtml(data.stateLabel || '计划中')}</span>
            </div>
          </div>
          <div class="codex-popover-actions">
            <span class="codex-prob-badge level-${escapeHtml(level)}">${escapeHtml(probDisplay)} 概率</span>
            <button class="codex-refresh-btn ${isRefreshing ? 'is-spinning' : ''}" type="button" title="立即刷新最新预测" data-codex-action="refresh">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="codex-popover-body">
          <h4 class="codex-event-title">${escapeHtml(data.title)}</h4>

          ${data.windowText ? `
            <div class="codex-meta-row codex-time-highlight">
              <span class="codex-meta-icon">⏰</span>
              <div class="codex-meta-content">
                <div class="codex-meta-title-row">
                  <span class="codex-meta-label">预测重置时间：</span>
                  <span class="codex-time-status-chip ${escapeHtml(data.windowStatus || '')}">${escapeHtml(data.windowStatusLabel || data.stateLabel || '预测中')}</span>
                </div>
                <div class="codex-meta-val">${escapeHtml(data.windowText)}</div>
              </div>
            </div>
          ` : ''}

          ${data.lastCompletedAt ? `
            <div class="codex-meta-row codex-last-reset-row">
              <span class="codex-meta-icon">🔄</span>
              <span class="codex-meta-label">上一轮完成重置：</span>
              <span class="codex-meta-val">${escapeHtml(formatUtcToLocal(data.lastCompletedAt))}</span>
            </div>
          ` : ''}

          ${data.summary ? `
            <div class="codex-summary-box">
              <p>${escapeHtml(data.summary)}</p>
            </div>
          ` : ''}

          ${plansHtml ? `
            <div class="codex-plans-row">
              <span class="codex-plans-label">涵盖方案：</span>
              <div class="codex-plans-list">${plansHtml}</div>
            </div>
          ` : ''}
        </div>

        <div class="codex-popover-footer">
          <div class="codex-footer-left">
            ${sourceLinkHtml}
          </div>
          <div class="codex-footer-right">
            <span>aitrend.us 提供预测</span>
          </div>
        </div>
      </div>
    `;
  }

  class CodexResetWidget {
    constructor(container, options = {}) {
      this.container = container;
      this.options = options;
      this.storage = options.storage || null;
      this.data = null;
      this.state = 'loading'; // loading | loaded | error
      this.isOpen = false;
      this.isRefreshing = false;
      this.boundDocClick = this.handleDocumentClick.bind(this);
    }

    render() {
      if (!this.container) return;
      const pillHtml = renderPillHtml(this.data, this.state);
      const popoverHtml = this.isOpen ? renderPopoverHtml(this.data, this.isRefreshing) : '';

      this.container.innerHTML = `
        <div class="codex-widget-root ${this.isOpen ? 'is-open' : ''}">
          ${pillHtml}
          ${popoverHtml}
        </div>
      `;

      this.bindEvents();
    }

    bindEvents() {
      const root = this.container.querySelector('.codex-widget-root');
      if (!root) return;

      const pill = root.querySelector('.codex-reset-pill');
      if (pill) {
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.state === 'error' && !this.data) {
            this.refresh();
          } else {
            this.togglePopover();
          }
        });
      }

      const refreshBtn = root.querySelector('[data-codex-action="refresh"]');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.refresh();
        });
      }
    }

    togglePopover(forceState) {
      const next = typeof forceState === 'boolean' ? forceState : !this.isOpen;
      if (this.isOpen === next) return;
      this.isOpen = next;

      if (this.isOpen) {
        document.addEventListener('click', this.boundDocClick);
      } else {
        document.removeEventListener('click', this.boundDocClick);
      }

      this.render();
    }

    handleDocumentClick(e) {
      if (!this.container.contains(e.target)) {
        this.togglePopover(false);
      }
    }

    async refresh() {
      if (this.isRefreshing) return;
      this.isRefreshing = true;
      this.render();

      try {
        const fresh = await fetchCodexReset({
          apiKey: this.options.apiKey,
          storage: this.storage,
        });
        this.data = fresh;
        this.state = 'loaded';
      } catch (err) {
        console.warn('[TabOut CodexReset] 刷新失败:', err);
        if (!this.data) this.state = 'error';
      } finally {
        this.isRefreshing = false;
        this.render();
      }
    }

    async init() {
      // 1. Try to load from cache first for instantaneous display
      const cached = await getCachedData(this.storage);
      const now = Date.now();
      const isCacheValid = cached && (now - cached.timestamp < CACHE_TTL_MS);

      if (cached?.data) {
        this.data = cached.data;
        this.state = 'loaded';
        this.render();
      } else {
        this.state = 'loading';
        this.render();
      }

      // 2. If no valid cache, fetch fresh data in background
      if (!isCacheValid) {
        try {
          const fresh = await fetchCodexReset({
            apiKey: this.options.apiKey,
            storage: this.storage,
          });
          this.data = fresh;
          this.state = 'loaded';
          this.render();
        } catch (err) {
          console.warn('[TabOut CodexReset] 获取数据失败:', err);
          if (!this.data) {
            this.state = 'error';
            this.render();
          }
        }
      }
    }

    destroy() {
      document.removeEventListener('click', this.boundDocClick);
    }
  }

  function init(options = {}) {
    const container = options.container || document.getElementById('codexResetWidget');
    if (!container) return null;
    const widget = new CodexResetWidget(container, options);
    widget.init();
    return widget;
  }

  return {
    DEFAULT_API_KEY,
    PRIMARY_API_URL,
    FALLBACK_API_URL,
    CACHE_STORAGE_KEY,
    CACHE_TTL_MS,
    escapeHtml,
    formatStateLabel,
    formatWindowStatusLabel,
    formatUtcToLocal,
    getProbabilityLevel,
    parseCodexResetResponse,
    getCachedData,
    setCachedData,
    fetchCodexReset,
    renderPillHtml,
    renderPopoverHtml,
    CodexResetWidget,
    init,
  };
});
