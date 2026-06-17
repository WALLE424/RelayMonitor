'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSnapshot } = require('../../src/relay/snapshot');
const { getRelaySnapshot } = require('../../src/relay/snapshot');

test('buildSnapshot returns unavailable fallback when no real relay data exists', async () => {
  const snapshot = await buildSnapshot({
    relayState: {
      status: 'missing',
      providers: [],
      recentRequests: [],
      usageDailyRollups: [],
      proxyConfig: [],
    },
    now: new Date('2026-06-09T08:00:00Z'),
  });

  assert.equal(snapshot.mode, 'unavailable');
  assert.equal(snapshot.provider.appType, 'codex');
  assert.equal(snapshot.usage.totalRequests, 0);
  assert.equal(snapshot.recentRequests.length, 0);
  assert.equal(snapshot.cache.hitRate, 0);
  assert.equal(snapshot.context.usedPercent, 0);
  assert.equal(snapshot.trend.length, 7);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'collectors'), false);
});

test('buildSnapshot preserves relay cost, latency, cache, and context metrics', async () => {
  const snapshot = await buildSnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'relay-1',
          name: 'Relay One',
          baseUrl: 'https://relay.example.test/v1',
          maskedKey: 'sk-************CDEF',
          model: 'gpt-5.5',
          isCurrent: true,
        },
      ],
      recentRequests: [
        {
          requestId: 'req-1',
          providerId: 'relay-1',
          appType: 'codex',
          model: 'gpt-5.5',
          inputTokens: 3000,
          outputTokens: 1000,
          cacheReadTokens: 1000,
          cacheCreationTokens: 200,
          totalCostUsd: 1.25,
          latencyMs: 1500,
          statusCode: 200,
          createdAt: 1780000000,
        },
      ],
      usageDailyRollups: [
        {
          date: '2026-06-09',
          appType: 'codex',
          providerId: 'relay-1',
          model: 'gpt-5.5',
          requestCount: 2,
          successCount: 2,
          inputTokens: 3000,
          outputTokens: 1000,
          cacheReadTokens: 1000,
          cacheCreationTokens: 200,
          totalCostUsd: 1.25,
          avgLatencyMs: 1500,
        },
        {
          date: '2026-06-08',
          appType: 'codex',
          providerId: 'relay-1',
          model: 'gpt-5.5',
          requestCount: 1,
          successCount: 1,
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 500,
          cacheCreationTokens: 100,
          totalCostUsd: 0.5,
          avgLatencyMs: 3000,
        },
      ],
      proxyConfig: [],
    },
    now: new Date('2026-06-09T08:00:00Z'),
  });

  assert.equal(snapshot.mode, 'live');
  assert.equal(snapshot.usage.totalCostUsd, 1.75);
  assert.equal(snapshot.usage.avgLatencyMs, 2000);
  assert.equal(snapshot.cache.hitTokens, 1500);
  assert.equal(snapshot.cache.writeTokens, 300);
  assert.equal(snapshot.cache.hitRate, 1500 / 4000);
  assert.equal(snapshot.context.usedTokens, 4000);
  assert.equal(snapshot.context.usedPercent, 3.13);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'collectors'), false);
});

test('getRelaySnapshot exposes renderer-compatible balance and period totals', async () => {
  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'relay-1',
          name: 'Relay One',
          baseUrl: 'https://relay.example.test/v1',
          maskedKey: 'sk-************CDEF',
          model: 'gpt-5.5',
          isCurrent: true,
        },
      ],
      recentRequests: [],
      usageDailyRollups: [
        {
          date: '2026-06-09',
          appType: 'codex',
          providerId: 'relay-1',
          model: 'gpt-5.5',
          requestCount: 2,
          successCount: 2,
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 300,
          cacheCreationTokens: 40,
          totalCostUsd: 1.5,
          avgLatencyMs: 1000,
        },
        {
          date: '2026-06-08',
          appType: 'codex',
          providerId: 'relay-1',
          model: 'gpt-5.5',
          requestCount: 1,
          successCount: 1,
          inputTokens: 2000,
          outputTokens: 300,
          cacheReadTokens: 400,
          cacheCreationTokens: 50,
          totalCostUsd: 2.5,
          avgLatencyMs: 2000,
        },
        {
          date: '2026-06-01',
          appType: 'codex',
          providerId: 'relay-1',
          model: 'gpt-5.5',
          requestCount: 1,
          successCount: 1,
          inputTokens: 3000,
          outputTokens: 400,
          cacheReadTokens: 500,
          cacheCreationTokens: 60,
          totalCostUsd: 3.5,
          avgLatencyMs: 3000,
        },
      ],
      proxyConfig: [],
    },
    balance: {
      balance: 88.8,
      currency: 'USD',
      todaySpend: 999,
      weekSpend: 999,
      monthSpend: 999,
      totalSpend: 999,
      updatedAt: '2026-06-09T08:00:00.000Z',
    },
    now: new Date('2026-06-09T08:00:00Z'),
  });

  assert.equal(snapshot.balance.available, true);
  assert.equal(snapshot.balance.amount, 88.8);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.balance, 'todaySpend'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.balance, 'weekSpend'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.balance, 'monthSpend'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.balance, 'totalSpend'), false);
  assert.equal(snapshot.spend.today, 1.5);
  assert.equal(snapshot.spend.week, 4);
  assert.equal(snapshot.spend.month, 7.5);
  assert.equal(snapshot.spend.total, 7.5);
  assert.equal(snapshot.usage.todayTokens, 1540);
  assert.equal(snapshot.usage.weekTokens, 4290);
  assert.equal(snapshot.usage.monthTokens, 8250);
  assert.equal(snapshot.tokens.daily, 1540);
  assert.equal(snapshot.tokens.weekly, 4290);
  assert.equal(snapshot.tokens.monthly, 8250);
});

