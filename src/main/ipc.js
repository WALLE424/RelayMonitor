'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ipcMain, nativeTheme, screen, shell } = require('electron');
const chokidar = require('chokidar');
const {
  fetchWithBalanceSession,
  getBalanceLoginStatus,
  openExternalBalancePage,
  openBalanceLogin,
  renderedTextWithBalanceSession,
  safeUrl,
} = require('./balance-login');
const {
  companionBoundsForCodex,
  readCodexWindowBounds,
} = require('./companion-tracker');

const DEFAULT_SETTINGS = {
  appearanceTheme: 'light',
  appearanceThemeUserSelected: false,
  windowOpacity: 1,
  panelOpacity: 0.8,
  glassOpacity: 0.8,
  glassBlur: 24,
  systemGlass: false,
  readabilityGuard: true,
  cacheHitAlert: true,
  cacheHitTarget: 60,
  contextWarning: true,
  contextWarningThreshold: 78,
  customRelayName: '',
  cacheStatsEnabled: true,
  refreshSeconds: 5,
  closeButtonBehavior: 'hide-to-tray',
  companionEnabled: true,
  companionVisible: true,
  companionExpanded: false,
  companionLocked: false,
  companionFollowCodex: true,
  mainWindowBounds: null,
  companionBounds: null,
  moduleWindowBounds: {},
  balanceAcquisitionMode: 'auto-api',
  balanceManualAmount: null,
  balancePageUrl: '',
  balanceSelector: '',
  balanceProviderProfiles: {},
  ccswitchDbPath: path.join(process.env.USERPROFILE || '', '.cc-switch', 'cc-switch.db'),
  ccswitchSettingsPath: path.join(process.env.USERPROFILE || '', '.cc-switch', 'settings.json'),
};

const RENDERER_SETTING_KEYS = new Set([
  'glassOpacity',
  'appearanceTheme',
  'windowOpacity',
  'panelOpacity',
  'glassBlur',
  'systemGlass',
  'readabilityGuard',
  'cacheHitAlert',
  'cacheHitTarget',
  'cacheStatsEnabled',
  'contextWarning',
  'contextWarningThreshold',
  'contextWarningPercent',
  'customRelayName',
  'refreshSeconds',
  'closeButtonBehavior',
  'companionVisible',
  'companionExpanded',
  'companionLocked',
  'companionFollowCodex',
  'mainWindowBounds',
  'companionBounds',
  'moduleWindowBounds',
  'balanceAcquisitionMode',
  'balanceManualAmount',
  'balancePageUrl',
  'balanceSelector',
  'balanceProviderProfiles',
]);

const IPC_CHANNELS = [
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
];

const IPC_CHANNEL_SET = new Set(IPC_CHANNELS);
const CLOSE_BUTTON_BEHAVIORS = new Set(['hide-to-tray', 'quit']);
const BALANCE_ACQUISITION_MODES = new Set(['auto-api', 'web-session', 'manual']);
const BALANCE_SETTING_KEYS = new Set([
  'balanceAcquisitionMode',
  'balanceManualAmount',
  'balancePageUrl',
  'balanceSelector',
]);
const MODULE_MIN_WIDTH = 380;
const MODULE_MIN_HEIGHT = 320;
const SNAPSHOT_CACHE_MS = 1200;
const BALANCE_CACHE_MS = 25 * 1000;
const RELAY_UNCHANGED_CACHE_MS = BALANCE_CACHE_MS;
const COMPANION_TRACK_ACTIVE_MS = 2000;
const COMPANION_TRACK_IDLE_MS = 5000;
const SNAPSHOT_CRITICAL_REASONS = new Set([
  'watch',
  'settings',
  'balance-refresh',
  'balance-page-sync',
  'balance-login',
  'balance-login-activity',
  'balance-login-closed',
]);

function loadSnapshotModule() {
  try {
    return require('../relay/snapshot');
  } catch (error) {
    return {
      getRelaySnapshot: async () => ({
        updatedAt: new Date().toISOString(),
        mode: 'unavailable',
        warning: `\u6570\u636e\u6a21\u5757\u6682\u65f6\u4e0d\u53ef\u7528\uff1a${error.message}`,
        provider: {
          appType: 'codex',
          providerId: '',
          name: '',
          baseUrl: '',
          maskedKey: '',
          model: '\u672a\u68c0\u6d4b\u5230',
          reasoningEffort: '\u672a\u8bb0\u5f55',
          wireApi: '',
        },
        balance: {
          status: 'unavailable',
          available: false,
          amount: null,
          currencySymbol: '\u00a5',
        },
        usage: {
          todayTokens: 0,
          weekTokens: 0,
          monthTokens: 0,
          avgLatencyMs: 0,
        },
        cache: {
          hitRate: 0,
          hitTokens: 0,
          missTokens: 0,
          writeTokens: 0,
        },
        context: {
          windowTokens: 0,
          usedTokens: 0,
          remainingTokens: 0,
          usedPercent: 0,
          estimate: '',
        },
        trend: [],
        recentRequests: [],
      }),
    };
  }
}

function settingsPath(app) {
  return path.join(app.getPath('userData'), 'settings.json');
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampRatio(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const ratio = number > 1 ? number / 100 : number;
  return Math.min(max, Math.max(min, ratio));
}

function normalizeTheme(value) {
  return value === 'dark' ? 'dark' : 'light';
}

function normalizeCloseButtonBehavior(value) {
  return CLOSE_BUTTON_BEHAVIORS.has(value) ? value : DEFAULT_SETTINGS.closeButtonBehavior;
}

function normalizeBalanceAcquisitionMode(value) {
  return BALANCE_ACQUISITION_MODES.has(value) ? value : DEFAULT_SETTINGS.balanceAcquisitionMode;
}

function normalizeOptionalAmount(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(1000000000, Math.max(0, number));
}

function normalizeBoolean(value, fallback) {
  if (value === true || value === false) return value;
  return fallback;
}

function normalizeCompanionBounds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const width = Number(value.width);
  const height = Number(value.height);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Number.isFinite(width) ? Math.min(380, Math.max(286, Math.round(width))) : 326,
    height: Number.isFinite(height) ? Math.min(168, Math.max(44, Math.round(height))) : 48,
  };
}

function normalizeMainWindowBounds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Number.isFinite(width) ? Math.min(720, Math.max(360, Math.round(width))) : 418,
    height: Number.isFinite(height) ? Math.min(920, Math.max(460, Math.round(height))) : 548,
  };
}

