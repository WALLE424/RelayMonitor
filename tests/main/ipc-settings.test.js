'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  applyBalanceProviderProfile,
  balanceProviderProfileKey,
  createBalanceDiagnostic,
  createCompanionSnapshot,
  DEFAULT_SETTINGS,
  IPC_CHANNELS,
  normalizeSettings,
  rememberBalanceProviderProfile,
  resolveBalanceTargetUrl,
  sanitizeRendererSettingsPatch,
} = require('../../src/main/ipc');
const {
  authHeadersFromContext,
  authHeadersFromToken,
  createBalanceLoginStatus,
  extractStorageAuthContext,
  extractStorageAuthToken,
} = require('../../src/main/balance-login');

const root = path.resolve(__dirname, '..', '..');

test('sanitizeRendererSettingsPatch rejects path and unknown keys from renderer', () => {
  assert.deepEqual(sanitizeRendererSettingsPatch({
    appearanceTheme: 'dark',
    windowOpacity: 0.72,
    panelOpacity: 0.5,
    glassOpacity: 0.5,
    cacheHitTarget: 72,
    customRelayName: '  Team Relay  ',
    companionVisible: false,
    balanceAcquisitionMode: 'web-session',
    balanceManualAmount: '120.50',
    balancePageUrl: 'https://relay.example.cn/dashboard',
    balanceSelector: '.balance-value',
    codexSessionsPath: 'C:\\sensitive',
    ccswitchDbPath: 'C:\\anywhere\\cc-switch.db',
    unknownKey: 'ignored',
  }), {
    appearanceTheme: 'dark',
    windowOpacity: 0.72,
    panelOpacity: 0.5,
    glassOpacity: 0.5,
    cacheHitTarget: 72,
    customRelayName: '  Team Relay  ',
    companionVisible: false,
    balanceAcquisitionMode: 'web-session',
    balanceManualAmount: '120.50',
    balancePageUrl: 'https://relay.example.cn/dashboard',
    balanceSelector: '.balance-value',
  });
});

test('default settings do not include local Codex or Claude usage paths', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, 'codexConfigPath'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, 'codexSessionsPath'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, 'claudeProjectsPath'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, 'claudeTranscriptsPath'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, 'claudeSettingsPath'), false);
});

