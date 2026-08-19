'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../electron/model-policy');

test('new partitions derive from unique model ids', () => {
  assert.equal(policy.createPartitionForModelId('模型-123'), 'persist:model----123');
  assert.notEqual(policy.createPartitionForModelId('a'), policy.createPartitionForModelId('b'));
});

test('snapshot URLs must stay on the model origin', () => {
  assert.equal(policy.isSameModelOrigin('https://chatgpt.com/c/abc', 'https://chatgpt.com'), true);
  assert.equal(policy.isSameModelOrigin('https://evil.example/c', 'https://chatgpt.com'), false);
});

test('unknown sites are conservative generic-fill adapters', () => {
  assert.equal(policy.getModelCapabilities({ url: 'https://example.com' }).canAutoSend, false);
  assert.equal(policy.getModelCapabilities({ url: 'https://chatgpt.com' }).canAutoSend, true);
});