function normalizeModuleWindowBounds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const [id, bounds] of Object.entries(value)) {
    if (!bounds || typeof bounds !== 'object' || Array.isArray(bounds)) continue;
    const x = Number(bounds.x);
    const y = Number(bounds.y);
    const width = Number(bounds.width);
    const height = Number(bounds.height);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    output[id] = {
      x: Math.round(x),
      y: Math.round(y),
      width: Number.isFinite(width) ? Math.min(980, Math.max(MODULE_MIN_WIDTH, Math.round(width))) : undefined,
      height: Number.isFinite(height) ? Math.min(900, Math.max(MODULE_MIN_HEIGHT, Math.round(height))) : undefined,
    };
    if (output[id].width === undefined) delete output[id].width;
    if (output[id].height === undefined) delete output[id].height;
  }
  return output;
}

function normalizeUrlText(value) {
  return String(value || '').trim().slice(0, 500);
}

function normalizeSelectorText(value) {
  return String(value || '').trim().slice(0, 240);
}

function normalizeBalanceProviderProfiles(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const [rawKey, rawProfile] of Object.entries(value)) {
    const key = String(rawKey || '').trim().slice(0, 240);
    if (!key || !rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) continue;
    output[key] = {
      mode: normalizeBalanceAcquisitionMode(rawProfile.mode || rawProfile.balanceAcquisitionMode),
      pageUrl: normalizeUrlText(rawProfile.pageUrl || rawProfile.balancePageUrl),
      selector: normalizeSelectorText(rawProfile.selector || rawProfile.balanceSelector),
      manualAmount: normalizeOptionalAmount(rawProfile.manualAmount ?? rawProfile.balanceManualAmount),
      updatedAt: String(rawProfile.updatedAt || '').trim().slice(0, 80),
    };
  }
  return output;
}

function pickKnownSettings(settings) {
  const output = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    output[key] = settings[key];
  }
  output.contextWarningPercent = settings.contextWarningPercent;
  return output;
}

function normalizeSettings(input) {
  const merged = { ...DEFAULT_SETTINGS, ...(input && typeof input === 'object' ? input : {}) };
  if (input && Object.prototype.hasOwnProperty.call(input, 'contextWarningPercent')
    && !Object.prototype.hasOwnProperty.call(input, 'contextWarningThreshold')) {
    merged.contextWarningThreshold = input.contextWarningPercent;
  }
  if (merged.appearanceTheme === 'dark' && merged.appearanceThemeUserSelected !== true) {
    merged.appearanceTheme = 'light';
  }
  merged.appearanceTheme = normalizeTheme(merged.appearanceTheme);
  merged.appearanceThemeUserSelected = normalizeBoolean(
    merged.appearanceThemeUserSelected,
    DEFAULT_SETTINGS.appearanceThemeUserSelected,
  );
  merged.windowOpacity = clampRatio(merged.windowOpacity, DEFAULT_SETTINGS.windowOpacity, 0.65, 1);
  if (input && Object.prototype.hasOwnProperty.call(input, 'glassOpacity')
    && !Object.prototype.hasOwnProperty.call(input, 'panelOpacity')) {
    merged.panelOpacity = input.glassOpacity;
  }
  merged.panelOpacity = clampRatio(merged.panelOpacity, DEFAULT_SETTINGS.panelOpacity, 0.35, 0.92);
  merged.glassOpacity = merged.panelOpacity;
  merged.glassBlur = clampNumber(merged.glassBlur, DEFAULT_SETTINGS.glassBlur, 8, 36);
  merged.cacheHitTarget = clampNumber(merged.cacheHitTarget, DEFAULT_SETTINGS.cacheHitTarget, 0, 100);
  merged.contextWarningThreshold = clampNumber(
    merged.contextWarningThreshold,
    DEFAULT_SETTINGS.contextWarningThreshold,
    0,
    100,
  );
  merged.refreshSeconds = clampNumber(merged.refreshSeconds, DEFAULT_SETTINGS.refreshSeconds, 5, 3600);
  merged.systemGlass = merged.systemGlass !== false;
  merged.readabilityGuard = merged.readabilityGuard !== false;
  merged.cacheHitAlert = merged.cacheHitAlert !== false;
  merged.cacheStatsEnabled = merged.cacheStatsEnabled !== false;
  merged.contextWarning = merged.contextWarning !== false;
  merged.contextWarningPercent = merged.contextWarningThreshold;
  merged.customRelayName = String(merged.customRelayName || '').trim().slice(0, 40);
  merged.closeButtonBehavior = normalizeCloseButtonBehavior(merged.closeButtonBehavior);
  merged.companionEnabled = normalizeBoolean(merged.companionEnabled, DEFAULT_SETTINGS.companionEnabled);
  merged.companionVisible = normalizeBoolean(merged.companionVisible, DEFAULT_SETTINGS.companionVisible);
  merged.companionExpanded = normalizeBoolean(merged.companionExpanded, DEFAULT_SETTINGS.companionExpanded);
  merged.companionLocked = normalizeBoolean(merged.companionLocked, DEFAULT_SETTINGS.companionLocked);
  merged.companionFollowCodex = normalizeBoolean(merged.companionFollowCodex, DEFAULT_SETTINGS.companionFollowCodex);
  merged.mainWindowBounds = normalizeMainWindowBounds(merged.mainWindowBounds);
  merged.companionBounds = normalizeCompanionBounds(merged.companionBounds);
  merged.moduleWindowBounds = normalizeModuleWindowBounds(merged.moduleWindowBounds);
  merged.balanceAcquisitionMode = normalizeBalanceAcquisitionMode(merged.balanceAcquisitionMode);
  merged.balanceManualAmount = normalizeOptionalAmount(merged.balanceManualAmount);
  merged.balancePageUrl = normalizeUrlText(merged.balancePageUrl);
  merged.balanceSelector = normalizeSelectorText(merged.balanceSelector);
  merged.balanceProviderProfiles = normalizeBalanceProviderProfiles(merged.balanceProviderProfiles);
  return pickKnownSettings(merged);
}

function applyWindowAppearance(getMainWindow, settings) {
  const window = getMainWindow();
  if (window && !window.isDestroyed()) {
    window.setOpacity?.(settings.windowOpacity);
  }
  try {
    nativeTheme.themeSource = settings.appearanceTheme;
  } catch (_) {
    // Non-critical. The renderer owns the final color system.
  }
}

function sanitizeRendererSettingsPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return {};
  const safePatch = {};
  for (const [key, value] of Object.entries(patch)) {
    if (RENDERER_SETTING_KEYS.has(key)) {
      safePatch[key] = value;
    }
  }
  return safePatch;
}

function readSettings(app) {
  const file = settingsPath(app);
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (_) {
    return normalizeSettings();
  }
}

