'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateCacheStats } = require('../../src/collectors/cache-stats');
const { estimateContextUsage } = require('../../src/collectors/context-usage');

test('calculateCacheStats uses explicit cache_miss tokens when available', () => {
  const stats = calculateCacheStats([
    { input: 1000, cache_read: 200, cache_creation: 100, cache_miss: 300 },
    { input_tokens: 500, cache_read_tokens: 50, cache_creation_tokens: 25, cache_miss_tokens: 150 },
  ]);

  assert.deepEqual(stats, {
    hitTokens: 250,
    missTokens: 450,
    writeTokens: 125,
    hitRate: 250 / 700,
  });
});

test('calculateCacheStats derives miss tokens from input when cache_miss is absent', () => {
  const stats = calculateCacheStats([
    { input_tokens: 1000, cache_read_tokens: 250, cache_creation_tokens: 10 },
  ]);

  assert.equal(stats.hitTokens, 250);
  assert.equal(stats.missTokens, 750);
  assert.equal(stats.writeTokens, 10);
  assert.equal(stats.hitRate, 0.25);
});

test('estimateContextUsage picks model windows and clamps remaining tokens', () => {
  assert.deepEqual(estimateContextUsage({ model: 'gpt-5.5', usedTokens: 64000 }), {
    model: 'gpt-5.5',
    windowTokens: 128000,
    usedTokens: 64000,
    remainingTokens: 64000,
    usedPercent: 50,
  });

  assert.deepEqual(estimateContextUsage({ model: 'claude-sonnet-4', usedTokens: 210000 }), {
    model: 'claude-sonnet-4',
    windowTokens: 200000,
    usedTokens: 210000,
    remainingTokens: 0,
    usedPercent: 100,
  });
});
