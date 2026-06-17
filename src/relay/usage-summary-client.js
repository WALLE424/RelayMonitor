'use strict';

const { DEFAULT_QUOTA_PER_UNIT } = require('./balance-client');
const { stripTags } = require('./web-balance-client');

const DEFAULT_CURRENCY = 'USD';

const USAGE_API_PATHS = [
  '/api/usage/token',
  '/api/usage',
  '/api/user/quota',
  '/api/user/self',
  '/api/user',
  '/api/dashboard',
  '/api/account',
  '/dashboard/billing/credit_grants',
];

const USAGE_PAGE_PATHS = [
  '/console',
  '/dashboard',
  '/billing',
  '/user/billing',
  '/wallet',
  '/usage',
  '/log',
];

function toNumber(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function normalizeMoney(value) {
  const number = toNumber(value);
  return number == null ? null : Number(number.toFixed(6));
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function readPath(source, path) {
  const parts = String(path || '').split('.');
  let cursor = source;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || !Object.prototype.hasOwnProperty.call(cursor, part)) {
      return undefined;
    }
    cursor = cursor[part];
  }
  return cursor;
}

function firstNumber(source, paths) {
  for (const path of paths) {
    const number = toNumber(readPath(source, path));
    if (number != null) return { value: number, path };
  }
  return { value: null, path: '' };
}

function firstText(source, paths, fallback = '') {
  for (const path of paths) {
    const value = readPath(source, path);
    if (value != null && value !== '') return String(value);
  }
  return fallback;
}

function quotaPerUnitFromPayload(payload, fallback = DEFAULT_QUOTA_PER_UNIT) {
  const quotaPerUnit = firstNumber(payload, [
    'quota_per_unit',
    'quotaPerUnit',
    'data.quota_per_unit',
    'data.quotaPerUnit',
    'status.quota_per_unit',
    'status.quotaPerUnit',
    'data.status.quota_per_unit',
    'data.status.quotaPerUnit',
  ]);
  return quotaPerUnit.value && quotaPerUnit.value > 0 ? quotaPerUnit.value : fallback;
}

function normalizeUsageSummaryPayload(input = {}, options = {}) {
  const payload = isObject(input) ? input : {};
  const directTotal = firstNumber(payload, [
    'totalSpend',
    'total_spend',
    'totalCost',
    'total_cost',
    'total_cost_usd',
    'totalCostUsd',
    'total_consumption',
    'totalConsumption',
    'total_used_money',
    'totalUsedMoney',
    'spent',
    'used',
    'consumed',
    'data.totalSpend',
    'data.total_spend',
    'data.totalCost',
    'data.total_cost',
    'data.total_cost_usd',
    'data.totalCostUsd',
    'data.total_consumption',
    'data.totalConsumption',
    'data.total_used_money',
    'data.totalUsedMoney',
    'data.spent',
    'data.used',
    'data.consumed',
    'data.user.total_spend',
    'data.user.totalSpend',
    'user.total_spend',
    'user.totalSpend',
  ]);
  const today = firstNumber(payload, [
    'todaySpend',
    'today_spend',
    'todayCost',
    'today_cost',
    'dailySpend',
    'daily_spend',
    'data.todaySpend',
    'data.today_spend',
    'data.todayCost',
    'data.today_cost',
    'data.dailySpend',
    'data.daily_spend',
  ]);
  const week = firstNumber(payload, [
    'weekSpend',
    'week_spend',
    'weeklySpend',
    'weekly_spend',
    'weekCost',
    'week_cost',
    'data.weekSpend',
    'data.week_spend',
    'data.weeklySpend',
    'data.weekly_spend',
    'data.weekCost',
    'data.week_cost',
  ]);
  const month = firstNumber(payload, [
    'monthSpend',
    'month_spend',
    'monthlySpend',
    'monthly_spend',
    'monthCost',
    'month_cost',
    'data.monthSpend',
    'data.month_spend',
    'data.monthlySpend',
    'data.monthly_spend',
    'data.monthCost',
    'data.month_cost',
  ]);

  let totalCost = normalizeMoney(directTotal.value);
  let sourceField = directTotal.path;
  let rawQuota = null;
  let quotaPerUnit = null;
  if (totalCost == null) {
    const quotaUsed = firstNumber(payload, [
      'total_used',
      'totalUsed',
      'used_quota',
      'usedQuota',
      'quota_used',
      'quotaUsed',
      'data.total_used',
      'data.totalUsed',
      'data.used_quota',
      'data.usedQuota',
      'data.quota_used',
      'data.quotaUsed',
      'data.token.total_used',
      'data.token.totalUsed',
      'token.total_used',
      'token.totalUsed',
    ]);
    if (quotaUsed.value != null) {
      quotaPerUnit = quotaPerUnitFromPayload(payload, options.quotaPerUnit);
      rawQuota = quotaUsed.value;
      totalCost = normalizeMoney(rawQuota / quotaPerUnit);
      sourceField = quotaUsed.path;
    }
  }

  return {
    status: totalCost == null && today.value == null && week.value == null && month.value == null ? 'unknown' : 'ok',
    totalCost,
    todayCost: normalizeMoney(today.value),
    weekCost: normalizeMoney(week.value),
    monthCost: normalizeMoney(month.value),
    currency: firstText(payload, ['currency', 'unit', 'data.currency', 'data.unit'], options.currency || DEFAULT_CURRENCY),
    sourceField,
    rawQuota,
    quotaPerUnit,
  };
}