test('getRelaySnapshot uses request log daily rollups when usage rollups are stale', async () => {
  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'relay-1',
          name: 'Relay One',
          baseUrl: 'https://relay.example.test/v1',
          maskedKey: 'sk-************CDEF',
          model: 'gpt-5.5',
          isCurrent: true,
        },
      ],
      recentRequests: [
        {
          requestId: 'req-today',
          providerId: 'relay-1',
          appType: 'codex',
          model: 'gpt-5.5',
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 30,
          cacheCreationTokens: 4,
          totalCostUsd: 0.5,
          latencyMs: 1200,
          statusCode: 200,
          createdAt: Date.parse('2026-06-15T04:08:44Z') / 1000,
        },
      ],
      requestDailyRollups: [
        {
          date: '2026-06-15',
          appType: 'codex',
          providerId: 'relay-1',
          model: 'gpt-5.5',
          requestCount: 2,
          successCount: 2,
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 300,
          cacheCreationTokens: 40,
          totalCostUsd: 1.5,
          avgLatencyMs: 1100,
        },
      ],
      usageDailyRollups: [
        {
          date: '2026-05-16',
          appType: 'codex',
          providerId: 'relay-1',
          model: 'gpt-5.5',
          requestCount: 1,
          successCount: 1,
          inputTokens: 5000,
          outputTokens: 100,
          cacheReadTokens: 900,
          cacheCreationTokens: 0,
          totalCostUsd: 8,
          avgLatencyMs: 900,
        },
      ],
      proxyConfig: [],
    },
    balance: {
      status: 'unlimited',
      amount: null,
      available: true,
    },
    now: new Date('2026-06-15T08:00:00Z'),
  });

  const today = snapshot.trend7d.find((point) => point.date === '2026-06-15');
  assert.equal(today.value, 1540);
  assert.equal(today.cost, 1.5);
  assert.equal(snapshot.tokens.daily, 1540);
  assert.equal(snapshot.spend.today, 1.5);
  assert.equal(snapshot.spend.week, 1.5);
  assert.equal(snapshot.balance.status, 'auth-required');
  assert.equal(snapshot.balance.available, false);
  assert.equal(snapshot.balance.quotaStatus, 'unlimited');
});

test('getRelaySnapshot keeps recent trend and today spend from real request log rollups', async () => {
  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'relay-1',
          name: 'Relay One',
          baseUrl: 'https://relay.example.test/v1',
          maskedKey: 'sk-************CDEF',
          model: 'gpt-5.5',
          isCurrent: true,
        },
      ],
      recentRequests: [],
      requestDailyRollups: [
        {
          date: '2026-06-15',
          appType: 'codex',
          providerId: 'relay-1',
          model: 'gpt-5.5',
          requestCount: 3,
          successCount: 3,
          inputTokens: 2000,
          outputTokens: 300,
          cacheReadTokens: 400,
          cacheCreationTokens: 50,
          totalCostUsd: 2.25,
          avgLatencyMs: 1300,
        },
        {
          date: '2026-06-14',
          appType: 'codex',
          providerId: 'relay-1',
          model: 'gpt-5.5',
          requestCount: 1,
          successCount: 1,
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 30,
          cacheCreationTokens: 4,
          totalCostUsd: 0.5,
          avgLatencyMs: 1000,
        },
      ],
      usageDailyRollups: [
        {
          date: '2026-06-15',
          appType: 'codex',
          providerId: 'relay-1',
          model: 'stale-model',
          requestCount: 99,
          successCount: 99,
          inputTokens: 900000,
          outputTokens: 900000,
          cacheReadTokens: 900000,
          cacheCreationTokens: 900000,
          totalCostUsd: 999,
          avgLatencyMs: 9000,
        },
      ],
      proxyConfig: [],
    },
    balance: {
      status: 'unavailable',
      amount: null,
      available: false,
    },
    now: new Date('2026-06-15T08:00:00+08:00'),
  });

  const today = snapshot.trend7d.find((point) => point.date === '2026-06-15');
  const yesterday = snapshot.trend7d.find((point) => point.date === '2026-06-14');
  assert.equal(today.value, 2750);
  assert.equal(today.cost, 2.25);
  assert.equal(yesterday.value, 154);
  assert.equal(yesterday.cost, 0.5);
  assert.equal(snapshot.tokens.daily, 2750);
  assert.equal(snapshot.usage.todayTokens, 2750);
  assert.equal(snapshot.spend.today, 2.25);
  assert.equal(snapshot.spend.week, 2.75);
  assert.equal(snapshot.usage.totalRequests, 4);
  assert.equal(snapshot.usage.totalCostUsd, 2.75);
});

