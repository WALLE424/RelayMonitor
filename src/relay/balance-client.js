'use strict';

const DEFAULT_CURRENCY = 'USD';
const DEFAULT_QUOTA_PER_UNIT = 500000;

const COMMON_BALANCE_PATHS = [
  '/api/user/self',
  '/api/user/quota',
  '/api/user/balance',
  '/api/usage/token',
  '/api/token/self',
  '/dashboard/billing/credit_grants',
];

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function readPath(input, path) {
  if (!isObject(input)) return undefined;
  let cursor = input;
  for (const part of path.split('.')) {
    if (!isObject(cursor) && typeof cursor !== 'object') return undefined;
    if (cursor == null || cursor[part] == null || cursor[part] === '') return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function firstNumber(input, paths) {
  for (const path of paths) {
    const value = readPath(input, path);
    const number = toNumber(value);
    if (number != null) return { value: number, path };
  }
  return { value: null, path: '' };
}

function normalizeMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number(number.toFixed(6));
}

function quotaPerUnitFromPayload(input, fallback = DEFAULT_QUOTA_PER_UNIT) {
  const explicit = firstNumber(input, [
    'quota_per_unit',
    'quotaPerUnit',
    'data.quota_per_unit',
    'data.quotaPerUnit',
    'status.quota_per_unit',
    'status.quotaPerUnit',
    'data.status.quota_per_unit',
    'data.status.quotaPerUnit',
  ]);
  const value = explicit.value != null ? explicit.value : Number(fallback);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_QUOTA_PER_UNIT;
}

function firstText(input, paths, fallback = '') {
  for (const path of paths) {
    const value = readPath(input, path);
    if (value != null && value !== '') return String(value);
  }
  return fallback;
}

function firstBoolean(input, paths) {
  for (const path of paths) {
    const value = readPath(input, path);
    if (value === true || value === 'true' || value === 1 || value === '1') return { value: true, path };
    if (value === false || value === 'false' || value === 0 || value === '0') return { value: false, path };
  }
  return { value: null, path: '' };
}

function normalizeBalancePayload(input, options = {}) {
  const payload = isObject(input) ? input : {};
  const unlimited = firstBoolean(payload, [
    'unlimited_quota',
    'unlimitedQuota',
    'data.unlimited_quota',
    'data.unlimitedQuota',
    'token.unlimited_quota',
    'data.token.unlimited_quota',
  ]);
  if (unlimited.value === true) {
    const rawQuota = firstNumber(payload, [
      'total_available',
      'available',
      'remaining',
      'data.total_available',
      'data.available',
      'data.remaining',
    ]);
    const quotaPerUnit = quotaPerUnitFromPayload(payload, options.quotaPerUnit);
    return {
      status: 'unlimited',
      amount: null,
      sourceField: unlimited.path,
      quotaPerUnit,
      rawQuota: rawQuota.value,
    };
  }

  if (options.treatAvailableAsQuota) {
    const quotaAvailable = firstNumber(payload, [
      'available',
      'remaining',
      'remain',
      'total_available',
      'available_quota',
      'remaining_quota',
      'quota_remaining',
      'data.available',
      'data.remaining',
      'data.remain',
      'data.total_available',
      'data.available_quota',
      'data.remaining_quota',
      'data.quota_remaining',
    ]);
    if (quotaAvailable.value != null) {
      const quotaPerUnit = quotaPerUnitFromPayload(payload, options.quotaPerUnit);
      return {
        amount: normalizeMoney(quotaAvailable.value / quotaPerUnit),
        sourceField: quotaAvailable.path,
        quotaPerUnit,
        rawQuota: quotaAvailable.value,
      };
    }
  }

  const direct = firstNumber(payload, [
    'balance',
    'credit',
    'remaining',
    'remain',
    'amount',
    'available',
    'data.balance',
    'data.credit',
    'data.remaining',
    'data.remain',
    'data.amount',
    'data.available',
    'data.user.balance',
    'data.user.credit',
    'user.balance',
    'user.credit',
  ]);
  if (direct.value != null) {
    return { amount: direct.value, sourceField: direct.path };
  }

  const quota = firstNumber(payload, [
    'quota',
    'available_quota',
    'remaining_quota',
    'quota_remaining',
    'data.quota',
    'data.available_quota',
    'data.remaining_quota',
    'data.quota_remaining',
    'user.quota',
    'data.user.quota',
  ]);
  if (quota.value != null) {
    const quotaPerUnit = quotaPerUnitFromPayload(payload, options.quotaPerUnit);
    return {
      amount: normalizeMoney(quota.value / quotaPerUnit),
      sourceField: quota.path,
      quotaPerUnit,
      rawQuota: quota.value,
    };
  }

  const totalGranted = firstNumber(payload, ['total_granted', 'totalGranted', 'data.total_granted']);
  const totalUsed = firstNumber(payload, ['total_used', 'totalUsed', 'data.total_used']);
  if (totalGranted.value != null) {
    const quotaPerUnit = quotaPerUnitFromPayload(payload, options.quotaPerUnit);
    const rawQuota = totalGranted.value - (totalUsed.value || 0);
    return {
      amount: normalizeMoney(rawQuota / quotaPerUnit),
      sourceField: totalUsed.path ? `${totalGranted.path}-${totalUsed.path}` : totalGranted.path,
      quotaPerUnit,
      rawQuota,
    };
  }

  return { amount: null, sourceField: '' };
}

function normalizeBalance(input = {}, options = {}) {
  const normalized = normalizeBalancePayload(input, options);
  return {
    status: normalized.status || (normalized.amount == null ? 'unknown' : 'ok'),
    available: normalized.status === 'unlimited' || normalized.amount != null,
    amount: normalized.amount,
    balance: normalized.amount,
    currency: firstText(input, ['currency', 'unit', 'data.currency', 'data.unit'], DEFAULT_CURRENCY),
    updatedAt: input.updatedAt || input.updated_at || new Date().toISOString(),
    sourceField: normalized.sourceField,
    quotaPerUnit: normalized.quotaPerUnit,
    rawQuota: normalized.rawQuota,
  };
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function endpointOrigin(baseUrl) {
  try {
    return new URL(baseUrl).origin;
  } catch (_) {
    return '';
  }
}

function resolveEndpoint(endpoint, baseUrl) {
  const raw = String(endpoint || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).toString();
  } catch (_) {
    const origin = endpointOrigin(baseUrl);
    if (!origin) return '';
    return new URL(raw.startsWith('/') ? raw : `/${raw}`, origin).toString();
  }
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function buildBalanceEndpointCandidates(provider = {}, options = {}) {
  const baseUrl = provider.baseUrl || provider.base_url || provider.endpoint || provider.url || '';
  const explicit = [
    provider.balanceEndpoint,
    provider.balance_endpoint,
    provider.balanceUrl,
    provider.balance_url,
    options.endpoint,
  ].map((item) => resolveEndpoint(item, baseUrl));
  const origin = endpointOrigin(baseUrl);
  const common = origin
    ? COMMON_BALANCE_PATHS.map((item) => `${trimTrailingSlash(origin)}${item}`)
    : [];
  return unique([...explicit, ...(options.includeCommon === false ? [] : common)]);
}

function statusFromHttp(response, fallback = 'error') {
  if (response.status === 401 || response.status === 403) return 'auth-required';
  if (response.status === 429) return 'rate-limited';
  if (response.status === 404) return 'unavailable';
  return fallback;
}

async function fetchJson(fetchImpl, endpoint, requestOptions) {
  const response = await fetchImpl(endpoint, requestOptions);
  let json = {};
  try {
    json = await response.json();
  } catch (_) {
    json = {};
  }
  return { response, json };
}

async function readProviderBalance(provider = {}, options = {}) {
  if (options.balance) return normalizeBalance(options.balance);
  const candidates = options.candidates || buildBalanceEndpointCandidates(provider, options);
  if (!candidates.length) {
    return {
      status: 'unavailable',
      available: false,
      amount: null,
      balance: null,
      currency: DEFAULT_CURRENCY,
      providerId: provider.providerId || provider.id || '',
      updatedAt: new Date().toISOString(),
      error: 'No balance endpoint configured',
    };
  }
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return {
      status: 'error',
      available: false,
      amount: null,
      balance: null,
      currency: DEFAULT_CURRENCY,
      providerId: provider.providerId || provider.id || '',
      updatedAt: new Date().toISOString(),
      error: 'fetch is not available in this Node runtime',
    };
  }

  try {
    let lastResult = null;
    for (const endpoint of candidates) {
      const controller = !options.signal && typeof AbortController === 'function'
        ? new AbortController()
        : null;
      const timeout = controller
        ? setTimeout(() => controller.abort(), options.timeoutMs || 2500)
        : null;
      timeout?.unref?.();
      try {
        const { response, json } = await fetchJson(fetchImpl, endpoint, {
          method: 'GET',
          signal: options.signal || controller?.signal,
          headers: options.headers || {},
        });
        const normalized = normalizeBalance(json, {
          treatAvailableAsQuota: /\/api\/usage\/token(?:[/?#]|$)/i.test(endpoint),
        });
        const hasUsableResult = normalized.status === 'ok' || normalized.status === 'unlimited';
        lastResult = {
          ...normalized,
          status: response.ok && hasUsableResult
            ? normalized.status
            : statusFromHttp(response, hasUsableResult ? normalized.status : 'unknown'),
          available: response.ok && (normalized.amount != null || normalized.status === 'unlimited'),
          providerId: provider.providerId || provider.id || '',
          httpStatus: response.status,
          endpoint,
          source: 'relay-endpoint',
          error: response.ok ? '' : `Balance endpoint returned HTTP ${response.status}`,
        };
        if (lastResult.status === 'ok' || lastResult.status === 'unlimited') return lastResult;
      } catch (error) {
        lastResult = {
          status: error.name === 'AbortError' ? 'timeout' : 'error',
          available: false,
          amount: null,
          balance: null,
          currency: DEFAULT_CURRENCY,
          providerId: provider.providerId || provider.id || '',
          updatedAt: new Date().toISOString(),
          endpoint,
          source: 'relay-endpoint',
          error: error.message,
        };
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    return lastResult || {
      status: 'unavailable',
      available: false,
      amount: null,
      balance: null,
      currency: DEFAULT_CURRENCY,
      providerId: provider.providerId || provider.id || '',
      updatedAt: new Date().toISOString(),
      error: 'No balance endpoint responded with a usable balance',
    };
  } catch (error) {
    return {
      status: 'error',
      available: false,
      amount: null,
      balance: null,
      currency: DEFAULT_CURRENCY,
      providerId: provider.providerId || provider.id || '',
      updatedAt: new Date().toISOString(),
      error: error.message,
    };
  }
}

module.exports = {
  buildBalanceEndpointCandidates,
  DEFAULT_QUOTA_PER_UNIT,
  normalizeBalance,
  normalizeBalancePayload,
  readProviderBalance,
};
