'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getAdapter,
  getAdapterById,
  listAdapters,
  matchSite,
  resolveAdapter,
} = require('../electron/site-adapters/registry');

const chatgpt = require('../electron/site-adapters/chatgpt');
const deepseek = require('../electron/site-adapters/deepseek');
const gemini = require('../electron/site-adapters/gemini');
const qwen = require('../electron/site-adapters/qwen');
const grok = require('../electron/site-adapters/grok');
const generic = require('../electron/site-adapters/generic-fill');

// ========== Adapter matches 方法测试 ==========

test('chatgpt adapter matches correct URLs', () => {
  assert.equal(chatgpt.matches('https://chatgpt.com/c/abc'), true);
  assert.equal(chatgpt.matches('https://chat.openai.com/c/abc'), true);
  assert.equal(chatgpt.matches('https://www.chatgpt.com/'), true);
  assert.equal(chatgpt.matches('https://example.com'), false);
  assert.equal(chatgpt.matches('invalid-url'), false);
});

test('deepseek adapter matches correct URLs', () => {
  assert.equal(deepseek.matches('https://chat.deepseek.com/a/chat'), true);
  assert.equal(deepseek.matches('https://deepseek.com'), false);
  assert.equal(deepseek.matches('https://example.com'), false);
  assert.equal(deepseek.matches('invalid-url'), false);
});

test('gemini adapter matches correct URLs', () => {
  assert.equal(gemini.matches('https://gemini.google.com/app'), true);
  assert.equal(gemini.matches('https://www.gemini.google.com/'), true);
  assert.equal(gemini.matches('https://bard.google.com'), false);
  assert.equal(gemini.matches('https://example.com'), false);
  assert.equal(gemini.matches('invalid-url'), false);
});

test('qwen adapter matches correct URLs', () => {
  assert.equal(qwen.matches('https://tongyi.aliyun.com/'), true);
  assert.equal(qwen.matches('https://qianwen.aliyun.com/'), true);
  assert.equal(qwen.matches('https://www.tongyi.aliyun.com/'), false);
  assert.equal(qwen.matches('https://example.com'), false);
  assert.equal(qwen.matches('invalid-url'), false);
});

test('grok adapter matches correct URLs', () => {
  assert.equal(grok.matches('https://grok.com/'), true);
  assert.equal(grok.matches('https://www.grok.com/'), true);
  assert.equal(grok.matches('https://x.com/grok'), false);
  assert.equal(grok.matches('https://example.com'), false);
  assert.equal(grok.matches('invalid-url'), false);
});

// ========== Registry 查找和匹配测试 ==========

test('getAdapter returns correct adapter for each site', () => {
  assert.equal(getAdapter('https://chatgpt.com/c/abc').id, 'chatgpt');
  assert.equal(getAdapter('https://chat.deepseek.com/a/chat').id, 'deepseek');
  assert.equal(getAdapter('https://gemini.google.com/app').id, 'gemini');
  assert.equal(getAdapter('https://tongyi.aliyun.com/').id, 'qwen');
  assert.equal(getAdapter('https://grok.com/').id, 'grok');
  assert.equal(getAdapter('https://unknown-site.com/').id, 'generic-fill');
});

test('getAdapterById returns correct adapter', () => {
  assert.equal(getAdapterById('chatgpt').id, 'chatgpt');
  assert.equal(getAdapterById('deepseek').id, 'deepseek');
  assert.equal(getAdapterById('gemini').id, 'gemini');
  assert.equal(getAdapterById('qwen').id, 'qwen');
  assert.equal(getAdapterById('grok').id, 'grok');
  assert.equal(getAdapterById('generic-fill').id, 'generic-fill');
  assert.equal(getAdapterById('nonexistent'), null);
});

test('listAdapters returns all adapters', () => {
  const all = listAdapters();
  assert.equal(all.length, 5);
  const ids = all.map((a) => a.id);
  assert.ok(ids.includes('chatgpt'));
  assert.ok(ids.includes('deepseek'));
  assert.ok(ids.includes('gemini'));
  assert.ok(ids.includes('qwen'));
  assert.ok(ids.includes('grok'));
});

test('matchSite returns correct match info', () => {
  const chatgptMatch = matchSite('https://chatgpt.com/c/abc');
  assert.equal(chatgptMatch.matched, true);
  assert.equal(chatgptMatch.adapterId, 'chatgpt');

  const unknownMatch = matchSite('https://unknown.com');
  assert.equal(unknownMatch.matched, false);
  assert.equal(unknownMatch.adapterId, 'generic-fill');
});

// ========== Adapter 结构完整性测试 ==========

test('all adapters have required structure', () => {
  const allAdapters = [...listAdapters(), generic];

  for (const adapter of allAdapters) {
    assert.ok(adapter.id, `${adapter.id} has id`);
    assert.ok(typeof adapter.matches === 'function', `${adapter.id} has matches`);
    assert.ok(adapter.prompt, `${adapter.id} has prompt`);
    assert.ok(Array.isArray(adapter.prompt.inputSelectors), `${adapter.id} has inputSelectors`);
    assert.ok(Array.isArray(adapter.prompt.sendSelectors), `${adapter.id} has sendSelectors`);
    assert.ok(adapter.prompt.inputStrategy, `${adapter.id} has inputStrategy`);
    assert.ok(adapter.prompt.sendStrategy, `${adapter.id} has sendStrategy`);
    assert.ok(adapter.page, `${adapter.id} has page`);
    assert.ok(Array.isArray(adapter.page.readySelectors), `${adapter.id} has readySelectors`);
    assert.ok(Array.isArray(adapter.page.loadingSelectors), `${adapter.id} has loadingSelectors`);
    assert.ok(adapter.capabilities, `${adapter.id} has capabilities`);
    assert.ok(typeof adapter.capabilities.canAutoSend === 'boolean', `${adapter.id} has canAutoSend`);
    assert.ok(typeof adapter.capabilities.canFillPrompt === 'boolean', `${adapter.id} has canFillPrompt`);
  }
});

// ========== Fallback 降级逻辑测试 ==========

test('unknown site falls back to generic-fill', () => {
  const adapter = getAdapter('https://unknown-site.com/chat');
  assert.equal(adapter.id, 'generic-fill');
  assert.equal(adapter.capabilities.canAutoSend, false);
  assert.equal(adapter.capabilities.canFillPrompt, true);
  assert.equal(adapter.prompt.sendSelectors.length, 0);
});

test('generic adapter always matches', () => {
  assert.equal(generic.matches('https://anything.com'), true);
  assert.equal(generic.matches(''), true);
  assert.equal(generic.matches('not-a-url'), true);
});

// ========== 异常处理测试 ==========

test('adapter matches handles invalid URLs gracefully', () => {
  assert.equal(getAdapter('not-a-valid-url').id, 'generic-fill');
  assert.equal(matchSite('not-a-valid-url').matched, false);
});

// ========== resolveAdapter 向后兼容测试 ==========

test('resolveAdapter works like getAdapter', () => {
  assert.equal(resolveAdapter('https://chatgpt.com/').id, 'chatgpt');
  assert.equal(resolveAdapter('https://unknown.com/').id, 'generic-fill');
});
