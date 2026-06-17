'use strict';

const { calculateCacheStats } = require('../collectors/cache-stats');
const { estimateContextUsage } = require('../collectors/context-usage');
const { maskSecret, previewSecret } = require('../shared/secrets');
const { lastSevenDateKeys, localDateKey } = require('../shared/time');
const { readProviderBalance } = require('./balance-client');
const { readRelayState } = require('./ccswitch-db');
const { readUsageSummary } = require('./usage-summary-client');
const { readWebSessionBalance } = require('./web-balance-client');

const MISSING_MODEL = '未检测到';
const MISSING_REASONING_EFFORT = '未记录';
const DEFAULT_RECENT_REQUEST_LIMIT = 10;
const TREND_POINT_LIMIT = 7;

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toOptionalNumber(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeText(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizeModel(value) {
  return normalizeText(value, MISSING_MODEL);
}

function normalizeReasoningEffort(value) {
  return normalizeText(value, MISSING_REASONING_EFFORT);
}

function firstValue(input, fields) {
  if (!input || typeof input !== 'object') return undefined;
  for (const field of fields) {
    if (input[field] != null && input[field] !== '') return input[field];
  }
  return undefined;
}

function limitItems(items, limit) {
  const array = Array.isArray(items) ? items : [];
  const max = Math.max(0, toNumber(limit));
  return max > 0 ? array.slice(0, max) : [];
}

function sum(records, field) {
  return records.reduce((total, record) => total + toNumber(record[field]), 0);
}

function currentProvider(providers) {
  const current = providers.filter((provider) => provider.isCurrent);
  return current.find((provider) => provider.baseUrl)
    || current.find((provider) => provider.appType === 'codex')
    || current[0]
    || providers.find((provider) => provider.baseUrl)
    || providers[0]
    || null;
}

function providerKey(provider = {}) {
  return String(provider.providerId || provider.provider_id || provider.id || '').trim();
}

function isSessionProviderKey(value) {
  const key = String(value || '').trim();
  return key === '' || key.startsWith('_') || /_session$/i.test(key);
}

function rowProviderKey(row) {
  return String(row?.providerId || row?.provider_id || row?.provider || row?.id || '').trim();
}

function belongsToProvider(row, provider) {
  const currentKey = providerKey(provider);
  if (!currentKey) return true;
  const rowKey = String(row?.providerId || row?.provider_id || row?.provider || '').trim();
  return !rowKey || rowKey === currentKey;
}

function filterRowsForProvider(rows, provider) {
  const array = Array.isArray(rows) ? rows : [];
  const currentKey = providerKey(provider);
  const currentAppType = String(provider.appType || '').trim();
  if (!currentKey) return array;
  const providerKeys = array.map(rowProviderKey).filter(Boolean);
  const hasConcreteProviderKeys = providerKeys.some((key) => !isSessionProviderKey(key));
  const hasOnlySessionKeys = providerKeys.length > 0 && providerKeys.every(isSessionProviderKey);

  if (hasConcreteProviderKeys) {
    return array.filter((row) => providerKey(row) === currentKey && (!currentAppType || String(row?.appType || row?.app_type || '').trim() === currentAppType));
  }

  if (hasOnlySessionKeys && currentAppType) {
    return array.filter((row) => {
      const rowAppType = String(row?.appType || row?.app_type || '').trim();
      const rowKey = rowProviderKey(row);
      return rowAppType === currentAppType && (!rowKey || isSessionProviderKey(rowKey));
    });
  }

  return array;
}

function rawProviderSecret(provider) {
  return firstValue(provider, [
    'apiKey',
    'api_key',
    'key',
    'token',
    'secret',
    'authorization',
    'bearer',
  ]);
}

function safeMaskedKey(provider, secret) {
  const explicit = String(provider.maskedKey || provider.apiKeyMasked || '').trim();
  if (secret) return maskSecret(secret);
  if (/^(?:sk-|sk_)/i.test(explicit) && !/[\u2022*]/.test(explicit) && explicit.length > 12) {
    return maskSecret(explicit);
  }
  return explicit;
}

function safeKeyPreview(provider, secret) {
  const explicit = String(provider.keyPreview || provider.apiKeyPreview || '').trim();
  if (secret) return previewSecret(secret);
  if (!explicit) return '';
  if (explicit.length <= 16 || /[.\u2022*]/.test(explicit)) return explicit;
  return previewSecret(explicit);
}

function sanitizeProvider(provider = {}) {
  const secret = rawProviderSecret(provider);
  return {
    appType: String(provider.appType || provider.app_type || ''),
    providerId: String(provider.providerId || provider.provider_id || provider.id || ''),
    name: String(provider.name || ''),
    baseUrl: String(provider.baseUrl || provider.base_url || provider.endpoint || ''),
    maskedKey: safeMaskedKey(provider, secret),
    keyPreview: safeKeyPreview(provider, secret),
    model: normalizeModel(provider.model || provider.modelName || provider.defaultModel || provider.default_model),
    reasoningEffort: normalizeReasoningEffort(provider.reasoningEffort || provider.reasoning_effort || provider.modelReasoningEffort || provider.model_reasoning_effort),
    wireApi: String(provider.wireApi || provider.wire_api || ''),
    isCurrent: Boolean(provider.isCurrent),
    appLabel: String(provider.appLabel || provider.provider || provider.providerType || provider.provider_type || provider.appType || ''),
    websiteUrl: provider.websiteUrl || provider.website_url || '',
    category: provider.category || '',
    providerType: provider.providerType || provider.provider_type || '',
    costMultiplier: provider.costMultiplier || provider.cost_multiplier,
    balanceEndpoint: String(provider.balanceEndpoint || provider.balance_endpoint || provider.balanceUrl || provider.balance_url || ''),
    balanceEndpointSource: String(provider.balanceEndpointSource || provider.balance_endpoint_source || ''),
    balanceTimeoutSeconds: provider.balanceTimeoutSeconds || provider.balance_timeout_seconds || null,
  };
}

function sanitizeProviders(providers) {
  return (providers || []).map(sanitizeProvider);
}

function aggregateUsage(rollups, requests) {
  if (rollups.length > 0) {
    const totalRequests = sum(rollups, 'requestCount');
    const totalLatency = rollups.reduce((total, row) => total + toNumber(row.avgLatencyMs) * toNumber(row.requestCount), 0);
    return {
      totalRequests,
      successCount: sum(rollups, 'successCount'),
      inputTokens: sum(rollups, 'inputTokens'),
      outputTokens: sum(rollups, 'outputTokens'),
      totalCostUsd: sum(rollups, 'totalCostUsd'),
      avgLatencyMs: totalRequests > 0 ? Math.round(totalLatency / totalRequests) : 0,
    };
  }

  const successCount = requests.filter((request) => request.statusCode >= 200 && request.statusCode < 400).length;
  const totalLatency = sum(requests, 'latencyMs');
  return {
    totalRequests: requests.length,
    successCount,
    inputTokens: sum(requests, 'inputTokens'),
    outputTokens: sum(requests, 'outputTokens'),
    totalCostUsd: sum(requests, 'totalCostUsd'),
    avgLatencyMs: requests.length > 0 ? Math.round(totalLatency / requests.length) : 0,
  };
}

function buildTrend(rollups, now) {
  const byDate = new Map();
  for (const row of rollups) {
    if (!byDate.has(row.date)) {
      byDate.set(row.date, {
        date: row.date,
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalCostUsd: 0,
      });
    }
    const bucket = byDate.get(row.date);
    bucket.requestCount += toNumber(row.requestCount);
    bucket.inputTokens += toNumber(row.inputTokens);
    bucket.outputTokens += toNumber(row.outputTokens);
    bucket.cacheReadTokens += toNumber(row.cacheReadTokens);
    bucket.cacheCreationTokens += toNumber(row.cacheCreationTokens);
    bucket.totalCostUsd += toNumber(row.totalCostUsd);
  }

  return lastSevenDateKeys(now).map((date) => byDate.get(date) || {
    date,
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalCostUsd: 0,
  });
}

function tokenTotal(row) {
  return toNumber(row.inputTokens) + toNumber(row.outputTokens) + toNumber(row.cacheReadTokens) + toNumber(row.cacheCreationTokens);
}

function requestTokensTotal(request) {
  return toNumber(request.inputTokens ?? request.usage?.inputTokens ?? request.tokens?.input)
    + toNumber(request.outputTokens ?? request.usage?.outputTokens ?? request.tokens?.output)
    + toNumber(request.cacheReadTokens ?? request.usage?.cachedTokens ?? request.tokens?.cached)
    + toNumber(request.cacheCreationTokens ?? request.usage?.cacheCreationTokens);
}

function dateKeyFromTimestamp(value) {
  const createdAt = toNumber(value);
  if (!createdAt) return '';
  const timestamp = createdAt > 1000000000000 ? createdAt : createdAt * 1000;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '' : localDateKey(date);
}

function rollupDateKey(row) {
  return String(row?.date || '').slice(0, 10);
}

function emptyRollup(date) {
  return {
    date,
    appType: '',
    providerId: '',
    model: '',
    requestCount: 0,
    successCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalCostUsd: 0,
    avgLatencyMs: 0,
    dataSource: 'computed',
  };
}

function addRollup(target, row) {
  target.requestCount += toNumber(row.requestCount);
  target.successCount += toNumber(row.successCount);
  target.inputTokens += toNumber(row.inputTokens);
  target.outputTokens += toNumber(row.outputTokens);
  target.cacheReadTokens += toNumber(row.cacheReadTokens);
  target.cacheCreationTokens += toNumber(row.cacheCreationTokens);
  target.totalCostUsd += toNumber(row.totalCostUsd);
  const rowRequests = toNumber(row.requestCount);
  const rowLatency = toNumber(row.avgLatencyMs);
  if (rowRequests > 0 && rowLatency > 0) {
    target._latencyWeighted = toNumber(target._latencyWeighted) + rowLatency * rowRequests;
    target._latencyRequests = toNumber(target._latencyRequests) + rowRequests;
  }
  if (!target.appType && row.appType) target.appType = row.appType;
  if (!target.providerId && row.providerId) target.providerId = row.providerId;
  if (!target.model && row.model) target.model = row.model;
}

function finalizeRollup(row) {
  const finalized = { ...row };
  if (toNumber(finalized._latencyRequests) > 0) {
    finalized.avgLatencyMs = Math.round(toNumber(finalized._latencyWeighted) / toNumber(finalized._latencyRequests));
  }
  delete finalized._latencyWeighted;
  delete finalized._latencyRequests;
  return finalized;
}

function aggregateRowsByDate(rows, dataSource) {
  const byDate = new Map();
  for (const row of rows || []) {
    const date = rollupDateKey(row);
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, { ...emptyRollup(date), dataSource });
    addRollup(byDate.get(date), row);
  }
  return byDate;
}

function aggregateRequestsByDate(requests) {
  const byDate = new Map();
  for (const request of requests || []) {
    const date = dateKeyFromTimestamp(request.createdAt);
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, { ...emptyRollup(date), dataSource: 'recent-requests' });
    addRollup(byDate.get(date), {
      appType: request.appType,
      providerId: request.providerId,
      model: request.requestModel || request.model,
      requestCount: 1,
      successCount: request.statusCode >= 200 && request.statusCode < 400 ? 1 : 0,
      inputTokens: request.inputTokens,
      outputTokens: request.outputTokens,
      cacheReadTokens: request.cacheReadTokens,
      cacheCreationTokens: request.cacheCreationTokens,
      totalCostUsd: request.totalCostUsd,
      avgLatencyMs: request.latencyMs,
    });
  }
  return byDate;
}

