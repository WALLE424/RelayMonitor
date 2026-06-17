'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');

function loadRendererModules() {
  const context = {
    Array,
    Date,
    Intl,
    Math,
    Number,
    Object,
    String,
    window: {},
  };
  context.window.window = context.window;
  vm.createContext(context);

  [
    'src/renderer/components/ui.js',
    'src/renderer/charts/trend.js',
    'src/renderer/views/settings.js',
    'src/renderer/views/overview.js',
    'src/renderer/views/request-detail.js',
  ].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });

  return context.window;
}

function fixture() {
  const trend = [
    { label: '周三', value: 128000, input: 54000, output: 42000, cached: 26000 },
    { label: '周四', value: 146000, input: 65000, output: 47000, cached: 34000 },
    { label: '周五', value: 119000, input: 52000, output: 38000, cached: 29000 },
    { label: '周六', value: 173000, input: 71000, output: 52000, cached: 50000 },
    { label: '周日', value: 152000, input: 68000, output: 46000, cached: 38000 },
    { label: '周一', value: 194000, input: 76000, output: 61000, cached: 57000 },
    { label: '今天', value: 168000, input: 72000, output: 52000, cached: 44000 },
  ];
  const request = {
    id: 'req-smoke',
    cacheHitRate: 71,
    contextUsage: 58,
    cost: 0.38,
    latency: 1680,
    model: 'gpt-4.1-mini',
    reasoningEffort: 'medium',
    reasoningTokens: 1094,
    relay: '上海 02',
    status: '成功',
    time: new Date('2026-06-09T07:22:00.000Z').toISOString(),
    tokens: {
      cached: 12950,
      input: 3068,
      output: 2222,
      total: 18240,
    },
  };

  return {
    request,
    settings: {
      appearanceTheme: 'light',
      balanceAcquisitionMode: 'auto-api',
      balanceManualAmount: '',
      balancePageUrl: '',
      balanceSelector: '',
      cacheHitAlert: true,
      cacheHitTarget: 60,
      closeButtonBehavior: 'hide-to-tray',
      contextWarning: true,
      contextWarningThreshold: 78,
      customRelayName: '',
      companionVisible: true,
      glassBlur: 16,
      glassOpacity: 0.84,
      panelOpacity: 0.84,
      windowOpacity: 1,
      systemGlass: true,
    },
    snapshot: {
      balance: { available: true, amount: 128.46 },
      cache: { hitRate: 0.68 },
      context: { usedPercent: 57, usedTokens: 73000, windowTokens: 128000 },
      currentRelay: { name: '上海 02 · OpenAI/Claude 中转', endpoint: 'https://relay.example.cn/v1' },
      endpoint: 'https://relay.example.cn/v1',
      modelTrends: { 'gpt-4.1-mini': trend },
      provider: {
        baseUrl: 'https://relay.example.cn/v1',
        keyPreview: 'sk-live-demo-9A2F',
        maskedKey: 'sk-************9A2F',
        model: 'gpt-4.1-mini',
        name: '上海 02 · OpenAI/Claude 中转',
        reasoningEffort: 'medium',
      },
      recentRequests: [request],
      requests: { failed: 0, success: 100 },
      spend: { today: 3.82, week: 18.74, month: 74.19 },
      tokens: { cached: 44000, input: 72000, output: 52000, total: 168000 },
      trend7d: trend,
      usage: { avgLatencyMs: 1680, monthTokens: 4920000, todayTokens: 168000, weekTokens: 1280000 },
    },
  };
}

function countMatches(html, pattern) {
  return (html.match(pattern) || []).length;
}

function assertIncludesAll(html, texts) {
  texts.forEach((text) => assert.match(html, new RegExp(text)));
}

function assertModulePanel(html, moduleId) {
  assert.match(html, new RegExp(`data-module-panel="${moduleId}"`));
  assert.match(html, new RegExp(`data-drag-panel="${moduleId}"`));
  assert.match(html, new RegExp(`data-module-close="${moduleId}"`));
}