function writeSettings(app, next) {
  const file = settingsPath(app);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

function sendToRenderer(getMainWindow, channel, payload) {
  const window = getMainWindow();
  if (!window || window.isDestroyed()) return;
  window.webContents.send(channel, payload);
}

function sendToWindow(window, channel, payload) {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(channel, payload);
}

function registerSafeHandler(channel, listener) {
  if (!IPC_CHANNEL_SET.has(channel)) {
    throw new Error(`Refusing to register unknown IPC channel: ${channel}`);
  }
  ipcMain.handle(channel, listener);
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getPath(source, paths, fallback = undefined) {
  for (const pathExpression of paths) {
    const parts = Array.isArray(pathExpression) ? pathExpression : String(pathExpression).split('.');
    let value = source;
    for (const part of parts) {
      if (value == null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, part)) {
        value = undefined;
        break;
      }
      value = value[part];
    }
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function latestRequest(snapshot) {
  const requests = Array.isArray(snapshot?.recentRequests) ? snapshot.recentRequests : [];
  return requests.find((request) => request && typeof request === 'object') || {};
}

function createCompanionSnapshot(snapshot, settings = {}) {
  const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const provider = safeSnapshot.provider || {};
  const currentRelay = safeSnapshot.currentRelay || {};
  const request = latestRequest(safeSnapshot);
  const balance = safeSnapshot.balance || {};
  const usage = safeSnapshot.usage || {};
  const cache = safeSnapshot.cache || {};
  const spend = safeSnapshot.spend || {};
  const providerName = settings.customRelayName
    || currentRelay.name
    || provider.name
    || safeSnapshot.relayName
    || '中转站';
  const todayTokens = toNumber(getPath(safeSnapshot, [
    'tokens.daily',
    'usage.todayTokens',
    'periods.todayTokens',
  ], 0));
  const todaySpend = toNumber(getPath(safeSnapshot, [
    'spend.today',
    'periods.todayCost',
  ], 0));
  const balanceAmount = getPath(safeSnapshot, [
    'balance.amount',
    'balance.balance',
    'balance.remaining',
  ], null);
  const balanceStatus = balance.status || (balanceAmount == null ? 'unknown' : 'ok');

  return {
    updatedAt: safeSnapshot.generatedAt || safeSnapshot.updatedAt || new Date().toISOString(),
    reason: safeSnapshot.reason || '',
    provider: {
      name: String(providerName).slice(0, 40),
      baseUrl: String(currentRelay.endpoint || provider.baseUrl || safeSnapshot.endpoint || '').slice(0, 240),
    },
    compact: {
      providerName: String(providerName).slice(0, 40),
      todayTokens,
      todaySpend,
      balanceAmount: balanceAmount == null ? null : toNumber(balanceAmount),
      balanceStatus,
      currencySymbol: balance.currencySymbol || '\u00a5',
    },
    details: {
      model: String(request.requestModel || request.modelName || request.model || currentRelay.model || provider.model || '未知模型').slice(0, 80),
      reasoningEffort: String(request.reasoningEffort || currentRelay.reasoningEffort || provider.reasoningEffort || '默认').slice(0, 40),
      avgLatencyMs: toNumber(usage.avgLatencyMs || safeSnapshot.latency?.avg || safeSnapshot.latency?.average),
      cacheHitRate: toNumber(cache.hitRate ?? cache.rate ?? safeSnapshot.cacheHitRate),
      balanceStatus,
      balanceAmount: balanceAmount == null ? null : toNumber(balanceAmount),
      balanceSource: String(balance.source || '').slice(0, 80),
    },
  };
}

function balanceStatusAdvice(balance = {}, loginStatus = {}, settings = {}) {
  const mode = settings.balanceAcquisitionMode || 'auto-api';
  const status = String(balance.status || '').toLowerCase();
  if (mode === 'manual') return '当前是手动估算模式，请确认初始余额是否正确。';
  if (status === 'ok' || balance.amount != null) return '余额读取正常。';
  if (status === 'unlimited' || balance.quotaStatus === 'unlimited') return '已检测到当前 API Token 为不限额，但这不是站点账户余额；请使用网页登录读取账户数据里的真实余额。';
  if (mode === 'web-session' && !loginStatus.hasLoginState) return '未检测到网页登录状态，请在设置页重新登录余额页面。';
  if (/auth-required|unauthorized|forbidden|401|403/.test(status)) return '中转站仍要求登录，请重新登录余额页面后刷新。';
  if (/parse-error/.test(status)) return '已访问余额页面但未提取到金额，请填写更准确的余额 CSS 选择器。';
  if (/provider-mismatch/.test(status)) return '余额页地址和当前中转站不匹配，请检查余额页面地址。';
  if (/not-configured|unavailable|unknown|error/.test(status)) return '请检查余额获取方式、页面地址或中转站余额接口。';
  return '请刷新余额或查看余额详情中的状态。';
}

function balanceFailureKind(balance = {}, loginStatus = {}, settings = {}) {
  const mode = settings.balanceAcquisitionMode || 'auto-api';
  const status = String(balance.status || '').toLowerCase();
  if (mode === 'manual') return 'manual-estimate';
  if (status === 'ok' || balance.amount != null) return 'ok';
  if (status === 'unlimited' || balance.quotaStatus === 'unlimited') return 'login-required';
  if (status === 'provider-mismatch') return 'provider-mismatch';
  if (mode === 'web-session' && !loginStatus.hasLoginState) return 'login-required';
  if (/auth-required|unauthorized|forbidden|401|403/.test(status)) return 'login-required';
  if (/parse-error/.test(status)) return 'selector-needed';
  if (/rate-limited|429/.test(status)) return 'rate-limited';
  if (/not-configured|unavailable/.test(status)) return 'not-configured';
  if (/timeout/.test(status)) return 'network-timeout';
  if (/error|unknown/.test(status)) return 'read-error';
  return 'unknown';
}

function balanceNextStep(balance = {}, loginStatus = {}, settings = {}) {
  const kind = balanceFailureKind(balance, loginStatus, settings);
  if (kind === 'ok') return '余额已读取成功。';
  if (kind === 'manual-estimate') return '继续使用手动估算，或切换为网页登录后登录真实后台。';
  if (kind === 'provider-mismatch') return '点击“使用当前中转站地址并登录”，或把余额页面地址改成当前中转站后台。';
  if (kind === 'login-required') return '在内置登录窗口完成该中转站网页登录，然后回到设置页刷新余额。';
  if (kind === 'selector-needed') return '打开余额页面，复制余额数字所在元素的 CSS 选择器填入“余额提取规则”。';
  if (kind === 'rate-limited') return '中转站临时限流，稍后刷新；不要频繁重试。';
  if (kind === 'not-configured') return '配置余额页面地址，或改用自动接口/手动估算。';
  if (kind === 'network-timeout') return '检查中转站后台是否能打开，或稍后重试。';
  if (kind === 'read-error') return '检查页面地址、登录态和中转站后台是否返回可读余额。';
  return '查看余额详情状态，必要时为该中转站添加专门提取规则。';
}

function suggestedBalancePageUrl(provider = {}, snapshot = {}) {
  const source = safeUrl(provider.websiteUrl || provider.baseUrl || snapshot.endpoint || '');
  if (!source) return '';
  try {
    const parsed = new URL(source);
    return `${parsed.origin}/console`;
  } catch (_) {
    return '';
  }
}

function hostsLookRelated(left, right) {
  const a = String(left || '').toLowerCase();
  const b = String(right || '').toLowerCase();
  if (!a || !b) return true;
  if (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)) return true;
  return false;
}

function hostFromSafeUrl(value) {
  try {
    return new URL(safeUrl(value)).hostname.toLowerCase();
  } catch (_) {
    return '';
  }
}

function balancePageMatchesProvider(pageUrl, providerUrl) {
  return hostsLookRelated(hostFromSafeUrl(pageUrl), hostFromSafeUrl(providerUrl));
}

function resolveBalanceTargetUrl(settings = {}, snapshot = {}) {
  const provider = snapshot?.provider || {};
  const providerUrl = provider.websiteUrl
    || provider.baseUrl
    || snapshot.endpoint
    || '';
  const configuredUrl = safeUrl(settings.balancePageUrl);
  const suggestedUrl = suggestedBalancePageUrl(provider, snapshot);
  if (configuredUrl && balancePageMatchesProvider(configuredUrl, providerUrl)) return configuredUrl;
  return safeUrl(suggestedUrl, providerUrl);
}

function balanceProviderProfileKey(snapshot = {}) {
  const provider = snapshot?.provider || {};
  const id = String(provider.providerId || provider.id || '').trim();
  if (id) return `id:${id}`;
  const baseUrl = safeUrl(provider.baseUrl || snapshot.endpoint || '');
  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl);
      return `host:${parsed.hostname.toLowerCase()}`;
    } catch (_) {
      return `url:${baseUrl.slice(0, 180)}`;
    }
  }
  return '';
}