function mergeUsageRollups(usageDailyRollups, requestDailyRollups, recentRequests, now) {
  const officialByDate = aggregateRowsByDate(usageDailyRollups, 'usage-daily-rollups');
  const requestByDate = aggregateRowsByDate(requestDailyRollups, 'request-daily-rollups');
  const recentByDate = aggregateRequestsByDate(recentRequests);
  const recentFallbackDates = new Set(lastSevenDateKeys(now));
  const hasRequestLogRollups = requestByDate.size > 0;
  const dates = new Set([
    ...requestByDate.keys(),
    ...Array.from(recentByDate.keys()).filter((date) => recentFallbackDates.has(date)),
    ...Array.from(officialByDate.keys()).filter((date) => !hasRequestLogRollups || !recentFallbackDates.has(date)),
  ]);

  return Array.from(dates).sort().map((date) => {
    const source = requestByDate.get(date)
      || recentByDate.get(date)
      || officialByDate.get(date)
      || emptyRollup(date);
    return finalizeRollup(source);
  });
}

function filterRowsForCurrentApp(rows, provider) {
  const array = Array.isArray(rows) ? rows : [];
  const currentAppType = String(provider?.appType || '').trim();
  if (!currentAppType) return array;
  return array.filter((row) => String(row?.appType || row?.app_type || '').trim() === currentAppType);
}