test('renderer uses dashboard topbar window controls without mac dots', () => {
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  const closeButton = html.match(/<button[^>]*id="close-button"[^>]*>/)?.[0] || '';

  assert.doesNotMatch(html, /mac-window-controls|mac-window-dot|traffic-light|traffic-lights|is-minimize/);
  assert.match(html, /<div class="topbar-actions">[\s\S]*id="minimize-button"[\s\S]*id="hide-button"[\s\S]*id="close-button"[\s\S]*<\/div>/);
  assert.match(html, /正在读取中转站状态/);
  assert.match(html, /title="最小化"/);
  assert.match(html, /title="隐藏到后台"/);
  assert.match(html, /title="关闭"/);
  assert.doesNotMatch(html, /姝|鏈|闅|鍏|绔|鎬|棌/);
  assert.match(closeButton, /\bclose-window-button\b/);
  assert.match(appJs, /window\.relayMonitor\s*\|\|\s*state\.api/);
  assert.match(appJs, /elements\.minimizeButton\.addEventListener\("click", minimizeWindow\)/);
  assert.match(appJs, /elements\.hideButton\.addEventListener\("click", hideWindow\)/);
  assert.match(appJs, /elements\.closeButton\.addEventListener\("click", closeWindow\)/);
});

test('snapshot pushes are coalesced before expensive dashboard renders', () => {
  const appJs = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  const moduleWindowJs = fs.readFileSync(path.join(root, 'src/renderer/module-window.js'), 'utf8');
  const overviewJs = fs.readFileSync(path.join(root, 'src/renderer/views/overview.js'), 'utf8');
  const appPushSource = appJs.slice(
    appJs.indexOf('function bindSnapshotPush'),
    appJs.indexOf('function boot'),
  );
  const modulePushSource = moduleWindowJs.slice(
    moduleWindowJs.indexOf('if (api && typeof api.onSnapshotPush'),
    moduleWindowJs.indexOf('if (api && typeof api.onSettingsPush'),
  );

  assert.match(appJs, /function scheduleSnapshotRender\(\)/);
  assert.match(appJs, /function snapshotSignature\(snapshot\)/);
  assert.match(appJs, /function useSuggestedBalancePageUrl/);
  assert.match(appJs, /setStatus\("已切换为当前中转站余额页面，正在打开登录窗口"\)/);
  assert.match(appJs, /openBalanceLogin\(\)/);
  assert.match(appJs, /requestAnimationFrame\(renderSnapshotViews\)/);
  assert.doesNotMatch(
    appJs.slice(appJs.indexOf('function snapshotSignature'), appJs.indexOf('function normalizeTheme')),
    /generatedAt|updatedAt/,
  );
  assert.match(appPushSource, /var nextSignature = snapshotSignature\(nextSnapshot\);/);
  assert.match(appPushSource, /if \(nextSignature === state\.snapshotSignature\)/);
  assert.match(appPushSource, /scheduleSnapshotRender\(\)/);
  assert.doesNotMatch(appPushSource, /renderSnapshotViews\(\)/);
  assert.match(appJs, /function bindModuleStatePush\(\)/);
  assert.match(appJs, /onModuleStatePush/);
  assert.match(appJs, /state\.activeModules = isPlainObject\(modules\) \? modules : \{\}/);
  assert.match(moduleWindowJs, /function scheduleRender\(\)/);
  assert.match(moduleWindowJs, /function snapshotSignature\(snapshot\)/);
  assert.match(moduleWindowJs, /function settingsSignature\(settings\)/);
  assert.match(moduleWindowJs, /requestAnimationFrame\(render\)/);
  assert.match(modulePushSource, /var nextSignature = snapshotSignature\(nextSnapshot\);/);
  assert.match(modulePushSource, /if \(nextSignature === state\.snapshotSignature\) return;/);
  assert.match(modulePushSource, /scheduleRender\(\)/);
  assert.doesNotMatch(modulePushSource, /render\(\)/);
  assert.match(overviewJs, /renderModule:\s*renderSingleModule/);
});

