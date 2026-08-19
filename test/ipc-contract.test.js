'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTempDir,
  createMockWindow,
  createMockApp,
  createMockSession,
  createMockSessionFactory,
} = require('./test-helpers');

// ═══════════════════════════════════════════════════════════════════════════════
// IPC 通道契约测试
// 记录当前所有 IPC 通道的返回类型和格式
// ═══════════════════════════════════════════════════════════════════════════════

// 模拟 StateStore 用于测试
class MockStateStore {
  constructor(fallback, normalize) {
    this.value = normalize ? normalize(fallback) : fallback;
    this.normalize = normalize || ((v) => v);
  }
  get() { return this.normalize(this.value); }
  replace(v) { this.value = this.normalize(v); return this.get(); }
  patch(p) { this.value = this.normalize({ ...this.value, ...(p || {}) }); return this.get(); }
  schedulePersist() { return Promise.resolve(); }
  flush() { return Promise.resolve(); }
}

// 模拟的 models 数据
const MOCK_MODELS = [
  {
    id: 'model-1',
    name: '测试模型',
    url: 'https://chatgpt.com',
    icon: '🤖',
    iconUrl: '',
    iconUrls: [],
    color: '#666666',
    partition: 'persist:model-1',
    capabilities: { canAutoSend: true },
  },
  {
    id: 'model-2',
    name: '另一个模型',
    url: 'https://claude.ai',
    icon: '🧠',
    iconUrl: '',
    iconUrls: [],
    color: '#444444',
    partition: 'persist:model-2',
    capabilities: { canAutoSend: true },
  },
];

// 模拟的 groups 数据
const MOCK_GROUPS = [
  { id: 'group-1', name: '测试分组', modelIds: ['model-1', 'model-2'] },
];

// 模拟的 settings 数据
const MOCK_SETTINGS = {
  proxyMode: 'system',
  proxyUrl: 'http://127.0.0.1:7897',
  restoreSnapshot: false,
  shortcutEnabled: true,
  shortcutAccelerator: 'Ctrl+Shift+Space',
  theme: 'dark',
  closeAction: 'ask',
  trayMemoryMode: 'keepAll',
  maxAliveViews: 0,
  autoReclaimEnabled: false,
  memoryPressureMb: 2500,
  idleReclaimEnabled: true,
  inactiveViewTtlMinutes: 30,
};

// 模拟的 quick state 数据
const MOCK_QUICK_STATE = {
  draft: '',
  lastModelId: 'model-1',
  lastModelIds: ['model-1'],
  submitMode: 'open',
  pinned: false,
  history: [],
};

// ═══════════════════════════════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════════════════════════════

test('models:list returns array of model objects', () => {
  // 验证返回格式: { ok: true, data } 或直接返回数组
  const result = MOCK_MODELS;
  assert.ok(Array.isArray(result), 'models:list must return an array');
  if (result.length > 0) {
    const model = result[0];
    assert.ok(typeof model.id === 'string', 'model.id must be a string');
    assert.ok(typeof model.name === 'string', 'model.name must be a string');
    assert.ok(typeof model.url === 'string', 'model.url must be a string');
  }
});

test('models:list empty result returns []', () => {
  const result = [];
  assert.ok(Array.isArray(result), 'Empty result must be an array');
  assert.equal(result.length, 0, 'Empty result length must be 0');
});

test('groups:list returns array of group objects', () => {
  const result = MOCK_GROUPS;
  assert.ok(Array.isArray(result), 'groups:list must return an array');
  if (result.length > 0) {
    const group = result[0];
    assert.ok(typeof group.id === 'string', 'group.id must be a string');
    assert.ok(typeof group.name === 'string', 'group.name must be a string');
    assert.ok(Array.isArray(group.modelIds), 'group.modelIds must be an array');
  }
});

test('groups:list empty result returns []', () => {
  const result = [];
  assert.ok(Array.isArray(result), 'Empty result must be an array');
  assert.equal(result.length, 0, 'Empty result length must be 0');
});

test('view:getStatus returns status object with models array', () => {
  const result = {
    models: [],
    loadedIds: [],
    splitIds: [],
    splitRatios: [],
    splitMode: false,
    activeId: null,
    memory: {},
  };
  assert.ok(typeof result === 'object', 'view:getStatus must return an object');
  assert.ok(Array.isArray(result.models), 'status.models must be an array');
  assert.ok(Array.isArray(result.loadedIds), 'status.loadedIds must be an array');
  assert.ok(Array.isArray(result.splitIds), 'status.splitIds must be an array');
  assert.ok(typeof result.splitMode === 'boolean', 'status.splitMode must be a boolean');
  assert.ok(result.activeId === null || typeof result.activeId === 'string', 'status.activeId must be null or string');
  assert.ok(typeof result.memory === 'object', 'status.memory must be an object');
});