test('getRelaySnapshot filters tokens spend trend and requests to the current ccswitch provider', async () => {
  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'relay-old',
          name: 'Old Relay',
          baseUrl: 'https://old.example.test/v1',
          maskedKey: 'sk-************OLD',
          model: 'old-model',
          isCurrent: false,
        },
        {
          appType: 'codex',
          providerId: 'relay-new',
          name: 'New Relay',
          baseUrl: 'https://new.example.test/v1',
          maskedKey: 'sk-************NEW',
          model: 'new-model',
          isCurrent: true,
        },
      ],
      recentRequests: [
        {
          requestId: 'req-old',
          providerId: 'relay-old',
          appType: 'codex',
          model: 'old-model',
          inputTokens: 9000,
          outputTokens: 900,
          cacheReadTokens: 90,
          cacheCreationTokens: 9,
          totalCostUsd: 9,
          latencyMs: 900,
          statusCode: 200,
          createdAt: Date.parse('2026-06-15T04:08:44Z') / 1000,
        },
        {
          requestId: 'req-new',
          providerId: 'relay-new',
          appType: 'codex',
          model: 'new-model',
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 30,
          cacheCreationTokens: 4,
          totalCostUsd: 0.5,
          latencyMs: 1000,
          statusCode: 200,
          createdAt: Date.parse('2026-06-15T05:08:44Z') / 1000,
        },
        {
          requestId: 'req-empty-provider',
          providerId: '',
          appType: 'codex',
          model: 'empty-provider-model',
          inputTokens: 9999,
          outputTokens: 999,
          cacheReadTokens: 99,
          cacheCreationTokens: 9,
          totalCostUsd: 99,
          latencyMs: 999,
          statusCode: 200,
          createdAt: Date.parse('2026-06-15T06:08:44Z') / 1000,
        },
      ],
      requestDailyRollups: [
        {
          date: '2026-06-15',
          appType: 'codex',
          providerId: 'relay-old',
          model: 'old-model',
          requestCount: 7,
          successCount: 7,
          inputTokens: 7000,
          outputTokens: 700,
          cacheReadTokens: 70,
          cacheCreationTokens: 7,
          totalCostUsd: 7,
          avgLatencyMs: 700,
        },
        {
          date: '2026-06-15',
          appType: 'codex',
          providerId: 'relay-new',
          model: 'new-model',
          requestCount: 2,
          successCount: 2,
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 300,
          cacheCreationTokens: 40,
          totalCostUsd: 1.5,
          avgLatencyMs: 1100,
        },
        {
          date: '2026-06-15',
          appType: 'codex',
          providerId: '',
          model: 'empty-provider-model',
          requestCount: 1,
          successCount: 1,
          inputTokens: 9999,
          outputTokens: 999,
          cacheReadTokens: 99,
          cacheCreationTokens: 9,
          totalCostUsd: 99,
          avgLatencyMs: 999,
        },
      ],
      usageDailyRollups: [],
      proxyConfig: [],
    },
    balance: {
      status: 'unavailable',
      amount: null,
      available: false,
    },
    now: new Date('2026-06-15T08:00:00+08:00'),
  });

  const today = snapshot.trend7d.find((point) => point.date === '2026-06-15');
  assert.equal(snapshot.provider.providerId, 'relay-new');
  assert.equal(snapshot.currentRelay.name, 'New Relay');
  assert.equal(snapshot.recentRequests.length, 1);
  assert.equal(snapshot.recentRequests[0].id, 'req-new');
  assert.equal(snapshot.recentRequests.some((request) => request.id === 'req-empty-provider'), false);
  assert.equal(today.value, 1540);
  assert.equal(today.cost, 1.5);
  assert.equal(snapshot.tokens.daily, 1540);
  assert.equal(snapshot.spend.today, 1.5);
  assert.equal(snapshot.usage.totalRequests, 2);
});

test('getRelaySnapshot keeps same relay provider usage scoped to the current app type', async () => {
  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'relay-shared',
          name: 'Shared Relay',
          baseUrl: 'https://shared.example.test/v1',
          maskedKey: 'sk-************CODX',
          model: 'gpt-5.5',
          isCurrent: true,
        },
      ],
      recentRequests: [
        {
          requestId: 'req-codex',
          providerId: 'relay-shared',
          appType: 'codex',
          requestModel: 'gpt-5.5',
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 30,
          cacheCreationTokens: 4,
          totalCostUsd: 0.5,
          latencyMs: 1000,
          statusCode: 200,
          createdAt: Date.parse('2026-06-15T05:08:44Z') / 1000,
        },
        {
          requestId: 'req-claude',
          providerId: 'relay-shared',
          appType: 'claude',
          requestModel: 'claude-sonnet-4',
          inputTokens: 9000,
          outputTokens: 900,
          cacheReadTokens: 90,
          cacheCreationTokens: 9,
          totalCostUsd: 9,
          latencyMs: 900,
          statusCode: 200,
          createdAt: Date.parse('2026-06-15T05:09:44Z') / 1000,
        },
      ],
      requestDailyRollups: [
        {
          date: '2026-06-15',
          appType: 'codex',
          providerId: 'relay-shared',
          model: 'gpt-5.5',
          requestCount: 1,
          successCount: 1,
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 300,
          cacheCreationTokens: 40,
          totalCostUsd: 1.5,
          avgLatencyMs: 1100,
        },
        {
          date: '2026-06-15',
          appType: 'claude',
          providerId: 'relay-shared',
          model: 'claude-sonnet-4',
          requestCount: 9,
          successCount: 9,
          inputTokens: 9000,
          outputTokens: 900,
          cacheReadTokens: 90,
          cacheCreationTokens: 9,
          totalCostUsd: 9,
          avgLatencyMs: 900,
        },
      ],
      usageDailyRollups: [],
      proxyConfig: [],
    },
    balance: {
      status: 'unavailable',
      amount: null,
      available: false,
    },
    now: new Date('2026-06-15T08:00:00+08:00'),
  });

  const today = snapshot.trend7d.find((point) => point.date === '2026-06-15');
  assert.equal(snapshot.provider.appType, 'codex');
  assert.equal(snapshot.recentRequests.length, 1);
  assert.equal(snapshot.recentRequests[0].id, 'req-codex');
  assert.equal(today.value, 1540);
  assert.equal(today.cost, 1.5);
  assert.equal(snapshot.spend.today, 1.5);
  assert.equal(snapshot.usage.totalRequests, 1);
});

