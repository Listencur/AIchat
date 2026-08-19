'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PromptInjector,
  buildPromptSubmitScript,
} = require('../electron/prompt-injector');

// ── buildPromptSubmitScript 测试 ──

test('buildPromptSubmitScript returns a string containing the prompt', () => {
  const script = buildPromptSubmitScript('Hello World');
  assert.ok(typeof script === 'string');
  assert.ok(script.includes('Hello World'));
  assert.ok(script.includes('async'));
});

test('buildPromptSubmitScript sets allowSend correctly', () => {
  const scriptTrue = buildPromptSubmitScript('test', true);
  assert.ok(scriptTrue.includes('true'));

  const scriptFalse = buildPromptSubmitScript('test', false);
  assert.ok(scriptFalse.includes('false'));
});

test('buildPromptSubmitScript includes adapter spec', () => {
  const adapter = { prompt: { inputSelectors: ['.my-input'] } };
  const script = buildPromptSubmitScript('test', true, adapter);
  assert.ok(script.includes('.my-input'));
});

test('buildPromptSubmitScript escapes special characters in prompt', () => {
  const script = buildPromptSubmitScript('line1\nline2\ttab"quote');
  assert.ok(script.includes('line1\\nline2'));
});

test('buildPromptSubmitScript returns function-like script', () => {
  const script = buildPromptSubmitScript('test');
  assert.ok(script.includes('(async () => {'));
  assert.ok(script.includes('})()'));
});

// ── PromptInjector.buildPromptScript 测试 ──

test('PromptInjector.buildPromptScript builds script from prompt', () => {
  const script = PromptInjector.buildPromptScript('Hello', true, {});
  assert.ok(typeof script === 'string');
  assert.ok(script.includes('Hello'));
});

test('PromptInjector.buildPromptScript includes adapter spec', () => {
  const adapter = { spec: { prompt: { sendSelectors: ['.send-btn'] } } };
  const script = PromptInjector.buildPromptScript('test', true, adapter);
  assert.ok(script.includes('.send-btn'));
});

test('PromptInjector.buildPromptScript with empty adapter', () => {
  const script = PromptInjector.buildPromptScript('test', false);
  assert.ok(typeof script === 'string');
  assert.ok(script.includes('test'));
});

// ── PromptInjector.fillPrompt 测试 ──

test('PromptInjector.fillPrompt returns error for null view', async () => {
  const result = await PromptInjector.fillPrompt(null, 'test', {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'view-not-available');
});

test('PromptInjector.fillPrompt returns error for destroyed view', async () => {
  const view = {
    webContents: {
      isDestroyed: () => true,
    },
  };
  const result = await PromptInjector.fillPrompt(view, 'test', {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'view-not-available');
});

test('PromptInjector.fillPrompt executes script on valid view', async () => {
  let executedScript = null;
  const view = {
    webContents: {
      isDestroyed: () => false,
      executeJavaScript: async (script) => {
        executedScript = script;
        return { ok: true, method: 'filled' };
      },
    },
  };
  const result = await PromptInjector.fillPrompt(view, 'test prompt', {});
  assert.equal(result.ok, true);
  assert.ok(executedScript.includes('test prompt'));
});

test('PromptInjector.fillPrompt handles execution error', async () => {
  const view = {
    webContents: {
      isDestroyed: () => false,
      executeJavaScript: async () => {
        throw new Error('Script execution failed');
      },
    },
  };
  const result = await PromptInjector.fillPrompt(view, 'test', {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'fill-failed');
  assert.ok(result.message.includes('Script execution failed'));
});

// ── PromptInjector.submitPrompt 测试 ──

test('PromptInjector.submitPrompt returns error for null view', async () => {
  const result = await PromptInjector.submitPrompt(null, 'test', {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'view-not-available');
});

test('PromptInjector.submitPrompt returns error for destroyed view', async () => {
  const view = {
    webContents: {
      isDestroyed: () => true,
    },
  };
  const result = await PromptInjector.submitPrompt(view, 'test', {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'view-not-available');
});

test('PromptInjector.submitPrompt executes script on valid view', async () => {
  let executedScript = null;
  const view = {
    webContents: {
      isDestroyed: () => false,
      executeJavaScript: async (script) => {
        executedScript = script;
        return { ok: true, method: 'form' };
      },
    },
  };
  const result = await PromptInjector.submitPrompt(view, 'submit me', {});
  assert.equal(result.ok, true);
  assert.ok(executedScript.includes('submit me'));
});

test('PromptInjector.submitPrompt handles execution error', async () => {
  const view = {
    webContents: {
      isDestroyed: () => false,
      executeJavaScript: async () => {
        throw new Error('Submit failed');
      },
    },
  };
  const result = await PromptInjector.submitPrompt(view, 'test', {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'submit-failed');
});

// ── PromptInjector.fallbackManualSend 测试 ──

test('PromptInjector.fallbackManualSend returns error when fill fails', async () => {
  const result = await PromptInjector.fallbackManualSend(null, 'test', {});
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'view-not-available');
});

test('PromptInjector.fallbackManualSend returns filled-only when fill succeeds but needs manual send', async () => {
  const view = {
    webContents: {
      isDestroyed: () => false,
      executeJavaScript: async () => ({ ok: true, method: 'filled' }),
    },
  };
  const result = await PromptInjector.fallbackManualSend(view, 'test', {});
  assert.equal(result.ok, true);
  assert.equal(result.method, 'filled-only');
  assert.equal(result.requiresManualSend, true);
});

// ── PromptInjector.findSendButton 测试 ──

test('PromptInjector.findSendButton returns send selectors', () => {
  const selectors = PromptInjector.findSendButton({});
  assert.ok(Array.isArray(selectors));
  assert.ok(selectors.length > 0);
  assert.ok(selectors.includes('[data-testid="send-button"]'));
});

test('PromptInjector.findSendButton includes adapter selectors', () => {
  const adapter = { prompt: { sendSelectors: ['.custom-send'] } };
  const selectors = PromptInjector.findSendButton(adapter);
  assert.ok(selectors.includes('.custom-send'));
});

// ── PromptInjector.clickSendButton 测试 ──

test('PromptInjector.clickSendButton returns empty string', () => {
  const result = PromptInjector.clickSendButton({});
  assert.equal(result, '');
});
