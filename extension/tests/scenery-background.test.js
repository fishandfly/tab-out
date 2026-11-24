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

test('Scenery 背景预设全部为远景机位（高视点远眺与广角视野）', () => {
  const jsPath = path.resolve(__dirname, '../scenery/app.js');
  const jsContent = fs.readFileSync(jsPath, 'utf8');

  assert.match(jsContent, /eyeHeight/, '机位高度应支持抬升至树冠之上的远景视点');
  const gMatch = jsContent.match(/var g_\s*=\s*(\[[\s\S]*?\]),\s*x_\s*=/);
  assert.ok(gMatch, '应存在 g_ 巡游预设列表');
  const gStr = gMatch[1];
  assert.doesNotMatch(gStr, /"grove-light"/, '巡游预设应剔除林间近景');
  assert.doesNotMatch(gStr, /"forest"/, '巡游预设应剔除树干遮挡近景');
  assert.doesNotMatch(gStr, /"sea-window"/, '巡游预设应剔除水下局促视窗');
  assert.match(gStr, /"cloudspire"/, '巡游预设包含雪峰云海俯瞰远景');
  assert.match(gStr, /"overlook"/, '巡游预设包含千嶂凭虚远景');
});

test('Scenery 背景与主页面支持首屏非阻塞异步加载、DPR 降采样、阴影关闭与 30FPS/后台节能休眠', () => {
  const indexPath = path.resolve(__dirname, '../index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');

  assert.match(indexHtml, /loading="lazy"/, 'iframe 应配置 loading="lazy" 避免阻断主界面首屏渲染');
  assert.match(indexHtml, /data-src="scenery\/index\.html\?screensaver=1"/, 'iframe 应使用 data-src 异步挂载屏保模式');

  const jsPath = path.resolve(__dirname, '../scenery/app.js');
  const jsContent = fs.readFileSync(jsPath, 'utf8');

  // 1. 像素比降采样测试
  assert.match(jsContent, /_isSaver\s*\?\s*Math\.min\(1\.0,\s*devicePixelRatio/, '屏保背景应限制 DPR <= 1.0 降低 GPU 像素填充率');

  // 2. 阴影关闭与低能耗模式
  assert.match(jsContent, /powerPreference:\s*_isSaverMode\s*\?\s*"low-power"/, '屏保背景应选用低功耗 GPU 首选项');
  assert.match(jsContent, /shadowMap\.enabled\s*=\s*!_isSaverMode/, '屏保背景应关闭高开销的实时级联阴影贴图深度渲染通道');

  // 3. 帧率节流至 30 FPS 及失焦降频
  assert.match(jsContent, /_targetInterval\s*>\s*0\s*&&\s*_tabOutLastRenderTime/, '应基于时间戳对 3D 渲染帧率进行节流');
  assert.match(jsContent, /TABOUT_PAUSE_RENDER/, '应支持隐藏或休眠时完全暂停 3D 渲染循环');
  assert.match(jsContent, /TABOUT_THROTTLE_FPS/, '应支持窗口失焦时降频节流');

  // 4. 背景管理器调度测试
  const bgMgrPath = path.resolve(__dirname, '../background-manager.js');
  const bgContent = fs.readFileSync(bgMgrPath, 'utf8');
  assert.match(bgContent, /loadSceneryFrame/, '背景管理器应包含非阻塞异步挂载调度');
  assert.match(bgContent, /visibilitychange/, '背景管理器应监听标签页显隐并通知暂停渲染');
  assert.match(bgContent, /blur/, '背景管理器应监听窗口失焦并通知降低渲染负载');
});

test('Scenery 自动漫游支持平稳前向推进（从远到近走进，平直视平线，无步态摇晃与颠簸）', () => {
  const jsPath = path.resolve(__dirname, '../scenery/app.js');
  const jsContent = fs.readFileSync(jsPath, 'utf8');

  // 1. 人体第一人称视高设置
  assert.match(jsContent, /eyeHeight:\s*customEye\s*\|\|\s*d\.view\?\.eyeHeight\s*\|\|\s*1\.78/, '默认视高应为人眼高度 ~1.78m');

  // 2. 稳步前向推进（从远到近走进，无起伏摆动）
  assert.match(jsContent, /walkSpeed\s*=\s*0\.4/, '漫游时应具有适宜由远及近推进的平稳步速');
  assert.match(jsContent, /fwdX\s*=\s*-Math\.sin\(f\.yaw\)/, '应沿航向向量持续向前稳步走进');
  assert.match(jsContent, /m\s*=\s*f\.x\s*\+\s*fwdX\s*\*\s*walkDist/, '应沿前向视线直线推进');

  // 3. 画面无步态颠簸摇摆，保持平稳推镜头
  assert.doesNotMatch(jsContent, /bobY\s*=/, '不得模拟起伏颠簸步态');
  assert.doesNotMatch(jsContent, /swayX\s*=/, '不得模拟左右摇摆');
  assert.match(jsContent, /_smoothGroundH/, '地势高度应平滑过渡以呈现平稳推镜头质感');

  // 4. 生态状态反馈
  assert.match(jsContent, /walkSpeed:\s*walkSpeed/, '漫游时应将推进步速传递至环境生态');

  // 5. 长时间平稳防抖（有界平滑推进、垂直高度速率限幅与 30FPS 帧率节流容差）
  assert.match(jsContent, /maxTravel/, '推镜头行程应合理有界避免长时游走落入碎石悬崖导致抖动');
  assert.match(jsContent, /clampedStep/, '垂直地势跟踪应具备最大步进限幅以消除地势突变抖动');
  assert.match(jsContent, /_targetInterval\s*-\s*4/, '帧率节流应具备容差阈值消除 60Hz 屏幕帧间隔抖动');
});