test('getRelaySnapshot falls back to available relay logs when current provider metadata does not match logs', async () => {
  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'metadata-only-provider',
          name: 'Metadata Relay',
          baseUrl: 'https://metadata.example.test/v1',
          maskedKey: 'sk-************META',
          model: 'gpt-5.5',
          isCurrent: true,
        },
      ],
      recentRequests: [
        {
          requestId: 'req-session',
          providerId: '_session',
          appType: 'unknown-app-label',
          requestModel: 'gpt-5.5',
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 30,
          cacheCreationTokens: 4,
          totalCostUsd: 0.5,
          latencyMs: 1000,
          statusCode: 200,
          createdAt: Date.parse('2026-06-15T05:08:44Z') / 1000,
        },
      ],
      requestDailyRollups: [
        {
          date: '2026-06-15',
          appType: 'unknown-app-label',
          providerId: '_session',
          model: 'gpt-5.5',
          requestCount: 1,
          successCount: 1,
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 300,
          cacheCreationTokens: 40,
          totalCostUsd: 1.5,
          avgLatencyMs: 1100,
        },
      ],
      usageDailyRollups: [],
      proxyConfig: [],
    },
    balance: {
      status: 'unavailable',
      amount: null,
      available: false,
    },
    now: new Date('2026-06-15T08:00:00+08:00'),
  });

  const today = snapshot.trend7d.find((point) => point.date === '2026-06-15');
  assert.equal(snapshot.recentRequests.length, 1);
  assert.equal(today.value, 1540);
  assert.equal(snapshot.spend.today, 1.5);
  assert.equal(snapshot.usage.totalRequests, 1);
});

test('getRelaySnapshot shows zero usage for a newly selected ccswitch provider without matching logs', async () => {
  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'relay-new-empty',
          name: 'New Empty Relay',
          baseUrl: 'https://empty.example.test/v1',
          maskedKey: 'sk-************NEW',
          model: 'new-model',
          isCurrent: true,
        },
      ],
      recentRequests: [
        {
          requestId: 'req-old',
          providerId: 'relay-old',
          appType: 'codex',
          model: 'old-model',
          inputTokens: 9000,
          outputTokens: 900,
          cacheReadTokens: 90,
          cacheCreationTokens: 9,
          totalCostUsd: 9,
          latencyMs: 900,
          statusCode: 200,
          createdAt: Date.parse('2026-06-15T04:08:44Z') / 1000,
        },
      ],
      requestDailyRollups: [
        {
          date: '2026-06-15',
          appType: 'codex',
          providerId: 'relay-old',
          model: 'old-model',
          requestCount: 7,
          successCount: 7,
          inputTokens: 7000,
          outputTokens: 700,
          cacheReadTokens: 70,
          cacheCreationTokens: 7,
          totalCostUsd: 7,
          avgLatencyMs: 700,
        },
      ],
      usageDailyRollups: [],
      proxyConfig: [],
    },
    balance: {
      status: 'unavailable',
      amount: null,
      available: false,
    },
    now: new Date('2026-06-15T08:00:00+08:00'),
  });

  const today = snapshot.trend7d.find((point) => point.date === '2026-06-15');
  assert.equal(snapshot.provider.providerId, 'relay-new-empty');
  assert.equal(snapshot.recentRequests.length, 0);
  assert.equal(today.value, 0);
  assert.equal(today.cost, 0);
  assert.equal(snapshot.tokens.daily, 0);
  assert.equal(snapshot.spend.today, 0);
  assert.equal(snapshot.usage.totalRequests, 0);
});

test('getRelaySnapshot keeps ccswitch session-level logs for the current app when provider ids are not concrete', async () => {
  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'relay-new',
          name: 'New Relay',
          baseUrl: 'https://new.example.test/v1',
          maskedKey: 'sk-************NEW',
          model: 'new-model',
          isCurrent: true,
        },
      ],
      recentRequests: [
        {
          requestId: 'req-session',
          providerId: '_codex_session',
          appType: 'codex',
          model: 'new-model',
          inputTokens: 500,
          outputTokens: 40,
          cacheReadTokens: 60,
          cacheCreationTokens: 10,
          totalCostUsd: 0.75,
          latencyMs: 800,
          statusCode: 200,
          createdAt: Date.parse('2026-06-15T04:08:44Z') / 1000,
        },
      ],
      requestDailyRollups: [
        {
          date: '2026-06-15',
          appType: 'codex',
          providerId: '_codex_session',
          model: 'new-model',
          requestCount: 1,
          successCount: 1,
          inputTokens: 500,
          outputTokens: 40,
          cacheReadTokens: 60,
          cacheCreationTokens: 10,
          totalCostUsd: 0.75,
          avgLatencyMs: 800,
        },
      ],
      usageDailyRollups: [],
      proxyConfig: [],
    },
    balance: {
      status: 'unavailable',
      amount: null,
      available: false,
    },
    now: new Date('2026-06-15T08:00:00+08:00'),
  });

  const today = snapshot.trend7d.find((point) => point.date === '2026-06-15');
  assert.equal(snapshot.provider.providerId, 'relay-new');
  assert.equal(snapshot.recentRequests.length, 1);
  assert.equal(today.value, 610);
  assert.equal(snapshot.tokens.daily, 610);
  assert.equal(snapshot.spend.today, 0.75);
});

test('getRelaySnapshot ignores cached balance from a previous ccswitch provider', async () => {
  const visited = [];
  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'relay-new',
          name: 'New Relay',
          baseUrl: 'https://new.example.test/v1',
          apiKey: 'sk-live-new-secret',
          balanceEndpoint: '/api/user/self',
          model: 'new-model',
          isCurrent: true,
        },
      ],
      recentRequests: [],
      requestDailyRollups: [],
      usageDailyRollups: [],
      proxyConfig: [],
    },
    balance: {
      status: 'ok',
      amount: 999,
      available: true,
      __cacheProviderKey: 'relay-old|https://old.example.test/v1||auto-api||',
    },
    balanceOptions: {
      enabled: true,
      mode: 'auto-api',
      fetch: async (url) => {
        visited.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({ balance: 12.5, currency: 'USD' }),
        };
      },
    },
    now: new Date('2026-06-15T08:00:00+08:00'),
  });

  assert.equal(snapshot.balance.amount, 12.5);
  assert.equal(visited[0], 'https://new.example.test/api/user/self');
});

