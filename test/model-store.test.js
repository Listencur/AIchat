'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const {
  ModelStore,
  generateModelId,
  isRestorableUrl,
  buildModelIconUrls,
  normalizeModelIcon,
  normalizeIconUrls,
  isSupportedIconPath,
} = require('../electron/model-store');

function createTempDir(prefix = 'model-store-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    path: dir,
    cleanup() {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

function createMockApp() {
  return {
    getPath: (name) => {
      if (name === 'userData') return '/tmp/test-user-data';
      return '/tmp';
    },
  };
}

// ── 纯函数测试 ──

test('generateModelId produces unique ids', () => {
  const id1 = generateModelId('Test Model');
  // Small delay to ensure different timestamp
  const start = Date.now();
  while (Date.now() === start) {}
  const id2 = generateModelId('Test Model');
  assert.ok(id1 !== id2, 'IDs should be unique');
  assert.ok(id1.startsWith('test-model-'), `ID should start with slug: ${id1}`);
});

test('isRestorableUrl validates http and https', () => {
  assert.equal(isRestorableUrl('https://chatgpt.com'), true);
  assert.equal(isRestorableUrl('http://example.com'), true);
  assert.equal(isRestorableUrl('ftp://example.com'), false);
  assert.equal(isRestorableUrl(''), false);
  assert.equal(isRestorableUrl(null), false);
});

test('normalizeIconUrls deduplicates', () => {
  const result = normalizeIconUrls(['https://a.com/favicon.ico', 'https://a.com/favicon.ico', 'https://b.com/icon.png']);
  assert.equal(result.length, 2);
});

test('isSupportedIconPath checks extensions', () => {
  assert.equal(isSupportedIconPath('icon.png'), true);
  assert.equal(isSupportedIconPath('icon.jpg'), true);
  assert.equal(isSupportedIconPath('icon.svg'), true);
  assert.equal(isSupportedIconPath('icon.exe'), false);
  assert.equal(isSupportedIconPath(''), false);
});

test('buildModelIconUrls returns array with preferred first', () => {
  const urls = buildModelIconUrls('https://chatgpt.com', 'https://preferred.com/icon.png');
  assert.ok(urls.length > 0, 'Should have at least one URL');
  assert.equal(urls[0], 'https://preferred.com/icon.png');
});

test('normalizeModelIcon fills defaults', () => {
  const result = normalizeModelIcon({ url: 'https://chatgpt.com', iconUrl: '' });
  assert.equal(result.icon, '🤖');
  assert.ok(Array.isArray(result.iconUrls));
});

// ── ModelStore 测试 ──

test('ModelStore list returns empty array on first run', () => {
  const tmp = createTempDir();
  try {
    const defaultPath = path.join(tmp.path, 'default-models.json');
    fs.writeFileSync(defaultPath, JSON.stringify({ configVersion: 1, models: [] }), 'utf-8');
    const store = new ModelStore({
      app: createMockApp(),
      fs,
      path,
      defaultModelsPath: defaultPath,
      userModelsPath: path.join(tmp.path, 'user-models.json'),
      userModelIconsDir: path.join(tmp.path, 'model-icons'),
    });
    const models = store.list();
    assert.ok(Array.isArray(models));
    assert.equal(models.length, 0);
  } finally {
    tmp.cleanup();
  }
});

test('ModelStore add and list', () => {
  const tmp = createTempDir();
  try {
    const defaultPath = path.join(tmp.path, 'default-models.json');
    fs.writeFileSync(defaultPath, JSON.stringify({ configVersion: 1, models: [] }), 'utf-8');
    const store = new ModelStore({
      app: createMockApp(),
      fs,
      path,
      defaultModelsPath: defaultPath,
      userModelsPath: path.join(tmp.path, 'user-models.json'),
      userModelIconsDir: path.join(tmp.path, 'model-icons'),
    });
    const newModel = store.add({ name: 'Test', url: 'https://chatgpt.com', icon: '🤖' });
    assert.ok(newModel.id, 'Should have an id');
    assert.equal(newModel.name, 'Test');
    assert.equal(newModel.url, 'https://chatgpt.com');
    assert.ok(newModel.partition, 'Should have a partition');

    const models = store.list();
    assert.equal(models.length, 1);
    assert.equal(models[0].id, newModel.id);
  } finally {
    tmp.cleanup();
  }
});

test('ModelStore update modifies model', () => {
  const tmp = createTempDir();
  try {
    const defaultPath = path.join(tmp.path, 'default-models.json');
    fs.writeFileSync(defaultPath, JSON.stringify({ configVersion: 1, models: [] }), 'utf-8');
    const store = new ModelStore({
      app: createMockApp(),
      fs,
      path,
      defaultModelsPath: defaultPath,
      userModelsPath: path.join(tmp.path, 'user-models.json'),
      userModelIconsDir: path.join(tmp.path, 'model-icons'),
    });
    const newModel = store.add({ name: 'Test', url: 'https://chatgpt.com' });
    const updated = store.update(newModel.id, { name: 'Updated', url: 'https://example.com' });
    assert.ok(updated, 'Should return updated model');
    assert.equal(updated.name, 'Updated');
    assert.equal(updated.url, 'https://example.com');
  } finally {
    tmp.cleanup();
  }
});

test('ModelStore update returns null for invalid config', () => {
  const tmp = createTempDir();
  try {
    const defaultPath = path.join(tmp.path, 'default-models.json');
    fs.writeFileSync(defaultPath, JSON.stringify({ configVersion: 1, models: [] }), 'utf-8');
    const store = new ModelStore({
      app: createMockApp(),
      fs,
      path,
      defaultModelsPath: defaultPath,
      userModelsPath: path.join(tmp.path, 'user-models.json'),
      userModelIconsDir: path.join(tmp.path, 'model-icons'),
    });
    const result = store.update('nonexistent', { name: '', url: '' });
    assert.equal(result, null);
  } finally {
    tmp.cleanup();
  }
});

test('ModelStore remove deletes model', () => {
  const tmp = createTempDir();
  try {
    const defaultPath = path.join(tmp.path, 'default-models.json');
    fs.writeFileSync(defaultPath, JSON.stringify({ configVersion: 1, models: [] }), 'utf-8');
    const store = new ModelStore({
      app: createMockApp(),
      fs,
      path,
      defaultModelsPath: defaultPath,
      userModelsPath: path.join(tmp.path, 'user-models.json'),
      userModelIconsDir: path.join(tmp.path, 'model-icons'),
    });
    const newModel = store.add({ name: 'Test', url: 'https://chatgpt.com' });
    assert.equal(store.list().length, 1);
    store.remove(newModel.id);
    assert.equal(store.list().length, 0);
  } finally {
    tmp.cleanup();
  }
});

test('ModelStore reorder reorders models', () => {
  const tmp = createTempDir();
  try {
    const defaultPath = path.join(tmp.path, 'default-models.json');
    fs.writeFileSync(defaultPath, JSON.stringify({ configVersion: 1, models: [] }), 'utf-8');
    const store = new ModelStore({
      app: createMockApp(),
      fs,
      path,
      defaultModelsPath: defaultPath,
      userModelsPath: path.join(tmp.path, 'user-models.json'),
      userModelIconsDir: path.join(tmp.path, 'model-icons'),
    });
    const m1 = store.add({ name: 'A', url: 'https://a.com' });
    const m2 = store.add({ name: 'B', url: 'https://b.com' });
    const reordered = store.reorder([m2.id, m1.id]);
    assert.equal(reordered[0].id, m2.id);
    assert.equal(reordered[1].id, m1.id);
  } finally {
    tmp.cleanup();
  }
});

test('ModelStore syncs default models on load', () => {
  const tmp = createTempDir();
  try {
    const defaultPath = path.join(tmp.path, 'default-models.json');
    const defaultModels = [
      { id: 'default-1', name: 'Default 1', url: 'https://chatgpt.com', icon: '🤖', iconUrl: '', iconUrls: [], color: '#666666', partition: 'persist:model-default-1' },
      { id: 'default-2', name: 'Default 2', url: 'https://gemini.google.com', icon: '✨', iconUrl: '', iconUrls: [], color: '#666666', partition: 'persist:model-default-2' },
    ];
    fs.writeFileSync(defaultPath, JSON.stringify({ configVersion: 1, models: defaultModels }), 'utf-8');
    const store = new ModelStore({
      app: createMockApp(),
      fs,
      path,
      defaultModelsPath: defaultPath,
      userModelsPath: path.join(tmp.path, 'user-models.json'),
      userModelIconsDir: path.join(tmp.path, 'model-icons'),
    });
    // First run creates initial data
    const models = store.list();
    assert.equal(models.length, 2);
    assert.equal(models[0].id, 'default-1');
  } finally {
    tmp.cleanup();
  }
});

test('ModelStore removeDefaultModelIds tracks removed defaults', () => {
  const tmp = createTempDir();
  try {
    const defaultPath = path.join(tmp.path, 'default-models.json');
    const defaultModels = [
      { id: 'default-1', name: 'Default 1', url: 'https://chatgpt.com', icon: '🤖', iconUrl: '', iconUrls: [], color: '#666666', partition: 'persist:model-default-1' },
    ];
    fs.writeFileSync(defaultPath, JSON.stringify({ configVersion: 1, models: defaultModels }), 'utf-8');
    const store = new ModelStore({
      app: createMockApp(),
      fs,
      path,
      defaultModelsPath: defaultPath,
      userModelsPath: path.join(tmp.path, 'user-models.json'),
      userModelIconsDir: path.join(tmp.path, 'model-icons'),
    });
    store.list(); // initialize
    store.remove('default-1');
    // After removing, the default model should not reappear on next load
    const models = store.list();
    assert.equal(models.length, 0);
  } finally {
    tmp.cleanup();
  }
});
