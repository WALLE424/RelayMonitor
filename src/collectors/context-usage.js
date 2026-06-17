'use strict';

const DEFAULT_WINDOW_TOKENS = 128000;

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getContextWindow(model) {
  const name = String(model || '').toLowerCase();
  if (name.includes('claude') && name.includes('sonnet')) return 200000;
  if (name.includes('gpt-5.5')) return 128000;
  return DEFAULT_WINDOW_TOKENS;
}

function inferUsedTokens(input) {
  if (typeof input === 'number') return input;
  if (Array.isArray(input)) {
    return input.reduce((sum, item) => sum + inferUsedTokens(item), 0);
  }
  if (!input || typeof input !== 'object') return 0;
  if (input.usedTokens != null) return toFiniteNumber(input.usedTokens);
  if (input.used_tokens != null) return toFiniteNumber(input.used_tokens);
  return toFiniteNumber(input.inputTokens ?? input.input_tokens ?? input.input)
    + toFiniteNumber(input.outputTokens ?? input.output_tokens ?? input.output);
}

function inferModel(input, fallback) {
  if (fallback) return fallback;
  if (Array.isArray(input)) {
    const first = input.find((item) => item && (item.model || item.requestModel || item.request_model));
    return inferModel(first, '');
  }
  if (!input || typeof input !== 'object') return 'unknown';
  return String(input.model || input.requestModel || input.request_model || 'unknown');
}

function estimateContextUsage(input = {}, options = {}) {
  const model = inferModel(input, options.model);
  const windowTokens = toFiniteNumber(options.windowTokens) || getContextWindow(model);
  const usedTokens = Math.max(0, inferUsedTokens(options.usedTokens != null ? options.usedTokens : input));
  const remainingTokens = Math.max(0, windowTokens - usedTokens);
  const percent = windowTokens > 0 ? Math.min(100, (usedTokens / windowTokens) * 100) : 0;

  return {
    model,
    windowTokens,
    usedTokens,
    remainingTokens,
    usedPercent: Number(percent.toFixed(2)),
  };
}

module.exports = {
  DEFAULT_WINDOW_TOKENS,
  estimateContextUsage,
  getContextWindow,
};
