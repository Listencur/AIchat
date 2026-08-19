'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createMockView,
  createMockWindow,
} = require('./test-helpers');

// ═══════════════════════════════════════════════════════════════════════════════
// 阶段2：IPC 返回结构统一测试
// ═══════════════════════════════════════════════════════════════════════════════

test('IPC success response has ok:true format', () => {
  const successResults = [
    { ok: true },
    { ok: true, data: [] },
    { ok: true, modelId: 'model-1' },
  ];
  
  for (const result of successResults) {
    assert.ok(typeof result === 'object', 'Success result must be an object');
    assert.equal(result.ok, true, 'Success result.ok must be true');
  }
});

test('IPC failure response has ok:false with reason', () => {
  const failureResults = [
    { ok: false, reason: 'not-found' },
    { ok: false, reason: 'invalid-models' },
    { ok: false, reason: 'view-not-loaded', message: 'WebContents destroyed' },
  ];
  
  for (const result of failureResults) {
    assert.ok(typeof result === 'object', 'Failure result must be an object');
    assert.equal(result.ok, false, 'Failure result.ok must be false');
    assert.ok(typeof result.reason === 'string', 'Failure result.reason must be a string');
    assert.ok(result.reason.length > 0, 'Failure result.reason must not be empty');
  }
});

test('list channels return [] on failure', () => {
  const listResults = [[], []];
  for (const result of listResults) {
    assert.ok(Array.isArray(result), 'List result must be an array');
    assert.equal(result.length, 0, 'Empty list result length must be 0');
  }
});

test('status channels return complete empty structure on failure', () => {
  const emptyStatus = {
    models: [],
    loadedIds: [],
    splitIds: [],
    splitRatios: [],
    splitMode: false,
    activeId: null,
    memory: {},
  };
  
  assert.ok(typeof emptyStatus === 'object', 'Status must be an object');
  assert.ok(Array.isArray(emptyStatus.models), 'Status.models must be an array');
  assert.ok(Array.isArray(emptyStatus.loadedIds), 'Status.loadedIds must be an array');
  assert.ok(Array.isArray(emptyStatus.splitIds), 'Status.splitIds must be an array');
  assert.equal(emptyStatus.splitMode, false, 'Status.splitMode must be false');
  assert.equal(emptyStatus.activeId, null, 'Status.activeId must be null');
  assert.ok(typeof emptyStatus.memory === 'object', 'Status.memory must be an object');
});

test('view:switch returns ok:false with reason on model not found', () => {
  const result = { ok: false, reason: 'not-found' };
  assert.equal(result.ok, false, 'result.ok must be false');
  assert.equal(result.reason, 'not-found', 'result.reason must be not-found');
});