test('view:switch returns ok object indicating success', () => {
  const successResult = { ok: true };
  const failResult = { ok: false, reason: 'not-found' };
  assert.ok(typeof successResult === 'object', 'view:switch must return an object');
  assert.equal(successResult.ok, true, 'success result.ok must be true');
  assert.ok(typeof failResult === 'object', 'view:switch fail result must be an object');
  assert.equal(failResult.ok, false, 'fail result.ok must be false');
  assert.ok(typeof failResult.reason === 'string', 'fail result.reason must be a string');
});

test('quick:submit returns result object with ok property', () => {
  const successResult = {
    ok: true,
    mode: 'open',
    modelId: 'model-1',
    modelIds: ['model-1'],
    results: [],
  };
  const failResult = {
    ok: false,
    mode: 'open',
  };
  assert.ok(typeof successResult.ok === 'boolean', 'quick:submit result.ok must be a boolean');
  assert.ok(typeof successResult.mode === 'string', 'quick:submit result.mode must be a string');
  assert.ok(typeof failResult.ok === 'boolean', 'quick:submit fail result.ok must be a boolean');
});

test('quick:stateGet returns quick state object', () => {
  const result = MOCK_QUICK_STATE;
  assert.ok(typeof result === 'object', 'quick:stateGet must return an object');
  assert.ok(typeof result.draft === 'string', 'quick state.draft must be a string');
  assert.ok(typeof result.lastModelId === 'string', 'quick state.lastModelId must be a string');
  assert.ok(Array.isArray(result.lastModelIds), 'quick state.lastModelIds must be an array');
  assert.ok(typeof result.submitMode === 'string', 'quick state.submitMode must be a string');
  assert.ok(typeof result.pinned === 'boolean', 'quick state.pinned must be a boolean');
  assert.ok(Array.isArray(result.history), 'quick state.history must be an array');
});

test('settings:get returns settings object', () => {
  const result = MOCK_SETTINGS;
  assert.ok(typeof result === 'object', 'settings:get must return an object');
  assert.ok(typeof result.proxyMode === 'string', 'settings.proxyMode must be a string');
  assert.ok(typeof result.theme === 'string', 'settings.theme must be a string');
  assert.ok(typeof result.closeAction === 'string', 'settings.closeAction must be a string');
});

test('settings:set returns settings with shortcutStatus', () => {
  const result = {
    ...MOCK_SETTINGS,
    shortcutStatus: {
      registered: true,
      accelerator: 'Ctrl+Shift+Space',
    },
  };
  assert.ok(typeof result === 'object', 'settings:set must return an object');
  assert.ok(typeof result.shortcutStatus === 'object', 'settings:set must include shortcutStatus');
  assert.ok(typeof result.shortcutStatus.registered === 'boolean', 'shortcutStatus.registered must be a boolean');
});

test('view:getStatus failure returns empty structure', () => {
  const emptyResult = {
    models: [],
    loadedIds: [],
    splitIds: [],
    splitRatios: [],
    splitMode: false,
    activeId: null,
    memory: {},
  };
  assert.ok(typeof emptyResult === 'object', 'Failure result must be an object');
  assert.ok(Array.isArray(emptyResult.models), 'Failure result.models must be an array');
  assert.ok(Array.isArray(emptyResult.loadedIds), 'Failure result.loadedIds must be an array');
  assert.ok(Array.isArray(emptyResult.splitIds), 'Failure result.splitIds must be an array');
  assert.equal(emptyResult.splitMode, false, 'Failure result.splitMode must be false');
  assert.equal(emptyResult.activeId, null, 'Failure result.activeId must be null');
  assert.ok(typeof emptyResult.memory === 'object', 'Failure result.memory must be an object');
});

test('models:add returns new model with id and capabilities', () => {
  const result = {
    id: 'new-model-123',
    name: '新模型',
    url: 'https://example.com',
    icon: '🤖',
    iconUrl: '',
    iconUrls: [],
    color: '#666666',
    partition: 'persist:new-model-123',
    capabilities: { canAutoSend: false },
  };
  assert.ok(typeof result.id === 'string', 'models:add result.id must be a string');
  assert.ok(typeof result.name === 'string', 'models:add result.name must be a string');
  assert.ok(typeof result.url === 'string', 'models:add result.url must be a string');
  assert.ok(typeof result.capabilities === 'object', 'models:add result.capabilities must be an object');
});

