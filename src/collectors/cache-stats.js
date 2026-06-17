'use strict';

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function readField(record, names) {
  if (!record || typeof record !== 'object') return undefined;
  for (const name of names) {
    if (record[name] != null) return record[name];
  }
  if (record.usage && typeof record.usage === 'object') {
    for (const name of names) {
      if (record.usage[name] != null) return record.usage[name];
    }
  }
  return undefined;
}

function asRecords(input) {
  if (!input) return [];
  return Array.isArray(input) ? input : [input];
}

function calculateCacheStats(input) {
  let hitTokens = 0;
  let missTokens = 0;
  let writeTokens = 0;

  for (const record of asRecords(input)) {
    const hit = toFiniteNumber(readField(record, [
      'cache_read',
      'cache_read_tokens',
      'cacheRead',
      'cacheReadTokens',
      'cached_input_tokens',
    ]));
    const write = toFiniteNumber(readField(record, [
      'cache_creation',
      'cache_creation_tokens',
      'cacheCreation',
      'cacheCreationTokens',
      'cache_write_tokens',
    ]));
    const explicitMiss = readField(record, [
      'cache_miss',
      'cache_miss_tokens',
      'cacheMiss',
      'cacheMissTokens',
    ]);
    const inputTokens = toFiniteNumber(readField(record, [
      'input',
      'input_tokens',
      'inputTokens',
      'prompt_tokens',
      'promptTokens',
    ]));

    hitTokens += Math.max(0, hit);
    writeTokens += Math.max(0, write);
    missTokens += explicitMiss == null ? Math.max(0, inputTokens - hit) : Math.max(0, toFiniteNumber(explicitMiss));
  }

  const denominator = hitTokens + missTokens;
  return {
    hitTokens,
    missTokens,
    writeTokens,
    hitRate: denominator > 0 ? hitTokens / denominator : 0,
  };
}

module.exports = { calculateCacheStats };
