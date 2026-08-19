'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const {
  SnapshotService,
  normalizeSnapshot,
  SNAPSHOT_MAX_AGE_MS,
} = require('../electron/snapshot-service');

function createTempDir(prefix = 'snapshot-service-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    path: dir,
    cleanup() {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

// ── 纯函数测试 ──

test('normalizeSnapshot returns empty snapshot for null input', () => {
  const result = normalizeSnapshot(null);
  assert.equal(result.version, 1);
  assert.equal(result.savedAt, '');
  assert.equal(result.activeModelId, '');
  assert.equal(result.splitMode, false);
  assert.ok(Array.isArray(result.entries));
  assert.equal(result.entries.length, 0);
});

test('normalizeSnapshot returns empty for stale data', () => {
  const oldDate = new Date(Date.now() - SNAPSHOT_MAX_AGE_MS - 1000).toISOString();
  const data = {
    savedAt: oldDate,
    activeModelId: 'model-1',
    entries: [{ modelId: 'model-1', url: 'https://chatgpt.com/c/123', scrollY: 100 }],
  };
  const result = normalizeSnapshot(data);
  assert.equal(result.savedAt, '');
  assert.equal(result.entries.length, 0);
});

test('normalizeSnapshot preserves fresh data', () => {
  const freshDate = new Date().toISOString();
  const data = {
    savedAt: freshDate,
    activeModelId: 'model-1',
    splitMode: true,
    splitIds: ['model-1', 'model-2'],
    splitRatios: [0.5, 0.5],
    splitDirection: 'vertical',
    entries: [{ modelId: 'model-1', url: 'https://chatgpt.com/c/123', scrollY: 100 }],
  };
  const result = normalizeSnapshot(data);
  assert.equal(result.savedAt, freshDate);
  assert.equal(result.activeModelId, 'model-1');
  assert.equal(result.splitMode, true);
  assert.equal(result.splitIds.length, 2);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].scrollY, 100);
});

test('normalizeSnapshot limits splitIds to 3', () => {
  const freshDate = new Date().toISOString();
  const data = {
    savedAt: freshDate,
    splitIds: ['a', 'b', 'c', 'd'],
    splitRatios: [0.25, 0.25, 0.25, 0.25],
    entries: [],
  };
  const result = normalizeSnapshot(data);
  assert.equal(result.splitIds.length, 3);
  assert.equal(result.splitRatios.length, 3);
});

test('normalizeSnapshot filters invalid entries', () => {
  const freshDate = new Date().toISOString();
  const data = {
    savedAt: freshDate,
    entries: [
      null,
      { modelId: 'm1', url: 'not-a-url', scrollY: 0 },
      { modelId: 'm1', url: 'https://chatgpt.com/c/123', scrollY: 50 },
      { url: 'https://chatgpt.com/c/456', scrollY: 0 },
    ],
  };
  const result = normalizeSnapshot(data);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].modelId, 'm1');
});

// ── SnapshotService 测试 ──

test('SnapshotService load returns empty snapshot on first run', () => {
  const tmp = createTempDir();
  try {
    const svc = new SnapshotService({
      fs,
      path,
      userSnapshotPath: path.join(tmp.path, 'snapshot.json'),
      loadModelsFn: () => [],
    });
    const snapshot = svc.load();
    assert.equal(snapshot.version, 1);
    assert.equal(snapshot.entries.length, 0);
  } finally {
    tmp.cleanup();
  }
});

test('SnapshotService save and load round-trips', () => {
  const tmp = createTempDir();
  try {
    const models = [
      { id: 'm1', url: 'https://chatgpt.com' },
    ];
    const svc = new SnapshotService({
      fs,
      path,
      userSnapshotPath: path.join(tmp.path, 'snapshot.json'),
      loadModelsFn: () => models,
    });
    const input = {
      savedAt: new Date().toISOString(),
      activeModelId: 'm1',
      splitMode: false,
      entries: [{ modelId: 'm1', url: 'https://chatgpt.com/c/1', scrollY: 100 }],
    };
    const saved = svc.save(input);
    assert.equal(saved.activeModelId, 'm1');

    const loaded = svc.load();
    assert.equal(loaded.activeModelId, 'm1');
    assert.equal(loaded.entries.length, 1);
  } finally {
    tmp.cleanup();
  }
});

test('SnapshotService purgeModelEntries removes model references', () => {
  const tmp = createTempDir();
  try {
    const models = [
      { id: 'm1', url: 'https://chatgpt.com' },
      { id: 'm2', url: 'https://gemini.google.com' },
    ];
    const svc = new SnapshotService({
      fs,
      path,
      userSnapshotPath: path.join(tmp.path, 'snapshot.json'),
      loadModelsFn: () => models,
    });
    const savedSnapshot = svc.save({
      savedAt: new Date().toISOString(),
      activeModelId: 'm1',
      splitMode: true,
      splitIds: ['m1', 'm2'],
      splitRatios: [0.5, 0.5],
      entries: [
        { modelId: 'm1', url: 'https://chatgpt.com/c/1', scrollY: 0 },
        { modelId: 'm2', url: 'https://gemini.google.com/c/2', scrollY: 0 },
      ],
    });
    assert.equal(savedSnapshot.entries.length, 2, 'Save should preserve both entries');
    const result = svc.purgeModelEntries('m1');
    assert.equal(result.activeModelId, '');
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].modelId, 'm2');
    // splitIds becomes empty because split mode requires >= 2 models
    assert.equal(result.splitIds.length, 0);
    assert.equal(result.splitMode, false);
  } finally {
    tmp.cleanup();
  }
});

test('SnapshotService validates entries against models on load', () => {
  const tmp = createTempDir();
  try {
    const models = [
      { id: 'm1', url: 'https://chatgpt.com' },
    ];
    const svc = new SnapshotService({
      fs,
      path,
      userSnapshotPath: path.join(tmp.path, 'snapshot.json'),
      loadModelsFn: () => models,
    });
    svc.save({
      savedAt: new Date().toISOString(),
      entries: [
        { modelId: 'm1', url: 'https://chatgpt.com/c/1', scrollY: 0 },
        { modelId: 'm2', url: 'https://evil.com/c/2', scrollY: 0 },
      ],
    });
    const loaded = svc.load();
    assert.equal(loaded.entries.length, 1);
    assert.equal(loaded.entries[0].modelId, 'm1');
  } finally {
    tmp.cleanup();
  }
});

test('SnapshotService uses store when provided', () => {
  const mockStore = {
    _value: normalizeSnapshot(null),
    get() { return this._value; },
    replace(v) { this._value = v; return this.get(); },
    schedulePersist() {},
  };
  const svc = new SnapshotService({ store: mockStore, loadModelsFn: () => [] });
  const snapshot = svc.load();
  assert.equal(snapshot.version, 1);

  svc.save({ savedAt: new Date().toISOString(), entries: [] });
  assert.ok(mockStore._value.savedAt);
});
