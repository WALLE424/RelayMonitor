'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  applyBalanceProviderProfile,
  createCompanionSnapshot,
  resolveBalanceTargetUrl,
} = require('../src/main/ipc');
const { getRelaySnapshot } = require('../src/relay/snapshot');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return {};
  }
}

function defaultSettingsPath() {
  return path.join(process.env.APPDATA || '', '\u4e2d\u8f6c\u7ad9\u76d1\u63a7', 'settings.json');
}

function fallbackSettingsPaths() {
  const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  return [
    defaultSettingsPath(),
    path.join(appData, 'relay-monitor', 'settings.json'),
    path.join(appData, 'RelayMonitor', 'settings.json'),
  ];
}

function readBestSettings() {
  for (const file of fallbackSettingsPaths()) {
    const data = readJson(file);
    if (data && Object.keys(data).length > 0) return { path: file, settings: data };
  }
  return { path: defaultSettingsPath(), settings: {} };
}

function defaultCcswitchDbPath(settings) {
  return settings.ccswitchDbPath || path.join(process.env.USERPROFILE || '', '.cc-switch', 'cc-switch.db');
}

function trendLooksFlat(points) {
  const values = (Array.isArray(points) ? points : []).map((point) => Number(point && point.value) || 0);
  if (values.length < 2) return true;
  return values.every((value) => value === values[0]);
}

function endpointHost(value) {
  try {
    const url = new URL(String(value || ''));
    return url.hostname + url.pathname;
  } catch (_) {
    return '';
  }
}

function safeBalance(balance) {
  const source = balance && typeof balance === 'object' ? balance : {};
  return {
    status: source.status || 'unknown',
    source: source.source || '',
    amount: source.amount == null ? null : Number(source.amount),
    endpointHost: endpointHost(source.endpoint),
    httpStatus: source.httpStatus || null,
    sourceField: source.sourceField || '',
    quotaStatus: source.quotaStatus || '',
    quotaEndpointHost: endpointHost(source.quotaEndpoint),
    quotaSourceField: source.quotaSourceField || '',
  };
}

function dataSourceSummary(snapshot) {
  const usageRows = Array.isArray(snapshot.usageRows) ? snapshot.usageRows : [];
  const sources = Array.from(new Set(usageRows.map((row) => row && row.dataSource).filter(Boolean)));
  const spend = snapshot.spend && typeof snapshot.spend === 'object' ? snapshot.spend : {};
  const usageSummary = snapshot.usageSummary && typeof snapshot.usageSummary === 'object' ? snapshot.usageSummary : {};
  return {
    provider: 'ccswitch providers/current',
    requests: 'ccswitch proxy_request_logs',
    trend: sources.length ? sources.join(', ') : 'ccswitch request log rollups',
    spend: spend.source || (sources.length ? sources.join(', ') : 'ccswitch request log rollups'),
    spendStatus: spend.status || '',
    usageSummary: usageSummary.source || 'unavailable',
    usageSummaryStatus: usageSummary.status || 'unavailable',
    balance: snapshot.balance && snapshot.balance.source ? snapshot.balance.source : 'unavailable',
    context: 'derived from ccswitch request tokens and model window',
  };
}

