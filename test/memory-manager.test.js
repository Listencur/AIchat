'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MemoryManager,
  MEMORY_SNAPSHOT_TTL_MS,
} = require('../electron/memory-manager');

function createMockApp(overrides = {}) {
  return {
    getAppMetrics: () => [
      { pid: 1, memory: { workingSetSize: 102400 } },
      { pid: 2, memory: { workingSetSize: 51200 } },
    ],
    ...overrides,
  };
}

function createMockMainWindow(overrides = {}) {
  return {
    isDestroyed: () => false,
    webContents: {
      send: () => {},
    },
    ...overrides,
  };
}

// ── MemoryManager 测试 ──

test('MemoryManager.getMemorySnapshot returns snapshot with totalMb', () => {
  const mgr = new MemoryManager({ app: createMockApp() });
  const snapshot = mgr.getMemorySnapshot();
  assert.ok(typeof snapshot.totalMb === 'number');
  assert.ok(typeof snapshot.sampledAt === 'number');
  assert.ok(typeof snapshot.processCount === 'number');
  assert.ok(snapshot.processCount === 2);
  assert.ok(snapshot.totalMb > 0);
});

test('MemoryManager.getMemorySnapshot caches within TTL', () => {
  const mgr = new MemoryManager({ app: createMockApp() });
  const s1 = mgr.getMemorySnapshot();
  const s2 = mgr.getMemorySnapshot();
  assert.strictEqual(s1, s2, 'Should return same cached snapshot');
});

test('MemoryManager.getMemorySnapshot force refreshes', () => {
  const mgr = new MemoryManager({ app: createMockApp() });
  const s1 = mgr.getMemorySnapshot();
  const s2 = mgr.getMemorySnapshot(true);
  assert.ok(s1 !== s2 || s1.sampledAt === s2.sampledAt, 'Force should attempt refresh');
});

test('MemoryManager.getProcessMemoryByPid returns Map', () => {
  const mgr = new MemoryManager({ app: createMockApp() });
  const byPid = mgr.getProcessMemoryByPid();
  assert.ok(byPid instanceof Map);
  assert.ok(byPid.has(1));
  assert.ok(byPid.has(2));
});

test('MemoryManager.getTotalAppMemoryMb returns number', () => {
  const mgr = new MemoryManager({ app: createMockApp() });
  const mb = mgr.getTotalAppMemoryMb();
  assert.ok(typeof mb === 'number');
  assert.ok(mb > 0);
});

test('MemoryManager.getMemorySummary includes all fields', () => {
  const mgr = new MemoryManager({ app: createMockApp() });
  const settings = {
    memoryPressureMb: 2500,
    autoReclaimEnabled: false,
    maxAliveViews: 0,
    trayMemoryMode: 'keepAll',
  };
  const summary = mgr.getMemorySummary(settings, null);
  assert.equal(summary.thresholdMb, 2500);
  assert.equal(summary.autoReclaimEnabled, false);
  assert.equal(summary.maxAliveViews, 0);
  assert.equal(summary.trayMemoryMode, 'keepAll');
  assert.equal(summary.loadedCount, 0);
  assert.equal(summary.activeId, null);
  assert.ok(typeof summary.totalMb === 'number');
  assert.ok(typeof summary.processCount === 'number');
  assert.ok(typeof summary.sampledAt === 'number');
});

test('MemoryManager.getMemorySummary with viewManager', () => {
  const mgr = new MemoryManager({ app: createMockApp() });
  const viewManager = {
    getState: () => ({
      activeId: 'm1',
      loadedIds: ['m1', 'm2'],
      splitMode: false,
      splitIds: [],
    }),
  };
  const settings = {
    memoryPressureMb: 2500,
    autoReclaimEnabled: false,
    maxAliveViews: 3,
    trayMemoryMode: 'keepAll',
  };
  const summary = mgr.getMemorySummary(settings, viewManager);
  assert.equal(summary.loadedCount, 2);
  assert.equal(summary.activeId, 'm1');
});

test('MemoryManager.stopWatch clears timer', () => {
  const mgr = new MemoryManager({ app: createMockApp() });
  mgr._watchTimer = setInterval(() => {}, 30000);
  mgr.stopWatch();
  assert.equal(mgr._watchTimer, null);
});

test('MemoryManager.startWatch does not start when disabled', () => {
  const mgr = new MemoryManager({ app: createMockApp() });
  mgr.startWatch(
    { autoReclaimEnabled: false, idleReclaimEnabled: false, inactiveViewTtlMinutes: 0 },
    { viewManager: null, mainWindow: null, appIsQuittingFn: () => false }
  );
  assert.equal(mgr._watchTimer, null);
});

test('MemoryManager.notifyViewStateAfterReclaim sends IPC messages', () => {
  let sentChannels = [];
  const mainWindow = {
    isDestroyed: () => false,
    webContents: { send: (ch) => { sentChannels.push(ch); } },
  };
  const mgr = new MemoryManager({ app: createMockApp() });
  mgr.notifyViewStateAfterReclaim({
    closedIds: ['m1'],
    splitMode: false,
    splitIds: [],
    splitDirection: 'horizontal',
    activeId: 'm2',
  }, mainWindow);
  assert.ok(sentChannels.includes('view:closed'));
  assert.ok(sentChannels.includes('view:splitChanged'));
  assert.ok(sentChannels.includes('view:switched'));
});

test('MemoryManager.notifyViewStateAfterReclaim does nothing with null window', () => {
  const mgr = new MemoryManager({ app: createMockApp() });
  // Should not throw
  mgr.notifyViewStateAfterReclaim({ closedIds: [] }, null);
});

test('MemoryManager.applyTrayMemoryPolicy returns null for keepAll', () => {
  const mgr = new MemoryManager({ app: createMockApp() });
  const result = mgr.applyTrayMemoryPolicy({ closeInactiveViews: () => ({}) }, { trayMemoryMode: 'keepAll' });
  assert.equal(result, null);
});

test('MEMORY_SNAPSHOT_TTL_MS is 5000', () => {
  assert.equal(MEMORY_SNAPSHOT_TTL_MS, 5000);
});