test('normalizeSettings drops deprecated local Codex and Claude usage paths', () => {
  const settings = normalizeSettings({
    codexConfigPath: 'C:\\Users\\WALLE\\.codex\\config.toml',
    codexSessionsPath: 'C:\\Users\\WALLE\\.codex\\sessions',
    claudeProjectsPath: 'C:\\Users\\WALLE\\.claude\\projects',
    claudeTranscriptsPath: 'C:\\Users\\WALLE\\.claude\\transcripts',
    claudeSettingsPath: 'C:\\Users\\WALLE\\.claude\\settings.json',
  });

  assert.equal(Object.prototype.hasOwnProperty.call(settings, 'codexConfigPath'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(settings, 'codexSessionsPath'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(settings, 'claudeProjectsPath'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(settings, 'claudeTranscriptsPath'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(settings, 'claudeSettingsPath'), false);
});

test('normalizeSettings clamps appearance settings and preserves light default', () => {
  const defaults = normalizeSettings();
  assert.equal(defaults.appearanceTheme, 'light');
  assert.equal(defaults.windowOpacity, 1);
  assert.equal(defaults.panelOpacity, 0.8);
  assert.equal(defaults.glassBlur, 24);
  assert.equal(defaults.glassOpacity, defaults.panelOpacity);

  const settings = normalizeSettings({
    appearanceTheme: 'purple',
    windowOpacity: 0.1,
    panelOpacity: 99,
    glassBlur: -1,
  });

  assert.equal(settings.appearanceTheme, 'light');
  assert.equal(settings.windowOpacity, 0.65);
  assert.equal(settings.panelOpacity, 0.92);
  assert.equal(settings.glassOpacity, 0.92);
  assert.equal(settings.glassBlur, 8);
});

test('normalizeSettings accepts percentage appearance values', () => {
  const settings = normalizeSettings({
    appearanceTheme: 'dark',
    appearanceThemeUserSelected: true,
    windowOpacity: 72,
    panelOpacity: 68,
    glassBlur: 24,
  });

  assert.equal(settings.appearanceTheme, 'dark');
  assert.equal(settings.windowOpacity, 0.72);
  assert.equal(settings.panelOpacity, 0.68);
  assert.equal(settings.glassOpacity, 0.68);
  assert.equal(settings.glassBlur, 24);
});

test('normalizeSettings keeps cacheStatsEnabled independent from cacheHitAlert', () => {
  const settings = normalizeSettings({
    cacheHitAlert: true,
    cacheStatsEnabled: false,
  });

  assert.equal(settings.cacheHitAlert, true);
  assert.equal(settings.cacheStatsEnabled, false);
});

test('normalizeSettings trims and limits customRelayName', () => {
  const settings = normalizeSettings({
    customRelayName: `  ${'Relay'.repeat(20)}  `,
  });

  assert.equal(settings.customRelayName, 'Relay'.repeat(8));
  assert.equal(settings.customRelayName.length, 40);
});

test('normalizeSettings supports close button behavior setting', () => {
  assert.equal(normalizeSettings().closeButtonBehavior, 'hide-to-tray');
  assert.equal(normalizeSettings().refreshSeconds, 5);
  assert.equal(normalizeSettings().companionVisible, true);
  assert.equal(normalizeSettings({ closeButtonBehavior: 'quit' }).closeButtonBehavior, 'quit');
  assert.equal(normalizeSettings({ companionVisible: false }).companionVisible, false);
  assert.equal(
    normalizeSettings({ closeButtonBehavior: 'destroy-window' }).closeButtonBehavior,
    'hide-to-tray',
  );
});

test('normalizeSettings persists resizable dashboard and module bounds safely', () => {
  const settings = normalizeSettings({
    mainWindowBounds: { x: 12.4, y: 35.6, width: 688.2, height: 801.8 },
    moduleWindowBounds: {
      balance: { x: 500.8, y: 120.2, width: 560.5, height: 420.7 },
      oversized: { x: 1, y: 2, width: 4000, height: 30 },
      invalid: { x: 'bad', y: 0, width: 400, height: 300 },
    },
  });

  assert.deepEqual(settings.mainWindowBounds, { x: 12, y: 36, width: 688, height: 802 });
  assert.deepEqual(settings.moduleWindowBounds.balance, { x: 501, y: 120, width: 561, height: 421 });
  assert.deepEqual(settings.moduleWindowBounds.oversized, { x: 1, y: 2, width: 980, height: 320 });
  assert.equal(settings.moduleWindowBounds.invalid, undefined);
});

test('window sources keep every dashboard window resizable', () => {
  const windowsSource = fs.readFileSync(path.join(root, 'src/main/windows.js'), 'utf8');
  const { MODULE_WINDOW_SIZES } = require('../../src/main/windows');
  const mainWindowSource = windowsSource.slice(
    windowsSource.indexOf('function createMainWindow'),
    windowsSource.indexOf('function createModuleWindow'),
  );
  const moduleWindowSource = windowsSource.slice(
    windowsSource.indexOf('function createModuleWindow'),
    windowsSource.indexOf('function createCompanionWindow'),
  );
  assert.match(mainWindowSource, /resizable:\s*true/);
  assert.match(moduleWindowSource, /resizable:\s*true/);
  assert.doesNotMatch(mainWindowSource, /resizable:\s*false/);
  assert.doesNotMatch(moduleWindowSource, /resizable:\s*false/);
  Object.values(MODULE_WINDOW_SIZES).forEach((size) => {
    assert.ok(size.width >= MODULE_WINDOW_SIZES.balance.width);
    assert.ok(size.height >= MODULE_WINDOW_SIZES.balance.height);
  });
});

test('companion window restores saved width and height', () => {
  const windowsSource = fs.readFileSync(path.join(root, 'src/main/windows.js'), 'utf8');
  const companionSource = windowsSource.slice(
    windowsSource.indexOf('function createCompanionWindow'),
    windowsSource.indexOf('module.exports'),
  );

  assert.match(companionSource, /Number\.isFinite\(initialBounds\?\.width\)/);
  assert.match(companionSource, /Number\.isFinite\(initialBounds\?\.height\)/);
  assert.match(companionSource, /Math\.min\(380,\s*Math\.max\(286,\s*Math\.round\(initialBounds\.width\)\)\)/);
  assert.match(companionSource, /Math\.min\(190,\s*Math\.max\(44,\s*Math\.round\(initialBounds\.height\)\)\)/);
});

test('companion tracker prefers real Codex windows and avoids broad browser matches', () => {
  const trackerSource = fs.readFileSync(path.join(root, 'src/main/companion-tracker.js'), 'utf8');
  const { companionBoundsForCodex } = require('../../src/main/companion-tracker');

  assert.match(trackerSource, /codexWindowPattern/);
  assert.ok(trackerSource.includes('openai\\\\.codex') || trackerSource.includes('openai\\.codex'));
  assert.match(trackerSource, /excludedWindowPattern/);
  assert.match(trackerSource, /chrome\|edge\|firefox\|browser/);
  assert.match(trackerSource, /Sort-Object @\{/);
  assert.match(trackerSource, /companionBoundsForCodex/);
  assert.deepEqual(
    companionBoundsForCodex(
      { x: 100, y: 120, width: 900, height: 700 },
      { width: 320, height: 48 },
      { x: 0, y: 0, width: 1200, height: 900 },
    ),
    { x: 390, y: 64, width: 320, height: 48 },
  );
  assert.equal(
    companionBoundsForCodex(
      { x: 100, y: 20, width: 900, height: 700 },
      { width: 320, height: 48 },
      { x: 0, y: 0, width: 1200, height: 900 },
    ).y,
    32,
  );
});

test('dashboard CSS follows the window size instead of locking to the default preview size', () => {
  const layout = fs.readFileSync(path.join(root, 'src/renderer/styles/layout.css'), 'utf8');
  const components = fs.readFileSync(path.join(root, 'src/renderer/styles/components.css'), 'utf8');

  assert.match(layout, /\.single-dashboard-overview\s*{[\s\S]*?width:\s*100vw;[\s\S]*?height:\s*100vh;/);
  assert.match(layout, /\.primary-dashboard\s*{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;/);
  assert.match(components, /body\.dashboard-only:not\(\.module-window-body\) \.single-dashboard-overview,[\s\S]*?width:\s*100vw;[\s\S]*?height:\s*100vh;/);
  assert.doesNotMatch(components, /body\.dashboard-only:not\(\.module-window-body\)[\s\S]{0,320}width:\s*418px;[\s\S]{0,120}height:\s*548px;/);
});

test('module dashboards keep balance-sized minimums and scroll when resized smaller', () => {
  const ipcSource = fs.readFileSync(path.join(root, 'src/main/ipc.js'), 'utf8');
  const layout = fs.readFileSync(path.join(root, 'src/renderer/styles/layout.css'), 'utf8');
  const components = fs.readFileSync(path.join(root, 'src/renderer/styles/components.css'), 'utf8');

  assert.match(ipcSource, /const MODULE_MIN_WIDTH = 380/);
  assert.match(ipcSource, /const MODULE_MIN_HEIGHT = 320/);
  assert.match(layout, /\.module-window-root \.module-panel\s*{[\s\S]*?min-width:\s*380px;[\s\S]*?min-height:\s*320px;[\s\S]*?overflow:\s*auto;/);
  assert.match(layout, /\.module-window-root\s*{[\s\S]*?overflow:\s*auto;/);
  assert.doesNotMatch(components, /\.module-window-body \.module-panel,[\s\S]*?resize:\s*both;/);
  assert.match(components, /\.balance-diagnostic-grid\s*{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(components, /\.balance-diagnostic-grid span\s*{[\s\S]*?overflow-wrap:\s*anywhere;/);
});

test('dashboard responsive CSS keeps compact rules inside media blocks', () => {
  const components = fs.readFileSync(path.join(root, 'src/renderer/styles/components.css'), 'utf8');

  assert.match(components, /@media \(max-width: 420px\) \{\s*\.dashboard-dock/s);
  assert.match(components, /@media \(max-width: 380px\) \{\s*\.dashboard-model-card[\s\S]*\.module-request-list \.request-row/);
});

test('light theme request icons use glass badges instead of dark plastic tiles', () => {
  const components = fs.readFileSync(path.join(root, 'src/renderer/styles/components.css'), 'utf8');
  const iconSource = components.slice(
    components.indexOf('.usage-icon {'),
    components.indexOf('.usage-track {'),
  );

  assert.match(iconSource, /rgba\(255,\s*255,\s*255,\s*0\.95\)/);
  assert.match(iconSource, /--usage-dot/);
  assert.match(iconSource, /body\.theme-dark \.usage-icon/);
  assert.doesNotMatch(iconSource, /rgba\(79,\s*104,\s*124,\s*0\.72\)/);
  assert.doesNotMatch(iconSource, /rgba\(35,\s*45,\s*57,\s*0\.82\)/);
});

test('normalizeSettings supports balance acquisition settings', () => {
  const settings = normalizeSettings({
    balanceAcquisitionMode: 'manual',
    balanceManualAmount: '88.8',
    balancePageUrl: `  https://relay.example.cn/dashboard  `,
    balanceSelector: '.balance-value',
  });

  assert.equal(settings.balanceAcquisitionMode, 'manual');
  assert.equal(settings.balanceManualAmount, 88.8);
  assert.equal(settings.balancePageUrl, 'https://relay.example.cn/dashboard');
  assert.equal(settings.balanceSelector, '.balance-value');
  assert.equal(normalizeSettings({ balanceAcquisitionMode: 'screen-scrape-password' }).balanceAcquisitionMode, 'auto-api');
  assert.equal(normalizeSettings({ balanceManualAmount: -1 }).balanceManualAmount, 0);
  assert.equal(normalizeSettings({ balanceManualAmount: 'bad' }).balanceManualAmount, null);
});

test('normalizeSettings preserves safe per-provider balance profiles', () => {
  const settings = normalizeSettings({
    balanceProviderProfiles: {
      ' id:waw ': {
        mode: 'web-session',
        pageUrl: '  https://relay.example.cn/console  ',
        selector: '  .wallet-balance  ',
        manualAmount: '188.6',
        updatedAt: '2026-06-16T12:00:00.000Z',
      },
      invalid: null,
      'id:bad-mode': {
        mode: 'screen-scrape-password',
        pageUrl: 'https://relay.example.cn/dashboard',
      },
    },
  });

  assert.deepEqual(settings.balanceProviderProfiles['id:waw'], {
    mode: 'web-session',
    pageUrl: 'https://relay.example.cn/console',
    selector: '.wallet-balance',
    manualAmount: 188.6,
    updatedAt: '2026-06-16T12:00:00.000Z',
  });
  assert.equal(settings.balanceProviderProfiles.invalid, undefined);
  assert.equal(settings.balanceProviderProfiles['id:bad-mode'].mode, 'auto-api');
});

test('balance provider profiles apply and remember current relay settings', () => {
  const snapshot = {
    provider: {
      providerId: 'waw',
      baseUrl: 'https://relay.example.cn/v1',
    },
  };
  const settings = normalizeSettings({
    balanceAcquisitionMode: 'auto-api',
    balanceProviderProfiles: {
      'id:waw': {
        mode: 'web-session',
        pageUrl: 'https://relay.example.cn/console',
        selector: '.wallet-balance',
        manualAmount: '200',
      },
    },
  });
  const applied = applyBalanceProviderProfile(settings, snapshot);

  assert.equal(balanceProviderProfileKey(snapshot), 'id:waw');
  assert.equal(applied.balanceAcquisitionMode, 'web-session');
  assert.equal(applied.balancePageUrl, 'https://relay.example.cn/console');
  assert.equal(applied.balanceSelector, '.wallet-balance');
  assert.equal(applied.balanceManualAmount, 200);

  const remembered = rememberBalanceProviderProfile(normalizeSettings({
    balanceAcquisitionMode: 'manual',
    balanceManualAmount: '88.8',
    balancePageUrl: 'https://relay.example.cn/billing',
    balanceSelector: '.balance',
  }), snapshot);

  assert.equal(remembered.balanceProviderProfiles['id:waw'].mode, 'manual');
  assert.equal(remembered.balanceProviderProfiles['id:waw'].manualAmount, 88.8);
  assert.equal(remembered.balanceProviderProfiles['id:waw'].pageUrl, 'https://relay.example.cn/billing');
});

test('sanitizeRendererSettingsPatch allows close button behavior only through settings whitelist', () => {
  assert.deepEqual(sanitizeRendererSettingsPatch({
    closeButtonBehavior: 'quit',
    forceClose: true,
    unknownChannel: 'window:close',
  }), {
    closeButtonBehavior: 'quit',
  });
});

test('createBalanceDiagnostic returns safe status and advice without secrets', () => {
  const diagnostic = createBalanceDiagnostic({
    provider: {
      name: 'waw',
      baseUrl: 'https://relay.example.cn/v1',
      apiKey: 'sk-raw-secret',
    },
    balance: {
      status: 'auth-required',
      source: 'web-session',
      amount: null,
      httpStatus: 401,
      cookie: 'SESSION=raw-cookie',
    },
  }, {
    balanceAcquisitionMode: 'web-session',
    balancePageUrl: 'https://relay.example.cn/console',
  }, {
    status: 'missing',
    hasLoginState: false,
    hasAuthUserId: true,
    cookie: 'SESSION=raw-cookie',
    token: 'raw-token',
  });

  assert.equal(diagnostic.mode, 'web-session');
  assert.equal(diagnostic.providerName, 'waw');
  assert.equal(diagnostic.targetHost, 'relay.example.cn/console');
  assert.equal(diagnostic.suggestedBalancePageUrl, 'https://relay.example.cn/console');
  assert.equal(diagnostic.suggestedBalancePageHost, 'relay.example.cn/console');
  assert.equal(diagnostic.effectiveLoginUrl, 'https://relay.example.cn/console');
  assert.equal(diagnostic.effectiveLoginHost, 'relay.example.cn/console');
  assert.equal(diagnostic.balanceStatus, 'auth-required');
  assert.equal(diagnostic.hasLoginState, false);
  assert.equal(diagnostic.hasAuthUserId, true);
  assert.equal(diagnostic.failureKind, 'login-required');
  assert.match(diagnostic.nextStep, /内置登录窗口/);
  assert.match(diagnostic.advice, /登录/);
  assert.doesNotMatch(JSON.stringify(diagnostic), /sk-raw-secret|SESSION=raw-cookie|raw-token|apiKey|"cookie"|"token"/i);
});

test('createBalanceDiagnostic shows effective current provider login page when configured page is stale', () => {
  const diagnostic = createBalanceDiagnostic({
    provider: {
      name: 'current',
      baseUrl: 'https://current.example.cn/v1',
    },
    endpoint: 'https://current.example.cn/v1',
    balance: {
      status: 'provider-mismatch',
      source: 'web-session',
      amount: null,
    },
  }, {
    balanceAcquisitionMode: 'web-session',
    balancePageUrl: 'https://old.example.cn/console',
  }, {
    status: 'missing',
    hasLoginState: false,
  });

  assert.equal(diagnostic.targetHost, 'old.example.cn/console');
  assert.equal(diagnostic.suggestedBalancePageUrl, 'https://current.example.cn/console');
  assert.equal(diagnostic.effectiveLoginUrl, 'https://current.example.cn/console');
  assert.equal(diagnostic.effectiveLoginHost, 'current.example.cn/console');
  assert.equal(diagnostic.failureKind, 'provider-mismatch');
  assert.match(diagnostic.nextStep, /当前中转站地址/);
});

test('createBalanceDiagnostic explains selector-needed parse failures', () => {
  const diagnostic = createBalanceDiagnostic({
    provider: {
      name: 'custom relay',
      baseUrl: 'https://custom.example.cn/v1',
    },
    balance: {
      status: 'parse-error',
      source: 'web-session-rendered',
      amount: null,
      httpStatus: 200,
    },
  }, {
    balanceAcquisitionMode: 'web-session',
    balancePageUrl: 'https://custom.example.cn/console',
  }, {
    status: 'ready',
    hasLoginState: true,
    hasCookies: true,
  });

  assert.equal(diagnostic.failureKind, 'selector-needed');
  assert.match(diagnostic.nextStep, /CSS 选择器/);
  assert.match(diagnostic.advice, /CSS 选择器/);
});

test('balance login target prefers current provider page over stale configured page', () => {
  const ipcSource = fs.readFileSync(path.join(root, 'src/main/ipc.js'), 'utf8');
  const targetSource = ipcSource.slice(
    ipcSource.indexOf('function balanceTargetUrl()'),
    ipcSource.indexOf('function webSessionFetch'),
  );

  assert.match(ipcSource, /function balancePageMatchesProvider/);
  assert.match(ipcSource, /function resolveBalanceTargetUrl\(settings = \{\}, snapshot = \{\}\)/);
  assert.match(targetSource, /return resolveBalanceTargetUrl\(effectiveBalanceSettings\(lastSnapshot \|\| \{\}\),\s*lastSnapshot \|\| \{\}\);/);
});

test('web balance page follows the current provider and bypasses stale balance cache', () => {
  const ipcSource = fs.readFileSync(path.join(root, 'src/main/ipc.js'), 'utf8');
  const syncSource = ipcSource.slice(
    ipcSource.indexOf('function syncBalancePageToCurrentProvider'),
    ipcSource.indexOf('function updateCompanionBounds'),
  );
  const readSnapshotSource = ipcSource.slice(
    ipcSource.indexOf('async function readSnapshot'),
    ipcSource.indexOf('async function snapshot'),
  );
  const openLoginSource = ipcSource.slice(
    ipcSource.indexOf("registerSafeHandler('balance:openLogin'"),
    ipcSource.indexOf("registerSafeHandler('relay:updateSettings'"),
  );

  assert.match(syncSource, /balanceAcquisitionMode \|\| 'auto-api'\) !== 'web-session'/);
  assert.match(syncSource, /resolveBalanceTargetUrl\(currentSettings,\s*currentSnapshot \|\| \{\}\)/);
  assert.match(syncSource, /balancePageUrl: targetUrl/);
  assert.match(syncSource, /lastBalance\s*=\s*null/);
  assert.match(syncSource, /sendSettingsToDashboards\(\)/);
  assert.match(ipcSource, /'balance-page-sync'/);
  assert.match(readSnapshotSource, /syncedBalancePageUrl !== previousBalancePageUrl/);
  assert.match(readSnapshotSource, /return readSnapshot\('balance-page-sync'\)/);
  assert.match(openLoginSource, /const currentSnapshot = await snapshot\('balance-refresh'\)/);
  assert.match(openLoginSource, /syncBalancePageToCurrentProvider\(currentSnapshot\)/);
});

test('runtime applies and saves per-provider balance profiles', () => {
  const ipcSource = fs.readFileSync(path.join(root, 'src/main/ipc.js'), 'utf8');
  const syncSource = ipcSource.slice(
    ipcSource.indexOf('function syncBalancePageToCurrentProvider'),
    ipcSource.indexOf('function updateCompanionBounds'),
  );
  const readSnapshotSource = ipcSource.slice(
    ipcSource.indexOf('async function readSnapshot'),
    ipcSource.indexOf('async function snapshot'),
  );
  const updateSettingsSource = ipcSource.slice(
    ipcSource.indexOf("registerSafeHandler('relay:updateSettings'"),
    ipcSource.indexOf("registerSafeHandler('app:openUserData'"),
  );

  assert.match(ipcSource, /function effectiveBalanceSettings/);
  assert.match(syncSource, /effectiveBalanceSettings\(currentSnapshot \|\| \{\}\)/);
  assert.match(syncSource, /rememberBalanceProviderProfile/);
  assert.match(readSnapshotSource, /const settingsForSnapshot = effectiveBalanceSettings\(lastSnapshot \|\| \{\}\)/);
  assert.match(readSnapshotSource, /applyBalanceProviderProfile\(settings,\s*lastSnapshot\)/);
  assert.match(readSnapshotSource, /balance-profile-sync/);
  assert.match(updateSettingsSource, /hasBalanceSettingsPatch\(safePatch\)/);
  assert.match(updateSettingsSource, /rememberBalanceProviderProfile\(settings,\s*lastSnapshot \|\| \{\}\)/);
});

test('resolveBalanceTargetUrl avoids stale relay pages when provider changes', () => {
  assert.equal(resolveBalanceTargetUrl({
    balancePageUrl: 'https://relay.example.cn/console',
  }, {
    provider: {
      name: 'current relay',
      baseUrl: 'http://203.56.121.111:3000/v1',
    },
  }), 'http://203.56.121.111:3000/console');

  assert.equal(resolveBalanceTargetUrl({
    balancePageUrl: 'https://relay.example.cn/billing',
  }, {
    provider: {
      name: 'current relay',
      baseUrl: 'https://relay.example.cn/v1',
    },
  }), 'https://relay.example.cn/billing');
});

test('preload exposes close behavior through the IPC whitelist and settings updater', () => {
  const preload = fs.readFileSync(path.join(root, 'src/preload/index.js'), 'utf8');

  assert.match(preload, /'relay:updateSettings'/);
  assert.match(preload, /'balance:openExternalLogin'/);
  assert.match(preload, /'balance:diagnose'/);
  assert.match(preload, /diagnoseBalance:\s*\(\)\s*=>\s*invoke\('balance:diagnose'\)/);
  assert.match(preload, /openExternalBalancePage:\s*\(\)\s*=>\s*invoke\('balance:openExternalLogin'\)/);
  assert.match(preload, /setCloseButtonBehavior:\s*\(behavior\)\s*=>\s*invoke\('relay:updateSettings',\s*\{\s*closeButtonBehavior:\s*behavior\s*\}\)/);
  assert.match(preload, /close:\s*\(\)\s*=>\s*invoke\('window:close'\)/);
  assert.match(preload, /setCompanionBounds:\s*\(bounds,\s*options\)\s*=>\s*invoke\('companion:setBounds',\s*bounds,\s*options\)/);
  assert.match(preload, /toggleModuleWindow:\s*\(moduleId\)\s*=>\s*invoke\('module:toggle',\s*moduleId\)/);
  assert.match(preload, /closeModuleWindow:\s*\(moduleId\)\s*=>\s*invoke\('module:close',\s*moduleId\)/);
  assert.match(preload, /getModuleWindowState:\s*\(\)\s*=>\s*invoke\('module:getState'\)/);
  assert.match(preload, /'relay:modules'/);
  assert.match(preload, /onModuleStatePush:\s*\(callback\)\s*=>\s*on\('relay:modules',\s*callback\)/);
});

test('companion tracker follows Codex frequently enough for attached overlay feel', () => {
  const ipcSource = fs.readFileSync(path.join(root, 'src/main/ipc.js'), 'utf8');

  assert.match(ipcSource, /function resetCompanionTracker\(\)/);
  assert.match(ipcSource, /COMPANION_TRACK_ACTIVE_MS\s*=\s*2000/);
  assert.match(ipcSource, /COMPANION_TRACK_IDLE_MS\s*=\s*5000/);
  assert.match(ipcSource, /function startCompanionTrackerInterval\(intervalMs\)/);
  assert.match(ipcSource, /companionIdleTicks >= 3/);
  assert.match(ipcSource, /settings\.companionLocked/);
});

test('package keeps portable output and enables configurable NSIS install directory', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const targets = pkg.build.win.target.map((target) => target.target || target);
  const iconPath = path.join(root, pkg.build.win.icon);
  const iconScript = fs.readFileSync(path.join(root, 'scripts/generate-icon.ps1'), 'utf8');

  assert.equal(pkg.build.win.icon, 'src/assets/icons/app-icon.ico');
  assert.equal(pkg.build.nsis.installerIcon, 'src/assets/icons/app-icon.ico');
  assert.equal(pkg.build.nsis.uninstallerIcon, 'src/assets/icons/app-icon.ico');
  assert.ok(fs.existsSync(iconPath));
  assert.ok(fs.statSync(iconPath).size > 4096);
  assert.ok(fs.existsSync(path.join(root, 'src/assets/icons/app-icon-256.png')));
  assert.ok(fs.existsSync(path.join(root, 'scripts/generate-icon.ps1')));
  assert.match(iconScript, /255,\s*250,\s*252/);
  assert.match(iconScript, /240\s+154\s+181/);
  assert.match(iconScript, /85\s+199\s+179/);
  assert.match(iconScript, /DrawArc\(\$dialMintPen/);
  assert.match(iconScript, /DrawLines\(\$sparkPen/);
  assert.equal(pkg.build.nsis.oneClick, false);
  assert.equal(pkg.build.nsis.allowToChangeInstallationDirectory, true);
  assert.ok(targets.includes('nsis'));
  assert.ok(targets.includes('portable'));
});

test('package exposes a safe snapshot diagnostic command', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const script = pkg.scripts && pkg.scripts.diagnose;
  const diagnoseSource = fs.readFileSync(path.join(root, 'scripts', 'diagnose-snapshot.js'), 'utf8');

  assert.equal(script, 'node scripts/diagnose-snapshot.js');
  assert.ok(fs.existsSync(path.join(root, 'scripts', 'diagnose-snapshot.js')));
  assert.match(diagnoseSource, /\\u4e2d\\u8f6c\\u7ad9\\u76d1\\u63a7/);
  assert.match(diagnoseSource, /function suggestedBalancePage/);
  assert.match(diagnoseSource, /function configuredBalancePage/);
  assert.match(diagnoseSource, /function effectiveBalanceLoginPage/);
  assert.match(diagnoseSource, /suggestedBalancePage: suggestedBalance/);
  assert.match(diagnoseSource, /configuredBalancePage: configuredBalance/);
  assert.match(diagnoseSource, /effectiveLoginPage: effectiveBalance/);
  assert.match(diagnoseSource, /resolveBalanceTargetUrl\(settings,\s*snapshot\)/);
  assert.match(diagnoseSource, /新版 exe 登录窗口会优先打开/);
  assert.match(diagnoseSource, /余额页面地址和当前中转站不匹配/);
  assert.match(diagnoseSource, /CLI 诊断不能读取 Electron 持久登录 session/);
});

test('balance login storage token extraction ignores relay api keys', () => {
  const token = extractStorageAuthToken([
    { key: 'theme', value: 'light' },
    { key: 'user', value: JSON.stringify({ access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature' }) },
    { key: 'apiKey', value: 'sk-should-not-be-used' },
  ]);

  assert.equal(token, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature');
  assert.deepEqual(authHeadersFromToken(token), {
    Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature',
  });
});

test('balance login status accepts local storage token without cookies', () => {
  const status = createBalanceLoginStatus({
    cookies: [],
    storageEntries: [
      { key: 'session', value: JSON.stringify({ token: 'eyJhbGciOiJIUzI1NiJ9.payload.signature' }) },
    ],
    targetUrl: 'https://relay.example.cn/console',
  });

  assert.equal(status.status, 'ready');
  assert.equal(status.hasCookies, false);
  assert.equal(status.hasAuthToken, true);
  assert.equal(status.hasLoginState, true);
  assert.equal(status.origin, 'https://relay.example.cn');
  assert.equal(status.message, '已保存网页登录状态');
});

test('balance login storage extraction includes New API user id header', () => {
  const context = extractStorageAuthContext([
    {
      key: 'new-api-user',
      value: JSON.stringify({
        id: 42,
        access_token: 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
      }),
    },
  ]);

  assert.deepEqual(context, {
    token: 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
    userId: '42',
  });
  assert.deepEqual(authHeadersFromContext(context), {
    Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
    'New-Api-User': '42',
  });
  assert.doesNotMatch(JSON.stringify(createBalanceLoginStatus({
    storageEntries: [{ key: 'new-api-user', value: { id: 42, access_token: context.token } }],
    targetUrl: 'https://relay.example.cn/console',
  })), /eyJhbGci|New-Api-User/);
});

test('balance login status accepts indexedDB token records', () => {
  const status = createBalanceLoginStatus({
    cookies: [],
    storageEntries: [
      {
        area: 'indexedDB',
        key: 'auth.users.0',
        value: {
          profile: {
            accessToken: 'eyJpbmRleGVkREItdG9rZW4.payload.signature',
          },
        },
      },
    ],
    targetUrl: 'https://relay.example.cn/console',
  });

  assert.equal(status.status, 'ready');
  assert.equal(status.hasAuthToken, true);
  assert.equal(status.hasLoginState, true);
});

test('balance login window activity and close invalidate cached balance and refresh snapshot', () => {
  const ipcSource = fs.readFileSync(path.join(root, 'src', 'main', 'ipc.js'), 'utf8');
  const loginSource = fs.readFileSync(path.join(root, 'src', 'main', 'balance-login.js'), 'utf8');

  assert.match(loginSource, /renderedTextWithBalanceSession/);
  assert.match(loginSource, /LOGIN_USER_AGENT/);
  assert.match(loginSource, /LOGIN_SHELL_PATH/);
  assert.match(loginSource, /balance-login-shell\.html/);
  assert.match(loginSource, /loadLoginShell/);
  assert.match(loginSource, /setWindowOpenHandler/);
  assert.match(loginSource, /openExternalBalancePage/);
  assert.match(loginSource, /setUserAgent\(LOGIN_USER_AGENT\)/);
  assert.match(loginSource, /did-fail-load/);
  assert.match(loginSource, /LOGIN_BLANK_CHECK_MS/);
  assert.match(loginSource, /buildLoginUrlCandidates/);
  assert.match(loginSource, /\/dashboard/);
  assert.match(loginSource, /\/login/);
  assert.match(loginSource, /clearBalanceAuthCache\(\);/);
  assert.match(loginSource, /did-finish-load/);
  assert.match(loginSource, /did-navigate/);
  assert.match(loginSource, /LOGIN_ACTIVITY_DEBOUNCE_MS/);
  assert.match(loginSource, /onActivity/);
  assert.match(loginSource, /onClosed/);
  assert.match(ipcSource, /providerApiFallback:\s*settingsForSnapshot\.balanceAcquisitionMode === 'web-session'/);
  assert.match(ipcSource, /balance-login-activity/);
  assert.match(ipcSource, /balance-login-closed/);
  assert.match(ipcSource, /renderText:\s*settingsForSnapshot\.balanceAcquisitionMode === 'web-session' \? webSessionRenderedText : undefined/);
  assert.match(ipcSource, /lastBalance\s*=\s*null/);
  assert.match(ipcSource, /pushSnapshot\(reason\)/);
});

test('automatic refreshes reuse short balance cache without local usage scans or stale ccswitch watch data', () => {
  const ipcSource = fs.readFileSync(path.join(root, 'src', 'main', 'ipc.js'), 'utf8');
  const canReuseBalanceSource = ipcSource.slice(
    ipcSource.indexOf('function canReuseBalance'),
    ipcSource.indexOf('async function readSnapshot'),
  );
  const canReuseSnapshotSource = ipcSource.slice(
    ipcSource.indexOf('function canReuseSnapshot'),
    ipcSource.indexOf('function balanceCacheKeyFromSnapshot'),
  );
  const readSnapshotSource = ipcSource.slice(
    ipcSource.indexOf('async function readSnapshot'),
    ipcSource.indexOf('async function snapshot'),
  );

  assert.match(canReuseBalanceSource, /function canReuseBalance\(reason,\s*currentSettings = effectiveBalanceSettings\(lastSnapshot \|\| \{\}\)\)/);
  assert.match(canReuseBalanceSource, /'watch'/);
  assert.match(canReuseBalanceSource, /'balance-refresh'/);
  assert.match(canReuseBalanceSource, /'balance-login'/);
  assert.match(canReuseBalanceSource, /'settings'/);
  assert.match(canReuseBalanceSource, /lastBalanceProviderKey/);
  assert.match(canReuseBalanceSource, /balanceCacheKeyFromSnapshot\(lastSnapshot,\s*currentSettings\)/);
  assert.match(canReuseBalanceSource, /lastBalance/);
  assert.match(canReuseSnapshotSource, /\['ipc',\s*'interval'\]/);
  assert.doesNotMatch(canReuseSnapshotSource, /'watch'/);
  assert.match(ipcSource, /SNAPSHOT_CRITICAL_REASONS/);
  assert.match(ipcSource, /let snapshotQueuedReason = null/);
  assert.match(ipcSource, /function queueSnapshotReason\(reason\)/);
  assert.match(ipcSource, /async function drainSnapshotQueue\(reason = 'manual'\)/);
  assert.match(ipcSource, /snapshotInFlight = drainSnapshotQueue\(reason\)/);
  assert.doesNotMatch(ipcSource, /snapshotInFlight = readSnapshot\(reason\)/);
  assert.doesNotMatch(ipcSource, /LOCAL_USAGE_CACHE_MS/);
  assert.doesNotMatch(ipcSource, /function canReuseLocalUsage/);
  assert.doesNotMatch(readSnapshotSource, /codexOptions/);
  assert.doesNotMatch(readSnapshotSource, /claudeOptions/);
  assert.doesNotMatch(readSnapshotSource, /lastCodexUsage|lastClaudeUsage/);
});

test('snapshot enables relay usage summary for auto api and web session modes', () => {
  const ipcSource = fs.readFileSync(path.join(root, 'src', 'main', 'ipc.js'), 'utf8');
  const readSnapshotSource = ipcSource.slice(
    ipcSource.indexOf('async function readSnapshot'),
    ipcSource.indexOf('async function snapshot'),
  );

  assert.match(readSnapshotSource, /usageSummaryOptions:\s*\{/);
  assert.match(readSnapshotSource, /enabled:\s*settingsForSnapshot\.balanceAcquisitionMode !== 'manual'/);
  assert.match(readSnapshotSource, /skipOfficial:\s*settingsForSnapshot\.balanceAcquisitionMode === 'web-session'/);
  assert.match(readSnapshotSource, /timeoutMs:\s*1200/);
});

test('interval refresh reuses unchanged ccswitch files but critical refreshes bypass snapshot cache', () => {
  const ipcSource = fs.readFileSync(path.join(root, 'src', 'main', 'ipc.js'), 'utf8');
  const canReuseSnapshotSource = ipcSource.slice(
    ipcSource.indexOf('function canReuseSnapshot'),
    ipcSource.indexOf('function balanceCacheKeyFromSnapshot'),
  );
  const readSnapshotSource = ipcSource.slice(
    ipcSource.indexOf('async function readSnapshot'),
    ipcSource.indexOf('async function snapshot'),
  );
  const watcherSource = ipcSource.slice(
    ipcSource.indexOf('function resetWatcher'),
    ipcSource.indexOf('function resetRefreshTimer'),
  );

  assert.match(ipcSource, /RELAY_UNCHANGED_CACHE_MS\s*=\s*BALANCE_CACHE_MS/);
  assert.match(canReuseSnapshotSource, /relayFileSignature\(\)/);
  assert.match(canReuseSnapshotSource, /currentSignature === lastRelayFileSignature/);
  assert.match(canReuseSnapshotSource, /reason !== 'interval'/);
  assert.match(canReuseSnapshotSource, /!canReuseBalance\(reason\)/);
  assert.match(readSnapshotSource, /lastRelayFileSignature\s*=\s*relayFileSignature\(\)/);
  assert.match(watcherSource, /chokidar\.watch\(relayWatchPaths\(\)/);
  assert.doesNotMatch(canReuseSnapshotSource, /'watch'/);
  assert.doesNotMatch(canReuseSnapshotSource, /'settings'/);
  assert.doesNotMatch(canReuseSnapshotSource, /'balance-refresh'/);
});

test('snapshot reads are serialized so critical refreshes cannot pile up', () => {
  const ipcSource = fs.readFileSync(path.join(root, 'src', 'main', 'ipc.js'), 'utf8');
  const queueSource = ipcSource.slice(
    ipcSource.indexOf('function queueSnapshotReason'),
    ipcSource.indexOf('async function pushSnapshot'),
  );

  assert.match(queueSource, /SNAPSHOT_CRITICAL_REASONS\.has\(reason\)/);
  assert.match(queueSource, /snapshotQueuedReason = reason/);
  assert.match(queueSource, /while \(!disposed && snapshotQueuedReason\)/);
  assert.match(queueSource, /const queuedReason = snapshotQueuedReason/);
  assert.match(queueSource, /snapshotQueuedReason = null/);
  assert.match(queueSource, /if \(snapshotInFlight\)/);
  assert.match(queueSource, /queueSnapshotReason\(reason\)/);
  assert.match(queueSource, /return snapshotInFlight/);
});

test('snapshot broadcasts are coalesced so repeated pushes do not spam renderer windows', () => {
  const ipcSource = fs.readFileSync(path.join(root, 'src', 'main', 'ipc.js'), 'utf8');
  const pushSource = ipcSource.slice(
    ipcSource.indexOf('function queueSnapshotPushReason'),
    ipcSource.indexOf('function scheduleSnapshot'),
  );

  assert.match(ipcSource, /let snapshotPushInFlight = null/);
  assert.match(ipcSource, /let snapshotPushQueuedReason = null/);
  assert.match(pushSource, /function queueSnapshotPushReason\(reason\)/);
  assert.match(pushSource, /SNAPSHOT_CRITICAL_REASONS\.has\(reason\)/);
  assert.match(pushSource, /async function flushSnapshotPush\(reason\)/);
  assert.match(pushSource, /sendSnapshotToWindows\(await snapshot\(currentReason\)\)/);
  assert.match(pushSource, /currentReason = snapshotPushQueuedReason/);
  assert.match(pushSource, /if \(snapshotPushInFlight\)/);
  assert.match(pushSource, /queueSnapshotPushReason\(reason\)/);
  assert.match(pushSource, /return snapshotPushInFlight/);
});

test('companion follow avoids redundant setBounds when already aligned', () => {
  const ipcSource = fs.readFileSync(path.join(root, 'src', 'main', 'ipc.js'), 'utf8');
  const syncSource = ipcSource.slice(
    ipcSource.indexOf('async function syncCompanionToCodex'),
    ipcSource.indexOf('function canReuseSnapshot'),
  );

  assert.match(syncSource, /const currentBounds = companion\.getBounds\(\);/);
  assert.match(syncSource, /Math\.abs\(currentBounds\.x - nextBounds\.x\) > 1/);
  assert.match(syncSource, /companion\.setBounds\(nextBounds,\s*false\)/);
});

test('companion visibility controls broadcast updated settings to every dashboard window', () => {
  const ipcSource = fs.readFileSync(path.join(root, 'src', 'main', 'ipc.js'), 'utf8');
  const showSource = ipcSource.slice(
    ipcSource.indexOf("registerSafeHandler('companion:show'"),
    ipcSource.indexOf("registerSafeHandler('companion:hide'"),
  );
  const hideSource = ipcSource.slice(
    ipcSource.indexOf("registerSafeHandler('companion:hide'"),
    ipcSource.indexOf("registerSafeHandler('companion:toggle'"),
  );
  const toggleSource = ipcSource.slice(
    ipcSource.indexOf("registerSafeHandler('companion:toggle'"),
    ipcSource.indexOf("registerSafeHandler('companion:getState'"),
  );
  const helperSource = ipcSource.slice(
    ipcSource.indexOf('function sendSettingsToDashboards'),
    ipcSource.indexOf('function sendErrorToWindows'),
  );

  assert.match(helperSource, /sendToWindow\(getMainWindow\(\),\s*'relay:settings',\s*settings\)/);
  assert.match(helperSource, /Object\.values\(getModuleWindows\(\)\)\.forEach/);
  assert.match(helperSource, /sendToWindow\(moduleWindow,\s*'relay:settings',\s*settings\)/);
  assert.match(showSource, /companionVisible: true/);
  assert.match(showSource, /sendSettingsToDashboards\(\)/);
  assert.match(hideSource, /companionVisible: false/);
  assert.match(hideSource, /sendSettingsToDashboards\(\)/);
  assert.match(toggleSource, /settings = normalizeSettings\(\{ \.\.\.settings, companionVisible: visible \}\)/);
  assert.match(toggleSource, /sendSettingsToDashboards\(\)/);
});

test('module window visibility broadcasts dock state back to the main dashboard', () => {
  const ipcSource = fs.readFileSync(path.join(root, 'src', 'main', 'ipc.js'), 'utf8');
  const helperSource = ipcSource.slice(
    ipcSource.indexOf('function getModuleWindowState'),
    ipcSource.indexOf('function sendErrorToWindows'),
  );
  const toggleSource = ipcSource.slice(
    ipcSource.indexOf("registerSafeHandler('module:toggle'"),
    ipcSource.indexOf("registerSafeHandler('module:close'"),
  );
  const closeSource = ipcSource.slice(
    ipcSource.indexOf("registerSafeHandler('module:close'"),
    ipcSource.indexOf("registerSafeHandler('module:getState'"),
  );

  assert.match(helperSource, /function getModuleWindowState\(\)/);
  assert.match(helperSource, /sendToWindow\(getMainWindow\(\),\s*'relay:modules',\s*getModuleWindowState\(\)\)/);
  assert.match(toggleSource, /sendModuleStateToDashboards\(\)/);
  assert.match(closeSource, /sendModuleStateToDashboards\(\)/);
  assert.match(ipcSource, /registerSafeHandler\('module:getState',\s*\(\)\s*=>\s*getModuleWindowState\(\)\)/);
});

test('registerIpc writes normalized settings back on startup to drop deprecated fields', () => {
  const ipcSource = fs.readFileSync(path.join(root, 'src', 'main', 'ipc.js'), 'utf8');
  const startupSource = ipcSource.slice(
    ipcSource.indexOf('function registerIpc'),
    ipcSource.indexOf('let watcher = null'),
  );

  assert.match(startupSource, /let settings = readSettings\(app\);/);
  assert.match(startupSource, /writeSettings\(app,\s*settings\);/);
});

test('ipc channel list includes every registered handler name', () => {
  assert.deepEqual(IPC_CHANNELS, [
    'relay:getSnapshot',
    'relay:refreshBalance',
    'relay:getSettings',
    'relay:updateSettings',
    'balance:openLogin',
    'balance:openExternalLogin',
    'balance:getLoginStatus',
    'balance:diagnose',
    'app:openUserData',
    'window:minimize',
    'window:hide',
    'window:close',
    'window:openMain',
    'companion:show',
    'companion:hide',
    'companion:toggle',
    'companion:getState',
    'companion:setBounds',
    'companion:setExpanded',
    'companion:setLocked',
    'companion:setFollowCodex',
    'module:toggle',
    'module:close',
    'module:getState',
  ]);
  assert.ok(DEFAULT_SETTINGS.ccswitchDbPath.endsWith('cc-switch.db'));
});

test('createCompanionSnapshot exposes safe companion fields only', () => {
  const snapshot = createCompanionSnapshot({
    provider: {
      name: 'waw relay',
      baseUrl: 'https://relay.example.cn/v1',
      apiKey: 'sk-raw-secret',
      key: 'sk-another-secret',
      cookie: 'SESSION=raw-cookie',
      model: 'provider-default',
      reasoningEffort: 'low',
    },
    balance: {
      amount: 128.46,
      status: 'ok',
      todaySpend: 3.82,
      source: 'web-session',
    },
    cache: { hitRate: 0.68 },
    recentRequests: [
      {
        requestModel: 'gpt-5.5',
        reasoningEffort: 'xhigh',
      },
    ],
    spend: { today: 3.82 },
    usage: { todayTokens: 168000, avgLatencyMs: 1680 },
  }, {});

  assert.equal(snapshot.compact.providerName, 'waw relay');
  assert.equal(snapshot.compact.todayTokens, 168000);
  assert.equal(snapshot.compact.todaySpend, 3.82);
  assert.equal(snapshot.details.model, 'gpt-5.5');
  assert.equal(snapshot.details.reasoningEffort, 'xhigh');
  assert.equal(snapshot.details.cacheHitRate, 0.68);
  assert.doesNotMatch(JSON.stringify(snapshot), /sk-raw-secret|sk-another-secret|SESSION=raw-cookie|apiKey|cookie/i);
});