function suggestedBalancePage(provider, snapshot) {
  const raw = provider?.websiteUrl || provider?.baseUrl || snapshot?.endpoint || '';
  try {
    const parsed = new URL(String(raw || ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return {};
    const url = `${parsed.origin}/console`;
    return { url, host: endpointHost(url) };
  } catch (_) {
    return {};
  }
}

function configuredBalancePage(settings, snapshot) {
  const raw = settings.balancePageUrl
    || snapshot?.provider?.websiteUrl
    || snapshot?.provider?.baseUrl
    || snapshot?.endpoint
    || '';
  try {
    const parsed = new URL(String(raw || ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return {};
    return { url: parsed.toString(), host: endpointHost(parsed.toString()) };
  } catch (_) {
    return {};
  }
}

function effectiveBalanceLoginPage(settings, snapshot) {
  const url = resolveBalanceTargetUrl(settings, snapshot);
  return url ? { url, host: endpointHost(url) } : {};
}

function balanceDiagnosticNote(settings, balance, _suggested, effective) {
  if ((settings.balanceAcquisitionMode || 'auto-api') !== 'web-session') return '';
  if (balance && balance.amount != null) {
    return '已通过中转站账户页面或账户接口读取真实余额。';
  }
  if (balance && balance.quotaStatus === 'unlimited') {
    return '已检测到当前 API Token 为不限额，但这不是站点账户余额；账户余额仍需要内置网页登录态读取。';
  }
  if (balance && balance.status === 'provider-mismatch') {
    if (effective && effective.url) {
      return `余额页面地址和当前中转站不匹配；新版 exe 登录窗口会优先打开 ${effective.url}，登录后再刷新余额。`;
    }
    return '余额页面地址和当前中转站不匹配，请在 exe 设置页把余额页面改成当前中转站后台地址后重新登录。';
  }
  return 'CLI 诊断不能读取 Electron 持久登录 session；网页登录余额请以 exe 设置页的登录状态和主界面刷新结果为准。';
}

async function readSnapshot(settings, dbPath) {
  return getRelaySnapshot({
    settings,
    relayOptions: {
      dbPath,
      recentLimit: 200,
      requestDailyLimit: 366,
    },
    balanceOptions: {
      enabled: (settings.balanceAcquisitionMode || 'auto-api') === 'auto-api',
      manualAmount: settings.balanceManualAmount,
      mode: settings.balanceAcquisitionMode || 'auto-api',
      pageUrl: settings.balancePageUrl,
      selector: settings.balanceSelector,
      providerApiFallback: (settings.balanceAcquisitionMode || 'auto-api') === 'web-session',
      timeoutMs: 3500,
    },
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

async function readEffectiveSnapshot(settings, dbPath) {
  const initialSnapshot = await readSnapshot(settings, dbPath);
  const profiledSettings = applyBalanceProviderProfile(settings, initialSnapshot);
  const effectiveUrl = resolveBalanceTargetUrl(profiledSettings, initialSnapshot);
  const shouldRetryWithEffectiveBalancePage = (profiledSettings.balanceAcquisitionMode || 'auto-api') === 'web-session'
    && effectiveUrl
    && effectiveUrl !== profiledSettings.balancePageUrl;
  if (shouldRetryWithEffectiveBalancePage) {
    const finalSettings = { ...profiledSettings, balancePageUrl: effectiveUrl };
    return { settings: finalSettings, snapshot: await readSnapshot(finalSettings, dbPath) };
  }
  if (balanceSettingsSignature(profiledSettings) !== balanceSettingsSignature(settings)) {
    return { settings: profiledSettings, snapshot: await readSnapshot(profiledSettings, dbPath) };
  }
  return { settings, snapshot: initialSnapshot };
}

async function main() {
  const providedPath = process.argv[2] || '';
  const best = providedPath ? { path: providedPath, settings: readJson(providedPath) } : readBestSettings();
  const settingsPath = best.path;
  const originalSettings = best.settings;
  const dbPath = defaultCcswitchDbPath(originalSettings);
  const { settings: finalSettings, snapshot: finalSnapshot } = await readEffectiveSnapshot(originalSettings, dbPath);
  const companion = createCompanionSnapshot(finalSnapshot, finalSettings);
  const configuredBalance = configuredBalancePage(originalSettings, finalSnapshot);
  const suggestedBalance = suggestedBalancePage(finalSnapshot.provider || {}, finalSnapshot);
  const effectiveBalance = effectiveBalanceLoginPage(finalSettings, finalSnapshot);
  const report = {
    checkedAt: new Date().toISOString(),
    settingsPath,
    ccswitchDbPath: dbPath,
    relayState: finalSnapshot.relayState || {},
    provider: {
      name: finalSnapshot.provider && finalSnapshot.provider.name,
      baseUrlHost: endpointHost(finalSnapshot.provider && finalSnapshot.provider.baseUrl),
      model: finalSnapshot.provider && finalSnapshot.provider.model,
      reasoningEffort: finalSnapshot.provider && finalSnapshot.provider.reasoningEffort,
    },
    dataSources: dataSourceSummary(finalSnapshot),
    balance: safeBalance(finalSnapshot.balance),
    configuredBalancePage: configuredBalance,
    suggestedBalancePage: suggestedBalance,
    effectiveLoginPage: effectiveBalance,
    balanceNote: balanceDiagnosticNote(finalSettings, finalSnapshot.balance, suggestedBalance, effectiveBalance),
    tokens: {
      today: finalSnapshot.tokens && finalSnapshot.tokens.daily,
      week: finalSnapshot.tokens && finalSnapshot.tokens.weekly,
      month: finalSnapshot.tokens && finalSnapshot.tokens.monthly,
    },
    spend: {
      today: finalSnapshot.spend && finalSnapshot.spend.today,
      week: finalSnapshot.spend && finalSnapshot.spend.week,
      month: finalSnapshot.spend && finalSnapshot.spend.month,
      total: finalSnapshot.spend && finalSnapshot.spend.total,
      source: finalSnapshot.spend && finalSnapshot.spend.source,
      status: finalSnapshot.spend && finalSnapshot.spend.status,
    },
    trend: {
      points: finalSnapshot.trend7d,
      flat: trendLooksFlat(finalSnapshot.trend7d),
    },
    recentRequests: {
      count: Array.isArray(finalSnapshot.recentRequests) ? finalSnapshot.recentRequests.length : 0,
      latestModel: finalSnapshot.recentRequests && finalSnapshot.recentRequests[0] && finalSnapshot.recentRequests[0].model,
    },
    companion: companion.compact,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
