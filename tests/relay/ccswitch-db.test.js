'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readRelayState } = require('../../src/relay/ccswitch-db');

test('readRelayState returns missing status when database path does not exist', async () => {
  const state = await readRelayState({
    dbPath: path.join(os.tmpdir(), `missing-ccswitch-${Date.now()}.db`),
  });

  assert.equal(state.status, 'missing');
  assert.deepEqual(state.providers, []);
  assert.deepEqual(state.recentRequests, []);
  assert.deepEqual(state.usageDailyRollups, []);
});

test('readRelayState queries sqlite through python and returns parsed relay state', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-monitor-db-'));
  const dbPath = path.join(dir, 'cc-switch.db');
  const setupScript = `
import sqlite3, json, sys
con = sqlite3.connect(sys.argv[1])
con.executescript("""
CREATE TABLE providers (
  id TEXT NOT NULL,
  app_type TEXT NOT NULL,
  name TEXT NOT NULL,
  settings_config TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0,
  sort_index INTEGER
);
CREATE TABLE proxy_config (
  app_type TEXT PRIMARY KEY,
  proxy_enabled INTEGER NOT NULL DEFAULT 0,
  listen_address TEXT NOT NULL DEFAULT '127.0.0.1',
  listen_port INTEGER NOT NULL DEFAULT 15721,
  enable_logging INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 0,
  auto_failover_enabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE proxy_request_logs (
  request_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  app_type TEXT NOT NULL,
  model TEXT NOT NULL,
  request_model TEXT,
  reasoning_effort TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost_usd TEXT NOT NULL DEFAULT '0',
  input_cost_usd TEXT NOT NULL DEFAULT '0',
  output_cost_usd TEXT NOT NULL DEFAULT '0',
  cache_read_cost_usd TEXT NOT NULL DEFAULT '0',
  cache_creation_cost_usd TEXT NOT NULL DEFAULT '0',
  latency_ms INTEGER NOT NULL,
  status_code INTEGER NOT NULL,
  session_id TEXT,
  created_at INTEGER NOT NULL,
  data_source TEXT NOT NULL DEFAULT 'proxy'
);
CREATE TABLE usage_daily_rollups (
  date TEXT NOT NULL,
  app_type TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost_usd TEXT NOT NULL DEFAULT '0',
  avg_latency_ms INTEGER NOT NULL DEFAULT 0
);
""")
settings = json.dumps({
  "auth": {"api_key": "sk-fixture-1234567890"},
  "config": "model_provider = \\"custom\\"\\nmodel = \\"gpt-5.5\\"\\nmodel_reasoning_effort = \\"xhigh\\"\\n[model_providers.custom]\\nbase_url = \\"https://fixture.test/v1\\"\\nwire_api = \\"responses\\""
})
con.execute("INSERT INTO providers (id, app_type, name, settings_config, is_current, sort_index) VALUES (?, ?, ?, ?, ?, ?)", ("relay-fixture", "codex", "星河中转", settings, 1, 1))
con.execute("INSERT INTO proxy_config (app_type, proxy_enabled, listen_address, listen_port, enable_logging, enabled, auto_failover_enabled) VALUES (?, ?, ?, ?, ?, ?, ?)", ("codex", 1, "127.0.0.1", 15721, 1, 1, 0))
con.execute("INSERT INTO proxy_request_logs (request_id, provider_id, app_type, model, request_model, reasoning_effort, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_cost_usd, input_cost_usd, output_cost_usd, cache_read_cost_usd, cache_creation_cost_usd, latency_ms, status_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ("req-1", "relay-fixture", "codex", "provider-default-model", "gpt-4.1-real", "high", 1000, 200, 300, 50, "0", "0.10", "0.12", "0.02", "0.03", 1234, 200, 1780000000))
con.execute("INSERT INTO proxy_request_logs (request_id, provider_id, app_type, model, request_model, reasoning_effort, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_cost_usd, input_cost_usd, output_cost_usd, cache_read_cost_usd, cache_creation_cost_usd, latency_ms, status_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ("req-2", "relay-other", "codex", "other-provider-model", "gpt-other-real", "low", 2000, 400, 600, 100, "2.00", "0", "0", "0", "0", 1500, 200, 1780000000))
con.execute("INSERT INTO proxy_request_logs (request_id, provider_id, app_type, model, request_model, reasoning_effort, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_cost_usd, input_cost_usd, output_cost_usd, cache_read_cost_usd, cache_creation_cost_usd, latency_ms, status_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ("req-3", "relay-fixture", "claude", "claude-provider-model", "claude-real", "medium", 3000, 500, 700, 120, "3.50", "0", "0", "0", "0", 1700, 200, 1780000000))
con.execute("INSERT INTO proxy_request_logs (request_id, provider_id, app_type, model, request_model, reasoning_effort, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_cost_usd, input_cost_usd, output_cost_usd, cache_read_cost_usd, cache_creation_cost_usd, latency_ms, status_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ("req-4", "relay-fixture", "codex", "provider-default-model", "gpt-old-real", "high", 400, 40, 20, 4, "0.44", "0", "0", "0", "0", 1200, 200, 1779913600))
con.execute("INSERT INTO usage_daily_rollups (date, app_type, provider_id, model, request_count, success_count, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ("2026-06-09", "codex", "relay-fixture", "gpt-5.5", 2, 2, 1000, 200, 300, 50, "0.25", 1234))
con.execute("INSERT INTO usage_daily_rollups (date, app_type, provider_id, model, request_count, success_count, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ("2026-06-08", "codex", "relay-fixture", "gpt-5.5", 1, 1, 400, 40, 20, 4, "0.44", 1200))
con.execute("INSERT INTO usage_daily_rollups (date, app_type, provider_id, model, request_count, success_count, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ("2026-06-09", "codex", "relay-other", "gpt-other-real", 9, 9, 9000, 900, 90, 9, "9.00", 900))
con.execute("INSERT INTO usage_daily_rollups (date, app_type, provider_id, model, request_count, success_count, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ("2026-06-09", "claude", "relay-fixture", "claude-real", 3, 3, 3000, 500, 700, 120, "3.50", 1700))
con.commit()
`;
  execFileSync('python', ['-c', setupScript, dbPath]);

  const state = await readRelayState({ dbPath, pythonCommand: 'python' });

  assert.equal(state.status, 'ok');
  assert.equal(state.providers.length, 1);
  assert.equal(state.providers[0].name, '星河中转');
  assert.equal(state.providers[0].baseUrl, 'https://fixture.test/v1');
  assert.equal(state.providers[0].maskedKey.includes('1234567890'), false);
  assert.equal(state.recentRequests[0].requestId, 'req-1');
  assert.deepEqual(state.recentRequests.map((row) => row.providerId), ['relay-fixture', 'relay-fixture']);
  assert.deepEqual(state.recentRequests.map((row) => row.appType), ['codex', 'codex']);
  assert.equal(state.recentRequests[0].providerModel, 'provider-default-model');
  assert.equal(state.recentRequests[0].requestModel, 'gpt-4.1-real');
  assert.equal(state.recentRequests[0].model, 'gpt-4.1-real');
  assert.equal(state.recentRequests[0].reasoningEffort, 'high');
  assert.equal(state.usageDailyRollups[0].date, '2026-06-09');
  assert.deepEqual(state.usageDailyRollups.map((row) => row.providerId), ['relay-fixture', 'relay-fixture']);
  assert.deepEqual(state.usageDailyRollups.map((row) => row.appType), ['codex', 'codex']);
  const fixtureRollup = state.requestDailyRollups.find((row) => row.providerId === 'relay-fixture' && row.appType === 'codex');
  assert.equal(fixtureRollup.totalCostUsd, 0.27);
  assert.equal(fixtureRollup.inputTokens, 1000);
  assert.equal(state.requestDailyRollups.some((row) => row.providerId === 'relay-other'), false);
  assert.equal(state.requestDailyRollups.some((row) => row.appType === 'claude'), false);
  assert.equal(state.proxyConfig[0].listenPort, 15721);
});

