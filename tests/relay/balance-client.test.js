'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBalanceEndpointCandidates,
  normalizeBalance,
  readProviderBalance,
} = require('../../src/relay/balance-client');

test('normalizeBalance accepts common direct balance fields', () => {
  const balance = normalizeBalance({
    remaining: '42.5',
    currency: 'CNY',
    updated_at: '2026-06-14T08:00:00.000Z',
  });

  assert.equal(balance.status, 'ok');
  assert.equal(balance.amount, 42.5);
  assert.equal(balance.currency, 'CNY');
  assert.equal(balance.updatedAt, '2026-06-14T08:00:00.000Z');
});

test('normalizeBalance derives quota balance from one-api style data payload', () => {
  const balance = normalizeBalance({
    quota_per_unit: 500000,
    data: {
      quota: 100000,
      used_quota: 22500,
    },
  });

  assert.equal(balance.status, 'ok');
  assert.equal(balance.amount, 0.2);
  assert.equal(balance.sourceField, 'data.quota');
  assert.equal(balance.rawQuota, 100000);
  assert.equal(balance.quotaPerUnit, 500000);
});

test('normalizeBalance converts new-api quota payload into available money balance', () => {
  const balance = normalizeBalance({
    data: {
      quota: 20665000,
      used_quota: 9320000,
    },
  });

  assert.equal(balance.status, 'ok');
  assert.equal(balance.amount, 41.33);
  assert.equal(balance.sourceField, 'data.quota');
});

test('buildBalanceEndpointCandidates prefers explicit endpoint before safe probes', () => {
  const endpoints = buildBalanceEndpointCandidates({
    baseUrl: 'https://relay.example.com/v1',
    balanceEndpoint: '/api/user/self',
  });

  assert.deepEqual(endpoints.slice(0, 4), [
    'https://relay.example.com/api/user/self',
    'https://relay.example.com/api/user/quota',
    'https://relay.example.com/api/user/balance',
    'https://relay.example.com/api/usage/token',
  ]);
});

test('readProviderBalance tries candidate endpoints and reports source', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/api/user/self')) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ balance: 12.75, currency: 'USD' }),
    };
  };

  const balance = await readProviderBalance(
    { providerId: 'relay-1', baseUrl: 'https://relay.example.com/v1' },
    {
      fetch: fetchImpl,
      candidates: [
        'https://relay.example.com/api/user/self',
        'https://relay.example.com/api/user/quota',
      ],
    },
  );

  assert.equal(balance.status, 'ok');
  assert.equal(balance.amount, 12.75);
  assert.equal(balance.endpoint, 'https://relay.example.com/api/user/quota');
  assert.equal(calls.length, 2);
});

test('readProviderBalance returns auth-required instead of zero on 401', async () => {
  const balance = await readProviderBalance(
    { providerId: 'relay-1' },
    {
      candidates: ['https://relay.example.com/api/user/self'],
      fetch: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ message: 'unauthorized' }),
      }),
    },
  );

  assert.equal(balance.status, 'auth-required');
  assert.equal(balance.amount, null);
  assert.equal(balance.available, false);
  assert.match(balance.error, /401/);
});

test('readProviderBalance continues after unauthorized candidate and uses later working endpoint', async () => {
  const visited = [];
  const balance = await readProviderBalance(
    { baseUrl: 'https://relay.example.com/v1' },
    {
      candidates: [
        'https://relay.example.com/api/user/self',
        'https://relay.example.com/api/user/quota',
      ],
      fetch: async (url) => {
        visited.push(url);
        if (url.endsWith('/self')) {
          return {
            ok: false,
            status: 401,
            json: async () => ({}),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ balance: 23.4 }),
        };
      },
    },
  );

  assert.deepEqual(visited, [
    'https://relay.example.com/api/user/self',
    'https://relay.example.com/api/user/quota',
  ]);
  assert.equal(balance.status, 'ok');
  assert.equal(balance.amount, 23.4);
});

test('readProviderBalance converts new-api token usage available quota', async () => {
  const visited = [];
  const balance = await readProviderBalance(
    { providerId: 'relay-1', baseUrl: 'https://relay.example.com/v1' },
    {
      candidates: [
        'https://relay.example.com/api/user/self',
        'https://relay.example.com/api/usage/token',
      ],
      fetch: async (url) => {
        visited.push(url);
        if (url.endsWith('/api/user/self')) {
          return {
            ok: false,
            status: 404,
            json: async () => ({ error: 'not found' }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              available: 20665000,
              total_granted: 30000000,
              total_used: 9335000,
              quota_per_unit: 500000,
            },
          }),
        };
      },
    },
  );

  assert.deepEqual(visited, [
    'https://relay.example.com/api/user/self',
    'https://relay.example.com/api/usage/token',
  ]);
  assert.equal(balance.status, 'ok');
  assert.equal(balance.amount, 41.33);
  assert.equal(balance.rawQuota, 20665000);
  assert.equal(balance.quotaPerUnit, 500000);
  assert.equal(balance.sourceField, 'data.available');
});

test('readProviderBalance treats new-api unlimited token quota as usable status', async () => {
  const balance = await readProviderBalance(
    { providerId: 'waw', baseUrl: 'https://relay.example.cn/v1' },
    {
      candidates: ['https://relay.example.cn/api/usage/token'],
      fetch: async () => ({
        ok: true,
        status: 200,
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
      }),
    },
  );

  assert.equal(balance.status, 'unlimited');
  assert.equal(balance.available, true);
  assert.equal(balance.amount, null);
  assert.equal(balance.rawQuota, -1133049);
  assert.equal(balance.sourceField, 'data.unlimited_quota');
  assert.equal(balance.source, 'relay-endpoint');
});