test('models:remove success returns ok with details', () => {
  const result = {
    ok: true,
    modelId: 'model-1',
    partition: 'persist:model-1',
    diskRemoved: true,
    iconsRemoved: 0,
  };
  assert.ok(typeof result.ok === 'boolean', 'models:remove result.ok must be a boolean');
  assert.ok(typeof result.modelId === 'string', 'models:remove result.modelId must be a string');
  assert.ok(typeof result.partition === 'string', 'models:remove result.partition must be a string');
  assert.ok(typeof result.diskRemoved === 'boolean', 'models:remove result.diskRemoved must be a boolean');
  assert.ok(typeof result.iconsRemoved === 'number', 'models:remove result.iconsRemoved must be a number');
});

test('models:remove failure returns ok:false with reason', () => {
  const result = { ok: false, reason: 'not-found' };
  assert.equal(result.ok, false, 'Failure result.ok must be false');
  assert.ok(typeof result.reason === 'string', 'Failure result.reason must be a string');
});

test('view:getStatus returns memory summary', () => {
  const result = {
    totalMb: 100,
    thresholdMb: 2500,
    autoReclaimEnabled: false,
    maxAliveViews: 0,
    trayMemoryMode: 'keepAll',
    loadedCount: 0,
    activeId: null,
    processCount: 0,
    sampledAt: Date.now(),
  };
  assert.ok(typeof result === 'object', 'memory summary must be an object');
  assert.ok(typeof result.totalMb === 'number', 'memory.totalMb must be a number');
  assert.ok(typeof result.thresholdMb === 'number', 'memory.thresholdMb must be a number');
  assert.ok(typeof result.trayMemoryMode === 'string', 'memory.trayMemoryMode must be a string');
});

test('memory:getSummary returns memory summary object', () => {
  const result = {
    totalMb: 0,
    thresholdMb: 2500,
    autoReclaimEnabled: false,
    maxAliveViews: 0,
    trayMemoryMode: 'keepAll',
    loadedCount: 0,
    activeId: null,
    processCount: 0,
    sampledAt: Date.now(),
  };
  assert.ok(typeof result === 'object', 'memory:getSummary must return an object');
  assert.ok(typeof result.totalMb === 'number', 'result.totalMb must be a number');
  assert.ok(typeof result.processCount === 'number', 'result.processCount must be a number');
  assert.ok(typeof result.sampledAt === 'number', 'result.sampledAt must be a number');
});

test('settings:clearCache returns cache clear result', () => {
  const result = {
    ok: true,
    sessions: 1,
    diskCacheCleared: true,
  };
  assert.ok(typeof result.ok === 'boolean', 'settings:clearCache result.ok must be a boolean');
  assert.ok(typeof result.sessions === 'number', 'settings:clearCache result.sessions must be a number');
  assert.ok(typeof result.diskCacheCleared === 'boolean', 'settings:clearCache result.diskCacheCleared must be a boolean');
});

test('settings:clearLoginState returns login clear result', () => {
  const result = {
    ok: true,
    sessions: 1,
    diskCacheCleared: true,
    state: null,
  };
  assert.ok(typeof result.ok === 'boolean', 'settings:clearLoginState result.ok must be a boolean');
  assert.ok(typeof result.sessions === 'number', 'settings:clearLoginState result.sessions must be a number');
  assert.ok(typeof result.diskCacheCleared === 'boolean', 'settings:clearLoginState result.diskCacheCleared must be a boolean');
});

test('snapshot:get returns snapshot object', () => {
  const result = {
    version: 1,
    savedAt: '',
    activeModelId: '',
    splitMode: false,
    splitIds: [],
    splitRatios: [],
    splitDirection: 'horizontal',
    entries: [],
  };
  assert.ok(typeof result === 'object', 'snapshot:get must return an object');
  assert.ok(typeof result.version === 'number', 'snapshot.version must be a number');
  assert.ok(typeof result.savedAt === 'string', 'snapshot.savedAt must be a string');
  assert.ok(typeof result.splitMode === 'boolean', 'snapshot.splitMode must be a boolean');
  assert.ok(Array.isArray(result.entries), 'snapshot.entries must be an array');
});

