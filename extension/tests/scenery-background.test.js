const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TabOutBackgroundManager = require('../background-manager.js');

test('Scenery 资源文件完整且符合 MV3 CSP 规范', () => {
  const sceneryDir = path.resolve(__dirname, '../scenery');
  assert.ok(fs.existsSync(sceneryDir), 'scenery 目录应存在');

  const htmlPath = path.join(sceneryDir, 'index.html');
  const cssPath = path.join(sceneryDir, 'style.css');
  const jsPath = path.join(sceneryDir, 'app.js');

  assert.ok(fs.existsSync(htmlPath), 'scenery/index.html 应存在');
  assert.ok(fs.existsSync(cssPath), 'scenery/style.css 应存在');
  assert.ok(fs.existsSync(jsPath), 'scenery/app.js 应存在');

  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.doesNotMatch(html, /<script(?:\s+[^>]*)?>[\s\S]+?<\/script>/i, 'scenery/index.html 不得含有内联脚本（须外链 app.js）');
  assert.match(html, /<script src="app\.js"><\/script>/, 'scenery/index.html 须引用 app.js');
  assert.match(html, /<link rel="stylesheet" href="style\.css">/, 'scenery/index.html 须引用 style.css');
});

test('Scenery app.js 包含多景致预设与通信接口', () => {
  const jsPath = path.resolve(__dirname, '../scenery/app.js');
  const jsContent = fs.readFileSync(jsPath, 'utf8');

  assert.match(jsContent, /_tabOutSceneMeta/, '应定义景致中文名与描述字典');
  assert.match(jsContent, /ridge-dawn/, '包含山脊晨曦');
  assert.match(jsContent, /coast-dusk/, '包含暮色海滨');
  assert.match(jsContent, /glacier/, '包含琉蓝冰舌');
  assert.match(jsContent, /cloudspire/, '包含天穹雪脊');
  assert.match(jsContent, /TABOUT_SCENERY_CHANGE/, '景致流转时应向父窗口发送通知');
  assert.match(jsContent, /TABOUT_SCENERY_NEXT/, '应监听来自父窗口的切换下一景消息');
});

test('TabOut 主页面与样式已接入 Scenery 动态漫游背景', () => {
  const indexPath = path.resolve(__dirname, '../index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');

  assert.match(indexHtml, /id="backgroundSceneryFrame"/, 'index.html 须包含 backgroundSceneryFrame');
  assert.match(indexHtml, /id="backgroundSceneryOverlay"/, 'index.html 须包含 backgroundSceneryOverlay');
  assert.match(indexHtml, /scenery\/index\.html\?screensaver=1/, 'iframe 须以屏保模式挂载');

  const cssPath = path.resolve(__dirname, '../style.css');
  const styleCss = fs.readFileSync(cssPath, 'utf8');

  assert.match(styleCss, /\.background-scenery-frame\s*\{[\s\S]*?pointer-events:\s*none;/, '背景 frame 须穿透点击事件');
  assert.match(styleCss, /\.background-scenery-overlay\s*\{[\s\S]*?pointer-events:\s*none;/, '遮罩层须穿透点击事件');
  assert.match(styleCss, /body\.has-scenery-background/, '包含动态风景模式下的暗阶与层次适配');
});

test('TabOutBackgroundManager 支持 Scenery 景致更新与控制', () => {
  assert.equal(typeof TabOutBackgroundManager.nextScenery, 'function');
  assert.equal(typeof TabOutBackgroundManager.prevScenery, 'function');
  assert.equal(typeof TabOutBackgroundManager.selectScenery, 'function');
  assert.equal(typeof TabOutBackgroundManager.updateSceneryCredit, 'function');

  const mockRoot = { hidden: true, title: '' };
  const mockLabel = { textContent: '' };
  const mockLink = { href: '', textContent: '', title: '', hidden: true };
  const mockDivider = { hidden: true };
  const mockSwitchBtn = { textContent: '', title: '' };

  // mock document elements
  global.document = {
    getElementById: (id) => {
      if (id === 'backgroundCredit') return mockRoot;
      if (id === 'backgroundCreditLabel') return mockLabel;
      if (id === 'backgroundCreditLink') return mockLink;
      if (id === 'backgroundCreditDivider') return mockDivider;
      if (id === 'backgroundSwitchBtn') return mockSwitchBtn;
      return null;
    },
    querySelectorAll: () => [],
    body: { classList: { add: () => {}, contains: () => true } }
  };

  TabOutBackgroundManager.updateSceneryCredit({
    name: '山脊晨曦',
    description: '东望花岗岩脊，等第一束晨光跃过群山',
    index: 0,
    total: 15
  });

  assert.equal(mockRoot.hidden, false);
  assert.match(mockLabel.textContent, /山脊晨曦/);
  assert.match(mockRoot.title, /山脊晨曦/);
  assert.match(mockRoot.title, /1\/15/);
  assert.equal(mockSwitchBtn.textContent, '换景');
  assert.equal(mockLink.textContent, '沉浸漫游');
});

test('TabOutBackgroundManager 支持日间/夜暮/自动光照模式切换与持久化', () => {
  assert.equal(typeof TabOutBackgroundManager.getLightingMode, 'function');
  assert.equal(typeof TabOutBackgroundManager.setLightingMode, 'function');
  assert.equal(typeof TabOutBackgroundManager.cycleLightingMode, 'function');

  const mockLightingBtn = { textContent: '', title: '', hidden: false };
  const mockDataset = {};
  global.document = {
    getElementById: (id) => {
      if (id === 'backgroundLightingBtn') return mockLightingBtn;
      return null;
    },
    body: {
      dataset: mockDataset,
      classList: { contains: () => true, add: () => {} }
    }
  };

  TabOutBackgroundManager.setLightingMode('day');
  assert.equal(TabOutBackgroundManager.getLightingMode(), 'day');
  assert.equal(mockDataset.sceneryLighting, 'day');
  assert.match(mockLightingBtn.textContent, /日间/);

  TabOutBackgroundManager.setLightingMode('night');
  assert.equal(TabOutBackgroundManager.getLightingMode(), 'night');
  assert.equal(mockDataset.sceneryLighting, 'night');
  assert.match(mockLightingBtn.textContent, /夜暮/);

  TabOutBackgroundManager.setLightingMode('auto');
  assert.equal(TabOutBackgroundManager.getLightingMode(), 'auto');
  assert.match(mockLightingBtn.textContent, /自动/);
});

test('Scenery 背景换景周期为 30 分钟，且支持刷新/新开页面换景持久化流转', () => {
  const jsPath = path.resolve(__dirname, '../scenery/app.js');
  const jsContent = fs.readFileSync(jsPath, 'utf8');

  assert.match(jsContent, /SCENERY_DURATION_SEC\s*=\s*1800/, '单场景漫游时长应为 1800 秒（30 分钟）');
  assert.match(jsContent, /tabout_scenery_index/, '应使用 tabout_scenery_index 记录景致序号');

  const bgMgrPath = path.resolve(__dirname, '../background-manager.js');
  const bgContent = fs.readFileSync(bgMgrPath, 'utf8');
  assert.match(bgContent, /BACKGROUND_THEME_ROTATION_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/, '后台壁纸轮换周期应同步调整为 30 分钟');
});
