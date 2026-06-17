'use strict';

const { maskSecret, previewSecret } = require('../shared/secrets');

const SECRET_KEY_RE = /(?:api[_-]?key|apikey|token|secret|password|authorization|bearer|key)$/i;

function parseJsonObject(value) {
  if (!value) return { value: {}, error: '' };
  if (typeof value === 'object') return { value, error: '' };
  try {
    const parsed = JSON.parse(String(value));
    return { value: parsed && typeof parsed === 'object' ? parsed : {}, error: '' };
  } catch (error) {
    return {
      value: {},
      error: `Unable to parse settings_config JSON: ${error.message}`,
    };
  }
}

function parseMetaConfig(value) {
  return parseJsonObject(value);
}

function stripInlineComment(line) {
  let inString = false;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if ((char === '"' || char === "'") && (!inString || quote === char)) {
      inString = !inString;
      quote = inString ? char : '';
      continue;
    }
    if (char === '#' && !inString) return line.slice(0, index);
  }
  return line;
}

function unquoteTomlString(value) {
  const quote = value[0];
  const body = value.slice(1, -1);
  if (quote === "'") return body;
  return body.replace(/\\(["\\nrt])/g, (_, char) => {
    if (char === 'n') return '\n';
    if (char === 'r') return '\r';
    if (char === 't') return '\t';
    return char;
  });
}

function parseTomlValue(rawValue) {
  const value = rawValue.trim();
  if (!value) return '';
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return unquoteTomlString(value);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((part) => parseTomlValue(part));
  }
  return value;
}

function getSection(root, pathParts) {
  let section = root;
  for (const part of pathParts) {
    if (!section[part] || typeof section[part] !== 'object' || Array.isArray(section[part])) {
      section[part] = {};
    }
    section = section[part];
  }
  return section;
}

function parseCodexToml(toml) {
  const root = {};
  let section = root;
  const lines = String(toml || '').replace(/\r\n?/g, '\n').split('\n');

  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = getSection(root, sectionMatch[1].split('.').map((part) => part.trim()).filter(Boolean));
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) continue;
    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1);
    if (key) section[key] = parseTomlValue(value);
  }

  return root;
}

function firstObjectValue(value) {
  if (!value || typeof value !== 'object') return {};
  for (const item of Object.values(value)) {
    if (item && typeof item === 'object' && !Array.isArray(item)) return item;
  }
  return {};
}