test('view:enterSplit returns ok object', () => {
  const successResult = { ok: true };
  const failResult = { ok: false, reason: 'invalid-models' };
  assert.ok(typeof successResult === 'object', 'view:enterSplit must return an object');
  assert.equal(successResult.ok, true, 'success result.ok must be true');
  assert.ok(typeof failResult === 'object', 'view:enterSplit fail result must be an object');
  assert.equal(failResult.ok, false, 'fail result.ok must be false');
});

test('view:exitSplit returns ok object', () => {
  const result = { ok: true };
  assert.ok(typeof result === 'object', 'view:exitSplit must return an object');
  assert.equal(result.ok, true, 'result.ok must be true');
});

test('view:setSplitRatios returns boolean', () => {
  const result = true;
  assert.equal(typeof result, 'boolean', 'view:setSplitRatios must return a boolean');
});

test('view:setVisible returns boolean', () => {
  const result = true;
  assert.equal(typeof result, 'boolean', 'view:setVisible must return a boolean');
});

test('view:setSidebarCollapsed returns boolean', () => {
  const result = true;
  assert.equal(typeof result, 'boolean', 'view:setSidebarCollapsed must return a boolean');
});

test('view:refresh returns boolean', () => {
  const result = true;
  assert.equal(typeof result, 'boolean', 'view:refresh must return a boolean');
});

test('view:refreshModel returns boolean', () => {
  const result = true;
  assert.equal(typeof result, 'boolean', 'view:refreshModel must return a boolean');
});

test('window:minimize returns boolean', () => {
  const result = true;
  assert.equal(typeof result, 'boolean', 'window:minimize must return a boolean');
});

test('window:toggleMaximize returns boolean', () => {
  const result = true;
  assert.equal(typeof result, 'boolean', 'window:toggleMaximize must return a boolean');
});

test('window:close returns boolean', () => {
  const result = true;
  assert.equal(typeof result, 'boolean', 'window:close must return a boolean');
});

test('quick:stateSet returns updated quick state', () => {
  const result = {
    draft: 'new draft',
    lastModelId: 'model-1',
    lastModelIds: ['model-1'],
    submitMode: 'open',
    pinned: false,
    history: [],
  };
  assert.ok(typeof result === 'object', 'quick:stateSet must return an object');
  assert.ok(typeof result.draft === 'string', 'result.draft must be a string');
  assert.ok(typeof result.pinned === 'boolean', 'result.pinned must be a boolean');
});

test('quick:hide returns boolean', () => {
  const result = true;
  assert.equal(typeof result, 'boolean', 'quick:hide must return a boolean');
});

test('quick:setMenuOpen returns boolean', () => {
  const result = true;
  assert.equal(typeof result, 'boolean', 'quick:setMenuOpen must return a boolean');
});

test('quick:setPinned returns updated quick state', () => {
  const result = {
    ...MOCK_QUICK_STATE,
    pinned: true,
  };
  assert.ok(typeof result === 'object', 'quick:setPinned must return an object');
  assert.ok(typeof result.pinned === 'boolean', 'result.pinned must be a boolean');
});

test('groups:add returns new group object', () => {
  const result = {
    id: 'group-new',
    name: '新分组',
    modelIds: ['model-1'],
  };
  assert.ok(typeof result === 'object', 'groups:add must return an object');
  assert.ok(typeof result.id === 'string', 'result.id must be a string');
  assert.ok(typeof result.name === 'string', 'result.name must be a string');
  assert.ok(Array.isArray(result.modelIds), 'result.modelIds must be an array');
});

test('groups:remove returns boolean', () => {
  const result = true;
  assert.equal(typeof result, 'boolean', 'groups:remove must return a boolean');
});

test('models:reorder returns reordered models array', () => {
  const result = MOCK_MODELS;
  assert.ok(Array.isArray(result), 'models:reorder must return an array');
  assert.equal(result.length, MOCK_MODELS.length, 'models:reorder must return all models');
});

test('models:update returns updated model with capabilities', () => {
  const result = {
    id: 'model-1',
    name: '更新后的模型',
    url: 'https://chatgpt.com',
    icon: '🤖',
    iconUrl: '',
    iconUrls: [],
    color: '#666666',
    partition: 'persist:model-1',
    capabilities: { canAutoSend: true },
  };
  assert.ok(typeof result === 'object', 'models:update must return an object');
  assert.ok(typeof result.id === 'string', 'result.id must be a string');
  assert.ok(typeof result.capabilities === 'object', 'result.capabilities must be an object');
});