function applyBalanceProviderProfile(settings = {}, snapshot = {}) {
  const key = balanceProviderProfileKey(snapshot);
  const profile = key ? settings.balanceProviderProfiles?.[key] : null;
  if (!profile) return settings;
  return normalizeSettings({
    ...settings,
    balanceAcquisitionMode: profile.mode || settings.balanceAcquisitionMode,
    balanceManualAmount: profile.manualAmount ?? settings.balanceManualAmount,
    balancePageUrl: profile.pageUrl || settings.balancePageUrl,
    balanceSelector: profile.selector || settings.balanceSelector,
  });
}

function balanceSettingsSignature(settings = {}) {
  return JSON.stringify({
    mode: settings.balanceAcquisitionMode || 'auto-api',
    manualAmount: settings.balanceManualAmount ?? null,
    pageUrl: settings.balancePageUrl || '',
    selector: settings.balanceSelector || '',
  });
}

function hasBalanceSettingsPatch(patch = {}) {
  return Object.keys(patch || {}).some((key) => BALANCE_SETTING_KEYS.has(key));
}

function rememberBalanceProviderProfile(settings = {}, snapshot = {}) {
  const key = balanceProviderProfileKey(snapshot);
  if (!key) return normalizeSettings(settings);
  const profile = {
    mode: settings.balanceAcquisitionMode || 'auto-api',
    pageUrl: settings.balancePageUrl || '',
    selector: settings.balanceSelector || '',
    manualAmount: settings.balanceManualAmount ?? null,
    updatedAt: new Date().toISOString(),
  };
  return normalizeSettings({
    ...settings,
    balanceProviderProfiles: {
      ...(settings.balanceProviderProfiles || {}),
      [key]: profile,
    },
  });
}

function createBalanceDiagnostic(snapshot = {}, settings = {}, loginStatus = {}) {
  const balance = snapshot.balance || {};
  const provider = snapshot.provider || {};
  const providerUrl = provider.websiteUrl || provider.baseUrl || snapshot.endpoint || '';
  const targetUrl = safeUrl(settings.balancePageUrl, provider.websiteUrl || provider.baseUrl || snapshot.endpoint || '');
  const suggestedUrl = suggestedBalancePageUrl(provider, snapshot);
  const effectiveLoginUrl = targetUrl && balancePageMatchesProvider(targetUrl, providerUrl)
    ? targetUrl
    : safeUrl(suggestedUrl, providerUrl);
  const amount = balance.amount == null ? null : toNumber(balance.amount);
  return {
    mode: settings.balanceAcquisitionMode || 'auto-api',
    providerName: String(provider.name || snapshot.currentRelay?.name || '').slice(0, 80),
    providerHost: String(provider.baseUrl || snapshot.endpoint || '').slice(0, 240),
    targetHost: (() => {
      try {
        const parsed = new URL(targetUrl);
        return parsed.hostname + parsed.pathname;
      } catch (_) {
        return '';
      }
    })(),
    suggestedBalancePageUrl: suggestedUrl.slice(0, 500),
    suggestedBalancePageHost: (() => {
      try {
        const parsed = new URL(suggestedUrl);
        return parsed.hostname + parsed.pathname;
      } catch (_) {
        return '';
      }
    })(),
    effectiveLoginUrl: effectiveLoginUrl.slice(0, 500),
    effectiveLoginHost: (() => {
      try {
        const parsed = new URL(effectiveLoginUrl);
        return parsed.hostname + parsed.pathname;
      } catch (_) {
        return '';
      }
    })(),
    balanceStatus: String(balance.status || 'unknown').slice(0, 48),
    balanceSource: String(balance.source || '').slice(0, 80),
    amount,
    httpStatus: balance.httpStatus || null,
    sourceField: String(balance.sourceField || '').slice(0, 120),
    quotaStatus: String(balance.quotaStatus || '').slice(0, 48),
    quotaEndpoint: String(balance.quotaEndpoint || '').slice(0, 240),
    quotaSourceField: String(balance.quotaSourceField || '').slice(0, 120),
    hasLoginState: Boolean(loginStatus.hasLoginState),
    hasCookies: Boolean(loginStatus.hasCookies),
    hasAuthToken: Boolean(loginStatus.hasAuthToken),
    hasAuthUserId: Boolean(loginStatus.hasAuthUserId),
    loginStatus: String(loginStatus.status || '').slice(0, 48),
    loginOrigin: String(loginStatus.origin || '').slice(0, 220),
    updatedAt: new Date().toISOString(),
    failureKind: balanceFailureKind(balance, loginStatus, settings),
    nextStep: balanceNextStep(balance, loginStatus, settings),
    advice: balanceStatusAdvice(balance, loginStatus, settings),
  };
}

