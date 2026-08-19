'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ViewLifecycle,
} = require('../electron/view-lifecycle');

function createMockView() {
  return {
    setBackgroundColor: () => {},
    setVisible: () => {},
    setBounds: () => {},
    webContents: {
      isDestroyed: () => false,
      getUserAgent: () => 'Mozilla/5.0 TestAgent/1.0 Electron/30.0',
      setUserAgent: () => {},
      setBackgroundThrottling: () => {},
      on: () => {},
      send: () => {},
      loadURL: () => Promise.resolve(),
      session: {
        setProxy: () => Promise.resolve(),
        resolveProxy: () => Promise.resolve('DIRECT'),
      },
    },
  };
}

function createMockWindow(overrides = {}) {
  return {
    isDestroyed: () => false,
    webContents: {
      send: () => {},
    },
    contentView: {
      addChildView: () => {},
      removeChildView: () => {},
    },
    ...overrides,
  };
}

function createMockModel(id = 'test-model', name = 'Test Model') {
  return {
    id,
    name,
    url: 'https://chatgpt.com',
    icon: '🤖',
    partition: `persist:model-${id}`,
  };
}

// ── ViewLifecycle 基础测试 ──

test('ViewLifecycle constructor initializes correctly', () => {
  const win = createMockWindow();
  const proxyConfig = { proxyMode: 'system', theme: 'dark' };
  const lifecycle = new ViewLifecycle(win, proxyConfig);
  assert.ok(lifecycle.views instanceof Map);
  assert.ok(lifecycle.creatingViews instanceof Map);
  assert.ok(lifecycle.restoreEntries instanceof Map);
});

test('ViewLifecycle.getLoadingBackgroundColor returns correct color for dark theme', () => {
  const win = createMockWindow();
  const lifecycle = new ViewLifecycle(win, { theme: 'dark' });
  assert.equal(lifecycle.getLoadingBackgroundColor(), '#181818');
});

test('ViewLifecycle.getLoadingBackgroundColor returns correct color for light theme', () => {
  const win = createMockWindow();
  const lifecycle = new ViewLifecycle(win, { theme: 'light' });
  assert.equal(lifecycle.getLoadingBackgroundColor(), '#ffffff');
});

test('ViewLifecycle.applyViewBackground calls setBackgroundColor', () => {
  let called = false;
  const view = { setBackgroundColor: () => { called = true; } };
  const win = createMockWindow();
  const lifecycle = new ViewLifecycle(win, { theme: 'dark' });
  lifecycle.applyViewBackground(view);
  assert.equal(called, true);
});

test('ViewLifecycle.applyViewBackground handles null view', () => {
  const win = createMockWindow();
  const lifecycle = new ViewLifecycle(win, { theme: 'dark' });
  // Should not throw
  lifecycle.applyViewBackground(null);
  lifecycle.applyViewBackground(undefined);
});

test('ViewLifecycle.getInitialUrl returns model.url when no restore entry', () => {
  const win = createMockWindow();
  const lifecycle = new ViewLifecycle(win, { theme: 'dark' });
  const model = createMockModel();
  const url = lifecycle.getInitialUrl(model, null);
  assert.equal(url, model.url);
});

test('ViewLifecycle.getInitialUrl restores URL from same origin', () => {
  const win = createMockWindow();
  const lifecycle = new ViewLifecycle(win, { theme: 'dark' });
  const model = createMockModel();
  const restoreEntry = { url: 'https://chatgpt.com/?id=123' };
  const url = lifecycle.getInitialUrl(model, restoreEntry);
  assert.equal(url, restoreEntry.url);
});

test('ViewLifecycle.getInitialUrl falls back to model.url for different origin', () => {
  const win = createMockWindow();
  const lifecycle = new ViewLifecycle(win, { theme: 'dark' });
  const model = createMockModel();
  const restoreEntry = { url: 'https://example.com/page' };
  const url = lifecycle.getInitialUrl(model, restoreEntry);
  assert.equal(url, model.url);
});

test('ViewLifecycle.setRestoreEntries stores entries', () => {
  const win = createMockWindow();
  const lifecycle = new ViewLifecycle(win, { theme: 'dark' });
  const entries = new Map([['m1', { url: 'https://chatgpt.com', scrollY: 100 }]]);
  lifecycle.setRestoreEntries(entries);
  assert.strictEqual(lifecycle.restoreEntries, entries);
});

