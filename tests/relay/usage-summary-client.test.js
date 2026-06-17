'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractUsageSummaryFromHtml,
  normalizeUsageSummaryPayload,
  readUsageSummary,
} = require('../../src/relay/usage-summary-client');
const { getRelaySnapshot } = require('../../src/relay/snapshot');

test('normalizeUsageSummaryPayload reads relay official spend fields', () => {
  const result = normalizeUsageSummaryPayload({
    data: {
      today_spend: 3.82,
      weekly_spend: 18.74,
      monthly_spend: 74.19,
      total_spend: 197.49,
      currency: 'CNY',
    },
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.todayCost, 3.82);
  assert.equal(result.weekCost, 18.74);
  assert.equal(result.monthCost, 74.19);
  assert.equal(result.totalCost, 197.49);
  assert.equal(result.currency, 'CNY');
});

test('extractUsageSummaryFromHtml reads Chinese relay spend summary', () => {
  const result = extractUsageSummaryFromHtml(`
    <main>
      <p>今日消费 ¥3.82</p>
      <p>本周消费 ¥18.74</p>
      <p>本月消费 ¥74.19</p>
      <p>总消费 ¥197.49</p>
    </main>
  `);

  assert.equal(result.status, 'ok');
  assert.equal(result.todayCost, 3.82);
  assert.equal(result.weekCost, 18.74);
  assert.equal(result.monthCost, 74.19);
  assert.equal(result.totalCost, 197.49);
  assert.equal(result.sourceField, 'html-usage-regex');
});

test('readUsageSummary reads relay web-session spend without public API probing', async () => {
  const visited = [];
  const result = await readUsageSummary({ baseUrl: 'https://relay.example.test/v1' }, {
    skipOfficial: true,
    pageUrl: 'https://relay.example.test/console',
    fetch: async (url) => {
      visited.push(url);
      return {
        ok: true,
        status: 200,
        url,
        text: async () => '<main>Today Spend $2.50 Weekly Spend $9.75 Monthly Spend $22.40 Total Spend $44.80</main>',
      };
    },
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'relay-web-session');
  assert.equal(result.todayCost, 2.5);
  assert.equal(result.weekCost, 9.75);
  assert.equal(result.monthCost, 22.4);
  assert.equal(result.totalCost, 44.8);
  assert.ok(!visited.some((url) => url.includes('/api/usage')));
});

test('getRelaySnapshot prefers relay usage summary over request-log spend totals', async () => {
  const snapshot = await getRelaySnapshot({
    relayState: {
      status: 'ok',
      providers: [
        {
          appType: 'codex',
          providerId: 'relay-1',
          name: 'Relay One',
          baseUrl: 'https://relay.example.test/v1',
          isCurrent: true,
        },
      ],
      requestDailyRollups: [
        {
          date: '2026-06-09',
          appType: 'codex',
          providerId: 'relay-1',
          requestCount: 1,
          successCount: 1,
          inputTokens: 100,
          outputTokens: 50,
          totalCostUsd: 999,
          avgLatencyMs: 1200,
        },
      ],
      recentRequests: [],
    },
    balance: { amount: 20, available: true },
    usageSummaryOptions: {
      enabled: true,
      skipOfficial: true,
      pageUrl: 'https://relay.example.test/console',
      fetch: async (url) => ({
        ok: true,
        status: 200,
        url,
        text: async () => '<main>今日消费 ¥3.82 本周消费 ¥18.74 本月消费 ¥74.19 总消费 ¥197.49</main>',
      }),
    },
    now: new Date('2026-06-09T08:00:00Z'),
  });

  assert.equal(snapshot.spend.today, 3.82);
  assert.equal(snapshot.spend.week, 18.74);
  assert.equal(snapshot.spend.month, 74.19);
  assert.equal(snapshot.spend.total, 197.49);
  assert.equal(snapshot.spend.source, 'relay-web-session');
  assert.equal(snapshot.spend.status, 'ok');
});
