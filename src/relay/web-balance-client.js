'use strict';

const {
  DEFAULT_QUOTA_PER_UNIT,
  normalizeBalance,
} = require('./balance-client');

const DEFAULT_CURRENCY = 'USD';

const BALANCE_WORDS = [
  '\u4f59\u989d',
  '\u8d26\u6237\u4f59\u989d',
  '\u53ef\u7528\u4f59\u989d',
  '\u5f53\u524d\u4f59\u989d',
  '\u5269\u4f59\u91d1\u989d',
  '\u5269\u4f59\u989d\u5ea6',
  '\u53ef\u7528\u989d\u5ea6',
  '\u5269\u4f59\u989d',
  '\u8d26\u6237\u4f59\u91cf',
  '\u989d\u5ea6',
  '\u5145\u503c\u4f59\u989d',
  'Balance',
  'Credit',
  'Credits',
  'Remaining',
  'Available',
  'Quota',
  'Wallet',
  'Amount',
];

const LOGIN_WORDS = [
  '\u767b\u5f55',
  '\u767b\u9678',
  '\u767b\u5165',
  '\u5bc6\u7801',
  '\u9a8c\u8bc1\u7801',
  '\u9a57\u8b49\u78bc',
  'sign in',
  'login',
  'password',
  'captcha',
];

const COMMON_BALANCE_PAGE_PATHS = [
  '/',
  '/dashboard',
  '/console',
  '/panel',
  '/user',
  '/user/index',
  '/user/profile',
  '/user/billing',
  '/billing',
  '/wallet',
  '/topup',
  '/log',
];

const STATUS_API_PATHS = [
  '/api/status',
];