test('getRelaySnapshot assigns recent requests to local today for live token and spend updates', async () => {
  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'relay-1',
          name: 'Relay One',
          baseUrl: 'https://relay.example.test/v1',
          maskedKey: 'sk-************CDEF',
          model: 'gpt-5.5',
          isCurrent: true,
        },
      ],
      recentRequests: [
        {
          requestId: 'req-local-night',
          providerId: 'relay-1',
          appType: 'codex',
          model: 'gpt-5.5',
          inputTokens: 500,
          outputTokens: 40,
          cacheReadTokens: 60,
          cacheCreationTokens: 10,
          totalCostUsd: 0.75,
          latencyMs: 800,
          statusCode: 200,
          createdAt: Date.parse('2026-06-14T16:30:00Z') / 1000,
        },
      ],
      usageDailyRollups: [],
      requestDailyRollups: [],
      proxyConfig: [],
    },
    balance: {
      status: 'unavailable',
      amount: null,
      available: false,
    },
    now: new Date('2026-06-15T00:40:00+08:00'),
  });

  const today = snapshot.trend7d.find((point) => point.date === '2026-06-15');
  assert.equal(today.value, 610);
  assert.equal(today.cost, 0.75);
  assert.equal(snapshot.tokens.daily, 610);
  assert.equal(snapshot.spend.today, 0.75);
});

test('getRelaySnapshot keeps missing balance unknown while preserving spend totals', async () => {
  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'relay-1',
          name: 'Relay One',
          baseUrl: 'https://relay.example.test/v1',
          maskedKey: 'sk-************CDEF',
          model: 'gpt-5.5',
          isCurrent: true,
        },
      ],
      recentRequests: [],
      usageDailyRollups: [
        {
          date: '2026-06-09',
          appType: 'codex',
          providerId: 'relay-1',
          model: 'gpt-5.5',
          requestCount: 2,
          successCount: 2,
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 300,
          cacheCreationTokens: 40,
          totalCostUsd: 1.5,
          avgLatencyMs: 1000,
        },
      ],
      proxyConfig: [],
    },
    now: new Date('2026-06-09T08:00:00Z'),
  });

  assert.equal(snapshot.balance.status, 'unavailable');
  assert.equal(snapshot.balance.available, false);
  assert.equal(snapshot.balance.amount, null);
  assert.equal(snapshot.balance.balance, null);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.balance, 'todaySpend'), false);
  assert.equal(snapshot.spend.today, 1.5);
  assert.equal(snapshot.spend.total, 1.5);
  assert.equal(snapshot.spend.source, 'ccswitch-usage-rollups');
  assert.equal(snapshot.spend.status, 'fallback-request-log');
});

test('getRelaySnapshot estimates balance from manual amount without showing it as real API data', async () => {
  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'relay-1',
          name: 'Relay One',
          baseUrl: 'https://relay.example.test/v1',
          maskedKey: 'sk-************CDEF',
          model: 'gpt-5.5',
          isCurrent: true,
        },
      ],
      recentRequests: [],
      usageDailyRollups: [
        {
          date: '2026-06-09',
          appType: 'codex',
          providerId: 'relay-1',
          model: 'gpt-5.5',
          requestCount: 2,
          successCount: 2,
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 300,
          cacheCreationTokens: 40,
          totalCostUsd: 12.5,
          avgLatencyMs: 1000,
        },
      ],
      proxyConfig: [],
    },
    balanceOptions: {
      mode: 'manual',
      manualAmount: 100,
    },
    now: new Date('2026-06-09T08:00:00Z'),
  });

  assert.equal(snapshot.balance.status, 'estimated');
  assert.equal(snapshot.balance.source, 'manual-minus-spend');
  assert.equal(snapshot.balance.amount, 87.5);
  assert.equal(snapshot.balance.available, true);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.balance, 'totalSpend'), false);
});

test('getRelaySnapshot reads web-session balance without triggering auto provider API probing', async () => {
  const visited = [];
  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'relay-1',
          name: 'Relay One',
          baseUrl: 'https://relay.example.test/v1',
          maskedKey: 'sk-************CDEF',
          model: 'gpt-5.5',
          isCurrent: true,
        },
      ],
      recentRequests: [],
      usageDailyRollups: [],
      proxyConfig: [],
    },
    balanceOptions: {
      mode: 'web-session',
      pageUrl: 'https://relay.example.test/dashboard',
      selector: '.balance-value',
      fetch: async (url) => {
        visited.push(url);
        if (url.includes('/api/')) {
          return {
            ok: false,
            status: 404,
            url,
            text: async () => '{}',
          };
        }
        return {
          ok: true,
          status: 200,
          url,
          text: async () => '<span class="balance-value">¥66.60</span>',
        };
      },
    },
    now: new Date('2026-06-09T08:00:00Z'),
  });

  assert.ok(visited.includes('https://relay.example.test/api/user/self'));
  assert.ok(visited.includes('https://relay.example.test/dashboard'));
  assert.equal(snapshot.balance.status, 'ok');
  assert.equal(snapshot.balance.source, 'web-session');
  assert.equal(snapshot.balance.amount, 66.6);
});

test('getRelaySnapshot keeps web-session failures separate from provider token quota', async () => {
  const visited = [];
  const provider = {
    appType: 'codex',
    providerId: 'waw',
    name: 'waw',
    baseUrl: 'https://relay.example.cn/v1',
    maskedKey: 'sk-************CDEF',
    model: 'gpt-5.5',
    isCurrent: true,
  };
  Object.defineProperty(provider, 'apiKey', {
    value: 'sk-live-balance-secret',
    enumerable: false,
  });

  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [provider],
      recentRequests: [],
      usageDailyRollups: [],
      proxyConfig: [],
    },
    balanceOptions: {
      mode: 'web-session',
      pageUrl: 'https://relay.example.cn/console',
      fetch: async (url, options = {}) => {
        visited.push({ url, authorization: options.headers?.Authorization || '' });
        if (url.includes('/api/status')) {
          return {
            ok: true,
            status: 200,
            url,
            text: async () => JSON.stringify({ data: { quota_per_unit: 500000 } }),
          };
        }
        if (!options.headers?.Authorization) {
          return {
            ok: false,
            status: 401,
            url,
            text: async () => JSON.stringify({ message: 'Unauthorized' }),
            json: async () => ({ message: 'Unauthorized' }),
          };
        }
        if (url.includes('/api/usage/token')) {
          return {
            ok: true,
            status: 200,
            url,
            json: async () => ({
              code: true,
              data: {
                total_available: -1133049,
                total_granted: 4524917,
                total_used: 5657966,
                unlimited_quota: true,
              },
              message: 'ok',
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          url,
          json: async () => ({ message: 'Unauthorized, invalid access token', success: false }),
        };
      },
    },
    now: new Date('2026-06-09T08:00:00Z'),
  });

  assert.equal(snapshot.balance.status, 'auth-required');
  assert.equal(snapshot.balance.available, false);
  assert.equal(snapshot.balance.amount, null);
  assert.equal(snapshot.balance.source, 'web-session-api');
  assert.equal(visited.some((item) => item.url.includes('/api/usage/token')), false);
  assert.equal(JSON.stringify(snapshot).includes('sk-live-balance-secret'), false);
});

