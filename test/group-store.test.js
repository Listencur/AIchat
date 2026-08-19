'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const {
  GroupStore,
  generateGroupId,
  normalizeGroupsData,
} = require('../electron/group-store');

function createTempDir(prefix = 'group-store-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    path: dir,
    cleanup() {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

// ── 纯函数测试 ──

test('generateGroupId produces unique ids with group prefix', () => {
  const id1 = generateGroupId('My Group');
  const start = Date.now();
  while (Date.now() === start) {}
  const id2 = generateGroupId('My Group');
  assert.ok(id1 !== id2, 'IDs should be unique');
  assert.ok(id1.startsWith('group-'), `ID should start with group-: ${id1}`);
});

test('normalizeGroupsData filters invalid groups', () => {
  const data = {
    groups: [
      { id: 'g1', name: 'Valid', modelIds: ['m1'] },
      null,
      { name: 'No ID', modelIds: ['m1'] },
      { id: 'g2', name: '', modelIds: ['m1'] },
      { id: 'g3', name: 'No Models', modelIds: [] },
      { id: 'g4', name: 'Has Models', modelIds: ['m1', 'm2'] },
    ],
  };
  const result = normalizeGroupsData(data);
  // g1 passes, "No ID" gets auto-generated id and passes, g4 passes
  // null fails (no name), g2 fails (empty name), g3 fails (empty modelIds)
  assert.equal(result.groups.length, 3);
  assert.equal(result.groups[0].id, 'g1');
  assert.equal(result.groups[2].id, 'g4');
});

test('normalizeGroupsData generates id from name if missing', () => {
  const data = { groups: [{ name: 'Auto ID', modelIds: ['m1'] }] };
  const result = normalizeGroupsData(data);
  assert.equal(result.groups.length, 1);
  assert.ok(result.groups[0].id.startsWith('group-auto-id-'));
});

// ── GroupStore 测试 ──

test('GroupStore load returns empty array on first run', () => {
  const tmp = createTempDir();
  try {
    const store = new GroupStore({
      fs,
      path,
      userGroupsPath: path.join(tmp.path, 'groups.json'),
    });
    const groups = store.load();
    assert.ok(Array.isArray(groups));
    assert.equal(groups.length, 0);
  } finally {
    tmp.cleanup();
  }
});

test('GroupStore save and load', () => {
  const tmp = createTempDir();
  try {
    const store = new GroupStore({
      fs,
      path,
      userGroupsPath: path.join(tmp.path, 'groups.json'),
    });
    const groups = store.save([
      { id: 'g1', name: 'Test Group', modelIds: ['m1', 'm2'] },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].name, 'Test Group');

    const loaded = store.load();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, 'g1');
  } finally {
    tmp.cleanup();
  }
});

test('GroupStore purgeModelReferences removes model from all groups', () => {
  const tmp = createTempDir();
  try {
    const store = new GroupStore({
      fs,
      path,
      userGroupsPath: path.join(tmp.path, 'groups.json'),
    });
    store.save([
      { id: 'g1', name: 'Group 1', modelIds: ['m1', 'm2'] },
      { id: 'g2', name: 'Group 2', modelIds: ['m2', 'm3'] },
      { id: 'g3', name: 'Group 3', modelIds: ['m1'] },
    ]);
    const result = store.purgeModelReferences('m1');
    // g1 should have only m2, g2 should have m2,m3, g3 should be removed (empty)
    assert.equal(result.length, 2);
    assert.deepEqual(result[0].modelIds, ['m2']);
    assert.deepEqual(result[1].modelIds, ['m2', 'm3']);
  } finally {
    tmp.cleanup();
  }
});

test('GroupStore uses store when provided', () => {
  const mockStore = {
    _value: { groups: [] },
    get() { return this._value; },
    replace(v) { this._value = v; return this.get(); },
    schedulePersist() {},
  };
  const store = new GroupStore({ store: mockStore });
  const groups = store.load();
  assert.ok(Array.isArray(groups));
  assert.equal(groups.length, 0);

  store.save([{ id: 'g1', name: 'Test', modelIds: ['m1'] }]);
  assert.equal(mockStore._value.groups.length, 1);
});