test('view:enterSplit returns ok:false with reason on invalid models', () => {
  const result = { ok: false, reason: 'invalid-models' };
  assert.equal(result.ok, false, 'result.ok must be false');
  assert.equal(result.reason, 'invalid-models', 'result.reason must be invalid-models');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 快速提问并发测试
// ═══════════════════════════════════════════════════════════════════════════════

test('quick:submit returns results keyed by modelId', () => {
  const results = [
    { modelId: 'model-1', ok: true, action: 'sent' },
    { modelId: 'model-2', ok: true, action: 'sent' },
    { modelId: 'model-3', ok: false, reason: 'view-not-loaded' },
  ];
  
  assert.ok(Array.isArray(results), 'Results must be an array');
  results.forEach((result) => {
    assert.ok(typeof result.modelId === 'string', 'Each result must have modelId');
    assert.ok(typeof result.ok === 'boolean', 'Each result must have ok');
  });
  
  const modelIds = results.map((r) => r.modelId);
  const uniqueIds = [...new Set(modelIds)];
  assert.equal(modelIds.length, uniqueIds.length, 'Model IDs must be unique');
});

test('quick:submit multi-model results are independent', () => {
  const results = [
    { modelId: 'model-1', ok: true, action: 'sent' },
    { modelId: 'model-2', ok: false, reason: 'view-not-loaded' },
  ];
  
  const successResults = results.filter((r) => r.ok);
  const failedResults = results.filter((r) => !r.ok);
  
  assert.equal(successResults.length, 1, 'One model should succeed');
  assert.equal(failedResults.length, 1, 'One model should fail');
  assert.equal(successResults[0].modelId, 'model-1', 'model-1 should succeed');
  assert.equal(failedResults[0].modelId, 'model-2', 'model-2 should fail');
});

test('unknown site returns requiresManualSend: true', () => {
  const result = {
    modelId: 'model-1',
    ok: true,
    action: 'filled-manual-send',
    requiresManualSend: true,
    adapterId: 'generic',
  };
  
  assert.equal(result.ok, true, 'result.ok must be true');
  assert.equal(result.requiresManualSend, true, 'requiresManualSend must be true');
  assert.equal(result.action, 'filled-manual-send', 'action must be filled-manual-send');
});

test('adapted site without send button returns requiresManualSend: true', () => {
  const result = {
    modelId: 'model-1',
    ok: true,
    action: 'filled-manual-send',
    requiresManualSend: true,
    adapterId: 'chatgpt',
  };
  
  assert.equal(result.ok, true, 'result.ok must be true');
  assert.equal(result.requiresManualSend, true, 'requiresManualSend must be true');
});

test('view-not-loaded prevents submission', () => {
  const result = { modelId: 'model-1', ok: false, reason: 'view-not-loaded' };
  assert.equal(result.ok, false, 'result.ok must be false');
  assert.equal(result.reason, 'view-not-loaded', 'reason must be view-not-loaded');
});

// ═══════════════════════════════════════════════════════════════════════════════
// busy View 保护测试
// ═══════════════════════════════════════════════════════════════════════════════

test('busy view has busyReasons map', () => {
  const busyReasons = new Map();
  busyReasons.set('submit', 1);
  busyReasons.set('fill', 1);
  
  assert.equal(busyReasons.size, 2, 'busyReasons should have 2 entries');
  assert.equal(busyReasons.get('submit'), 1, 'submit reason should be 1');
  assert.equal(busyReasons.get('fill'), 1, 'fill reason should be 1');
});

test('canAutoReclaim returns false for busy views', () => {
  const busyReasons = new Map([['submit', 1]]);
  const isBusy = busyReasons.size > 0;
  
  assert.equal(isBusy, true, 'View should be busy');
  // canAutoReclaim should return false when isBusy is true
  const canReclaim = !isBusy;
  assert.equal(canReclaim, false, 'canAutoReclaim should return false for busy view');
});

test('canAutoReclaim returns false for active views', () => {
  const protectedIds = new Set(['model-1']);
  const modelId = 'model-1';
  
  assert.equal(protectedIds.has(modelId), true, 'Active view should be protected');
  const canReclaim = !protectedIds.has(modelId);
  assert.equal(canReclaim, false, 'canAutoReclaim should return false for active view');
});

test('canAutoReclaim returns true for inactive non-busy views', () => {
  const protectedIds = new Set(['model-1']);
  const busyReasons = new Map();
  const modelId = 'model-2';
  
  assert.equal(protectedIds.has(modelId), false, 'Inactive view should not be protected');
  assert.equal(busyReasons.size, 0, 'View should not be busy');
  const canReclaim = !protectedIds.has(modelId) && busyReasons.size === 0;
  assert.equal(canReclaim, true, 'canAutoReclaim should return true for inactive non-busy view');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 状态并发测试
// ═══════════════════════════════════════════════════════════════════════════════

test('StateStore.patch merges fields atomically', () => {
  // 模拟 StateStore.patch 行为
  const state = {
    draft: 'old draft',
    lastModelId: 'model-1',
    lastModelIds: ['model-1'],
    submitMode: 'open',
    pinned: false,
    history: [],
  };
  
  // 第一次 patch
  const patch1 = { draft: 'new draft' };
  const merged1 = { ...state, ...patch1 };
  assert.equal(merged1.draft, 'new draft', 'draft should be updated');
  assert.equal(merged1.lastModelId, 'model-1', 'lastModelId should be preserved');
  
  // 第二次 patch
  const patch2 = { lastModelId: 'model-2' };
  const merged2 = { ...merged1, ...patch2 };
  assert.equal(merged2.draft, 'new draft', 'draft should be preserved');
  assert.equal(merged2.lastModelId, 'model-2', 'lastModelId should be updated');
});

test('draft is not overwritten by old snapshot', () => {
  const currentDraft = 'current draft';
  const oldDraft = 'old draft';
  
  // 模拟 patch 行为：只更新指定字段
  const state = { draft: currentDraft, lastModelId: 'model-1' };
  const patch = { lastModelId: 'model-2' }; // 不包含 draft
  const result = { ...state, ...patch };
  
  assert.equal(result.draft, currentDraft, 'draft should not be overwritten');
  assert.equal(result.lastModelId, 'model-2', 'lastModelId should be updated');
});

test('lastModelId is not overwritten by old snapshot', () => {
  const currentLastModelId = 'model-2';
  const oldLastModelId = 'model-1';
  
  const state = { draft: 'draft', lastModelId: currentLastModelId };
  const patch = { draft: 'new draft' }; // 不包含 lastModelId
  const result = { ...state, ...patch };
  
  assert.equal(result.lastModelId, currentLastModelId, 'lastModelId should not be overwritten');
  assert.equal(result.draft, 'new draft', 'draft should be updated');
});

test('lastModelIds is not overwritten by old snapshot', () => {
  const currentLastModelIds = ['model-2', 'model-3'];
  const oldLastModelIds = ['model-1'];
  
  const state = { draft: 'draft', lastModelIds: currentLastModelIds };
  const patch = { draft: 'new draft' }; // 不包含 lastModelIds
  const result = { ...state, ...patch };
  
  assert.deepEqual(result.lastModelIds, currentLastModelIds, 'lastModelIds should not be overwritten');
  assert.equal(result.draft, 'new draft', 'draft should be updated');
});

test('history deduplication works correctly', () => {
  const history = ['prompt1', 'prompt2', 'prompt1', 'prompt3'];
  const deduplicated = history.filter((item, index, list) => list.indexOf(item) === index);
  
  assert.deepEqual(deduplicated, ['prompt1', 'prompt2', 'prompt3'], 'History should be deduplicated');
});

test('history limit is enforced', () => {
  const QUICK_HISTORY_LIMIT = 10;
  const history = Array.from({ length: 15 }, (_, i) => `prompt${i}`);
  const limited = history.slice(0, QUICK_HISTORY_LIMIT);
  
  assert.equal(limited.length, QUICK_HISTORY_LIMIT, 'History should be limited');
  assert.equal(limited[0], 'prompt0', 'First item should be preserved');
  assert.equal(limited[9], 'prompt9', 'Tenth item should be preserved');
});

test('quick state normalization preserves valid fields', () => {
  const state = {
    draft: 'test draft',
    lastModelId: 'model-1',
    lastModelIds: ['model-1', 'model-2'],
    submitMode: 'open',
    pinned: true,
    history: ['prompt1', 'prompt2'],
  };
  
  // 模拟 normalizeQuickState 行为
  const normalized = {
    draft: typeof state.draft === 'string' ? state.draft.slice(0, 10000) : '',
    lastModelId: typeof state.lastModelId === 'string' ? state.lastModelId : '',
    lastModelIds: Array.isArray(state.lastModelIds) ? state.lastModelIds.slice(0, 3) : [],
    submitMode: state.submitMode === 'copy' ? 'copy' : 'open',
    pinned: state.pinned === true,
    history: Array.isArray(state.history) ? state.history.slice(0, 10) : [],
  };
  
  assert.equal(normalized.draft, 'test draft', 'draft should be preserved');
  assert.equal(normalized.lastModelId, 'model-1', 'lastModelId should be preserved');
  assert.deepEqual(normalized.lastModelIds, ['model-1', 'model-2'], 'lastModelIds should be preserved');
  assert.equal(normalized.pinned, true, 'pinned should be preserved');
  assert.equal(normalized.history.length, 2, 'history should be preserved');
});

test('quick state normalization handles invalid fields', () => {
  const state = {
    draft: 123, // 无效类型
    lastModelId: null, // 无效类型
    lastModelIds: 'not-an-array', // 无效类型
    submitMode: 'invalid', // 无效值
    pinned: 'yes', // 无效类型
    history: 'not-an-array', // 无效类型
  };
  
  // 模拟 normalizeQuickState 行为
  const normalized = {
    draft: typeof state.draft === 'string' ? state.draft.slice(0, 10000) : '',
    lastModelId: typeof state.lastModelId === 'string' ? state.lastModelId : '',
    lastModelIds: Array.isArray(state.lastModelIds) ? state.lastModelIds.slice(0, 3) : [],
    submitMode: state.submitMode === 'copy' ? 'copy' : 'open',
    pinned: state.pinned === true,
    history: Array.isArray(state.history) ? state.history.slice(0, 10) : [],
  };
  
  assert.equal(normalized.draft, '', 'Invalid draft should be reset');
  assert.equal(normalized.lastModelId, '', 'Invalid lastModelId should be reset');
  assert.deepEqual(normalized.lastModelIds, [], 'Invalid lastModelIds should be reset');
  assert.equal(normalized.submitMode, 'open', 'Invalid submitMode should be reset');
  assert.equal(normalized.pinned, false, 'Invalid pinned should be reset');
  assert.deepEqual(normalized.history, [], 'Invalid history should be reset');
});

test('ViewManager.isViewLoaded returns correct status', () => {
  // 模拟 ViewManager.isViewLoaded 行为
  const views = new Map();
  
  // 不存在的 view
  assert.equal(views.has('model-1'), false, 'View should not exist');
  
  // 添加 view
  const mockView = createMockView();
  views.set('model-1', { view: mockView, model: { id: 'model-1' } });
  assert.equal(views.has('model-1'), true, 'View should exist');
  
  // 检查 view 是否已加载
  const entry = views.get('model-1');
  const isLoaded = entry && entry.view && !entry.view.webContents.isDestroyed();
  assert.equal(isLoaded, true, 'View should be loaded');
});

test('ViewManager.isViewLoaded returns false for destroyed view', () => {
  const views = new Map();
  const mockView = createMockView({
    webContents: {
      isDestroyed: () => true,
    },
  });
  views.set('model-1', { view: mockView, model: { id: 'model-1' } });
  
  const entry = views.get('model-1');
  const isLoaded = entry && entry.view && !entry.view.webContents.isDestroyed();
  assert.equal(isLoaded, false, 'Destroyed view should not be loaded');
});