function readPath(input, dottedPath) {
  if (!input || typeof input !== 'object') return undefined;
  let cursor = input;
  for (const part of dottedPath.split('.')) {
    if (!cursor || typeof cursor !== 'object' || cursor[part] == null) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function firstValue(input, paths) {
  for (const fieldPath of paths) {
    const value = readPath(input, fieldPath);
    if (value != null && value !== '') return value;
  }
  return undefined;
}

function normalizeBaseUrlForTemplate(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function extractUsageScriptUrl(meta, baseUrl) {
  const usageScript = meta && typeof meta === 'object' && !Array.isArray(meta)
    ? meta.usage_script || meta.usageScript
    : null;
  if (!usageScript || typeof usageScript !== 'object' || usageScript.enabled === false) return '';
  const directUrl = stringValue(usageScript.url || firstValue(usageScript, [
    'request.url',
    'requestUrl',
    'endpoint',
    'balanceEndpoint',
    'balance_url',
  ]));
  const code = stringValue(usageScript.code);
  const match = directUrl
    ? ['', directUrl]
    : code.match(/\burl\s*:\s*["'`]([^"'`]+)["'`]/i);
  const template = String(match?.[1] || '').trim();
  if (!template) return '';
  const templateBaseUrl = normalizeBaseUrlForTemplate(usageScript.baseUrl || baseUrl);
  return template
    .replace(/\{\{\s*baseUrl\s*}}/gi, templateBaseUrl)
    .replace(/\{\{\s*apiKey\s*}}/gi, '');
}

function usageScriptTimeout(meta) {
  const usageScript = meta && typeof meta === 'object' && !Array.isArray(meta)
    ? meta.usage_script || meta.usageScript
    : null;
  const timeout = Number(usageScript?.timeout);
  return Number.isFinite(timeout) && timeout > 0 ? Math.min(60, timeout) : null;
}

function stringValue(value) {
  if (value && typeof value === 'object') return '';
  return value == null ? '' : String(value).trim();
}

function extractCodexConfig(settings) {
  const configText = settings.config || settings.codex_config || settings.codexConfig || '';
  const toml = parseCodexToml(configText);
  const providerName = toml.model_provider || settings.model_provider || settings.modelProvider || '';
  const providerBlocks = toml.model_providers || {};
  const providerBlock = providerBlocks[providerName] || firstObjectValue(providerBlocks);
  const env = settings.env && typeof settings.env === 'object' ? settings.env : {};

  return {
    baseUrl: stringValue(providerBlock.base_url
      || toml.base_url
      || firstValue(settings, ['base_url', 'baseUrl', 'endpoint', 'api_base_url', 'apiBaseUrl', 'relay_url', 'relayUrl'])
      || firstValue(env, ['OPENAI_BASE_URL', 'ANTHROPIC_BASE_URL', 'BASE_URL'])),
    model: stringValue(toml.model || firstValue(settings, ['model', 'default_model', 'defaultModel', 'model_name', 'modelName'])
      || firstValue(env, ['OPENAI_MODEL', 'ANTHROPIC_MODEL', 'MODEL'])),
    reasoningEffort: stringValue(toml.model_reasoning_effort
      || firstValue(settings, ['model_reasoning_effort', 'modelReasoningEffort', 'reasoning_effort', 'reasoningEffort'])
      || firstValue(env, ['OPENAI_REASONING_EFFORT', 'MODEL_REASONING_EFFORT', 'REASONING_EFFORT'])),
    wireApi: stringValue(providerBlock.wire_api || toml.wire_api || firstValue(settings, ['wire_api', 'wireApi', 'api_type', 'apiType'])),
    modelProvider: stringValue(providerName || firstValue(settings, ['provider', 'provider.name', 'provider.id', 'modelProvider'])),
  };
}

function findSecret(value, keyHint = '', seen = new Set()) {
  if (value == null) return '';
  if (typeof value === 'string') {
    return SECRET_KEY_RE.test(keyHint) || /^(?:sk-|sk_)[A-Za-z0-9_-]+/.test(value) ? value : '';
  }
  if (typeof value !== 'object') return '';
  if (seen.has(value)) return '';
  seen.add(value);

  const entries = Object.entries(value);
  for (const [key, child] of entries) {
    if (SECRET_KEY_RE.test(key)) {
      const found = findSecret(child, key, seen);
      if (found) return found;
      if (typeof child === 'string' && child.trim()) return child;
    }
  }
  for (const [key, child] of entries) {
    const found = findSecret(child, key, seen);
    if (found) return found;
  }
  return '';
}

function extractMaskedKey(settings) {
  const secret = extractSecret(settings);
  return secret ? maskSecret(secret) : '';
}

function extractKeyPreview(settings) {
  const secret = extractSecret(settings);
  return secret ? previewSecret(secret) : '';
}

function extractSecret(settings) {
  return findSecret(settings.auth)
    || findSecret(settings.credentials)
    || findSecret(settings.env)
    || findSecret(settings);
}

function attachInternalSecret(provider, settings) {
  const secret = extractSecret(settings);
  if (!secret) return provider;
  Object.defineProperty(provider, 'apiKey', {
    value: secret,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return provider;
}

function parseProviderConfig(row = {}) {
  const parsed = parseJsonObject(row.settings_config ?? row.settingsConfig);
  const settings = parsed.value;
  const parsedMeta = parseMetaConfig(row.meta);
  const meta = parsedMeta.value;
  const codex = extractCodexConfig(settings);
  const env = settings.env && typeof settings.env === 'object' ? settings.env : {};

  const baseUrl = codex.baseUrl || firstValue(settings, [
    'base_url',
    'baseUrl',
    'endpoint',
    'url',
    'api_url',
    'apiUrl',
    'api_base_url',
    'apiBaseUrl',
    'relay_url',
    'relayUrl',
    'provider.base_url',
    'provider.baseUrl',
    'provider.endpoint',
  ]) || firstValue(env, ['OPENAI_BASE_URL', 'ANTHROPIC_BASE_URL', 'BASE_URL']) || '';
  const model = codex.model || firstValue(settings, [
    'model',
    'default_model',
    'defaultModel',
    'model_name',
    'modelName',
    'provider.model',
    'provider.default_model',
    'provider.defaultModel',
  ]) || firstValue(env, ['OPENAI_MODEL', 'ANTHROPIC_MODEL', 'MODEL']) || '';
  const reasoningEffort = codex.reasoningEffort || firstValue(settings, [
    'model_reasoning_effort',
    'modelReasoningEffort',
    'reasoning_effort',
    'reasoningEffort',
    'provider.reasoning_effort',
    'provider.reasoningEffort',
  ]) || firstValue(env, ['OPENAI_REASONING_EFFORT', 'MODEL_REASONING_EFFORT', 'REASONING_EFFORT']) || '';
  const providerType = row.provider_type || row.providerType || firstValue(settings, [
    'provider_type',
    'providerType',
    'provider.type',
    'type',
  ]);
  const usageScriptEndpoint = extractUsageScriptUrl(meta, stringValue(baseUrl));
  const balanceEndpoint = usageScriptEndpoint || firstValue(settings, [
    'balance_endpoint',
    'balanceEndpoint',
    'balance_url',
    'balanceUrl',
    'billing_endpoint',
    'billingEndpoint',
    'quota_endpoint',
    'quotaEndpoint',
    'provider.balance_endpoint',
    'provider.balanceEndpoint',
    'provider.balance_url',
    'provider.balanceUrl',
  ]);

  const provider = {
    appType: stringValue(row.app_type || row.appType || row.app || firstValue(settings, ['app_type', 'appType', 'app'])),
    providerId: stringValue(row.id || row.provider_id || row.providerId),
    name: stringValue(row.name || firstValue(settings, ['name', 'provider.name'])),
    baseUrl: stringValue(baseUrl),
    maskedKey: extractMaskedKey(settings),
    keyPreview: extractKeyPreview(settings),
    model: stringValue(model),
    reasoningEffort: stringValue(reasoningEffort),
    wireApi: stringValue(codex.wireApi),
    isCurrent: Boolean(Number(row.is_current ?? row.isCurrent ?? 0)),
  };

  if (balanceEndpoint) provider.balanceEndpoint = stringValue(balanceEndpoint);
  if (usageScriptEndpoint) {
    provider.balanceEndpointSource = 'ccswitch-usage-script';
    provider.balanceTimeoutSeconds = usageScriptTimeout(meta);
  }
  if (row.website_url || row.websiteUrl) provider.websiteUrl = String(row.website_url || row.websiteUrl);
  if (row.category) provider.category = String(row.category);
  if (providerType) provider.providerType = stringValue(providerType);
  if (row.cost_multiplier || row.costMultiplier) provider.costMultiplier = Number(row.cost_multiplier || row.costMultiplier) || 1;
  if (parsed.error) provider.configError = parsed.error;
  if (parsedMeta.error) provider.metaError = parsedMeta.error;
  return attachInternalSecret(provider, settings);
}

module.exports = {
  extractCodexConfig,
  extractKeyPreview,
  extractMaskedKey,
  parseCodexToml,
  parseProviderConfig,
  parseSettingsConfig: parseJsonObject,
};