test('ViewLifecycle.setLoadingState does nothing when entry missing', () => {
  const win = createMockWindow();
  const lifecycle = new ViewLifecycle(win, { theme: 'dark' });
  // Should not throw
  lifecycle.setLoadingState('nonexistent', true);
});

test('ViewLifecycle.emitLoadingState does nothing when window destroyed', () => {
  let sent = false;
  const win = createMockWindow({
    isDestroyed: () => true,
    webContents: { send: () => { sent = true; } },
  });
  const lifecycle = new ViewLifecycle(win, { theme: 'dark' });
  lifecycle.emitLoadingState('nonexistent');
  assert.equal(sent, false);
});

test('ViewLifecycle.emitLoadingState sends IPC message', () => {
  let sentChannel = null;
  let sentData = null;
  const win = createMockWindow({
    webContents: {
      send: (ch, data) => { sentChannel = ch; sentData = data; },
    },
  });
  const lifecycle = new ViewLifecycle(win, { theme: 'dark' });
  lifecycle.views.set('m1', {
    view: createMockView(),
    model: createMockModel('m1'),
    loading: true,
    hasContent: false,
    loadFailed: false,
    lastUsedAt: Date.now(),
    inactiveSince: 0,
    busyReasons: new Map(),
  });
  lifecycle.emitLoadingState('m1');
  assert.equal(sentChannel, 'view:loadingChanged');
  assert.equal(sentData.id, 'm1');
  assert.equal(sentData.loading, true);
});

test('ViewLifecycle.removeView cleans up entry', () => {
  let removedChild = false;
  let destroyed = false;
  const view = {
    webContents: {
      isDestroyed: () => destroyed,
      destroy: () => { destroyed = true; },
    },
  };
  const win = createMockWindow({
    contentView: {
      removeChildView: () => { removedChild = true; },
      addChildView: () => {},
    },
  });
  const lifecycle = new ViewLifecycle(win, { theme: 'dark' });
  lifecycle.views.set('m1', {
    view,
    model: createMockModel('m1'),
    loading: false,
    hasContent: true,
    loadFailed: false,
    lastUsedAt: Date.now(),
    inactiveSince: 0,
    busyReasons: new Map(),
  });
  lifecycle.removeView('m1');
  assert.equal(removedChild, true);
  assert.equal(destroyed, true);
  assert.equal(lifecycle.views.has('m1'), false);
});

test('ViewLifecycle.removeView does nothing for unknown id', () => {
  const win = createMockWindow();
  const lifecycle = new ViewLifecycle(win, { theme: 'dark' });
  // Should not throw
  lifecycle.removeView('nonexistent');
});

test('ViewLifecycle.destroyView cleans up entry', () => {
  let destroyed = false;
  const view = {
    webContents: {
      isDestroyed: () => destroyed,
      destroy: () => { destroyed = true; },
    },
  };
  const win = createMockWindow({
    contentView: {
      removeChildView: () => {},
      addChildView: () => {},
    },
  });
  const lifecycle = new ViewLifecycle(win, { theme: 'dark' });
  lifecycle.views.set('m1', {
    view,
    model: createMockModel('m1'),
    loading: false,
    hasContent: true,
    loadFailed: false,
    lastUsedAt: Date.now(),
    inactiveSince: 0,
    busyReasons: new Map(),
  });
  lifecycle.destroyView('m1');
  assert.equal(destroyed, true);
  assert.equal(lifecycle.views.has('m1'), false);
});

test('ViewLifecycle.isViewLoaded returns false for unknown id', () => {
  const win = createMockWindow();
  const lifecycle = new ViewLifecycle(win, { theme: 'dark' });
  assert.equal(lifecycle.isViewLoaded('nonexistent'), false);
});

test('ViewLifecycle.isViewLoaded returns true for loaded view', () => {
  const view = {
    webContents: { isDestroyed: () => false },
  };
  const win = createMockWindow();
  const lifecycle = new ViewLifecycle(win, { theme: 'dark' });
  lifecycle.views.set('m1', {
    view,
    model: createMockModel('m1'),
    loading: false,
    hasContent: true,
    loadFailed: false,
    lastUsedAt: Date.now(),
    inactiveSince: 0,
    busyReasons: new Map(),
  });
  assert.equal(lifecycle.isViewLoaded('m1'), true);
});