test('getRelaySnapshot does not treat provider token quota as account balance in web-session mode', async () => {
  const visited = [];
  const provider = {
    appType: 'codex',
    providerId: 'waw',
    name: 'waw',
    baseUrl: 'https://relay.example.cn/v1',
    balanceEndpoint: 'https://relay.example.cn/v1/user/balance',
    maskedKey: 'sk-************CDEF',
    model: 'gpt-5.5',
    isCurrent: true,
  };
  Object.defineProperty(provider, 'apiKey', {
    value: 'sk-live-balance-secret',
    enumerable: false,
  });

  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [provider],
      recentRequests: [],
      usageDailyRollups: [],
      proxyConfig: [],
    },
    balanceOptions: {
      mode: 'web-session',
      pageUrl: 'https://relay.example.cn/console',
      providerApiFallback: true,
      fetch: async (url) => {
        if (url.includes('/api/status')) {
          return {
            ok: true,
            status: 200,
            url,
            text: async () => '{}',
          };
        }
        return {
          ok: false,
          status: 401,
          url: 'https://relay.example.cn/login',
          text: async () => '<form><input type="password" /></form>',
        };
      },
      providerFetch: async (url, options = {}) => {
        visited.push({ url, authorization: options.headers?.Authorization || '' });
        if (url.endsWith('/api/usage/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              code: true,
              data: {
                total_available: -2143025,
                total_granted: 1253103,
                total_used: 3396128,
                unlimited_quota: true,
              },
              message: 'ok',
            }),
          };
        }
        return {
          ok: url.includes('/api/'),
          status: url.includes('/api/') ? 200 : 404,
          json: async () => ({ message: 'Unauthorized, invalid access token', success: false }),
        };
      },
    },
    now: new Date('2026-06-09T08:00:00Z'),
  });

  assert.ok(visited.some((item) => item.url === 'https://relay.example.cn/api/usage/token'));
  assert.ok(visited.every((item) => item.authorization === 'Bearer sk-live-balance-secret'));
  assert.equal(snapshot.balance.status, 'auth-required');
  assert.equal(snapshot.balance.available, false);
  assert.equal(snapshot.balance.amount, null);
  assert.equal(snapshot.balance.source, 'web-session-api');
  assert.equal(snapshot.balance.quotaStatus, 'unlimited');
  assert.equal(snapshot.balance.quotaEndpoint, 'https://relay.example.cn/api/usage/token');
  assert.equal(snapshot.balance.quotaSourceField, 'data.unlimited_quota');
  assert.equal(JSON.stringify(snapshot).includes('sk-live-balance-secret'), false);
});

test('getRelaySnapshot tries current provider console instead of stale balance page', async () => {
  const visited = [];
  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'pinai',
          name: 'PinAI API',
          baseUrl: 'https://us.pinai-cn.com/v1',
          websiteUrl: 'https://us.pinai-cn.com',
          maskedKey: 'sk-************CDEF',
          model: 'gpt-5.5',
          isCurrent: true,
        },
      ],
      recentRequests: [],
      usageDailyRollups: [],
      proxyConfig: [],
    },
    balanceOptions: {
      mode: 'web-session',
      pageUrl: 'https://relay.example.cn/console',
      fetch: async (url) => {
        visited.push(url);
        assert.equal(url.startsWith('https://relay.example.cn'), false);
        if (url === 'https://us.pinai-cn.com/console') {
          return {
            ok: true,
            status: 200,
            url,
            text: async () => '<main>账户余额：¥31.25</main>',
          };
        }
        return {
          ok: false,
          status: 404,
          url,
          text: async () => '{}',
        };
      },
    },
    now: new Date('2026-06-09T08:00:00Z'),
  });

  assert.ok(visited.includes('https://us.pinai-cn.com/console'));
  assert.equal(snapshot.balance.status, 'ok');
  assert.equal(snapshot.balance.available, true);
  assert.equal(snapshot.balance.amount, 31.25);
  assert.equal(snapshot.balance.endpoint, 'https://us.pinai-cn.com/console');
  assert.equal(snapshot.balance.staleEndpoint, 'https://relay.example.cn/console');
  assert.equal(snapshot.balance.autoSuggested, true);
});

test('getRelaySnapshot reports stale web balance page even before Electron session fetch is available', async () => {
  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'my-codex',
          name: 'My Codex',
          baseUrl: 'https://203.56.121.111/v1',
          maskedKey: 'sk-************CDEF',
          model: 'gpt-5.5',
          isCurrent: true,
        },
      ],
      recentRequests: [],
      usageDailyRollups: [],
      proxyConfig: [],
    },
    balanceOptions: {
      mode: 'web-session',
      pageUrl: 'https://relay.example.cn/console',
    },
    now: new Date('2026-06-09T08:00:00Z'),
  });

  assert.equal(snapshot.balance.status, 'provider-mismatch');
  assert.equal(snapshot.balance.available, false);
  assert.equal(snapshot.balance.amount, null);
  assert.equal(snapshot.balance.endpoint, 'https://relay.example.cn/console');
  assert.match(snapshot.balance.error, /relay\.example\.cn/);
  assert.match(snapshot.balance.error, /203\.56\.121\.111/);
});

