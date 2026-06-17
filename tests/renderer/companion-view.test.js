'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const companion = require(path.resolve(__dirname, '..', '..', 'src/renderer/companion.js'));

const YUAN = '\u00a5';
const RELAY = '\u4e2d\u8f6c\u7ad9';
const NEED_LOGIN = '\u9700\u8981\u767b\u5f55';

test('formatCompactToken renders compact token counts', () => {
  assert.equal(companion.formatCompactToken(168000), '168K');
  assert.equal(companion.formatCompactToken(9400), '9.4K');
  assert.equal(companion.formatCompactToken(2400000), '2.4M');
  assert.equal(companion.formatCompactToken(null), '0');
});

test('formatCompactMoney renders RMB values and status fallback', () => {
  assert.equal(companion.formatCompactMoney(3.82), `${YUAN}3.82`);
  assert.equal(companion.formatCompactMoney(12846), `${YUAN}1.3\u4e07`);
  assert.equal(companion.formatCompactMoney(null, { fallback: NEED_LOGIN }), NEED_LOGIN);
});

test('createCompanionViewModel builds compact and expanded fields without secrets', () => {
  const viewModel = companion.createCompanionViewModel({
    compact: {
      providerName: `waw \u8def OpenAI/Claude ${RELAY}`,
      todayTokens: 168000,
      todaySpend: 3.82,
      balanceAmount: 128.46,
      balanceStatus: 'ok',
      currencySymbol: YUAN,
    },
    details: {
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      avgLatencyMs: 1680,
      cacheHitRate: 0.68,
      balanceStatus: 'ok',
      balanceAmount: 128.46,
    },
    provider: {
      apiKey: 'sk-raw-secret-should-not-render',
      key: 'sk-another-secret',
      cookie: 'SESSION=raw-cookie',
    },
  });

  assert.equal(viewModel.compactText, `waw \u00b7 168K \u00b7 \u4f59\u989d ${YUAN}128.46`);
  assert.equal(viewModel.model, 'gpt-5.5');
  assert.equal(viewModel.reasoningEffort, 'xhigh');
  assert.equal(viewModel.avgLatencyText, '1.7s');
  assert.equal(viewModel.cacheHitRateText, '68%');
  assert.equal(viewModel.balanceStatus, `\u4f59\u989d ${YUAN}128.46`);
  assert.doesNotMatch(JSON.stringify(viewModel), /sk-raw-secret|sk-another-secret|SESSION=raw-cookie|apiKey|cookie/i);
});

test('createCompanionViewModel shows balance status instead of zero when unavailable', () => {
  const viewModel = companion.createCompanionViewModel({
    compact: {
      providerName: RELAY,
      todayTokens: 9400,
      todaySpend: null,
      balanceAmount: null,
      balanceStatus: 'auth-required',
      currencySymbol: YUAN,
    },
    details: {
      model: 'claude-sonnet-4.5',
      reasoningEffort: 'thinking:4096',
    },
  });

  assert.equal(viewModel.compactText, `${RELAY} \u00b7 9.4K \u00b7 ${NEED_LOGIN}`);
  assert.equal(viewModel.statusTone, 'danger');
  assert.equal(viewModel.model, 'claude-sonnet-4.5');
  assert.equal(viewModel.reasoningEffort, 'thinking:4096');
  assert.doesNotMatch(viewModel.compactText, /\u00a50\.00/);
});

test('createCompanionViewModel shows provider mismatch as a warning status', () => {
  const viewModel = companion.createCompanionViewModel({
    compact: {
      providerName: RELAY,
      todayTokens: 168000,
      todaySpend: 3.82,
      balanceAmount: null,
      balanceStatus: 'provider-mismatch',
      currencySymbol: YUAN,
    },
    details: {
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      balanceStatus: 'provider-mismatch',
    },
  });

  assert.equal(viewModel.balanceStatus, '\u4f59\u989d\u9875\u4e0d\u5339\u914d');
  assert.equal(viewModel.statusTone, 'warning');
  assert.match(viewModel.compactText, /\u4f59\u989d\u9875\u4e0d\u5339\u914d/);
  assert.doesNotMatch(viewModel.compactText, /\u00a50\.00/);
});

test('createCompanionViewModel ignores balance spend fields and uses relay spend totals', () => {
  const viewModel = companion.createCompanionViewModel({
    compact: {
      providerName: RELAY,
      todayTokens: 9400,
      balanceAmount: 128.46,
      balanceStatus: 'ok',
      currencySymbol: YUAN,
    },
    spend: {
      today: 3.82,
      week: 18.74,
      month: 74.19,
      total: 197.49,
    },
    balance: {
      amount: 128.46,
      status: 'ok',
      todaySpend: 999,
      weekSpend: 999,
      monthSpend: 999,
      totalSpend: 999,
    },
  });

  assert.equal(viewModel.todaySpendText, `${YUAN}3.82`);
  assert.equal(viewModel.compactText, `${RELAY} \u00b7 9.4K \u00b7 \u4f59\u989d ${YUAN}128.46`);
  assert.doesNotMatch(viewModel.todaySpendText, /999/);
});

test('createAnimatedSnapshot interpolates token spend and balance values', () => {
  const animated = companion.createAnimatedSnapshot({
    compact: {
      providerName: 'waw',
      todayTokens: 100000,
      todaySpend: 2,
      balanceAmount: 80,
      balanceStatus: 'ok',
      currencySymbol: YUAN,
    },
    details: { balanceAmount: 80 },
  }, {
    compact: {
      providerName: 'waw',
      todayTokens: 200000,
      todaySpend: 4,
      balanceAmount: 70,
      balanceStatus: 'ok',
      currencySymbol: YUAN,
    },
    details: { balanceAmount: 70 },
  }, 0.5);

  assert.ok(animated.compact.todayTokens > 100000);
  assert.ok(animated.compact.todayTokens < 200000);
  assert.ok(animated.compact.todaySpend > 2);
  assert.ok(animated.compact.todaySpend < 4);
  assert.ok(animated.compact.balanceAmount < 80);
  assert.ok(animated.compact.balanceAmount > 70);
});

test('companion animates compact values even while collapsed', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src/renderer/companion.js'), 'utf8');
  const setSnapshotSource = source.slice(
    source.indexOf('function setSnapshot'),
    source.indexOf('function initCompanion'),
  );

  assert.match(setSnapshotSource, /createAnimatedSnapshot\(start,\s*next,\s*progress\)/);
  assert.doesNotMatch(setSnapshotSource, /if\s*\(!state\.expanded\)\s*{[\s\S]*?state\.displaySnapshot\s*=\s*next/);
});

test('companion animation updates existing nodes instead of rebuilding every frame', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src/renderer/companion.js'), 'utf8');
  const renderSource = source.slice(
    source.indexOf('function render(root, state)'),
    source.indexOf('function setExpanded'),
  );
  const updateSource = source.slice(
    source.indexOf('function updateRenderedValues'),
    source.indexOf('function hideCompanion'),
  );

  assert.match(renderSource, /if \(updateRenderedValues\(root,\s*state,\s*viewModel\)\) return;/);
  assert.match(renderSource, /clearNode\(root\)/);
  assert.match(updateSource, /querySelector\(\"\.companion-bar\"\)/);
  assert.match(updateSource, /\.textContent = viewModel\.compactText/);
  assert.match(updateSource, /return true/);
});
