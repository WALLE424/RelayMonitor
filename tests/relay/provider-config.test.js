'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseProviderConfig } = require('../../src/relay/provider-config');

test('parseProviderConfig extracts codex TOML provider fields and masks auth key', () => {
  const settingsConfig = JSON.stringify({
    auth: {
      api_key: 'sk-test-1234567890abcdef',
      auth_mode: 'apikey',
    },
    config: [
      'model_provider = "custom"',
      'model = "gpt-5.5"',
      'model_reasoning_effort = "high"',
      '',
      '[model_providers.custom]',
      'base_url = "https://relay.example.test/v1"',
      'wire_api = "responses"',
    ].join('\n'),
  });

  const provider = parseProviderConfig({
    id: 'relay-1',
    app_type: 'codex',
    name: 'Relay One',
    settings_config: settingsConfig,
    is_current: 1,
  });

  assert.deepEqual(
    {
      appType: provider.appType,
      providerId: provider.providerId,
      name: provider.name,
      baseUrl: provider.baseUrl,
      model: provider.model,
      reasoningEffort: provider.reasoningEffort,
      wireApi: provider.wireApi,
      isCurrent: provider.isCurrent,
    },
    {
      appType: 'codex',
      providerId: 'relay-1',
      name: 'Relay One',
      baseUrl: 'https://relay.example.test/v1',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      wireApi: 'responses',
      isCurrent: true,
    },
  );
  assert.notEqual(provider.maskedKey, '');
  assert.match(provider.maskedKey, /^sk-[\s\S]+CDEF$/);
  assert.equal(provider.maskedKey.startsWith('sk--'), false);
  assert.equal(provider.apiKey, 'sk-test-1234567890abcdef');
  assert.equal(JSON.stringify(provider).includes('1234567890abcdef'), false);
  assert.equal(Object.keys(provider).includes('apiKey'), false);
});

test('parseProviderConfig normalizes common ccswitch provider fields without exposing plain keys', () => {
  const settingsConfig = JSON.stringify({
    endpoint: 'https://ccswitch-relay.example/v1',
    balanceEndpoint: '/api/user/quota',
    default_model: 'claude-opus-4-1',
    modelReasoningEffort: 'medium',
    apiKey: 'sk-live-secretplaintext-1234567890abcd',
    provider: {
      type: 'anthropic',
    },
  });

  const provider = parseProviderConfig({
    id: 'relay-ccswitch',
    app_type: 'claude',
    name: 'ccswitch Relay',
    settings_config: settingsConfig,
    is_current: 1,
  });

  assert.equal(provider.baseUrl, 'https://ccswitch-relay.example/v1');
  assert.equal(provider.balanceEndpoint, '/api/user/quota');
  assert.equal(provider.model, 'claude-opus-4-1');
  assert.equal(provider.reasoningEffort, 'medium');
  assert.equal(provider.providerType, 'anthropic');
  assert.equal(provider.maskedKey.includes('secretplaintext'), false);
  assert.equal(provider.keyPreview.includes('secretplaintext'), false);
  assert.match(provider.keyPreview, /^sk-l.+ABCD$/);
  assert.equal(provider.apiKey, 'sk-live-secretplaintext-1234567890abcd');
  assert.equal(JSON.stringify(provider).includes('sk-live-secretplaintext-1234567890abcd'), false);
  assert.equal(Object.keys(provider).includes('apiKey'), false);
});

test('parseProviderConfig extracts ccswitch usage_script balance endpoint', () => {
  const settingsConfig = JSON.stringify({
    auth: { OPENAI_API_KEY: 'sk-live-pinai-secret-1234567890abcd' },
    config: [
      'model_provider = "pinai"',
      '[model_providers.pinai]',
      'base_url = "https://us.pinai-cn.com"',
    ].join('\n'),
  });
  const meta = JSON.stringify({
    usage_script: {
      enabled: true,
      timeout: 10,
      code: `({
        request: {
          url: "https://us.pinai-cn.com/v1/usage",
          method: "GET",
          headers: { "Authorization": "Bearer {{apiKey}}" }
        },
        extractor: function(response) {
          return { remaining: response.balance, unit: response.unit || "USD" };
        }
      })`,
    },
  });

  const provider = parseProviderConfig({
    id: 'pinaiapi',
    app_type: 'codex',
    name: 'PinAI API',
    settings_config: settingsConfig,
    website_url: 'https://us.pinai-cn.com',
    meta,
    is_current: 1,
  });

  assert.equal(provider.balanceEndpoint, 'https://us.pinai-cn.com/v1/usage');
  assert.equal(provider.balanceEndpointSource, 'ccswitch-usage-script');
  assert.equal(provider.balanceTimeoutSeconds, 10);
  assert.equal(provider.apiKey, 'sk-live-pinai-secret-1234567890abcd');
  assert.equal(JSON.stringify(provider).includes('sk-live-pinai-secret'), false);
});

test('parseProviderConfig tolerates malformed settings_config', () => {
  const provider = parseProviderConfig({
    id: 'broken',
    app_type: 'codex',
    name: 'Broken',
    settings_config: '{not-json',
  });

  assert.equal(provider.providerId, 'broken');
  assert.equal(provider.baseUrl, '');
  assert.equal(provider.maskedKey, '');
  assert.match(provider.configError, /settings_config/i);
});