test('getRelaySnapshot uses ccswitch explicit balance endpoint even when stale web page is configured', async () => {
  const visited = [];
  const provider = {
    appType: 'codex',
    providerId: 'pinai',
    name: 'PinAI API',
    baseUrl: 'https://us.pinai-cn.com',
    websiteUrl: 'https://us.pinai-cn.com',
    balanceEndpoint: 'https://us.pinai-cn.com/v1/usage',
    balanceEndpointSource: 'ccswitch-usage-script',
    maskedKey: 'sk-************CDEF',
    model: 'gpt-5.5',
    isCurrent: true,
  };
  Object.defineProperty(provider, 'apiKey', {
    value: 'sk-live-pinai-secret',
    enumerable: false,
  });

  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [provider],
      recentRequests: [],
      usageDailyRollups: [],
      proxyConfig: [],
    },
    balanceOptions: {
      mode: 'web-session',
      pageUrl: 'https://relay.example.cn/console',
      fetch: async () => {
        throw new Error('stale web-session page should not be used');
      },
      providerFetch: async (url, options = {}) => {
        visited.push({ url, authorization: options.headers?.Authorization || '' });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            balance: 23.87504169,
            remaining: 23.87504169,
            unit: 'USD',
            isValid: true,
          }),
        };
      },
    },
    now: new Date('2026-06-09T08:00:00Z'),
  });

  assert.equal(snapshot.balance.status, 'ok');
  assert.equal(snapshot.balance.available, true);
  assert.equal(snapshot.balance.amount, 23.87504169);
  assert.equal(snapshot.balance.endpoint, 'https://us.pinai-cn.com/v1/usage');
  assert.equal(snapshot.balance.sourceField, 'balance');
  assert.deepEqual(visited, [{
    url: 'https://us.pinai-cn.com/v1/usage',
    authorization: 'Bearer sk-live-pinai-secret',
  }]);
  assert.equal(JSON.stringify(snapshot).includes('sk-live-pinai-secret'), false);
});

test('getRelaySnapshot falls back to web-session balance when auto API fails', async () => {
  const visited = [];
  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          providerId: 'relay-1',
          name: 'Relay One',
          baseUrl: 'https://relay.example.test/v1',
          apiKey: 'sk-live-balance-secret',
          balanceEndpoint: '/api/user/self',
          isCurrent: true,
        },
      ],
      recentRequests: [],
      usageDailyRollups: [],
      proxyConfig: [],
    },
    balanceOptions: {
      enabled: true,
      pageUrl: 'https://relay.example.test/console',
      fetch: async (url) => {
        visited.push(url);
        if (url.includes('/api/user/self')) {
          return {
            ok: false,
            status: 401,
            json: async () => ({ error: 'unauthorized' }),
          };
        }
        return {
          ok: true,
          status: 200,
          url,
          text: async () => '<nav><span>当前余额</span><strong>¥41.33</strong></nav>',
        };
      },
    },
    now: new Date('2026-06-09T08:00:00Z'),
  });

  assert.ok(visited.some((url) => url.includes('/api/user/self')));
  assert.ok(visited.some((url) => url.includes('/console')));
  assert.equal(snapshot.balance.status, 'ok');
  assert.equal(snapshot.balance.source, 'web-session');
  assert.equal(snapshot.balance.amount, 41.33);
});

test('getRelaySnapshot sends provider api key when probing auto balance endpoints', async () => {
  const visited = [];
  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'relay-1',
          name: 'Relay One',
          baseUrl: 'https://relay.example.test/v1',
          apiKey: 'sk-live-balance-secret',
          balanceEndpoint: '/api/user/self',
          model: 'gpt-5.5',
          isCurrent: true,
        },
      ],
      recentRequests: [],
      usageDailyRollups: [],
      proxyConfig: [],
    },
    balanceOptions: {
      enabled: true,
      fetch: async (url, options) => {
        visited.push({ url, options });
        return {
          ok: true,
          status: 200,
          json: async () => ({ balance: 19.5, currency: 'CNY' }),
        };
      },
    },
    now: new Date('2026-06-09T08:00:00Z'),
  });

  assert.equal(snapshot.balance.status, 'ok');
  assert.equal(snapshot.balance.amount, 19.5);
  assert.equal(visited[0].url, 'https://relay.example.test/api/user/self');
  assert.equal(visited[0].options.headers.Authorization, 'Bearer sk-live-balance-secret');
});

test('getRelaySnapshot prefers actual request model over provider default model', async () => {
  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'relay-1',
          name: 'Relay One',
          baseUrl: 'https://relay.example.test/v1',
          maskedKey: 'sk-************CDEF',
          model: 'provider-default-model',
          reasoningEffort: 'low',
          isCurrent: true,
        },
      ],
      recentRequests: [
        {
          requestId: 'req-actual',
          providerId: 'relay-1',
          appType: 'codex',
          model: 'provider-default-model',
          providerModel: 'provider-default-model',
          requestModel: 'claude-sonnet-4-real',
          reasoningEffort: 'high',
          inputTokens: 1200,
          outputTokens: 340,
          cacheReadTokens: 200,
          cacheCreationTokens: 0,
          totalCostUsd: 0.42,
          latencyMs: 900,
          statusCode: 200,
          createdAt: 1780000000,
        },
      ],
      usageDailyRollups: [],
      proxyConfig: [],
    },
    now: new Date('2026-06-09T08:00:00Z'),
  });

  assert.equal(snapshot.provider.model, 'provider-default-model');
  assert.equal(snapshot.recentRequests[0].model, 'claude-sonnet-4-real');
  assert.equal(snapshot.recentRequests[0].requestModel, 'claude-sonnet-4-real');
  assert.equal(snapshot.recentRequests[0].providerModel, 'provider-default-model');
  assert.equal(snapshot.recentRequests[0].reasoningEffort, 'high');
});