test('appearance settings apply without rebuilding dashboard markup on every slider tick', () => {
  const appJs = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  const moduleWindowJs = fs.readFileSync(path.join(root, 'src/renderer/module-window.js'), 'utf8');
  const appUpdateStart = appJs.indexOf('function updateSettingsPatch');
  const appUpdateSource = appJs.slice(
    appUpdateStart,
    appJs.indexOf('function updateSetting', appUpdateStart + 1),
  );
  const moduleUpdateSource = moduleWindowJs.slice(
    moduleWindowJs.indexOf('function updateSetting'),
    moduleWindowJs.indexOf('function refreshBalanceLoginStatus'),
  );

  assert.match(appJs, /function isAppearanceOnlyPatch/);
  assert.match(appUpdateSource, /if \(!isAppearanceOnlyPatch\(patch\)\) \{\s*renderSnapshotViews\(\);/);
  assert.match(moduleWindowJs, /function syncRangeValues/);
  assert.match(moduleWindowJs, /function isAppearanceOnlyPatch/);
  assert.doesNotMatch(moduleUpdateSource, /render\(\)/);
  assert.match(moduleUpdateSource, /syncRangeValues\(\)/);
});

test('renderer covers V2 dashboard copy, dock modules, settings, and secret states', () => {
  const window = loadRendererModules();
  const { request, settings, snapshot } = fixture();

  const overviewHidden = window.RelayMonitorOverview.render(snapshot, settings, { secretsVisible: false });
  const overviewModules = window.RelayMonitorOverview.render(snapshot, settings, {
    activeModules: {
      api: true,
      requests: true,
      tokens: true,
      balance: true,
      cache: true,
      settings: true,
    },
    secretsVisible: true,
  });
  const detailVisible = window.RelayMonitorRequestDetail.render(request, snapshot, settings, { secretsVisible: true });
  const settingsHtml = window.RelayMonitorSettings.render(settings);
  const combined = overviewHidden + overviewModules + detailVisible + settingsHtml;

  assertIncludesAll(combined, [
    'single-dashboard-overview',
    'dashboard-board',
    'primary-dashboard',
    'dashboard-dock',
    'API 切换',
    '请求',
    'Token',
    '余额',
    '缓存',
    '设置',
    '账户余额',
    '总消费额度',
    '平均耗时',
    '显示或隐藏密钥',
    '当前模型',
    '推理',
    'Token 曲线',
    '缓存命中率',
    '上下文已用',
    '关闭按钮行为',
    'data-setting="closeButtonBehavior"',
    'Codex 伴随悬浮条',
    'data-setting="companionVisible"',
    '余额获取方式',
    'data-setting="balanceAcquisitionMode"',
    'data-reset-appearance="true"',
    'data-refresh-balance="true"',
    'module-window-control',
  ]);

  assert.doesNotMatch(overviewHidden, /module-dashboard-grid|data-module-panel="api"|data-request-id="req-smoke"/);
  assert.doesNotMatch(overviewHidden, /余额获取方式|balanceAcquisitionMode|balanceManualAmount|balancePageUrl|balanceSelector/);
  ['api', 'requests', 'tokens', 'balance', 'cache', 'settings'].forEach((moduleId) => {
    assert.match(overviewModules, new RegExp(`data-module-panel="${moduleId}"`));
  });
  assert.match(overviewModules, /request-popover-card/);
  ['api', 'requests', 'tokens', 'balance', 'cache', 'settings'].forEach((moduleId) => {
    assert.match(overviewModules, new RegExp(`dock-icon-${moduleId}`));
  });
  assert.doesNotMatch(overviewModules, /<span class="dock-icon"[^>]*>(API|REQ|TOK|SET|%|￥)<\/span>/);
  assert.match(overviewModules, /推理 medium/);
  assert.match(overviewHidden, /sk-\*{12}9A2F/);
  assert.doesNotMatch(overviewHidden, /sk-live-demo-9A2F/);
  assert.match(overviewModules, /sk-live-demo-9A2F/);
  assert.match(detailVisible, /sk-live-demo-9A2F/);
  assert.doesNotMatch(overviewHidden, /¥0\.00/);
});

test('settings renders balance acquisition controls only inside settings drawer', () => {
  const window = loadRendererModules();
  const { settings, snapshot } = fixture();
  const webSettingsHtml = window.RelayMonitorSettings.render({
    ...settings,
    balanceAcquisitionMode: 'web-session',
    balancePageUrl: 'https://relay.example.cn/dashboard',
    balanceSelector: '.balance-value',
  }, {
    balanceLoginStatus: {
      status: 'logged-in',
      hasCookies: true,
      origin: 'https://relay.example.cn',
      updatedAt: '2026-06-14T08:00:00.000Z',
      message: 'saved',
      cookie: 'SESSION=raw-cookie-should-not-render',
      cookies: 'another-raw-cookie',
    },
    balanceDiagnostic: {
      balanceStatus: 'provider-mismatch',
      suggestedBalancePageUrl: 'https://relay.example.cn/console',
      suggestedBalancePageHost: 'relay.example.cn/console',
      effectiveLoginUrl: 'https://relay.example.cn/console',
      effectiveLoginHost: 'relay.example.cn/console',
      failureKind: 'provider-mismatch',
      nextStep: '点击“使用当前中转站地址并登录”',
      advice: '余额页地址和当前中转站不匹配',
      cookie: 'SESSION=raw-cookie-should-not-render',
      token: 'raw-token-should-not-render',
    },
  });
  const manualSettingsHtml = window.RelayMonitorSettings.render({
    ...settings,
    balanceAcquisitionMode: 'manual',
    balanceManualAmount: '100.00',
  });
  const tokenOnlySettingsHtml = window.RelayMonitorSettings.render({
    ...settings,
    balanceAcquisitionMode: 'web-session',
    balancePageUrl: 'https://relay.example.cn/dashboard',
  }, {
    balanceLoginStatus: {
      status: 'ready',
      hasCookies: false,
      hasAuthToken: true,
      hasLoginState: true,
      origin: 'https://relay.example.cn',
      message: 'saved by token',
      token: 'raw-token-should-not-render',
    },
  });
  const overviewHtml = window.RelayMonitorOverview.render(snapshot, settings, { secretsVisible: false });

  assert.match(webSettingsHtml, /余额获取方式/);
  assert.match(webSettingsHtml, /data-setting="balancePageUrl"/);
  assert.match(webSettingsHtml, /data-setting="balanceSelector"/);
  assert.match(webSettingsHtml, /data-open-balance-login/);
  assert.match(webSettingsHtml, /data-open-balance-external/);
  assert.match(webSettingsHtml, /用浏览器打开/);
  assert.match(webSettingsHtml, /data-diagnose-balance/);
  assert.match(webSettingsHtml, /balance-diagnostic-grid/);
  assert.match(webSettingsHtml, /网页 Token/);
  assert.match(webSettingsHtml, /用户标识/);
  assert.match(webSettingsHtml, /诊断余额/);
  assert.match(webSettingsHtml, /问题类型/);
  assert.match(webSettingsHtml, /provider-mismatch/);
  assert.match(webSettingsHtml, /下一步/);
  assert.match(webSettingsHtml, /建议页面/);
  assert.match(webSettingsHtml, /实际登录页/);
  assert.match(webSettingsHtml, /relay\.example\.cn\/console/);
  assert.match(webSettingsHtml, /data-use-suggested-balance-page="https:\/\/relay\.example\.cn\/console"/);
  assert.match(webSettingsHtml, /使用当前中转站地址并登录/);
  assert.match(tokenOnlySettingsHtml, /\u5df2\u4fdd\u5b58\u767b\u5f55\u6001/);
  assert.doesNotMatch(tokenOnlySettingsHtml, /raw-token-should-not-render/);
  assert.match(webSettingsHtml, /已保存登录态/);
  assert.doesNotMatch(webSettingsHtml, /浣|欓|璇|鎵|鐧|棰|鐘|榛|脳/);
  assert.doesNotMatch(webSettingsHtml, /SESSION=raw-cookie-should-not-render|another-raw-cookie|raw-token-should-not-render|"cookie"|"token"|apiKey/i);
  assert.match(manualSettingsHtml, /data-setting="balanceManualAmount"/);
  assert.doesNotMatch(manualSettingsHtml, /data-open-balance-login/);
  assert.doesNotMatch(overviewHtml, /余额获取方式|balancePageUrl|balanceSelector|balanceManualAmount|data-diagnose-balance|已保存登录态|需要重新登录/);
});

test('module settings window wires balance diagnostic controls', () => {
  const moduleWindowSource = fs.readFileSync(path.join(root, 'src/renderer/module-window.js'), 'utf8');

  assert.match(moduleWindowSource, /balanceDiagnostic:\s*null/);
  assert.match(moduleWindowSource, /balanceDiagnosticBusy:\s*false/);
  assert.match(moduleWindowSource, /balanceDiagnostic:\s*state\.balanceDiagnostic/);
  assert.match(moduleWindowSource, /balanceDiagnosticBusy:\s*state\.balanceDiagnosticBusy/);
  assert.match(moduleWindowSource, /function diagnoseBalance\(\)/);
  assert.match(moduleWindowSource, /api\.diagnoseBalance\(\)/);
  assert.match(moduleWindowSource, /function useSuggestedBalancePageUrl/);
  assert.match(moduleWindowSource, /function openExternalBalancePage/);
  assert.match(moduleWindowSource, /api\.openExternalBalancePage\(\)/);
  assert.match(moduleWindowSource, /data-use-suggested-balance-page/);
  assert.match(moduleWindowSource, /openBalanceLogin\(\)/);
  assert.match(moduleWindowSource, /data-open-balance-external/);
  assert.match(moduleWindowSource, /data-diagnose-balance/);
});

test('active api, requests, and tokens dock modules render floating drag panels', () => {
  const window = loadRendererModules();
  const { settings, snapshot } = fixture();
  const overviewHtml = window.RelayMonitorOverview.render(snapshot, settings, {
    activeModules: { api: true, requests: true, tokens: true },
    secretsVisible: false,
  });

  assert.match(overviewHtml, /module-floating-layer/);
  ['api', 'requests', 'tokens'].forEach((moduleId) => assertModulePanel(overviewHtml, moduleId));
  assert.equal(countMatches(overviewHtml, /data-drag-handle=/g), 3);
  assert.doesNotMatch(overviewHtml, /data-module-panel="balance"|data-module-panel="cache"|data-module-panel="settings"/);
  assert.doesNotMatch(overviewHtml, /data-drag-panel="balance"|data-drag-panel="cache"|data-drag-panel="settings"/);
});

test('default dock state does not render unopened module panels', () => {
  const window = loadRendererModules();
  const { settings, snapshot } = fixture();
  const overviewHtml = window.RelayMonitorOverview.render(snapshot, settings, { secretsVisible: false });

  assert.match(overviewHtml, /dashboard-dock/);
  assert.doesNotMatch(overviewHtml, /module-floating-layer/);
  assert.doesNotMatch(overviewHtml, /data-module-panel=/);
  assert.doesNotMatch(overviewHtml, /data-drag-panel=|data-drag-handle=/);
});

test('external module windows do not alter the main dashboard shape', () => {
  const window = loadRendererModules();
  const { settings, snapshot } = fixture();
  const overviewHtml = window.RelayMonitorOverview.render(snapshot, settings, {
    activeModules: { api: true, requests: true, tokens: true },
    externalModules: true,
    secretsVisible: false,
  });

  assert.match(overviewHtml, /data-module-toggle="api"[\s\S]*aria-pressed="true"/);
  assert.doesNotMatch(overviewHtml, /dashboard-board has-modules/);
  assert.doesNotMatch(overviewHtml, /module-floating-layer|data-module-panel="api"|data-module-panel="requests"|data-module-panel="tokens"/);
});

test('overview renders unknown balance as status text instead of zero', () => {
  const window = loadRendererModules();
  const { settings, snapshot } = fixture();
  const unknownBalanceSnapshot = {
    ...snapshot,
    balance: {
      ...snapshot.balance,
      amount: null,
      available: null,
      endpoint: '',
      source: 'relay',
      status: 'unknown',
    },
  };

  const overviewHtml = window.RelayMonitorOverview.render(unknownBalanceSnapshot, settings, {
    activeModules: { balance: true },
    secretsVisible: false,
  });

  assert.match(overviewHtml, /\u00a53\.82/);
  assert.match(overviewHtml, /\u00a518\.74/);
  assert.match(overviewHtml, /\u00a574\.19/);
  assert.doesNotMatch(overviewHtml, /dashboard-balance-value">\u00a50\.00/);
  assert.doesNotMatch(overviewHtml, /<strong title="\u00a50\.00">\u00a50\.00<\/strong>/);
  assert.doesNotMatch(overviewHtml, /<strong title="¥0\.00">¥0\.00<\/strong>/);
});

test('overview ignores balance spend fields and reads only relay spend totals', () => {
  const window = loadRendererModules();
  const { settings, snapshot } = fixture();
  const noisyBalanceSnapshot = {
    ...snapshot,
    balance: {
      ...snapshot.balance,
      todaySpend: 999,
      weekSpend: 999,
      monthSpend: 999,
      totalSpend: 999,
    },
    spend: {
      ...snapshot.spend,
      today: 3.82,
      week: 18.74,
      month: 74.19,
      total: 197.49,
    },
  };

  const overviewHtml = window.RelayMonitorOverview.render(noisyBalanceSnapshot, settings, {
    activeModules: { balance: true },
    secretsVisible: false,
  });

  assert.match(overviewHtml, /\u00a53\.82/);
  assert.match(overviewHtml, /\u00a518\.74/);
  assert.match(overviewHtml, /\u00a574\.19/);
  assert.match(overviewHtml, /\u00a5197\.5/);
  assert.doesNotMatch(overviewHtml, /\u00a5999\.00/);
});

test('overview renders auth-required balance as a Chinese status', () => {
  const window = loadRendererModules();
  const { settings, snapshot } = fixture();
  const authRequiredSnapshot = {
    ...snapshot,
    balance: {
      ...snapshot.balance,
      amount: null,
      available: false,
      endpoint: 'https://relay.example.cn/api/user/self',
      httpStatus: 401,
      source: 'web-session-api',
      sourceField: 'data.quota',
      quotaPerUnit: 500000,
      error: 'Balance endpoint returned HTTP 401',
      status: 'auth-required',
      token: 'raw-token-should-not-render',
      cookie: 'SESSION=raw-cookie-should-not-render',
    },
  };

  const overviewHtml = window.RelayMonitorOverview.render(authRequiredSnapshot, settings, {
    activeModules: { balance: true },
    secretsVisible: false,
  });

  assert.match(overviewHtml, /需要登录/);
  assert.match(overviewHtml, /data-open-balance-login="true"/);
  assert.match(overviewHtml, /建议操作/);
  assert.match(overviewHtml, /到设置中使用网页登录余额页面/);
  assert.match(overviewHtml, /balance-diagnostics/);
  assert.match(overviewHtml, /auth-required/);
  assert.match(overviewHtml, /web-session-api/);
  assert.match(overviewHtml, /relay\.example\.cn\/api\/user\/self/);
  assert.match(overviewHtml, /500000/);
  assert.doesNotMatch(overviewHtml, /Balance endpoint returned HTTP 401/);
  assert.doesNotMatch(overviewHtml, /raw-token-should-not-render|raw-cookie-should-not-render|SESSION=/);
  assert.doesNotMatch(overviewHtml, /<strong title="¥0\.00">¥0\.00<\/strong>/);
});

test('overview hides balance login action when balance is already available', () => {
  const window = loadRendererModules();
  const { settings, snapshot } = fixture();
  const overviewHtml = window.RelayMonitorOverview.render(snapshot, settings, {
    activeModules: {},
    secretsVisible: false,
  });

  assert.doesNotMatch(overviewHtml, /data-open-balance-login="true"/);
});

test('main dashboard wires the balance login action to existing login flow', () => {
  const appJs = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  const moduleWindowJs = fs.readFileSync(path.join(root, 'src/renderer/module-window.js'), 'utf8');

  assert.match(appJs, /button\[data-open-balance-login\]/);
  assert.match(appJs, /openSettings\(\);\s*openBalanceLogin\(\);/);
  assert.match(appJs, /function openExternalBalancePage\(\)/);
  assert.match(appJs, /state\.api\.openExternalBalancePage\(\)/);
  assert.match(appJs, /data-open-balance-external/);
  assert.match(appJs, /function ensureWebSessionBalanceMode\(\)/);
  assert.match(appJs, /updateSettingsPatch\(\{\s*balanceAcquisitionMode:\s*"web-session"\s*\}/);
  assert.match(appJs, /Promise\.resolve\(ensureWebSessionBalanceMode\(\)\)[\s\S]*state\.api\.openBalanceLogin\(\)/);
  assert.match(moduleWindowJs, /api\.updateSettings\(\{\s*balanceAcquisitionMode:\s*"web-session"\s*\}\)/);
  assert.match(moduleWindowJs, /modeReady\.then\(function \(\) \{[\s\S]*api\.openBalanceLogin\(\)/);
});

test('overview renders provider-mismatch balance as a clear status', () => {
  const window = loadRendererModules();
  const { settings, snapshot } = fixture();
  const mismatchSnapshot = {
    ...snapshot,
    balance: {
      ...snapshot.balance,
      amount: null,
      available: false,
      endpoint: 'https://relay.example.cn/console',
      source: 'web-session',
      status: 'provider-mismatch',
      error: 'Balance page host relay.example.cn does not match current provider host us.pinai-cn.com',
    },
  };

  const overviewHtml = window.RelayMonitorOverview.render(mismatchSnapshot, settings, {
    activeModules: { balance: true },
    secretsVisible: false,
  });

  assert.match(overviewHtml, /余额页面不匹配/);
  assert.match(overviewHtml, /建议操作/);
  assert.match(overviewHtml, /检查余额页面是否属于当前中转站/);
  assert.match(overviewHtml, /provider-mismatch/);
  assert.match(overviewHtml, /relay\.example\.cn\/console/);
  assert.doesNotMatch(overviewHtml, /us\.pinai-cn\.com|Balance page host/);
  assert.doesNotMatch(overviewHtml, /<strong title="¥0\.00">¥0\.00<\/strong>/);
});


test('overview gives an actionable hint when web balance extraction fails', () => {
  const window = loadRendererModules();
  const { settings, snapshot } = fixture();
  const parseErrorSnapshot = {
    ...snapshot,
    balance: {
      ...snapshot.balance,
      amount: null,
      available: false,
      endpoint: 'https://relay.example.cn/dashboard/billing',
      source: 'web-session',
      status: 'parse-error',
    },
  };

  const overviewHtml = window.RelayMonitorOverview.render(parseErrorSnapshot, settings, {
    activeModules: { balance: true },
    secretsVisible: false,
  });

  assert.ok(overviewHtml.includes('\u63d0\u53d6\u5931\u8d25'));
  assert.ok(overviewHtml.includes('\u5efa\u8bae\u64cd\u4f5c'));
  assert.ok(overviewHtml.includes('\u5728\u8bbe\u7f6e\u4e2d\u586b\u5199\u4f59\u989d CSS \u9009\u62e9\u5668'));
  assert.doesNotMatch(overviewHtml, /<strong title="\u00a50\.00">\u00a50\.00<\/strong>/);
});

test('overview and detail never reveal raw provider apiKey or key fields', () => {
  const window = loadRendererModules();
  const { request, settings, snapshot } = fixture();
  const unsafeSnapshot = {
    ...snapshot,
    provider: {
      ...snapshot.provider,
      keyPreview: '',
      apiKeyPreview: '',
      apiKey: 'sk-raw-secret-should-not-render',
      key: 'sk-another-raw-secret',
    },
  };

  const overviewHidden = window.RelayMonitorOverview.render(unsafeSnapshot, settings, { secretsVisible: false });
  const overviewVisible = window.RelayMonitorOverview.render(unsafeSnapshot, settings, { secretsVisible: true });
  const detailHidden = window.RelayMonitorRequestDetail.render(request, unsafeSnapshot, settings, { secretsVisible: false });
  const detailVisible = window.RelayMonitorRequestDetail.render(request, unsafeSnapshot, settings, { secretsVisible: true });
  const combined = overviewHidden + overviewVisible + detailHidden + detailVisible;

  assert.match(combined, /sk-\*{12}9A2F/);
  assert.doesNotMatch(combined, /sk-raw-secret-should-not-render|sk-another-raw-secret/);
});

test('overview single dashboard tolerates custom relay name without exposing raw keys', () => {
  const window = loadRendererModules();
  const { settings, snapshot } = fixture();
  const unsafeSnapshot = {
    ...snapshot,
    provider: {
      ...snapshot.provider,
      apiKey: 'sk-raw-secret-should-not-render',
      key: 'sk-another-raw-secret',
    },
  };
  const customSettings = {
    ...settings,
    customRelayName: '我的中转站',
  };

  const overviewHtml = window.RelayMonitorOverview.render(unsafeSnapshot, customSettings, {
    activeModules: { api: true },
    relayNameEditing: true,
    secretsVisible: true,
  });

  assert.match(overviewHtml, /dashboard-board has-modules/);
  assert.match(overviewHtml, /primary-dashboard/);
  assert.match(overviewHtml, /API 切换/);
  assert.match(overviewHtml, /账户余额/);
  assert.match(overviewHtml, /Token 曲线/);
  assert.match(overviewHtml, /我的中转站/);
  assert.doesNotMatch(overviewHtml, /sk-raw-secret-should-not-render|sk-another-raw-secret/);
  assert.doesNotMatch(overviewHtml, /jp-relay\.example|127\.0\.0\.1:8787/);
});

test('dock module state opens only requested detail dashboards', () => {
  const window = loadRendererModules();
  const { settings, snapshot } = fixture();

  const overviewApiToken = window.RelayMonitorOverview.render(snapshot, settings, {
    activeModules: { api: true, tokens: true },
    secretsVisible: false,
  });

  assertModulePanel(overviewApiToken, 'api');
  assertModulePanel(overviewApiToken, 'tokens');
  assert.doesNotMatch(overviewApiToken, /data-module-panel="requests"|data-module-panel="balance"|data-module-panel="cache"|data-module-panel="settings"/);
  assert.doesNotMatch(overviewApiToken, /data-drag-panel="requests"|data-drag-panel="balance"|data-drag-panel="cache"|data-drag-panel="settings"/);
  assert.equal(countMatches(overviewApiToken, /aria-pressed="true"/g), 2);
});

test('renderer detail tolerates non-array trend data', () => {
  const window = loadRendererModules();
  const { request, settings, snapshot } = fixture();
  const oddSnapshot = {
    ...snapshot,
    modelTrends: null,
    trend7d: { today: 168000 },
  };

  assert.doesNotThrow(() => {
    window.RelayMonitorRequestDetail.render(request, oddSnapshot, settings, { secretsVisible: false });
  });
});

test('overview and detail prefer latest real request model and reasoning over provider defaults', () => {
  const window = loadRendererModules();
  const { request, settings, snapshot } = fixture();
  const actualRequest = {
    ...request,
    model: '',
    requestModel: 'claude-opus-4-real',
    modelName: '',
    reasoningEffort: 'xhigh',
  };
  const actualSnapshot = {
    ...snapshot,
    provider: {
      ...snapshot.provider,
      model: 'provider-default-model',
      reasoningEffort: 'low',
    },
    recentRequests: [actualRequest],
    modelTrends: {},
  };

  const overviewHtml = window.RelayMonitorOverview.render(actualSnapshot, settings, {
    activeModules: { requests: true },
    secretsVisible: false,
  });
  const detailHtml = window.RelayMonitorRequestDetail.render(actualRequest, actualSnapshot, settings, { secretsVisible: false });

  assert.match(overviewHtml, /claude-opus-4-real/);
  assert.match(overviewHtml, /xhigh/);
  assert.doesNotMatch(overviewHtml, /provider-default-model|推理 low|>low</);
  assert.match(detailHtml, /claude-opus-4-real/);
  assert.match(detailHtml, /xhigh/);
  assert.doesNotMatch(detailHtml, /provider-default-model|>low</);
});

test('api module highlights ccswitch isCurrent provider instead of the first provider', () => {
  const window = loadRendererModules();
  const { settings, snapshot } = fixture();
  const html = window.RelayMonitorOverview.render({
    ...snapshot,
    provider: {
      providerId: 'relay-2',
      name: 'waw',
      baseUrl: 'https://relay.example.cn/v1',
      maskedKey: 'sk-************WAW',
    },
    providers: [
      {
        providerId: 'relay-1',
        name: 'old',
        baseUrl: 'https://old.example.test/v1',
        maskedKey: 'sk-************OLD',
        isCurrent: false,
      },
      {
        providerId: 'relay-2',
        name: 'waw',
        baseUrl: 'https://relay.example.cn/v1',
        maskedKey: 'sk-************WAW',
        isCurrent: true,
      },
    ],
  }, settings, {
    activeModules: { api: true },
    secretsVisible: false,
  });

  assert.match(html, /<div class="api-option is-current">[\s\S]*<strong title="waw">waw<\/strong>/);
  assert.doesNotMatch(html, /<div class="api-option is-current">[\s\S]*<strong title="old">old<\/strong>/);
});

test('overview empty relay state does not invent cache context or secret values', () => {
  const window = loadRendererModules();
  const { settings } = fixture();
  const html = window.RelayMonitorOverview.render({
    provider: { name: '', baseUrl: '', maskedKey: '', keyPreview: '' },
    providers: [],
    recentRequests: [],
    cache: {},
    context: {},
    usage: {},
    trend7d: [],
    balance: { status: 'unavailable', amount: null },
  }, settings, {
    activeModules: { api: true, cache: true },
    secretsVisible: false,
  });

  assert.doesNotMatch(html, /68%|57%|sk-\*{12}|sk-\*{12}9A2F/);
  assert.match(html, /0%/);
  assert.match(html, /未检测到密钥/);
});