test('ViewLifecycle.beginBusy and isBusy work correctly', () => {
  const win = createMockWindow();
  const lifecycle = new ViewLifecycle(win, { theme: 'dark' });
  lifecycle.views.set('m1', {
    view: createMockView(),
    model: createMockModel('m1'),
    loading: false,
    hasContent: true,
    loadFailed: false,
    lastUsedAt: Date.now(),
    inactiveSince: 0,
    busyReasons: new Map(),
  });
  assert.equal(lifecycle.isBusy('m1'), false);
  const endBusy = lifecycle.beginBusy('m1', 'test-operation');
  assert.equal(lifecycle.isBusy('m1'), true);
  endBusy();
  assert.equal(lifecycle.isBusy('m1'), false);
});

test('ViewLifecycle.beginBusy returns no-op for unknown id', () => {
  const win = createMockWindow();
  const lifecycle = new ViewLifecycle(win, { theme: 'dark' });
  const endBusy = lifecycle.beginBusy('nonexistent', 'test');
  assert.equal(typeof endBusy, 'function');
  // Should not throw
  endBusy();
});

test('ViewLifecycle.touchLRU updates lastUsedAt', () => {
  const win = createMockWindow();
  const lifecycle = new ViewLifecycle(win, { theme: 'dark' });
  const now = Date.now();
  lifecycle.views.set('m1', {
    view: createMockView(),
    model: createMockModel('m1'),
    loading: false,
    hasContent: true,
    loadFailed: false,
    lastUsedAt: now,
    inactiveSince: now,
    busyReasons: new Map(),
  });
  lifecycle.touchLRU('m1');
  const entry = lifecycle.views.get('m1');
  assert.ok(entry.lastUsedAt >= now);
  assert.equal(entry.inactiveSince, 0);
});

test('ViewLifecycle.markInactive sets inactiveSince', () => {
  const win = createMockWindow();
  const lifecycle = new ViewLifecycle(win, { theme: 'dark' });
  const now = Date.now();
  lifecycle.views.set('m1', {
    view: createMockView(),
    model: createMockModel('m1'),
    loading: false,
    hasContent: true,
    loadFailed: false,
    lastUsedAt: now,
    inactiveSince: 0,
    busyReasons: new Map(),
  });
  lifecycle.markInactive('m1');
  const entry = lifecycle.views.get('m1');
  assert.ok(entry.inactiveSince > 0);
});

test('ViewLifecycle.createProxyOptions returns correct options', () => {
  const win = createMockWindow();
  const lifecycle = new ViewLifecycle(win, { proxyMode: 'direct', proxyUrl: '' });
  assert.deepEqual(lifecycle.createProxyOptions(), { mode: 'direct' });
  lifecycle.proxyConfig = { proxyMode: 'custom', proxyUrl: 'http://127.0.0.1:7897' };
  assert.deepEqual(lifecycle.createProxyOptions(), { mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:7897' });
  lifecycle.proxyConfig = { proxyMode: 'system', proxyUrl: '' };
  assert.deepEqual(lifecycle.createProxyOptions(), { mode: 'system' });
});

test('ViewLifecycle.ensureView deduplicates concurrent calls', async () => {
  const win = createMockWindow();
  const lifecycle = new ViewLifecycle(win, { proxyMode: 'direct', theme: 'dark' });
  // Mock createView to track calls
  let callCount = 0;
  lifecycle.createView = async () => {
    callCount++;
    return createMockView();
  };
  const model = createMockModel();
  const p1 = lifecycle.ensureView(model);
  const p2 = lifecycle.ensureView(model);
  const [v1, v2] = await Promise.all([p1, p2]);
  // Both should return the same view, createView called once
  assert.equal(callCount, 1);
  assert.strictEqual(v1, v2);
});

test('ViewLifecycle.createView throws for invalid partition', async () => {
  const win = createMockWindow();
  const lifecycle = new ViewLifecycle(win, { proxyMode: 'direct', theme: 'dark' });
  const model = { id: '', name: 'Test', url: 'https://chatgpt.com', partition: '' };
  await assert.rejects(() => lifecycle.createView(model), /invalid partition|WebContentsView/);
});
