(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TabOutBackgroundManager = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

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
  const BACKGROUND_THEME_ROTATION_MS = 90 * 1000;
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
      { key: 'misty-lake', label: '雾隐平湖', query: 'misty lake mountains', categories: '100' },
      { key: 'cherry-path', label: '樱吹雪径', query: 'cherry blossom path', categories: '100' },
      { key: 'autumn-maple', label: '秋枫古道', query: 'autumn maple forest', categories: '100' },
      { key: 'star-desert', label: '星沙荒漠', query: 'desert night stars', categories: '100' },
      { key: 'waterfall-green', label: '翠谷飞瀑', query: 'waterfall jungle', categories: '100' },
      { key: 'lavender-field', label: '薰衣草田', query: 'lavender field sunset', categories: '100' },
      { key: 'nebula-cosmos', label: '星云深空', query: 'nebula deep space galaxy', categories: '100' },
      { key: 'cyber-tokyo', label: '赛博霓虹', query: 'cyberpunk neon city tokyo', categories: '100' },
      { key: 'mount-fuji', label: '富士春雪', query: 'mount fuji cherry blossom', categories: '100' },
      { key: 'ocean-coral', label: '珊瑚浅海', query: 'ocean coral reef drone', categories: '100' },
      { key: 'nordic-cabin', label: '北欧孤屋', query: 'nordic cabin snow forest', categories: '100' },
      { key: 'ancient-temple', label: '古刹幽深', query: 'ancient temple mist forest', categories: '100' },
      { key: 'iceland-beach', label: '冰岛黑沙', query: 'iceland black sand beach', categories: '100' },
      { key: 'golden-savannah', label: '金色草原', query: 'serengeti savannah sunset', categories: '100' },
      { key: 'bamboo-forest', label: '翠竹幽径', query: 'kyoto bamboo forest green', categories: '100' },
      { key: 'desert-oasis', label: '大漠绿洲', query: 'desert sand dunes oasis', categories: '100' },
      { key: 'swiss-alps', label: '瑞士庄园', query: 'swiss alps green valley', categories: '100' },
      { key: 'venice-canal', label: '水城威尼斯', query: 'venice canal sunset gondola', categories: '100' },
    ],
    sport: [
      { key: 'stadium-lights', label: '球场灯火', query: 'stadium lights', categories: '101' },
      { key: 'track-speed', label: '赛道速度', query: 'running track', categories: '101' },
      { key: 'cycling-surge', label: '骑行冲刺', query: 'cycling race', categories: '101' },
      { key: 'surf-energy', label: '冲浪瞬间', query: 'surf action', categories: '101' },
      { key: 'court-tension', label: '篮场张力', query: 'basketball court', categories: '101' },
      { key: 'marathon-flow', label: '晨跑动势', query: 'marathon city', categories: '101' },
      { key: 'snowboard-air', label: '雪板腾空', query: 'snowboard jump', categories: '101' },
      { key: 'cliff-climb', label: '峭壁攀登', query: 'rock climbing cliff', categories: '100' },
      { key: 'yoga-dawn', label: '晨光瑜伽', query: 'yoga sunrise beach', categories: '100' },
      { key: 'tennis-focus', label: '网前专注', query: 'tennis match', categories: '101' },
      { key: 'swim-ocean', label: '碧波逐浪', query: 'open water swimming', categories: '100' },
      { key: 'parkour-city', label: '城市飞跃', query: 'parkour city rooftop', categories: '100' },
      { key: 'skate-bowl', label: '滑板飞跃', query: 'skateboarding concrete bowl action', categories: '101' },
      { key: 'f1-speed', label: '极速赛车', query: 'f1 racing car track drift', categories: '101' },
      { key: 'paragliding-sky', label: '滑翔蓝天', query: 'paragliding mountain sky high', categories: '100' },
      { key: 'motocross-dirt', label: '越野狂飙', query: 'motocross jump mud action', categories: '101' },
      { key: 'kayak-rapid', label: '激流皮艇', query: 'whitewater kayaking rapid', categories: '100' },
      { key: 'golf-green', label: '绿野挥杆', query: 'golf swing green grass', categories: '101' },
      { key: 'boxing-ring', label: '拳台瞬间', query: 'boxing fight ring match shadow', categories: '101' },
      { key: 'hiking-peak', label: '登顶俯瞰', query: 'hiking backpack summit mountain', categories: '100' },
      { key: 'ballet-jump', label: '芭蕾跃动', query: 'ballet dancer jumping stage light', categories: '100' },
      { key: 'soccer-kick', label: '球门抽射', query: 'soccer match action kick stadium', categories: '101' },
      { key: 'freedive-blue', label: '深蓝自由潜', query: 'freediving deep ocean light ray', categories: '100' },
      { key: 'dance-street', label: '街舞张力', query: 'street dance breakdance action urban', categories: '100' },
    ],
  };

  let _themeRotationId = 0;
  let _currentDirection = '';
  let _photoLayerIndex = -1;
  let _requestSequence = 0;
  let _recentPhotoIds = [];
  let _lastQueryByDirection = {
    epic: '',
    sport: '',
  };

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
    _recentPhotoIds = [photoId, ..._recentPhotoIds.filter((id) => id !== photoId)]
      .slice(0, BACKGROUND_RECENT_PHOTO_LIMIT);
  }

  function pickBackgroundQuery(direction) {
    const queries = BACKGROUND_REMOTE_QUERIES[direction] || [];
    if (!queries.length) return null;
    const lastKey = _lastQueryByDirection[direction] || '';
    const choice = pickRandomFromPool(queries, (item) => lastKey && item?.key === lastKey) || queries[0];
    _lastQueryByDirection = {
      ..._lastQueryByDirection,
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
    if (!allowRecent && _recentPhotoIds.includes(item.id)) return null;

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

    const nextIndex = _photoLayerIndex < 0
      ? 0
      : (_photoLayerIndex + 1) % layers.length;
    const nextLayer = layers[nextIndex];

    nextLayer.style.backgroundImage = buildBackgroundPhotoCss(photo);
    nextLayer.dataset.direction = photo.direction || '';
    nextLayer.classList.add('is-active');

    layers.forEach((layer, index) => {
      if (index === nextIndex) return;
      layer.classList.remove('is-active');
    });

    _photoLayerIndex = nextIndex;
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
    _photoLayerIndex = -1;
    document.body.classList.remove('has-background-photo');
    delete document.body.dataset.bgTheme;
    delete document.body.dataset.bgDirection;
    updateBackgroundCredit(null);
  }

  function applyBackgroundTheme(theme, direction = '') {
    if (!theme) return;
    document.body.dataset.bgTheme = theme;
    if (direction) document.body.dataset.bgDirection = direction;
  }

  async function rotateBackgroundScene() {
    const nextTheme = getNextBackgroundTheme(document.body.dataset.bgTheme || '', _currentDirection);
    _currentDirection = nextTheme.direction;

    const requestSequence = ++_requestSequence;

    try {
      const photo = await fetchRemoteBackground(nextTheme.direction);
      await preloadBackgroundImage(photo.imageUrl);
      if (requestSequence !== _requestSequence) return;
      applyBackgroundTheme(nextTheme.theme, nextTheme.direction);
      applyBackgroundPhoto(photo);
    } catch (err) {
      if (requestSequence !== _requestSequence) return;
      try {
        const fallbackPhoto = buildDirectFallbackPhoto(nextTheme.direction);
        if (!fallbackPhoto) throw err;
        await preloadBackgroundImage(fallbackPhoto.imageUrl);
        if (requestSequence !== _requestSequence) return;
        applyBackgroundTheme(nextTheme.theme, nextTheme.direction);
        applyBackgroundPhoto(fallbackPhoto);
      } catch (fallbackErr) {
        if (!document.body.classList.contains('has-background-photo')) {
          clearBackgroundPhoto();
        }
      }
    }
  }

  function initDynamicBackground() {
    void rotateBackgroundScene();
    if (_themeRotationId) window.clearInterval(_themeRotationId);
    _themeRotationId = window.setInterval(() => {
      void rotateBackgroundScene();
    }, BACKGROUND_THEME_ROTATION_MS);

    const switchBtn = document.getElementById('backgroundSwitchBtn');
    if (switchBtn) {
      switchBtn.addEventListener('click', () => {
        void rotateBackgroundScene();
      });
    }
  }

  return {
    initDynamicBackground,
    rotateBackgroundScene,
    clearBackgroundPhoto,
    applyBackgroundTheme,
    applyBackgroundPhoto,
    getNextBackgroundDirection,
    getNextBackgroundTheme,
  };
});