function endpointOrigin(value) {
  try {
    return new URL(value).origin;
  } catch (_) {
    return '';
  }
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function resolveEndpoint(value, baseUrl) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).toString();
  } catch (_) {
    const origin = endpointOrigin(baseUrl);
    return origin ? new URL(raw.startsWith('/') ? raw : `/${raw}`, origin).toString() : '';
  }
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function buildUsageSummaryCandidates(provider = {}, options = {}) {
  const baseUrl = provider.baseUrl || provider.base_url || provider.endpoint || provider.url || options.pageUrl || '';
  const explicit = [
    provider.usageSummaryEndpoint,
    provider.usage_summary_endpoint,
    provider.billingEndpoint,
    provider.billing_endpoint,
    provider.balanceEndpoint,
    provider.balance_endpoint,
    options.endpoint,
  ].map((item) => resolveEndpoint(item, baseUrl));
  const origin = endpointOrigin(baseUrl);
  const common = origin ? USAGE_API_PATHS.map((item) => `${trimTrailingSlash(origin)}${item}`) : [];
  return unique([...explicit, ...common]);
}

function pageCandidates(pageUrl) {
  const raw = String(pageUrl || '').trim();
  if (!raw) return [];
  const urls = [raw];
  try {
    const origin = new URL(raw).origin;
    for (const pagePath of USAGE_PAGE_PATHS) urls.push(new URL(pagePath, origin).toString());
  } catch (_) {
    // Keep explicit page only.
  }
  return unique(urls);
}

async function responseText(response) {
  if (typeof response.text === 'function') return response.text();
  if (typeof response.json === 'function') return JSON.stringify(await response.json());
  return String(response.body || '');
}