function preferredRowsForProvider(rows, provider) {
  const array = Array.isArray(rows) ? rows : [];
  const providerRows = filterRowsForProvider(array, provider);
  const appRows = filterRowsForCurrentApp(providerRows, provider);
  if (appRows.length > 0) return appRows;
  if (providerRows.length > 0) return providerRows;

  const sessionRows = array.filter((row) => isSessionProviderKey(rowProviderKey(row)));
  const appSessionRows = filterRowsForCurrentApp(sessionRows, provider);
  if (appSessionRows.length > 0) return appSessionRows;
  if (sessionRows.length > 0) return sessionRows;

  if (!providerKey(provider)) {
    const appOnlyRows = filterRowsForCurrentApp(array, provider);
    return appOnlyRows.length > 0 ? appOnlyRows : array;
  }

  return [];
}

function isSameMonth(date, now) {
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function summarizePeriods(rows, now) {
  const todayKey = localDateKey(now);
  const sevenKeys = new Set(lastSevenDateKeys(now));
  const result = {
    todayCost: 0,
    weekCost: 0,
    monthCost: 0,
    totalCost: 0,
    todayTokens: 0,
    weekTokens: 0,
    monthTokens: 0,
    totalTokens: 0,
  };

  for (const row of rows || []) {
    const dateKey = String(row.date || '').slice(0, 10);
    const rowCost = toNumber(row.totalCostUsd);
    const rowTokens = tokenTotal(row);
    result.totalCost += rowCost;
    result.totalTokens += rowTokens;
    if (dateKey === todayKey) {
      result.todayCost += rowCost;
      result.todayTokens += rowTokens;
    }
    if (sevenKeys.has(dateKey)) {
      result.weekCost += rowCost;
      result.weekTokens += rowTokens;
    }
    const date = new Date(`${dateKey}T00:00:00Z`);
    if (!Number.isNaN(date.getTime()) && isSameMonth(date, now)) {
      result.monthCost += rowCost;
      result.monthTokens += rowTokens;
    }
  }

  return result;
}

function balanceFromOptions(balanceOptions, periods) {
  const mode = balanceOptions.mode || (balanceOptions.enabled === true ? 'auto-api' : 'auto-api');
  if (mode === 'manual') {
    const manualAmount = toOptionalNumber(balanceOptions.manualAmount);
    if (manualAmount == null) {
      return {
        status: 'unavailable',
        available: false,
        amount: null,
        balance: null,
        source: 'manual',
        error: 'Manual balance amount is not configured',
      };
    }
    const remaining = Math.max(0, manualAmount - toNumber(periods.totalCost));
    return {
      status: 'estimated',
      available: true,
      amount: remaining,
      balance: remaining,
      currency: 'USD',
      source: 'manual-minus-spend',
      updatedAt: new Date().toISOString(),
    };
  }
  if (mode === 'web-session' && typeof balanceOptions.fetch !== 'function') {
    return {
      status: 'auth-required',
      available: false,
      amount: null,
      balance: null,
      currency: 'USD',
      source: 'web-session',
      endpoint: balanceOptions.pageUrl || '',
      error: 'Web session balance reading is not configured yet',
    };
  }
  return undefined;
}

function hasUsableBalance(balance) {
  if (!balance || typeof balance !== 'object') return false;
  const amount = toOptionalNumber(balance.amount ?? balance.balance ?? balance.remaining);
  return amount != null || balance.status === 'estimated';
}

function hasMoneyBalance(balance) {
  if (!balance || typeof balance !== 'object') return false;
  return toOptionalNumber(balance.amount ?? balance.balance ?? balance.remaining) != null;
}

function hostFromUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch (_) {
    return '';
  }
}

