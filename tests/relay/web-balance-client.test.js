'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  apiCandidates,
  extractBalanceFromHtml,
  pageCandidates,
  readWebSessionBalance,
} = require('../../src/relay/web-balance-client');

test('extractBalanceFromHtml reads amount from CSS class selector', () => {
  const result = extractBalanceFromHtml('<main><span class="balance-value">¥123.45</span></main>', '.balance-value');

  assert.equal(result.amount, 123.45);
  assert.equal(result.sourceField, '.balance-value');
});

test('extractBalanceFromHtml reads Chinese balance text without selector', () => {
  const result = extractBalanceFromHtml('<div>\u8d26\u6237\u4f59\u989d\uff1a12.34 \u5143</div>');

  assert.equal(result.amount, 12.34);
  assert.equal(result.sourceField, 'html-regex');
});

test('extractBalanceFromHtml reads WAW account current balance text', () => {
  const result = extractBalanceFromHtml('<section><span>当前余额</span><strong>$18.53</strong><span>历史消耗 $86.10</span></section>');

  assert.equal(result.amount, 18.53);
  assert.equal(result.sourceField, 'html-regex');
});

test('extractBalanceFromHtml reads English balance text without selector', () => {
  const result = extractBalanceFromHtml('<section>Balance $9.99</section>');

  assert.equal(result.amount, 9.99);
  assert.equal(result.sourceField, 'html-regex');
});

test('extractBalanceFromHtml converts embedded quota JSON instead of showing raw quota', () => {
  const result = extractBalanceFromHtml('<script>window.user={"quota":20665000,"quota_per_unit":500000}</script>');

  assert.equal(result.amount, 41.33);
  assert.equal(result.sourceField, 'html-json-like-quota');
});

test('readWebSessionBalance returns auth-required for login pages', async () => {
  const balance = await readWebSessionBalance({
    pageUrl: 'https://relay.example.cn/dashboard',
    fetch: async (url) => ({
      ok: true,
      status: 200,
      url: url.includes('/api/') ? url : 'https://relay.example.cn/login',
      text: async () => (url.includes('/api/status') ? '{}' : '<form><input type="password" /></form>'),
    }),
  });

  assert.equal(balance.status, 'auth-required');
  assert.equal(balance.amount, null);
  assert.equal(balance.available, false);
});

test('readWebSessionBalance returns parse-error instead of zero when no balance is found', async () => {
  const balance = await readWebSessionBalance({
    pageUrl: 'https://relay.example.cn/dashboard',
    fetch: async (url) => ({
      ok: true,
      status: 200,
      url,
      text: async () => (url.includes('/api/') ? '{}' : '<main>Welcome</main>'),
    }),
  });

  assert.equal(balance.status, 'parse-error');
  assert.equal(balance.amount, null);
  assert.equal(balance.available, false);
});

test('readWebSessionBalance reports rate-limited pages explicitly', async () => {
  const result = await readWebSessionBalance({
    pageUrl: 'https://relay.example.test/console',
    fetch: async (url) => ({
      ok: false,
      status: 429,
      url,
      text: async () => 'Too Many Requests',
    }),
  });

  assert.equal(result.status, 'rate-limited');
  assert.equal(result.available, false);
  assert.equal(result.amount, null);
});

test('readWebSessionBalance reads new-api logged-in JSON balance before HTML', async () => {
  const visited = [];
  const result = await readWebSessionBalance({
    pageUrl: 'https://relay.example.test/console',
    fetch: async (url) => {
      visited.push(url);
      if (url.endsWith('/api/status')) {
        return {
          ok: true,
          status: 200,
          url,
          text: async () => JSON.stringify({ data: { quota_per_unit: 500000 } }),
        };
      }
      if (url.endsWith('/api/user/self')) {
        return {
          ok: true,
          status: 200,
          url,
          text: async () => JSON.stringify({ data: { quota: 20665000, used_quota: 9000000 } }),
        };
      }
      return {
        ok: true,
        status: 200,
        url,
        text: async () => '<main>Balance $1.00</main>',
      };
    },
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'web-session-api');
  assert.equal(result.amount, 41.33);
  assert.equal(result.endpoint, 'https://relay.example.test/api/user/self');
  assert.ok(visited.includes('https://relay.example.test/api/status'));
  assert.ok(!visited.includes('https://relay.example.test/console'));
});

test('readWebSessionBalance falls back to HTML when JSON APIs are unavailable', async () => {
  const visited = [];
  const result = await readWebSessionBalance({
    pageUrl: 'https://relay.example.test/console',
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
        text: async () => '<main>Balance $9.99</main>',
      };
    },
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'web-session');
  assert.equal(result.amount, 9.99);
  assert.ok(visited.includes('https://relay.example.test/api/user/self'));
  assert.ok(visited.includes('https://relay.example.test/console'));
});