const BALANCE_API_PATHS = [
  '/api/user/self',
  '/api/user/quota',
  '/api/user/balance',
  '/api/user',
  '/api/profile',
  '/api/account',
  '/api/dashboard',
  '/api/usage',
  '/api/usage/token',
];

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripTags(value) {
  return decodeEntities(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function selectorText(html, selector) {
  const trimmed = String(selector || '').trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('#')) {
    const id = escapeRegExp(trimmed.slice(1));
    const match = String(html || '').match(new RegExp(`<([a-z][\\w:-]*)[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i'));
    return match ? stripTags(match[2]) : '';
  }

  if (trimmed.startsWith('.')) {
    const className = escapeRegExp(trimmed.slice(1));
    const match = String(html || '').match(new RegExp(`<([a-z][\\w:-]*)[^>]*\\bclass=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i'));
    return match ? stripTags(match[2]) : '';
  }

  const dataAttr = trimmed.match(/^\[([\w:-]+)(?:=["']?([^"'\]]+)["']?)?]$/);
  if (dataAttr) {
    const attr = escapeRegExp(dataAttr[1]);
    const val = dataAttr[2] ? `["'][^"']*${escapeRegExp(dataAttr[2])}[^"']*["']` : '(?:[^>"\']+|["\'][^"\']*["\'])+';
    const match = String(html || '').match(new RegExp(`<([a-z][\\w:-]*)[^>]*\\b${attr}(?:=${val})?[^>]*>([\\s\\S]*?)<\\/\\1>`, 'i'));
    return match ? stripTags(match[2]) : '';
  }

  return '';
}

function parseAmount(value) {
  const text = String(value || '')
    .replace(/,/g, '')
    .replace(/\uffe5/g, '\u00a5')
    .trim();
  const match = text.match(/(?:[\u00a5$]|CNY|RMB|USD)?\s*(-?\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number : null;
}

function normalizeMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number(number.toFixed(6));
}

function keywordPattern() {
  return BALANCE_WORDS.map(escapeRegExp).join('|');
}

function extractJsonLikeBalance(html) {
  const text = String(html || '');
  const patterns = [
    /["'](?:balance|credit|remaining|remain|amount|available)["']\s*:\s*["']?(-?\d[\d,]*(?:\.\d+)?)["']?/i,
    /["'](?:quota|user_quota|quota_remaining|available_quota|remain_quota)["']\s*:\s*["']?(-?\d[\d,]*(?:\.\d+)?)["']?/i,
  ];
  for (const [index, pattern] of patterns.entries()) {
    const match = text.match(pattern);
    const amount = match ? parseAmount(match[1]) : null;
    if (amount != null) {
      if (index === 1) {
        const quotaUnitMatch = text.match(/["'](?:quota_per_unit|quotaPerUnit)["']\s*:\s*["']?(\d[\d,]*(?:\.\d+)?)["']?/i);
        const quotaPerUnit = quotaUnitMatch ? parseAmount(quotaUnitMatch[1]) : DEFAULT_QUOTA_PER_UNIT;
        return {
          amount: normalizeMoney(amount / (quotaPerUnit || DEFAULT_QUOTA_PER_UNIT)),
          sourceField: 'html-json-like-quota',
          matchedText: match[0].slice(0, 120),
        };
      }
      return { amount, sourceField: 'html-json-like', matchedText: match[0].slice(0, 120) };
    }
  }
  return null;
}

function extractBalanceFromHtml(html, selector = '') {
  const selected = selectorText(html, selector);
  if (selected) {
    const selectedAmount = parseAmount(selected);
    if (selectedAmount != null) {
      return { amount: selectedAmount, sourceField: selector, matchedText: selected.slice(0, 120) };
    }
  }

  const jsonLike = extractJsonLikeBalance(html);
  if (jsonLike) return jsonLike;

  const text = stripTags(html);
  const words = keywordPattern();
  const patterns = [
    new RegExp(`(?:${words})\\s*[:\uff1a：]?\\s*(?:[\u00a5\uffe5$]|CNY|RMB|USD)?\\s*(-?\\d[\\d,]*(?:\\.\\d+)?)`, 'i'),
    new RegExp(`(?:[\u00a5\uffe5$]|CNY|RMB|USD)\\s*(-?\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:${words})`, 'i'),
    /(?:[\u00a5\uffe5$])\s*(-?\d[\d,]*(?:\.\d+)?)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const amount = parseAmount(match[1]);
      if (amount != null) {
        return { amount, sourceField: 'html-regex', matchedText: match[0].slice(0, 120) };
      }
    }
  }

  return { amount: null, sourceField: '', matchedText: '' };
}

function looksLikeLogin(url, html) {
  const target = String(url || '').toLowerCase();
  const text = stripTags(html).toLowerCase();
  return /login|signin|sign-in|auth/.test(target)
    || LOGIN_WORDS.some((word) => text.includes(word.toLowerCase()));
}

function pageCandidates(pageUrl) {
  const raw = String(pageUrl || '').trim();
  if (!raw) return [];
  const urls = [raw];
  try {
    const origin = new URL(raw).origin;
    for (const path of COMMON_BALANCE_PAGE_PATHS) {
      urls.push(new URL(path, origin).toString());
    }
  } catch (_) {
    // Keep the explicit URL only when it is not parseable.
  }
  return Array.from(new Set(urls));
}

function originFromUrl(value) {
  try {
    return new URL(value).origin;
  } catch (_) {
    return '';
  }
}

function apiCandidates(pageUrl) {
  const origin = originFromUrl(pageUrl);
  if (!origin) return [];
  return BALANCE_API_PATHS.map((item) => new URL(item, origin).toString());
}

function statusApiCandidates(pageUrl) {
  const origin = originFromUrl(pageUrl);
  if (!origin) return [];
  return STATUS_API_PATHS.map((item) => new URL(item, origin).toString());
}

async function responseText(response) {
  if (typeof response.text === 'function') return response.text();
  if (typeof response.body === 'string') return response.body;
  return '';
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

function isTerminalApiFailure(result) {
  return result?.status === 'rate-limited';
}

function preferFailure(current, next) {
  if (!current) return next;
  if (!next) return current;
  const rank = {
    'rate-limited': 90,
    'auth-required': 70,
    error: 50,
    unavailable: 30,
    'parse-error': 20,
  };
  return (rank[next.status] || 0) > (rank[current.status] || 0) ? next : current;
}

function failureFromHttp(response, endpoint, providerId, source = 'web-session-api') {
  const status = response.status === 401 || response.status === 403
    ? 'auth-required'
    : response.status === 429
      ? 'rate-limited'
      : response.status === 404
        ? 'unavailable'
        : 'error';
  return {
    status,
    available: false,
    amount: null,
    balance: null,
    currency: DEFAULT_CURRENCY,
    providerId,
    source,
    endpoint,
    httpStatus: response.status,
    error: status === 'auth-required'
      ? 'Balance API requires login'
      : status === 'rate-limited'
        ? 'Balance API is rate limited'
        : `Balance API returned HTTP ${response.status}`,
  };
}

function quotaPerUnitFromStatusPayload(payload) {
  const normalized = normalizeBalance(payload);
  const fields = [
    payload?.quota_per_unit,
    payload?.quotaPerUnit,
    payload?.data?.quota_per_unit,
    payload?.data?.quotaPerUnit,
    normalized.quotaPerUnit,
  ];
  for (const value of fields) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return DEFAULT_QUOTA_PER_UNIT;
}

async function readQuotaPerUnit(fetchImpl, pageUrl, providerId) {
  for (const endpoint of statusApiCandidates(pageUrl)) {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json,text/plain,*/*' },
    });
    const text = await responseText(response);
    if (response.status === 429) {
      return {
        quotaPerUnit: DEFAULT_QUOTA_PER_UNIT,
        failure: failureFromHttp(response, response.url || endpoint, providerId),
      };
    }
    if (!response.ok) continue;
    const payload = parseJsonText(text);
    if (payload) {
      return {
        quotaPerUnit: quotaPerUnitFromStatusPayload(payload),
        endpoint: response.url || endpoint,
      };
    }
  }
  return { quotaPerUnit: DEFAULT_QUOTA_PER_UNIT };
}

async function readWebSessionApiBalance({ fetchImpl, pageUrl, providerId, currency }) {
  const statusResult = await readQuotaPerUnit(fetchImpl, pageUrl, providerId);
  if (statusResult.failure?.status === 'rate-limited') return statusResult.failure;

  let lastFailure = null;
  for (const endpoint of apiCandidates(pageUrl)) {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json,text/plain,*/*' },
    });
    const finalUrl = response.url || endpoint;
    const text = await responseText(response);
    if (response.status === 401 || response.status === 403 || looksLikeLogin(finalUrl, text)) {
      lastFailure = failureFromHttp(response, finalUrl, providerId);
      break;
    }
    if (!response.ok) {
      lastFailure = failureFromHttp(response, finalUrl, providerId);
      if (lastFailure.status === 'rate-limited') return lastFailure;
      continue;
    }

    const payload = parseJsonText(text);
    if (!payload) {
      lastFailure = {
        status: 'parse-error',
        available: false,
        amount: null,
        balance: null,
        currency: DEFAULT_CURRENCY,
        providerId,
        source: 'web-session-api',
        endpoint: finalUrl,
        httpStatus: response.status,
        error: 'Balance API did not return JSON',
      };
      continue;
    }

    const normalized = normalizeBalance(payload, { quotaPerUnit: statusResult.quotaPerUnit });
    if (normalized.status === 'ok' && normalized.amount != null) {
      return {
        ...normalized,
        available: true,
        currency: currency || normalized.currency || DEFAULT_CURRENCY,
        providerId,
        source: 'web-session-api',
        endpoint: finalUrl,
        statusEndpoint: statusResult.endpoint || '',
        httpStatus: response.status,
        updatedAt: new Date().toISOString(),
      };
    }
    lastFailure = {
      ...normalized,
      status: 'parse-error',
      available: false,
      providerId,
      source: 'web-session-api',
      endpoint: finalUrl,
      httpStatus: response.status,
      error: 'Unable to extract balance from API JSON',
    };
  }
  return lastFailure;
}

async function readWebSessionBalance(options = {}) {
  const pageUrl = String(options.pageUrl || '').trim();
  const providerId = options.providerId || '';
  if (!pageUrl) {
    return {
      status: 'unavailable',
      available: false,
      amount: null,
      balance: null,
      currency: DEFAULT_CURRENCY,
      providerId,
      source: 'web-session',
      error: 'Balance page URL is not configured',
    };
  }

  const fetchImpl = options.fetch;
  if (typeof fetchImpl !== 'function') {
    return {
      status: 'error',
      available: false,
      amount: null,
      balance: null,
      currency: DEFAULT_CURRENCY,
      providerId,
      source: 'web-session',
      endpoint: pageUrl,
      error: 'web session fetch is not available',
    };
  }

  try {
    let lastFailure = null;
    const apiBalance = await readWebSessionApiBalance({
      fetchImpl,
      pageUrl,
      providerId,
      currency: options.currency,
    });
    if (apiBalance?.status === 'ok' || isTerminalApiFailure(apiBalance)) {
      return apiBalance;
    }
    if (apiBalance) lastFailure = apiBalance;

    for (const candidateUrl of pageCandidates(pageUrl)) {
      const response = await fetchImpl(candidateUrl, { method: 'GET' });
      const finalUrl = response.url || candidateUrl;
      const html = typeof response.text === 'function' ? await response.text() : String(response.body || '');
      if (response.status === 401 || response.status === 403 || looksLikeLogin(finalUrl, html)) {
        lastFailure = preferFailure(lastFailure, {
          status: 'auth-required',
          available: false,
          amount: null,
          balance: null,
          currency: DEFAULT_CURRENCY,
          providerId,
          source: 'web-session',
          endpoint: finalUrl,
          httpStatus: response.status,
          error: 'Balance page requires login',
        });
        continue;
      }
      if (!response.ok) {
        const rateLimited = response.status === 429;
        lastFailure = preferFailure(lastFailure, {
          status: rateLimited ? 'rate-limited' : 'error',
          available: false,
          amount: null,
          balance: null,
          currency: DEFAULT_CURRENCY,
          providerId,
          source: 'web-session',
          endpoint: finalUrl,
          httpStatus: response.status,
          error: rateLimited ? 'Balance page is rate limited' : `Balance page returned HTTP ${response.status}`,
        });
        if (rateLimited) return lastFailure;
        continue;
      }

      const parsed = extractBalanceFromHtml(html, options.selector || '');
      if (parsed.amount != null) {
        return {
          status: 'ok',
          available: true,
          amount: parsed.amount,
          balance: parsed.amount,
          currency: options.currency || DEFAULT_CURRENCY,
          providerId,
          source: 'web-session',
          sourceField: parsed.sourceField,
          endpoint: finalUrl,
          httpStatus: response.status,
          updatedAt: new Date().toISOString(),
        };
      }
      lastFailure = preferFailure(lastFailure, {
        status: 'parse-error',
        available: false,
        amount: null,
        balance: null,
        currency: DEFAULT_CURRENCY,
        providerId,
        source: 'web-session',
        endpoint: finalUrl,
        httpStatus: response.status,
        error: 'Unable to extract balance from page',
      });
    }

    if (typeof options.renderText === 'function') {
      for (const candidateUrl of pageCandidates(pageUrl)) {
        const renderedText = await options.renderText(candidateUrl, {
          timeoutMs: options.renderTimeoutMs,
          settleMs: options.renderSettleMs,
        });
        if (!renderedText) continue;
        if (looksLikeLogin(candidateUrl, renderedText)) {
          lastFailure = preferFailure(lastFailure, {
            status: 'auth-required',
            available: false,
            amount: null,
            balance: null,
            currency: DEFAULT_CURRENCY,
            providerId,
            source: 'web-session-rendered',
            endpoint: candidateUrl,
            error: 'Rendered balance page requires login',
          });
          continue;
        }
        const parsed = extractBalanceFromHtml(renderedText, options.selector || '');
        if (parsed.amount != null) {
          return {
            status: 'ok',
            available: true,
            amount: parsed.amount,
            balance: parsed.amount,
            currency: options.currency || DEFAULT_CURRENCY,
            providerId,
            source: 'web-session-rendered',
            sourceField: parsed.sourceField || 'rendered-text',
            endpoint: candidateUrl,
            updatedAt: new Date().toISOString(),
          };
        }
        lastFailure = preferFailure(lastFailure, {
          status: 'parse-error',
          available: false,
          amount: null,
          balance: null,
          currency: DEFAULT_CURRENCY,
          providerId,
          source: 'web-session-rendered',
          endpoint: candidateUrl,
          error: 'Unable to extract balance from rendered page',
        });
      }
    }

    return lastFailure || {
      status: 'parse-error',
      available: false,
      amount: null,
      balance: null,
      currency: DEFAULT_CURRENCY,
      providerId,
      source: 'web-session',
      endpoint: pageUrl,
      error: 'Unable to extract balance from page',
    };
  } catch (error) {
    return {
      status: 'error',
      available: false,
      amount: null,
      balance: null,
      currency: DEFAULT_CURRENCY,
      providerId,
      source: 'web-session',
      endpoint: pageUrl,
      error: error.message,
    };
  }
}

module.exports = {
  apiCandidates,
  extractBalanceFromHtml,
  pageCandidates,
  readWebSessionBalance,
  stripTags,
};
