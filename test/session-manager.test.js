'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const {
  SessionManager,
  getPersistPartitionName,
  getPartitionDirName,
} = require('../electron/session-manager');

function createTempDir(prefix = 'session-mgr-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    path: dir,
    cleanup() {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

function createMockSession(overrides = {}) {
  return {
    setProxy: () => Promise.resolve(),
    resolveProxy: () => Promise.resolve('DIRECT'),
    clearCache: () => Promise.resolve(),
    clearStorageData: () => Promise.resolve(),
    clearAuthCache: () => Promise.resolve(),
    clearCodeCaches: () => Promise.resolve(),
    clearHostResolverCache: () => Promise.resolve(),
    cookies: { flushStore: () => Promise.resolve() },
    ...overrides,
  };
}

function createMockSessionFactory() {
  const sessions = new Map();
  return {
    fromPartition: (partition) => {
      if (!sessions.has(partition)) sessions.set(partition, createMockSession());
      return sessions.get(partition);
    },
    defaultSession: createMockSession(),
    _sessions: sessions,
  };
}

function createMockApp(overrides = {}) {
  return {
    getPath: (name) => {
      const paths = { userData: '/tmp/test-user-data', temp: os.tmpdir() };
      return paths[name] || '/tmp';
    },
    ...overrides,
  };
}

// ── 纯函数测试 ──

test('getPersistPartitionName extracts name from persist partition', () => {
  const model = { partition: 'persist:model-abc' };
  assert.equal(getPersistPartitionName(model), 'model-abc');
});

test('getPersistPartitionName returns empty for non-persist partition', () => {
  const model = { partition: 'persist:' };
  assert.equal(getPersistPartitionName(model), '');
});

test('getPersistPartitionName returns empty for no partition', () => {
  const model = {};
  assert.equal(getPersistPartitionName(model), '');
});

test('getPartitionDirName encodes special characters', () => {
  const result = getPartitionDirName('model-test@123');
  assert.ok(!result.includes('@'), 'Should not contain @');
  assert.ok(result.length > 0);
});

// ── SessionManager 单元测试 ──

test('SessionManager.clearTempDiskCache returns false when no diskCachePath', () => {
  const mgr = new SessionManager({ app: createMockApp() });
  assert.equal(mgr.clearTempDiskCache(), false);
});

test('SessionManager.clearTempDiskCache returns false for safe path check', () => {
  const tmp = createTempDir();
  try {
    const mgr = new SessionManager({
      app: createMockApp({ getPath: () => tmp.path }),
      fs,
      path,
      diskCachePath: path.join(tmp.path, 'some-other-dir'),
    });
    assert.equal(mgr.clearTempDiskCache(), false);
  } finally {
    tmp.cleanup();
  }
});

test('SessionManager.createProxyOptions returns correct options', () => {
  const mgr = new SessionManager({ app: createMockApp() });
  assert.deepEqual(mgr.createProxyOptions({ proxyMode: 'direct' }), { mode: 'direct' });
  assert.deepEqual(mgr.createProxyOptions({ proxyMode: 'custom', proxyUrl: 'http://127.0.0.1:7897' }), { mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:7897' });
  assert.deepEqual(mgr.createProxyOptions({ proxyMode: 'system' }), { mode: 'system' });
});

test('SessionManager.clearSessionCacheData calls clearCache', async () => {
  let cleared = false;
  const ses = createMockSession({ clearCache: () => { cleared = true; return Promise.resolve(); } });
  const mgr = new SessionManager({ app: createMockApp() });
  await mgr.clearSessionCacheData(ses);
  assert.equal(cleared, true);
});

test('SessionManager.clearSessionLoginData clears all login storage', async () => {
  let clearedStorages = null;
  const ses = createMockSession({
    clearStorageData: (opts) => { clearedStorages = opts.storages; return Promise.resolve(); },
    clearCache: () => Promise.resolve(),
  });
  const mgr = new SessionManager({ app: createMockApp() });
  await mgr.clearSessionLoginData(ses);
  assert.ok(Array.isArray(clearedStorages));
  assert.ok(clearedStorages.includes('cookies'));
  assert.ok(clearedStorages.includes('localstorage'));
});

test('SessionManager.clearAllCache clears all managed sessions', async () => {
  const factory = createMockSessionFactory();
  const loadModelsFn = () => [{ id: 'm1', partition: 'persist:model-m1' }];
  const mgr = new SessionManager({
    app: createMockApp(),
    session: factory,
    fs,
    path,
    diskCachePath: '',
  });
  const result = await mgr.clearAllCache(loadModelsFn);
  assert.equal(result.ok, true);
  assert.ok(result.sessions >= 1);
});

test('SessionManager.clearAllLoginState clears all managed sessions', async () => {
  const factory = createMockSessionFactory();
  const loadModelsFn = () => [{ id: 'm1', partition: 'persist:model-m1' }];
  const mgr = new SessionManager({
    app: createMockApp(),
    session: factory,
    fs,
    path,
    diskCachePath: '',
  });
  const result = await mgr.clearAllLoginState(loadModelsFn);
  assert.equal(result.ok, true);
  assert.ok(result.sessions >= 1);
});

test('SessionManager.removePartitionData returns ok for valid model', async () => {
  const tmp = createTempDir();
  try {
    const factory = createMockSessionFactory();
    const mgr = new SessionManager({
      app: createMockApp({ getPath: () => tmp.path }),
      session: factory,
      fs,
      path,
      diskCachePath: '',
    });
    const result = await mgr.removePartitionData({ id: 'test', partition: 'persist:model-test' });
    assert.equal(result.ok, true);
    assert.equal(result.partition, 'persist:model-test');
  } finally {
    tmp.cleanup();
  }
});

test('SessionManager.getManagedSessions includes default session', () => {
  const factory = createMockSessionFactory();
  const loadModelsFn = () => [];
  const mgr = new SessionManager({
    app: createMockApp(),
    session: factory,
  });
  const sessions = mgr.getManagedSessions(loadModelsFn);
  assert.ok(sessions.length >= 1);
  assert.equal(sessions[0].partition, 'default');
});