function parseJsonText(text) {
  const raw = String(text || '').trim();
  if (!raw || !/^[{[]/.test(raw)) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function amountAfterLabel(text, labels) {
  for (const label of labels) {
    const patterns = [
      new RegExp(`(?:${label})\\s*[:：]?\\s*(?:[¥￥$]|CNY|RMB|USD)?\\s*(-?\\d[\\d,]*(?:\\.\\d+)?)`, 'i'),
      new RegExp(`(?:[¥￥$]|CNY|RMB|USD)\\s*(-?\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:${label})`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const amount = match ? toNumber(match[1]) : null;
      if (amount != null) return amount;
    }
  }
  return null;
}

function failure(status, source, endpoint, error, extra = {}) {
  return {
    status,
    available: false,
    totalCost: null,
    todayCost: null,
    weekCost: null,
    monthCost: null,
    currency: DEFAULT_CURRENCY,
    source,
    endpoint,
    error,
    ...extra,
  };
}

function statusFromHttp(response) {
  if (response.status === 401 || response.status === 403) return 'auth-required';
  if (response.status === 429) return 'rate-limited';
  if (response.status === 404) return 'unavailable';
  return 'error';
}

async function readOfficialUsageSummary(provider = {}, options = {}) {
  if (options.enabled === false) return null;
  const fetchImpl = options.providerFetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return null;
  const candidates = options.candidates || buildUsageSummaryCandidates(provider, options);
  if (!candidates.length) return null;
  let lastResult = null;

  for (const endpoint of candidates) {
    const controller = !options.signal && typeof AbortController === 'function'
      ? new AbortController()
      : null;
    const timer = controller ? setTimeout(() => controller.abort(), options.timeoutMs || 2500) : null;
    timer?.unref?.();
    try {
      const response = await fetchImpl(endpoint, {
        method: 'GET',
        signal: options.signal || controller?.signal,
        headers: {
          Accept: 'application/json,text/plain,*/*',
          ...(options.headers || {}),
        },
      });
      const finalUrl = response.url || endpoint;
      const text = await responseText(response);
      if (!response.ok) {
        lastResult = failure(statusFromHttp(response), 'relay-official-api', finalUrl, `Usage summary API returned HTTP ${response.status}`, {
          httpStatus: response.status,
        });
        if (lastResult.status === 'rate-limited') return lastResult;
        continue;
      }
      const payload = parseJsonText(text);
      if (!payload) {
        lastResult = failure('parse-error', 'relay-official-api', finalUrl, 'Usage summary API did not return JSON', {
          httpStatus: response.status,
        });
        continue;
      }
      const normalized = normalizeUsageSummaryPayload(payload, options);
      if (normalized.status === 'ok') {
        return {
          ...normalized,
          available: true,
          source: 'relay-official-api',
          endpoint: finalUrl,
          httpStatus: response.status,
          updatedAt: new Date().toISOString(),
        };
      }
      lastResult = failure('parse-error', 'relay-official-api', finalUrl, 'Unable to extract usage summary from API JSON', {
        httpStatus: response.status,
      });
    } catch (error) {
      lastResult = failure(error.name === 'AbortError' ? 'timeout' : 'error', 'relay-official-api', endpoint, error.message);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return lastResult;
}

function extractUsageSummaryFromHtml(html, selector = '') {
  const raw = String(html || '');
  const selectedText = selector ? stripTags(raw.match(new RegExp(`<[^>]+(?:class|id)=["'][^"']*${selector.replace(/^[.#]/, '')}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i'))?.[1] || '') : '';
  const selectedAmount = selectedText ? toNumber(selectedText.match(/-?\d[\d,]*(?:\.\d+)?/)?.[0]) : null;
  if (selectedAmount != null) {
    return {
      status: 'ok',
      totalCost: normalizeMoney(selectedAmount),
      sourceField: selector,
      currency: DEFAULT_CURRENCY,
    };
  }

  const payload = parseJsonText(raw.match(/[{[][\s\S]*[}\]]/)?.[0] || '');
  if (payload) {
    const normalized = normalizeUsageSummaryPayload(payload);
    if (normalized.status === 'ok') return normalized;
  }

  const text = stripTags(raw);
  const totalCost = amountAfterLabel(text, [
    '总消费', '累计消费', '已消费', '总花费', '总支出', '消费总额',
    'Total\\s+(?:Spend|Spent|Cost|Used)', 'Lifetime\\s+(?:Spend|Cost)', 'Consumed',
  ]);
  const todayCost = amountAfterLabel(text, [
    '今日消费', '今日花费', '今日支出', '当天消费', '今天消费',
    'Today\\s+(?:Spend|Spent|Cost|Used)', 'Daily\\s+(?:Spend|Cost|Used)',
  ]);
  const weekCost = amountAfterLabel(text, [
    '本周消费', '七天消费', '近7天消费', '最近7天消费', '周消费',
    'Week(?:ly)?\\s+(?:Spend|Spent|Cost|Used)', '7\\s*days?\\s+(?:Spend|Cost|Used)',
  ]);
  const monthCost = amountAfterLabel(text, [
    '本月消费', '月消费', '当月消费', '本月花费',
    'Month(?:ly)?\\s+(?:Spend|Spent|Cost|Used)',
  ]);

  if ([totalCost, todayCost, weekCost, monthCost].some((amount) => amount != null)) {
    return {
      status: 'ok',
      totalCost: normalizeMoney(totalCost),
      todayCost: normalizeMoney(todayCost),
      weekCost: normalizeMoney(weekCost),
      monthCost: normalizeMoney(monthCost),
      sourceField: 'html-usage-regex',
      currency: DEFAULT_CURRENCY,
    };
  }
  return failure('parse-error', 'relay-web-session', '', 'Unable to extract usage summary from page');
}

async function readWebUsageSummary(options = {}) {
  const fetchImpl = options.fetch;
  const pageUrl = String(options.pageUrl || '').trim();
  if (typeof fetchImpl !== 'function' || !pageUrl) return null;
  let lastResult = null;
  for (const candidateUrl of pageCandidates(pageUrl)) {
    try {
      const response = await fetchImpl(candidateUrl, {
        method: 'GET',
        headers: { Accept: 'text/html,application/json,text/plain,*/*' },
      });
      const finalUrl = response.url || candidateUrl;
      const text = await responseText(response);
      if (response.status === 401 || response.status === 403 || /login|signin|password|登录|密码/i.test(stripTags(text))) {
        lastResult = failure('auth-required', 'relay-web-session', finalUrl, 'Usage summary page requires login', {
          httpStatus: response.status,
        });
        continue;
      }
      if (!response.ok) {
        lastResult = failure(statusFromHttp(response), 'relay-web-session', finalUrl, `Usage summary page returned HTTP ${response.status}`, {
          httpStatus: response.status,
        });
        continue;
      }
      const normalized = extractUsageSummaryFromHtml(text, options.selector || '');
      if (normalized.status === 'ok') {
        return {
          ...normalized,
          available: true,
          source: 'relay-web-session',
          endpoint: finalUrl,
          httpStatus: response.status,
          updatedAt: new Date().toISOString(),
        };
      }
      lastResult = { ...normalized, endpoint: finalUrl };
    } catch (error) {
      lastResult = failure('error', 'relay-web-session', candidateUrl, error.message);
    }
  }

  if (typeof options.renderText === 'function') {
    for (const candidateUrl of pageCandidates(pageUrl)) {
      const renderedText = await options.renderText(candidateUrl, {
        timeoutMs: options.renderTimeoutMs,
        settleMs: options.renderSettleMs,
      });
      if (!renderedText) continue;
      if (/login|signin|password|登录|密码/i.test(renderedText)) {
        lastResult = failure('auth-required', 'relay-web-session-rendered', candidateUrl, 'Rendered usage summary page requires login');
        continue;
      }
      const normalized = extractUsageSummaryFromHtml(renderedText, options.selector || '');
      if (normalized.status === 'ok') {
        return {
          ...normalized,
          available: true,
          source: 'relay-web-session-rendered',
          endpoint: candidateUrl,
          updatedAt: new Date().toISOString(),
        };
      }
      lastResult = { ...normalized, source: 'relay-web-session-rendered', endpoint: candidateUrl };
    }
  }

  return lastResult;
}

async function readUsageSummary(provider = {}, options = {}) {
  const official = options.skipOfficial === true ? null : await readOfficialUsageSummary(provider, options);
  if (official?.status === 'ok') return official;
  const web = await readWebUsageSummary(options);
  if (web?.status === 'ok') return web;
  return official || web || failure('unavailable', 'ccswitch-request-log', '', 'No relay official usage summary was available');
}

module.exports = {
  buildUsageSummaryCandidates,
  extractUsageSummaryFromHtml,
  normalizeUsageSummaryPayload,
  readUsageSummary,
};