function registerIpc({
  app,
  getMainWindow,
  getCompanionWindow = () => null,
  getModuleWindow = () => null,
  getModuleWindows = () => ({}),
  toggleModuleWindow = () => ({}),
  closeModuleWindow = () => false,
  showCompanionWindow = () => null,
  hideCompanionWindow = () => null,
  restoreMainWindow = () => null,
}) {
  let settings = readSettings(app);
  writeSettings(app, settings);
  let watcher = null;
  let refreshTimer = null;
  let watchDebounce = null;
  let companionTrackTimer = null;
  let companionTrackIntervalMs = 0;
  let companionTrackBusy = false;
  let companionDraggingUntil = 0;
  let companionLastCodexBounds = null;
  let companionIdleTicks = 0;
  let disposed = false;
  let lastSnapshot = null;
  let lastSnapshotAt = 0;
  let lastRelayFileSignature = '';
  let lastBalance = null;
  let lastBalanceAt = 0;
  let lastBalanceProviderKey = '';
  let snapshotInFlight = null;
  let snapshotQueuedReason = null;
  let snapshotPushInFlight = null;
  let snapshotPushQueuedReason = null;
  const snapshotModule = loadSnapshotModule();
  applyWindowAppearance(getMainWindow, settings);

  function effectiveBalanceSettings(snapshot = lastSnapshot || {}) {
    return applyBalanceProviderProfile(settings, snapshot || {});
  }

  function balanceTargetUrl() {
    return resolveBalanceTargetUrl(effectiveBalanceSettings(lastSnapshot || {}), lastSnapshot || {});
  }

  function webSessionFetch(url, options) {
    return fetchWithBalanceSession(url, options);
  }

  function webSessionRenderedText(url, options) {
    return renderedTextWithBalanceSession(url, options);
  }

  function sendSnapshotToWindows(payload) {
    sendToWindow(getMainWindow(), 'relay:snapshot', payload);
    sendToWindow(getCompanionWindow(), 'relay:snapshot', createCompanionSnapshot(payload, settings));
    Object.values(getModuleWindows()).forEach((moduleWindow) => {
      sendToWindow(moduleWindow, 'relay:snapshot', payload);
    });
  }

  function sendSettingsToDashboards() {
    sendToWindow(getMainWindow(), 'relay:settings', settings);
    Object.values(getModuleWindows()).forEach((moduleWindow) => {
      sendToWindow(moduleWindow, 'relay:settings', settings);
    });
  }

  function getModuleWindowState() {
    return Object.fromEntries(Object.entries(getModuleWindows()).map(([id, moduleWindow]) => [
      id,
      Boolean(moduleWindow && !moduleWindow.isDestroyed() && moduleWindow.isVisible()),
    ]));
  }

  function sendModuleStateToDashboards() {
    sendToWindow(getMainWindow(), 'relay:modules', getModuleWindowState());
  }

  function sendErrorToWindows(payload) {
    sendToWindow(getMainWindow(), 'relay:error', payload);
    sendToWindow(getCompanionWindow(), 'relay:error', {
      message: payload?.message || '悬浮条刷新失败',
      reason: payload?.reason || 'unknown',
    });
    Object.values(getModuleWindows()).forEach((moduleWindow) => {
      sendToWindow(moduleWindow, 'relay:error', payload);
    });
  }

  function applyCompanionVisibility() {
    const companion = getCompanionWindow();
    if (!companion || companion.isDestroyed()) return;
    if (settings.companionEnabled && settings.companionVisible) {
      companion.showInactive?.();
      companion.setAlwaysOnTop(true, 'floating');
      return;
    }
    companion.hide();
  }

  function saveSettings() {
    writeSettings(app, settings);
  }

  function syncBalancePageToCurrentProvider(currentSnapshot = lastSnapshot) {
    const currentSettings = effectiveBalanceSettings(currentSnapshot || {});
    if ((currentSettings.balanceAcquisitionMode || 'auto-api') !== 'web-session') return '';
    const targetUrl = resolveBalanceTargetUrl(currentSettings, currentSnapshot || {});
    if (!targetUrl || targetUrl === currentSettings.balancePageUrl) {
      const rememberedSettings = rememberBalanceProviderProfile(currentSettings, currentSnapshot || {});
      if (JSON.stringify(rememberedSettings.balanceProviderProfiles || {}) !== JSON.stringify(settings.balanceProviderProfiles || {})) {
        settings = normalizeSettings({
          ...settings,
          balanceAcquisitionMode: currentSettings.balanceAcquisitionMode,
          balanceManualAmount: currentSettings.balanceManualAmount,
          balancePageUrl: currentSettings.balancePageUrl,
          balanceSelector: currentSettings.balanceSelector,
          balanceProviderProfiles: rememberedSettings.balanceProviderProfiles,
        });
        saveSettings();
        sendSettingsToDashboards();
        sendToWindow(getCompanionWindow(), 'relay:settings', settings);
      }
      return targetUrl;
    }
    settings = rememberBalanceProviderProfile({
      ...settings,
      balanceAcquisitionMode: currentSettings.balanceAcquisitionMode,
      balanceManualAmount: currentSettings.balanceManualAmount,
      balancePageUrl: targetUrl,
      balanceSelector: currentSettings.balanceSelector,
    }, currentSnapshot || {});
    lastBalance = null;
    lastBalanceAt = 0;
    lastBalanceProviderKey = '';
    saveSettings();
    sendSettingsToDashboards();
    sendToWindow(getCompanionWindow(), 'relay:settings', settings);
    return settings.balancePageUrl;
  }

  function updateCompanionBounds(bounds, options = {}) {
    const companion = getCompanionWindow();
    const normalized = normalizeCompanionBounds(bounds);
    if (!companion || companion.isDestroyed() || !normalized) return settings.companionBounds;
    companion.setBounds(normalized, false);
    if (options.persist === false) return normalized;
    settings = normalizeSettings({ ...settings, companionBounds: normalized });
    saveSettings();
    sendToWindow(companion, 'relay:settings', settings);
    return settings.companionBounds;
  }

  function updateMainWindowBounds(bounds) {
    const normalized = normalizeMainWindowBounds(bounds);
    if (!normalized) return settings.mainWindowBounds;
    settings = normalizeSettings({ ...settings, mainWindowBounds: normalized });
    saveSettings();
    return settings.mainWindowBounds;
  }

  function updateModuleWindowBounds(moduleId, bounds) {
    const normalizedMap = normalizeModuleWindowBounds({ [moduleId]: bounds });
    const normalized = normalizedMap[moduleId];
    if (!normalized) return settings.moduleWindowBounds?.[moduleId] || null;
    settings = normalizeSettings({
      ...settings,
      moduleWindowBounds: {
        ...settings.moduleWindowBounds,
        [moduleId]: normalized,
      },
    });
    saveSettings();
    return settings.moduleWindowBounds[moduleId];
  }

  async function syncCompanionToCodex() {
    if (disposed || companionTrackBusy || Date.now() < companionDraggingUntil || settings.companionLocked || !settings.companionFollowCodex || !settings.companionVisible) return;
    const companion = getCompanionWindow();
    if (!companion || companion.isDestroyed() || !companion.isVisible()) return;
    companionTrackBusy = true;
    try {
      const codexBounds = await readCodexWindowBounds();
      if (!codexBounds.found) return;
      const codexSignature = `${codexBounds.x}:${codexBounds.y}:${codexBounds.width}:${codexBounds.height}`;
      if (codexSignature === companionLastCodexBounds) {
        companionIdleTicks += 1;
      } else {
        companionIdleTicks = 0;
        companionLastCodexBounds = codexSignature;
      }
      const display = screen.getDisplayMatching({
        x: codexBounds.x,
        y: codexBounds.y,
        width: Math.max(1, codexBounds.width),
        height: Math.max(1, codexBounds.height),
      });
      const nextBounds = companionBoundsForCodex(codexBounds, companion.getBounds(), display.workArea);
      const currentBounds = companion.getBounds();
      if (Math.abs(currentBounds.x - nextBounds.x) > 1
        || Math.abs(currentBounds.y - nextBounds.y) > 1
        || Math.abs(currentBounds.width - nextBounds.width) > 1
        || Math.abs(currentBounds.height - nextBounds.height) > 1) {
        companion.setBounds(nextBounds, false);
      }
    } finally {
      companionTrackBusy = false;
    }
  }

  function canReuseSnapshot(reason) {
    if (!['ipc', 'interval'].includes(reason) || !lastSnapshot) return false;
    const ageMs = Date.now() - lastSnapshotAt;
    if (ageMs < SNAPSHOT_CACHE_MS) return true;
    if (reason !== 'interval' || ageMs >= RELAY_UNCHANGED_CACHE_MS || !canReuseBalance(reason)) return false;
    const currentSignature = relayFileSignature();
    return Boolean(lastRelayFileSignature && currentSignature === lastRelayFileSignature);
  }

  function relayWatchPaths() {
    return [
      settings.ccswitchSettingsPath,
      settings.ccswitchDbPath,
    ].filter(Boolean);
  }

  function fileSignature(filePath) {
    try {
      const stat = fs.statSync(filePath);
      return `${filePath}:${Math.round(stat.mtimeMs)}:${stat.size}`;
    } catch (_) {
      return `${filePath}:missing`;
    }
  }

  function relayFileSignature() {
    return relayWatchPaths().map(fileSignature).join('|');
  }

  function balanceCacheKeyFromSnapshot(snapshot, currentSettings = effectiveBalanceSettings(snapshot || {})) {
    const provider = snapshot?.provider || {};
    return [
      provider.providerId || provider.id || '',
      provider.baseUrl || '',
      provider.balanceEndpoint || '',
      currentSettings.balanceAcquisitionMode || '',
      currentSettings.balancePageUrl || '',
      currentSettings.balanceSelector || '',
    ].join('|');
  }

  function canReuseBalance(reason, currentSettings = effectiveBalanceSettings(lastSnapshot || {})) {
    return !['watch', 'balance-refresh', 'balance-login', 'balance-login-activity', 'balance-login-closed', 'settings'].includes(reason)
      && lastBalance
      && lastSnapshot
      && lastBalanceProviderKey
      && lastBalanceProviderKey === balanceCacheKeyFromSnapshot(lastSnapshot, currentSettings)
      && Date.now() - lastBalanceAt < BALANCE_CACHE_MS;
  }

  async function readSnapshot(reason = 'manual') {
    const readSnapshot = snapshotModule.getRelaySnapshot || snapshotModule.buildSnapshot;
    const settingsForSnapshot = effectiveBalanceSettings(lastSnapshot || {});
    const balanceOverride = canReuseBalance(reason, settingsForSnapshot) ? lastBalance : undefined;
    const result = await readSnapshot({
      balance: balanceOverride,
      settings: settingsForSnapshot,
      relayOptions: { dbPath: settingsForSnapshot.ccswitchDbPath },
      balanceOptions: {
        enabled: settingsForSnapshot.balanceAcquisitionMode === 'auto-api',
        manualAmount: settingsForSnapshot.balanceManualAmount,
        mode: settingsForSnapshot.balanceAcquisitionMode,
        pageUrl: settingsForSnapshot.balancePageUrl,
        selector: settingsForSnapshot.balanceSelector,
        providerApiFallback: settingsForSnapshot.balanceAcquisitionMode === 'web-session',
        fetch: settingsForSnapshot.balanceAcquisitionMode === 'web-session' ? webSessionFetch : undefined,
        renderText: settingsForSnapshot.balanceAcquisitionMode === 'web-session' ? webSessionRenderedText : undefined,
        renderTimeoutMs: 6500,
        renderSettleMs: 1200,
        timeoutMs: 2500,
      },
      usageSummaryOptions: {
        enabled: settingsForSnapshot.balanceAcquisitionMode !== 'manual',
        pageUrl: settingsForSnapshot.balancePageUrl,
        selector: settingsForSnapshot.balanceSelector,
        fetch: settingsForSnapshot.balanceAcquisitionMode === 'web-session' ? webSessionFetch : undefined,
        renderText: settingsForSnapshot.balanceAcquisitionMode === 'web-session' ? webSessionRenderedText : undefined,
        skipOfficial: settingsForSnapshot.balanceAcquisitionMode === 'web-session',
        renderTimeoutMs: 6500,
        renderSettleMs: 1200,
        timeoutMs: 1200,
      },
    });
    lastSnapshot = { ...result, reason };
    lastSnapshotAt = Date.now();
    lastRelayFileSignature = relayFileSignature();
    const profiledSettings = applyBalanceProviderProfile(settings, lastSnapshot);
    if (balanceSettingsSignature(profiledSettings) !== balanceSettingsSignature(settingsForSnapshot)
      && reason !== 'balance-profile-sync') {
      settings = profiledSettings;
      lastBalance = null;
      lastBalanceAt = 0;
      lastBalanceProviderKey = '';
      saveSettings();
      sendSettingsToDashboards();
      sendToWindow(getCompanionWindow(), 'relay:settings', settings);
      return readSnapshot('balance-profile-sync');
    }
    const previousBalancePageUrl = settings.balancePageUrl;
    const syncedBalancePageUrl = syncBalancePageToCurrentProvider(lastSnapshot);
    if (syncedBalancePageUrl && syncedBalancePageUrl !== previousBalancePageUrl && reason !== 'balance-page-sync') {
      return readSnapshot('balance-page-sync');
    }
    if (result?.balance) {
      lastBalanceProviderKey = balanceCacheKeyFromSnapshot(result, effectiveBalanceSettings(lastSnapshot));
      lastBalance = { ...result.balance, __cacheProviderKey: lastBalanceProviderKey };
      lastBalanceAt = lastSnapshotAt;
    }
    return lastSnapshot;
  }

  function queueSnapshotReason(reason) {
    if (!snapshotQueuedReason || SNAPSHOT_CRITICAL_REASONS.has(reason)) {
      snapshotQueuedReason = reason;
    }
  }

  function queueSnapshotPushReason(reason) {
    if (!snapshotPushQueuedReason || SNAPSHOT_CRITICAL_REASONS.has(reason)) {
      snapshotPushQueuedReason = reason;
    }
  }

  async function drainSnapshotQueue(reason = 'manual') {
    let result = await readSnapshot(reason);
    while (!disposed && snapshotQueuedReason) {
      const queuedReason = snapshotQueuedReason;
      snapshotQueuedReason = null;
      result = canReuseSnapshot(queuedReason) ? lastSnapshot : await readSnapshot(queuedReason);
    }
    return result;
  }

  async function snapshot(reason = 'manual') {
    if (canReuseSnapshot(reason)) return lastSnapshot;
    if (snapshotInFlight) {
      queueSnapshotReason(reason);
      return snapshotInFlight;
    }
    snapshotInFlight = drainSnapshotQueue(reason).finally(() => {
      snapshotInFlight = null;
    });
    return snapshotInFlight;
  }

  async function flushSnapshotPush(reason) {
    let currentReason = reason;
    while (!disposed && currentReason) {
      try {
        sendSnapshotToWindows(await snapshot(currentReason));
      } catch (error) {
        sendErrorToWindows({ message: error.message, reason: currentReason });
      }
      currentReason = snapshotPushQueuedReason;
      snapshotPushQueuedReason = null;
    }
  }

  function pushSnapshot(reason) {
    if (snapshotPushInFlight) {
      queueSnapshotPushReason(reason);
      return snapshotPushInFlight;
    }
    snapshotPushInFlight = flushSnapshotPush(reason).finally(() => {
      snapshotPushInFlight = null;
    });
    return snapshotPushInFlight;
  }

  function scheduleSnapshot(reason) {
    if (disposed) return;
    clearTimeout(watchDebounce);
    watchDebounce = setTimeout(() => {
      watchDebounce = null;
      void pushSnapshot(reason);
    }, 250);
    watchDebounce.unref?.();
  }

  function resetWatcher() {
    watcher?.close().catch?.(() => {});
    watcher = chokidar.watch(relayWatchPaths(), {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 600, pollInterval: 150 },
      depth: 5,
      persistent: true,
    });
    watcher.on('all', () => {
      scheduleSnapshot('watch');
    });
    watcher.on('error', (error) => {
      sendErrorToWindows({ message: error.message, reason: 'watch' });
    });
  }

  function resetRefreshTimer() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      void pushSnapshot('interval');
    }, settings.refreshSeconds * 1000);
    refreshTimer.unref?.();
  }

  function resetCompanionTracker() {
    clearInterval(companionTrackTimer);
    companionTrackTimer = null;
    companionTrackIntervalMs = 0;
    companionIdleTicks = 0;
    companionLastCodexBounds = null;
    if (!settings.companionFollowCodex) return;
    startCompanionTrackerInterval(COMPANION_TRACK_ACTIVE_MS);
    void syncCompanionToCodex();
  }

  function startCompanionTrackerInterval(intervalMs) {
    clearInterval(companionTrackTimer);
    companionTrackIntervalMs = intervalMs;
    companionTrackTimer = setInterval(() => {
      void syncCompanionToCodex();
      if (companionIdleTicks >= 3 && companionTrackIntervalMs !== COMPANION_TRACK_IDLE_MS) {
        startCompanionTrackerInterval(COMPANION_TRACK_IDLE_MS);
      } else if (companionIdleTicks < 3 && companionTrackIntervalMs !== COMPANION_TRACK_ACTIVE_MS) {
        startCompanionTrackerInterval(COMPANION_TRACK_ACTIVE_MS);
      }
    }, intervalMs);
    companionTrackTimer.unref?.();
  }

  function dispose() {
    disposed = true;
    clearTimeout(watchDebounce);
    clearInterval(refreshTimer);
    clearInterval(companionTrackTimer);
    watcher?.close().catch?.(() => {});
    watcher = null;
    for (const channel of IPC_CHANNELS) {
      ipcMain.removeHandler(channel);
    }
  }

  registerSafeHandler('relay:getSnapshot', async (event) => {
    const result = await snapshot('ipc');
    const companion = getCompanionWindow();
    if (companion && !companion.isDestroyed() && event.sender.id === companion.webContents.id) {
      return createCompanionSnapshot(result, settings);
    }
    return result;
  });
  registerSafeHandler('relay:refreshBalance', async (event) => {
    const result = await snapshot('balance-refresh');
    const companion = getCompanionWindow();
    if (companion && !companion.isDestroyed() && event.sender.id === companion.webContents.id) {
      return createCompanionSnapshot(result, settings);
    }
    return result;
  });
  registerSafeHandler('relay:getSettings', () => settings);
  registerSafeHandler('balance:getLoginStatus', async () => getBalanceLoginStatus(balanceTargetUrl()));
  registerSafeHandler('balance:diagnose', async () => {
    const currentSnapshot = await snapshot('balance-refresh');
    const currentSettings = effectiveBalanceSettings(currentSnapshot);
    const loginStatus = await getBalanceLoginStatus(resolveBalanceTargetUrl(currentSettings, currentSnapshot));
    return createBalanceDiagnostic(currentSnapshot, currentSettings, loginStatus);
  });
  registerSafeHandler('balance:openLogin', async () => {
    const refreshAfterBalanceLogin = (reason) => {
      lastBalance = null;
      lastBalanceAt = 0;
      void pushSnapshot(reason);
    };
    const currentSnapshot = await snapshot('balance-refresh');
    syncBalancePageToCurrentProvider(currentSnapshot);
    const status = await openBalanceLogin({
      getMainWindow,
      targetUrl: balanceTargetUrl(),
      onActivity: () => refreshAfterBalanceLogin('balance-login-activity'),
      onClosed: () => refreshAfterBalanceLogin('balance-login-closed'),
    });
    void pushSnapshot('balance-login');
    return status;
  });
  registerSafeHandler('balance:openExternalLogin', async () => {
    const currentSnapshot = await snapshot('balance-refresh');
    syncBalancePageToCurrentProvider(currentSnapshot);
    return openExternalBalancePage(balanceTargetUrl());
  });
  registerSafeHandler('relay:updateSettings', (_event, patch) => {
    const safePatch = sanitizeRendererSettingsPatch(patch);
    if (Object.prototype.hasOwnProperty.call(safePatch, 'appearanceTheme')) {
      safePatch.appearanceThemeUserSelected = true;
    }
    settings = normalizeSettings({ ...settings, ...safePatch });
    if (hasBalanceSettingsPatch(safePatch)) {
      settings = rememberBalanceProviderProfile(settings, lastSnapshot || {});
      lastBalance = null;
      lastBalanceAt = 0;
      lastBalanceProviderKey = '';
    }
    writeSettings(app, settings);
    applyWindowAppearance(getMainWindow, settings);
    applyCompanionVisibility();
    resetWatcher();
    resetRefreshTimer();
    resetCompanionTracker();
    sendToRenderer(getMainWindow, 'relay:settings', settings);
    sendToWindow(getCompanionWindow(), 'relay:settings', settings);
    Object.values(getModuleWindows()).forEach((moduleWindow) => {
      sendToWindow(moduleWindow, 'relay:settings', settings);
    });
    void pushSnapshot('settings');
    return settings;
  });
  registerSafeHandler('app:openUserData', () => shell.openPath(app.getPath('userData')));
  registerSafeHandler('window:minimize', () => getMainWindow()?.minimize());
  registerSafeHandler('window:hide', () => getMainWindow()?.hide());
  registerSafeHandler('window:close', () => {
    const window = getMainWindow();
    if (!window) return false;
    if (settings.closeButtonBehavior === 'quit') {
      window.forceClose = true;
      app.quit();
      return true;
    }
    window.hide();
    return true;
  });
  registerSafeHandler('window:openMain', () => {
    restoreMainWindow();
    return true;
  });
  registerSafeHandler('companion:show', () => {
    settings = normalizeSettings({ ...settings, companionVisible: true });
    saveSettings();
    showCompanionWindow();
    resetCompanionTracker();
    sendToWindow(getCompanionWindow(), 'relay:settings', settings);
    sendSettingsToDashboards();
    void pushSnapshot('companion-show');
    return getCompanionState();
  });
  registerSafeHandler('companion:hide', () => {
    settings = normalizeSettings({ ...settings, companionVisible: false });
    saveSettings();
    hideCompanionWindow();
    sendSettingsToDashboards();
    return getCompanionState();
  });
  registerSafeHandler('companion:toggle', () => {
    const companion = getCompanionWindow();
    const visible = !(companion && !companion.isDestroyed() && companion.isVisible());
    settings = normalizeSettings({ ...settings, companionVisible: visible });
    saveSettings();
    if (visible) {
      showCompanionWindow();
      resetCompanionTracker();
      void pushSnapshot('companion-toggle');
    } else {
      hideCompanionWindow();
    }
    sendSettingsToDashboards();
    return getCompanionState();
  });
  registerSafeHandler('companion:getState', () => getCompanionState());
  registerSafeHandler('companion:setBounds', (_event, bounds, options = {}) => {
    if (settings.companionLocked) return getCompanionState();
    const normalized = updateCompanionBounds(bounds, options);
    if (options.persist !== false) {
      settings = normalizeSettings({
        ...settings,
        companionFollowCodex: false,
        companionBounds: normalized,
      });
      resetCompanionTracker();
    } else {
      companionDraggingUntil = Date.now() + 1800;
    }
    return getCompanionState();
  });
  registerSafeHandler('companion:setExpanded', (_event, expanded) => {
    const companion = getCompanionWindow();
    settings = normalizeSettings({ ...settings, companionExpanded: Boolean(expanded) });
    saveSettings();
    if (companion && !companion.isDestroyed()) {
      const bounds = companion.getBounds();
      companion.setBounds({ ...bounds, height: settings.companionExpanded ? 164 : 48 }, false);
      sendToWindow(companion, 'relay:settings', settings);
    }
    return getCompanionState();
  });
  registerSafeHandler('companion:setLocked', (_event, locked) => {
    settings = normalizeSettings({ ...settings, companionLocked: Boolean(locked) });
    saveSettings();
    sendToWindow(getCompanionWindow(), 'relay:settings', settings);
    return getCompanionState();
  });
  registerSafeHandler('companion:setFollowCodex', (_event, enabled) => {
    settings = normalizeSettings({ ...settings, companionFollowCodex: Boolean(enabled) });
    saveSettings();
    resetCompanionTracker();
    sendToWindow(getCompanionWindow(), 'relay:settings', settings);
    return getCompanionState();
  });
  registerSafeHandler('module:toggle', (_event, moduleId) => {
    const result = toggleModuleWindow(moduleId, settings.moduleWindowBounds?.[moduleId] || null);
    if (result?.bounds) {
      settings = normalizeSettings({
        ...settings,
        moduleWindowBounds: {
          ...settings.moduleWindowBounds,
          [moduleId]: result.bounds,
        },
      });
      saveSettings();
    }
    const moduleWindow = getModuleWindow(moduleId);
    if (moduleWindow && !moduleWindow.isDestroyed()) {
      sendToWindow(moduleWindow, 'relay:settings', settings);
      if (lastSnapshot) {
        sendToWindow(moduleWindow, 'relay:snapshot', lastSnapshot);
      }
    }
    sendModuleStateToDashboards();
    return result;
  });
  registerSafeHandler('module:close', (_event, moduleId) => {
    const moduleWindow = getModuleWindow(moduleId);
    if (moduleWindow && !moduleWindow.isDestroyed()) {
      settings = normalizeSettings({
        ...settings,
        moduleWindowBounds: {
          ...settings.moduleWindowBounds,
          [moduleId]: moduleWindow.getBounds(),
        },
      });
      saveSettings();
    }
    const closed = closeModuleWindow(moduleId);
    sendModuleStateToDashboards();
    return closed;
  });
  registerSafeHandler('module:getState', () => getModuleWindowState());

  function getCompanionState() {
    const companion = getCompanionWindow();
    const bounds = companion && !companion.isDestroyed() ? companion.getBounds() : settings.companionBounds;
    return {
      visible: Boolean(companion && !companion.isDestroyed() && companion.isVisible()),
      expanded: settings.companionExpanded,
      locked: settings.companionLocked,
      followCodex: settings.companionFollowCodex,
      bounds,
    };
  }

  resetWatcher();
  resetRefreshTimer();
  applyCompanionVisibility();
  resetCompanionTracker();
  void pushSnapshot('boot');

  return {
    dispose,
    getLastSnapshot: () => lastSnapshot,
    getSettings: () => settings,
    updateMainWindowBounds,
    updateModuleWindowBounds,
  };
}

module.exports = {
  applyBalanceProviderProfile,
  balanceProviderProfileKey,
  createCompanionSnapshot,
  DEFAULT_SETTINGS,
  IPC_CHANNELS,
  createBalanceDiagnostic,
  normalizeSettings,
  rememberBalanceProviderProfile,
  resolveBalanceTargetUrl,
  registerIpc,
  sanitizeRendererSettingsPatch,
};