test('readWebSessionBalance falls back to rendered page text for SPA dashboards', async () => {
  const rendered = [];
  const result = await readWebSessionBalance({
    pageUrl: 'https://relay.example.test/console',
    fetch: async (url) => ({
      ok: !url.includes('/api/'),
      status: url.includes('/api/') ? 404 : 200,
      url,
      text: async () => (url.includes('/api/') ? '{}' : '<main id="app"></main>'),
    }),
    renderText: async (url) => {
      rendered.push(url);
      return url.endsWith('/console') ? '控制台 当前余额 ¥88.25 今日消费 ¥3.10' : '';
    },
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'web-session-rendered');
  assert.equal(result.amount, 88.25);
  assert.equal(result.endpoint, 'https://relay.example.test/console');
  assert.ok(rendered.includes('https://relay.example.test/console'));
});

test('readWebSessionBalance continues to HTML pages when common APIs require auth', async () => {
  const visited = [];
  const result = await readWebSessionBalance({
    pageUrl: 'https://relay.example.test/console',
    fetch: async (url) => {
      visited.push(url);
      if (url.includes('/api/')) {
        return {
          ok: false,
          status: 401,
          url,
          text: async () => '<form><input type="password" /></form>',
        };
      }
      return {
        ok: true,
        status: 200,
        url,
        text: async () => (url.endsWith('/console') ? '<main>\u8d26\u6237\u4f59\u989d\uff1a66.66 \u5143</main>' : '<main>Welcome</main>'),
      };
    },
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'web-session');
  assert.equal(result.amount, 66.66);
  assert.ok(visited.includes('https://relay.example.test/api/user/self'));
  assert.ok(visited.includes('https://relay.example.test/console'));
});

test('readWebSessionBalance reports auth-required only after APIs and pages all require login', async () => {
  const result = await readWebSessionBalance({
    pageUrl: 'https://relay.example.test/console',
    fetch: async (url) => ({
      ok: url.includes('/api/status'),
      status: url.includes('/api/status') ? 200 : 401,
      url: url.includes('/api/status') ? url : 'https://relay.example.test/login',
      text: async () => (url.includes('/api/status') ? '{}' : '<form><input type="password" /></form>'),
    }),
  });

  assert.equal(result.status, 'auth-required');
  assert.equal(result.available, false);
  assert.equal(result.amount, null);
});

test('readWebSessionBalance tries common dashboard pages after base URL parse miss', async () => {
  const visited = [];
  const balance = await readWebSessionBalance({
    pageUrl: 'https://relay.example.cn/v1',
    fetch: async (url) => {
      visited.push(url);
      return {
        ok: !url.includes('/api/'),
        status: url.includes('/api/') ? 404 : 200,
        url,
        text: async () => (url.endsWith('/dashboard') ? '<main>\u8d26\u6237\u4f59\u989d\uff1a45.67 \u5143</main>' : '<main>Welcome</main>'),
      };
    },
  });

  assert.equal(balance.status, 'ok');
  assert.equal(balance.amount, 45.67);
  assert.equal(balance.endpoint, 'https://relay.example.cn/dashboard');
  assert.ok(visited.includes('https://relay.example.cn/v1'));
  assert.ok(visited.includes('https://relay.example.cn/dashboard'));
});

test('pageCandidates includes explicit URL and common account pages', () => {
  const candidates = pageCandidates('https://relay.example.cn/v1');

  assert.equal(candidates[0], 'https://relay.example.cn/v1');
  assert.ok(candidates.includes('https://relay.example.cn/dashboard'));
  assert.ok(candidates.includes('https://relay.example.cn/wallet'));
});

test('apiCandidates includes common logged-in balance endpoints', () => {
  const candidates = apiCandidates('https://relay.example.cn/console');

  assert.deepEqual(candidates.slice(0, 3), [
    'https://relay.example.cn/api/user/self',
    'https://relay.example.cn/api/user/quota',
    'https://relay.example.cn/api/user/balance',
  ]);
});