function compactHost(host) {
  const parts = String(host || '').toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  return parts.slice(-2).join('.');
}

function hostsLookRelated(left, right) {
  const a = String(left || '').toLowerCase();
  const b = String(right || '').toLowerCase();
  if (!a || !b) return true;
  if (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)) return true;
  const compactA = compactHost(a);
  const compactB = compactHost(b);
  return Boolean(compactA && compactB && compactA === compactB);
}

function providerBalanceHost(provider = {}) {
  return hostFromUrl(provider.websiteUrl || provider.website_url || provider.baseUrl || provider.base_url || provider.endpoint || '');
}

function suggestedWebBalancePageUrl(provider = {}) {
  const raw = provider.websiteUrl || provider.website_url || provider.baseUrl || provider.base_url || provider.endpoint || '';
  try {
    const parsed = new URL(String(raw || ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return new URL('/console', parsed.origin).toString();
  } catch (_) {
    return '';
  }
}

function validateWebBalanceTarget(pageUrl, provider) {
  const pageHost = hostFromUrl(pageUrl);
  const providerHost = providerBalanceHost(provider);
  if (!String(pageUrl || '').trim()) {
    return {
      status: 'not-configured',
      available: false,
      amount: null,
      balance: null,
      currency: 'USD',
      source: 'web-session',
      endpoint: '',
      providerId: provider?.providerId || provider?.id || '',
      error: 'Balance page URL is not configured for the current provider',
    };
  }
  if (pageHost && providerHost && !hostsLookRelated(pageHost, providerHost)) {
    return {
      status: 'provider-mismatch',
      available: false,
      amount: null,
      balance: null,
      currency: 'USD',
      source: 'web-session',
      endpoint: pageUrl,
      providerId: provider?.providerId || provider?.id || '',
      error: `Balance page host ${pageHost} does not match current provider host ${providerHost}`,
    };
  }
  return null;
}

function shouldTryWebBalanceFallback(balance, balanceOptions) {
  if (balanceOptions.mode === 'web-session') return true;
  if (!balanceOptions.pageUrl && !balanceOptions.fetch) return false;
  if (!balance || typeof balance !== 'object') return true;
  return ['auth-required', 'error', 'parse-error', 'unavailable', 'unknown'].includes(String(balance.status || '').toLowerCase())
    || !hasUsableBalance(balance);
}

function hasExplicitProviderBalance(provider = {}) {
  return Boolean(provider.balanceEndpoint || provider.balance_endpoint || provider.balanceUrl || provider.balance_url);
}

function balanceProviderCacheKey(provider = {}, balanceOptions = {}) {
  const safeProvider = sanitizeProvider(provider);
  return [
    safeProvider.providerId || provider.id || '',
    safeProvider.baseUrl || '',
    safeProvider.balanceEndpoint || '',
    balanceOptions.mode || '',
    balanceOptions.pageUrl || '',
    balanceOptions.selector || '',
  ].join('|');
}

function cachedBalanceMatchesProvider(balance, provider, balanceOptions) {
  if (!balance || typeof balance !== 'object' || !balance.__cacheProviderKey) return true;
  return balance.__cacheProviderKey === balanceProviderCacheKey(provider, balanceOptions);
}

async function readExplicitProviderBalance(provider, balanceOptions, balanceHeaders) {
  if (!hasExplicitProviderBalance(provider)) return null;
  const { fetch: webSessionFetch, providerFetch, ...explicitOptions } = balanceOptions;
  return readProviderBalance(provider, {
    ...explicitOptions,
    fetch: providerFetch,
    headers: balanceHeaders,
    includeCommon: false,
    timeoutMs: provider.balanceTimeoutSeconds
      ? Math.round(Number(provider.balanceTimeoutSeconds) * 1000)
      : balanceOptions.timeoutMs,
  });
}

function shouldTryProviderApiBalance(provider, balanceOptions, balanceHeaders) {
  if (balanceOptions.providerApiFallback !== true) return false;
  return Boolean(
    hasExplicitProviderBalance(provider)
      || balanceHeaders.Authorization
      || balanceHeaders.authorization,
  );
}

async function readProviderApiBalance(provider, balanceOptions, balanceHeaders) {
  if (!shouldTryProviderApiBalance(provider, balanceOptions, balanceHeaders)) return null;
  const { fetch: webSessionFetch, providerFetch, ...providerOptions } = balanceOptions;
  return readProviderBalance(provider, {
    ...providerOptions,
    fetch: providerFetch,
    headers: balanceHeaders,
    includeCommon: true,
    timeoutMs: provider.balanceTimeoutSeconds
      ? Math.round(Number(provider.balanceTimeoutSeconds) * 1000)
      : balanceOptions.timeoutMs,
  });
}

async function resolveBalance({
  balanceOptions,
  periods,
  provider,
  balanceHeaders,
  webSessionOptions,
}) {
  let providerApiBalance = null;
  if (balanceOptions.mode === 'web-session') {
    providerApiBalance = await readProviderApiBalance(provider, balanceOptions, balanceHeaders);
    if (hasMoneyBalance(providerApiBalance)) return providerApiBalance;

    const targetProblem = validateWebBalanceTarget(balanceOptions.pageUrl, provider);
    if (targetProblem) {
      const explicitBalance = await readExplicitProviderBalance(provider, balanceOptions, balanceHeaders);
      if (hasMoneyBalance(explicitBalance)) return explicitBalance;

      const suggestedPageUrl = suggestedWebBalancePageUrl(provider);
      if (targetProblem.status === 'provider-mismatch' && suggestedPageUrl && typeof balanceOptions.fetch === 'function') {
        const suggestedBalance = await readWebSessionBalance({
          ...webSessionOptions,
          pageUrl: suggestedPageUrl,
          stalePageUrl: balanceOptions.pageUrl,
        });
        if (hasUsableBalance(suggestedBalance)) {
          return {
            ...suggestedBalance,
            source: suggestedBalance.source || 'web-session',
            staleEndpoint: balanceOptions.pageUrl,
            autoSuggested: true,
          };
        }
        return {
          ...suggestedBalance,
          status: suggestedBalance?.status || targetProblem.status,
          endpoint: suggestedBalance?.endpoint || suggestedPageUrl,
          staleEndpoint: balanceOptions.pageUrl,
          autoSuggested: true,
          error: suggestedBalance?.error || targetProblem.error,
        };
      }

      return targetProblem;
    }
  }

  const configured = balanceFromOptions(balanceOptions, periods);
  if (configured) {
    if (balanceOptions.mode === 'web-session' && providerApiBalance?.status === 'unlimited') {
      return {
        ...configured,
        quotaStatus: 'unlimited',
        quotaEndpoint: providerApiBalance.endpoint || '',
        quotaSourceField: providerApiBalance.sourceField || '',
      };
    }
    return configured;
  }

  if (balanceOptions.mode === 'web-session') {
    const webBalance = await readWebSessionBalance(webSessionOptions);
    if (hasUsableBalance(webBalance)) return webBalance;
    const explicitBalance = await readExplicitProviderBalance(provider, balanceOptions, balanceHeaders);
    if (hasMoneyBalance(explicitBalance)) return explicitBalance;
    if (providerApiBalance?.status === 'unlimited') {
      return {
        ...webBalance,
        quotaStatus: 'unlimited',
        quotaEndpoint: providerApiBalance.endpoint || '',
        quotaSourceField: providerApiBalance.sourceField || '',
      };
    }
    return webBalance;
  }

  let apiBalance;
  if (balanceOptions.enabled === true) {
    apiBalance = await readProviderBalance(provider, {
      ...balanceOptions,
      headers: balanceHeaders,
    });
    if (hasUsableBalance(apiBalance) || !shouldTryWebBalanceFallback(apiBalance, balanceOptions)) {
      return apiBalance;
    }
  }

  if (typeof balanceOptions.fetch === 'function' && shouldTryWebBalanceFallback(apiBalance, balanceOptions)) {
    return readWebSessionBalance(webSessionOptions);
  }

  return apiBalance;
}

function emptyTrend(now) {
  return lastSevenDateKeys(now).map((date) => ({
    date,
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalCostUsd: 0,
  }));
}

function unavailableSnapshot(now, relayState = {}) {
  const provider = {
    appType: 'codex',
    providerId: '',
    name: '',
    baseUrl: '',
    maskedKey: '',
    keyPreview: '',
    model: MISSING_MODEL,
    reasoningEffort: MISSING_REASONING_EFFORT,
    wireApi: '',
    isCurrent: false,
  };

  return {
    mode: 'unavailable',
    generatedAt: now.toISOString(),
    provider,
    providers: [],
    usage: {
      totalRequests: 0,
      successCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalCostUsd: 0,
      avgLatencyMs: 0,
    },
    recentRequests: [],
    cache: calculateCacheStats([]),
    context: estimateContextUsage({ model: provider.model, usedTokens: 0 }),
    trend: emptyTrend(now),
    relayState: {
      status: relayState.status || 'missing',
      dbPath: relayState.dbPath || '',
      error: relayState.error,
    },
  };
}

async function resolveInput(value, fallback) {
  if (value !== undefined) return value;
  return fallback();
}

async function resolveUsageSummary({
  provider,
  balanceHeaders,
  balanceOptions,
  usageSummaryOptions,
}) {
  if (!usageSummaryOptions || usageSummaryOptions.enabled !== true) return null;
  return readUsageSummary(provider, {
    ...usageSummaryOptions,
    pageUrl: usageSummaryOptions.pageUrl || balanceOptions.pageUrl || provider.websiteUrl || provider.baseUrl,
    headers: {
      ...(usageSummaryOptions.headers || {}),
      ...balanceHeaders,
    },
  });
}

async function buildSnapshot(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const relayState = await resolveInput(options.relayState, () => readRelayState(options.relayOptions || {}));

  const providers = sanitizeProviders(relayState.providers || []);
  const rawProvider = currentProvider(relayState.providers || []) || {};
  const provider = currentProvider(providers) || {
    appType: 'codex',
    providerId: '',
    name: '',
    baseUrl: '',
    maskedKey: '',
    keyPreview: '',
    model: (relayState.recentRequests || [])[0] ? relayState.recentRequests[0].model : MISSING_MODEL,
    reasoningEffort: MISSING_REASONING_EFFORT,
    wireApi: '',
    isCurrent: false,
  };
  const allRelayRequests = relayState.recentRequests || [];
  const allRecentRequests = preferredRowsForProvider(allRelayRequests, rawProvider || provider);
  const recentRequests = limitItems(allRecentRequests, options.recentRequestLimit ?? DEFAULT_RECENT_REQUEST_LIMIT);
  const rollups = preferredRowsForProvider(relayState.usageDailyRollups || [], rawProvider || provider);
  const requestDailyRollups = preferredRowsForProvider(relayState.requestDailyRollups || [], rawProvider || provider);
  const usageRows = mergeUsageRollups(rollups, requestDailyRollups, allRecentRequests, now);
  const hasRealData = providers.length > 0 || allRelayRequests.length > 0 || usageRows.length > 0;

  if (!hasRealData) return unavailableSnapshot(now, relayState);

  const safeProvider = sanitizeProvider(provider);
  const usage = aggregateUsage(usageRows, allRecentRequests);
  const periods = summarizePeriods(usageRows, now);
  const cacheSource = usageRows.length > 0 ? usageRows : allRecentRequests;
  const contextSource = recentRequests[0] || {
    model: safeProvider.model,
    usedTokens: usage.inputTokens + usage.outputTokens,
  };
  const balanceOptions = options.balanceOptions || {};
  const balanceHeaders = { ...(balanceOptions.headers || {}) };
  const providerSecret = rawProviderSecret(rawProvider);
  if (providerSecret && !balanceHeaders.Authorization && !balanceHeaders.authorization) {
    balanceHeaders.Authorization = /^bearer\s+/i.test(String(providerSecret))
      ? String(providerSecret)
      : `Bearer ${providerSecret}`;
  }
  const webSessionOptions = {
    ...balanceOptions,
    pageUrl: balanceOptions.pageUrl || safeProvider.websiteUrl || safeProvider.baseUrl,
    providerId: safeProvider.providerId,
  };
  const balanceOverride = cachedBalanceMatchesProvider(options.balance, rawProvider || safeProvider, balanceOptions)
    ? options.balance
    : undefined;
  const [balance, usageSummary] = await Promise.all([
    resolveInput(balanceOverride, () => resolveBalance({
      balanceOptions,
      periods,
      provider: rawProvider || safeProvider,
      balanceHeaders,
      webSessionOptions,
    })),
    resolveUsageSummary({
      provider: rawProvider || safeProvider,
      balanceHeaders,
      balanceOptions,
      usageSummaryOptions: options.usageSummaryOptions || {},
    }),
  ]);

  return {
    mode: 'live',
    generatedAt: now.toISOString(),
    provider: safeProvider,
    providers,
    usage,
    periods,
    balance,
    usageSummary,
    recentRequests,
    cache: calculateCacheStats(cacheSource),
    context: estimateContextUsage(contextSource, { model: contextSource.model || safeProvider.model }),
    trend: buildTrend(usageRows, now),
    usageRows,
    relayState: {
      status: relayState.status,
      dbPath: relayState.dbPath,
      error: relayState.error,
    },
  };
}

function shortDateLabel(date) {
  const parts = String(date || '').split('-');
  if (parts.length === 3) return `${Number(parts[1])}/${Number(parts[2])}`;
  return String(date || '');
}

function statusText(statusCode) {
  const code = toNumber(statusCode);
  if (!code) return '未知';
  return code >= 200 && code < 400 ? '成功' : '失败';
}

function requestToUi(request, provider, context) {
  const input = toNumber(request.inputTokens);
  const output = toNumber(request.outputTokens);
  const cached = toNumber(request.cacheReadTokens);
  const total = input + output + cached + toNumber(request.cacheCreationTokens);
  const createdAt = toNumber(request.createdAt);
  const timestamp = createdAt > 1000000000000 ? createdAt : createdAt * 1000;
  const cacheBase = cached + Math.max(0, input - cached);
  const cacheHitRate = cacheBase > 0 ? (cached / cacheBase) * 100 : 0;
  const providerModel = normalizeModel(request.providerModel || request.provider_model || provider?.model);
  const requestModel = normalizeModel(request.requestModel || request.request_model || request.modelName || request.model || providerModel);
  const reasoningEffort = normalizeReasoningEffort(request.requestReasoningEffort
    || request.request_reasoning_effort
    || request.reasoningEffort
    || request.reasoning_effort
    || request.reasoning?.effort);
  return {
    ...request,
    id: request.requestId || request.id || `${request.appType || 'request'}-${timestamp}`,
    model: requestModel,
    modelName: requestModel,
    providerModel,
    requestModel,
    reasoningEffort,
    status: statusText(request.statusCode),
    cost: toNumber(request.totalCostUsd),
    latency: toNumber(request.latencyMs),
    time: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
    relay: provider?.name || request.providerId || '当前中转站',
    provider: provider?.appType || request.appType || '',
    endpoint: provider?.baseUrl || '',
    cacheHitRate,
    contextUsage: context?.usedPercent || 0,
    tokens: {
      cached,
      input,
      output,
      total,
    },
    usage: {
      cachedTokens: cached,
      inputTokens: input,
      outputTokens: output,
      totalTokens: total,
    },
  };
}

function trendToUi(trendRows) {
  const rows = limitItems((trendRows || []).slice(-TREND_POINT_LIMIT), TREND_POINT_LIMIT);
  return rows.map((row) => {
    const input = toNumber(row.inputTokens);
    const output = toNumber(row.outputTokens);
    const cached = toNumber(row.cacheReadTokens) + toNumber(row.cacheCreationTokens);
    return {
      label: shortDateLabel(row.date),
      date: row.date,
      input,
      output,
      cached,
      value: input + output + cached,
      cost: toNumber(row.totalCostUsd),
    };
  });
}

function normalizeBalance(balance, periods) {
  if (!balance || typeof balance !== 'object') {
    return {
      status: 'unavailable',
      available: false,
      amount: null,
      balance: null,
      source: 'not-configured',
      error: 'No balance endpoint configured',
    };
  }

  const amount = toOptionalNumber(balance.amount ?? balance.balance ?? balance.remaining);
  const status = String(balance.status || (amount == null ? 'unknown' : 'ok'));
  const isTokenQuotaOnly = status.toLowerCase() === 'unlimited' && amount == null;
  return {
    status: isTokenQuotaOnly ? 'auth-required' : status,
    available: isTokenQuotaOnly ? false : (balance.available == null ? amount != null : Boolean(balance.available)),
    amount,
    balance: amount,
    currency: balance.currency || 'USD',
    source: balance.source || '',
    endpoint: balance.endpoint || '',
    staleEndpoint: balance.staleEndpoint || '',
    autoSuggested: Boolean(balance.autoSuggested),
    httpStatus: balance.httpStatus || null,
    sourceField: balance.sourceField || '',
    quotaPerUnit: balance.quotaPerUnit || null,
    rawQuota: balance.rawQuota || null,
    quotaStatus: balance.quotaStatus || (isTokenQuotaOnly ? 'unlimited' : ''),
    quotaEndpoint: balance.quotaEndpoint || (isTokenQuotaOnly ? balance.endpoint || '' : ''),
    quotaSourceField: balance.quotaSourceField || (isTokenQuotaOnly ? balance.sourceField || '' : ''),
    error: balance.error || (isTokenQuotaOnly ? 'API Token quota is unlimited, but site account balance still requires web login' : ''),
    updatedAt: balance.updatedAt || balance.updated_at || '',
  };
}

function normalizeUsageSummary(summary) {
  if (!summary || typeof summary !== 'object') {
    return {
      status: 'unavailable',
      available: false,
      source: '',
      todayCost: null,
      weekCost: null,
      monthCost: null,
      totalCost: null,
    };
  }
  const todayCost = toOptionalNumber(summary.todayCost);
  const weekCost = toOptionalNumber(summary.weekCost);
  const monthCost = toOptionalNumber(summary.monthCost);
  const totalCost = toOptionalNumber(summary.totalCost);
  const available = summary.available === true
    || [todayCost, weekCost, monthCost, totalCost].some((value) => value != null);
  return {
    status: summary.status || (available ? 'ok' : 'unavailable'),
    available,
    source: summary.source || '',
    endpoint: summary.endpoint || '',
    todayCost,
    weekCost,
    monthCost,
    totalCost,
    currency: summary.currency || 'USD',
    error: summary.error || '',
    updatedAt: summary.updatedAt || summary.updated_at || '',
  };
}

function spendValueFromSummary(summary, field, fallback) {
  const value = summary && summary.available ? toOptionalNumber(summary[field]) : null;
  return value == null ? fallback : value;
}

function fallbackSpendSource(snapshot) {
  const rows = Array.isArray(snapshot.usageRows) ? snapshot.usageRows : [];
  const sources = rows.map((row) => String(row?.dataSource || '').trim()).filter(Boolean);
  if (sources.includes('usage-daily-rollups')) return 'ccswitch-usage-rollups';
  if (sources.includes('request-daily-rollups')) return 'ccswitch-request-log';
  if (sources.includes('recent-requests')) return 'ccswitch-recent-requests';
  return 'ccswitch-request-log';
}

function modelTrendsFromRequests(requests, trendRows) {
  const totalPoints = trendToUi(trendRows);
  const byModel = new Map();
  for (const request of requests || []) {
    const model = normalizeModel(request.requestModel || request.request_model || request.model || request.modelName);
    const date = String(request.date || '').slice(0, 10) || dateKeyFromTimestamp(request.createdAt);
    if (!model || model === MISSING_MODEL || !date) continue;
    if (!byModel.has(model)) byModel.set(model, new Map());
    const modelDates = byModel.get(model);
    modelDates.set(date, toNumber(modelDates.get(date)) + requestTokensTotal(request));
  }
  return Object.fromEntries(Array.from(byModel.entries()).slice(0, 4).map(([model, dates]) => [
    model,
    totalPoints.map((point) => ({
      ...point,
      value: toNumber(dates.get(point.date)),
    })),
  ]));
}

function withRendererAliases(snapshot) {
  const provider = sanitizeProvider(snapshot.provider || {});
  const providers = sanitizeProviders(snapshot.providers || []);
  const usage = snapshot.usage || {};
  const cache = snapshot.cache || {};
  const context = snapshot.context || {};
  const periods = snapshot.periods || summarizePeriods(snapshot.trend, new Date(snapshot.generatedAt || Date.now()));
  const trend7d = trendToUi(snapshot.trend);
  const recentRequests = limitItems(snapshot.recentRequests || [], snapshot.recentRequestLimit ?? DEFAULT_RECENT_REQUEST_LIMIT)
    .map((request) => requestToUi(request, provider, context));
  const todayPoint = trend7d[trend7d.length - 1] || {};
  const balance = normalizeBalance(snapshot.balance, periods);
  const usageSummary = normalizeUsageSummary(snapshot.usageSummary);
  const cached = toNumber(cache.hitTokens);
  const input = toNumber(usage.inputTokens);
  const output = toNumber(usage.outputTokens);
  const model = normalizeModel(provider.model);
  const reasoningEffort = normalizeReasoningEffort(provider.reasoningEffort);
  const todaySpend = spendValueFromSummary(usageSummary, 'todayCost', toNumber(periods.todayCost) || toNumber(todayPoint.cost));
  const weekSpend = spendValueFromSummary(usageSummary, 'weekCost', toNumber(periods.weekCost));
  const monthSpend = spendValueFromSummary(usageSummary, 'monthCost', toNumber(periods.monthCost));
  const totalSpend = spendValueFromSummary(usageSummary, 'totalCost', toNumber(periods.totalCost) || toNumber(usage.totalCostUsd));
  const fallbackSource = fallbackSpendSource(snapshot);

  return {
    ...snapshot,
    provider,
    providers,
    currentRelay: {
      name: provider.name || '当前中转站',
      endpoint: provider.baseUrl || '',
      provider: provider.appType || provider.providerType || '',
      maskedKey: provider.maskedKey || '',
      keyPreview: provider.keyPreview || '',
      model,
      reasoningEffort,
    },
    endpoint: provider.baseUrl || '',
    baseUrl: provider.baseUrl || '',
    model,
    currentModel: model,
    reasoningEffort,
    balance,
    usageSummary,
    cache: {
      ...cache,
      rate: cache.hitRate,
    },
    context: {
      ...context,
      usage: toNumber(context.usedPercent),
      percent: toNumber(context.usedPercent),
    },
    latency: {
      avg: usage.avgLatencyMs || 0,
      average: usage.avgLatencyMs || 0,
      p95: usage.avgLatencyMs || 0,
    },
    modelTrends: snapshot.modelTrends || modelTrendsFromRequests(recentRequests, snapshot.trend),
    recentRequests,
    requests: {
      success: usage.totalRequests ? Math.round((toNumber(usage.successCount) / usage.totalRequests) * 100) : 0,
      failed: usage.totalRequests ? usage.totalRequests - toNumber(usage.successCount) : 0,
    },
    spend: {
      today: todaySpend,
      week: weekSpend,
      month: monthSpend,
      total: totalSpend,
      source: usageSummary.available ? usageSummary.source : fallbackSource,
      status: usageSummary.available ? usageSummary.status : 'fallback-request-log',
    },
    tokens: {
      cached,
      daily: toNumber(periods.todayTokens),
      weekly: toNumber(periods.weekTokens),
      monthly: toNumber(periods.monthTokens),
      input,
      output,
      total: input + output + cached,
    },
    usage: {
      ...usage,
      cachedTokens: cached,
      totalTokens: input + output + cached,
      todayTokens: toNumber(periods.todayTokens),
      weekTokens: toNumber(periods.weekTokens),
      monthTokens: toNumber(periods.monthTokens),
    },
    trend: limitItems((snapshot.trend || []).slice(-TREND_POINT_LIMIT), TREND_POINT_LIMIT),
    trend7d,
  };
}

async function getRelaySnapshot(options = {}) {
  const snapshot = await buildSnapshot(options);
  return withRendererAliases(snapshot);
}

module.exports = {
  buildSnapshot,
  getRelaySnapshot,
  unavailableSnapshot,
  withRendererAliases,
};