test('readRelayState falls back to current app logs when provider ids do not match request logs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-monitor-db-mismatch-'));
  const dbPath = path.join(dir, 'cc-switch.db');
  const setupScript = `
import sqlite3, json, sys
con = sqlite3.connect(sys.argv[1])
con.executescript("""
CREATE TABLE providers (
  id TEXT NOT NULL,
  app_type TEXT NOT NULL,
  name TEXT NOT NULL,
  settings_config TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0,
  sort_index INTEGER
);
CREATE TABLE proxy_request_logs (
  request_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  app_type TEXT NOT NULL,
  model TEXT NOT NULL,
  request_model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost_usd TEXT NOT NULL DEFAULT '0',
  latency_ms INTEGER NOT NULL,
  status_code INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE usage_daily_rollups (
  date TEXT NOT NULL,
  app_type TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost_usd TEXT NOT NULL DEFAULT '0',
  avg_latency_ms INTEGER NOT NULL DEFAULT 0
);
""")
settings = json.dumps({"config": "model = \\"gpt-5.5\\"\\n[model_providers.custom]\\nbase_url = \\"https://relay.example.cn/v1\\""})
con.execute("INSERT INTO providers (id, app_type, name, settings_config, is_current, sort_index) VALUES (?, ?, ?, ?, ?, ?)", ("waw-provider-row", "codex", "waw", settings, 1, 1))
con.execute("INSERT INTO proxy_request_logs (request_id, provider_id, app_type, model, request_model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_cost_usd, latency_ms, status_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ("req-codex", "_codex_session", "codex", "gpt-5.5", "gpt-5.5", 1000, 200, 300, 40, "1.50", 1000, 200, 1780000000))
con.execute("INSERT INTO proxy_request_logs (request_id, provider_id, app_type, model, request_model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_cost_usd, latency_ms, status_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ("req-claude", "_claude_session", "claude", "claude-sonnet-4", "claude-sonnet-4", 9000, 900, 90, 9, "9.00", 900, 200, 1780000000))
con.execute("INSERT INTO usage_daily_rollups (date, app_type, provider_id, model, request_count, success_count, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ("2026-06-09", "codex", "_codex_session", "gpt-5.5", 1, 1, 1000, 200, 300, 40, "1.50", 1000))
con.execute("INSERT INTO usage_daily_rollups (date, app_type, provider_id, model, request_count, success_count, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_cost_usd, avg_latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ("2026-06-09", "claude", "_claude_session", "claude-sonnet-4", 9, 9, 9000, 900, 90, 9, "9.00", 900))
con.commit()
`;
  execFileSync('python', ['-c', setupScript, dbPath]);

  const state = await readRelayState({ dbPath, pythonCommand: 'python' });

  assert.equal(state.status, 'ok');
  assert.equal(state.providers[0].providerId, 'waw-provider-row');
  assert.deepEqual(state.recentRequests.map((row) => row.requestId), ['req-codex']);
  assert.deepEqual(state.usageDailyRollups.map((row) => row.appType), ['codex']);
  assert.deepEqual(state.requestDailyRollups.map((row) => row.appType), ['codex']);
  assert.equal(state.requestDailyRollups[0].totalCostUsd, 1.5);
});