test('getRelaySnapshot exposes stable dashboard fields and limits heavy arrays', async () => {
  const now = new Date('2026-06-09T08:00:00Z');
  const recentRequests = Array.from({ length: 15 }, (_, index) => ({
    requestId: `req-${index}`,
    providerId: 'relay-1',
    appType: 'codex',
    model: 'gpt-4.1-real',
    requestModel: 'gpt-4.1-real',
    requestReasoningEffort: 'medium',
    inputTokens: 100 + index,
    outputTokens: 20 + index,
    cacheReadTokens: 10,
    cacheCreationTokens: 2,
    totalCostUsd: 0.01,
    latencyMs: 1000 + index,
    statusCode: 200,
    createdAt: 1780000000 - index,
  }));
  const usageDailyRollups = Array.from({ length: 12 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 5, 9 - index)).toISOString().slice(0, 10),
    appType: 'codex',
    providerId: 'relay-1',
    model: 'gpt-4.1-real',
    requestCount: 1,
    successCount: 1,
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 300,
    cacheCreationTokens: 40,
    totalCostUsd: 1,
    avgLatencyMs: 1000 + index,
  }));

  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'relay-1',
          name: 'Relay One',
          baseUrl: 'https://relay.example.test/v1',
          maskedKey: 'sk-************CDEF',
          keyPreview: 'sk-li...CDEF',
          model: 'gpt-4.1-real',
          reasoningEffort: 'medium',
          isCurrent: true,
        },
      ],
      recentRequests,
      usageDailyRollups,
      proxyConfig: [],
    },
    balance: {
      amount: 42.5,
      available: true,
      totalSpend: 99.25,
    },
    now,
  });

  assert.deepEqual(
    {
      name: snapshot.currentRelay.name,
      endpoint: snapshot.currentRelay.endpoint,
      provider: snapshot.currentRelay.provider,
      maskedKey: snapshot.currentRelay.maskedKey,
      keyPreview: snapshot.currentRelay.keyPreview,
      model: snapshot.currentRelay.model,
      reasoningEffort: snapshot.currentRelay.reasoningEffort,
    },
    {
      name: 'Relay One',
      endpoint: 'https://relay.example.test/v1',
      provider: 'codex',
      maskedKey: 'sk-************CDEF',
      keyPreview: 'sk-li...CDEF',
      model: 'gpt-4.1-real',
      reasoningEffort: 'medium',
    },
  );
  assert.equal(snapshot.model, 'gpt-4.1-real');
  assert.equal(snapshot.currentModel, 'gpt-4.1-real');
  assert.equal(snapshot.reasoningEffort, 'medium');
  assert.equal(snapshot.balance.amount, 42.5);
  assert.equal(snapshot.balance.available, true);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.balance, 'totalSpend'), false);
  assert.equal(snapshot.spend.total, 11.15);
  assert.equal(snapshot.latency.avg, snapshot.usage.avgLatencyMs);
  assert.equal(snapshot.cache.rate, snapshot.cache.hitRate);
  assert.equal(snapshot.context.usage, snapshot.context.usedPercent);
  assert.equal(snapshot.trend.length, 7);
  assert.equal(snapshot.trend7d.length, 7);
  assert.equal(snapshot.recentRequests.length, 10);
});

test('getRelaySnapshot marks missing model and reasoning fields instead of inventing defaults', async () => {
  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'relay-1',
          name: 'Relay One',
          baseUrl: 'https://relay.example.test/v1',
          maskedKey: 'configured',
          isCurrent: true,
        },
      ],
      recentRequests: [
        {
          requestId: 'req-missing',
          providerId: 'relay-1',
          appType: 'codex',
          inputTokens: 120,
          outputTokens: 30,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          totalCostUsd: 0.01,
          latencyMs: 700,
          statusCode: 200,
          createdAt: 1780000000,
        },
      ],
      usageDailyRollups: [],
      proxyConfig: [],
    },
    now: new Date('2026-06-09T08:00:00Z'),
  });

  assert.equal(snapshot.provider.model, '未检测到');
  assert.equal(snapshot.provider.reasoningEffort, '未记录');
  assert.equal(snapshot.model, '未检测到');
  assert.equal(snapshot.reasoningEffort, '未记录');
  assert.equal(snapshot.recentRequests[0].model, '未检测到');
  assert.equal(snapshot.recentRequests[0].reasoningEffort, '未记录');
});

test('getRelaySnapshot builds model trends only from real request logs', async () => {
  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'relay-1',
          name: 'Relay One',
          baseUrl: 'https://relay.example.test/v1',
          maskedKey: 'configured',
          isCurrent: true,
        },
      ],
      recentRequests: [
        {
          requestId: 'req-real-model',
          providerId: 'relay-1',
          appType: 'codex',
          requestModel: 'gpt-real',
          inputTokens: 100,
          outputTokens: 25,
          cacheReadTokens: 10,
          cacheCreationTokens: 5,
          totalCostUsd: 0.01,
          latencyMs: 700,
          statusCode: 200,
          createdAt: Date.parse('2026-06-09T08:00:00Z') / 1000,
        },
      ],
      usageDailyRollups: [
        {
          date: '2026-06-09',
          providerId: 'relay-1',
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 300,
          cacheCreationTokens: 40,
          totalCostUsd: 1,
        },
      ],
      proxyConfig: [],
    },
    now: new Date('2026-06-09T08:00:00Z'),
  });

  assert.equal(snapshot.modelTrends['gpt-real'].at(-1).value, 140);
  assert.notEqual(snapshot.modelTrends['gpt-real'].at(-1).value, Math.round(snapshot.trend7d.at(-1).value * 0.62));
});

