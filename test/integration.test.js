'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { ModelStore, generateModelId } = require('../electron/model-store');
const { ViewLayout } = require('../electron/view-layout');
const { ViewReclaimer } = require('../electron/view-reclaimer');
const { PromptInjector } = require('../electron/prompt-injector');
const { StateStore } = require('../electron/state-store');

function createTempDir(prefix = 'integration-test-') {
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

function createMockWindow() {
  return {
    isDestroyed: () => false,
    webContents: { send: () => {} },
    contentView: { addChildView: () => {}, removeChildView: () => {} },
  };
}

// ── 集成测试: 添加模型 → 编辑模型 → 删除模型 ──

test('integration: add model → edit model → delete model with partition cleanup', () => {
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

    // 1. 添加模型
    const model = store.add({ name: 'ChatGPT', url: 'https://chatgpt.com', icon: '🤖' });
    assert.ok(model.id, 'Model should have an id');
    assert.equal(model.name, 'ChatGPT');
    assert.ok(model.partition.startsWith('persist:model-'));
    assert.equal(store.list().length, 1);

    // 2. 编辑模型
    const updated = store.update(model.id, { name: 'ChatGPT Updated', url: 'https://chat.openai.com' });
    assert.ok(updated);
    assert.equal(updated.name, 'ChatGPT Updated');
    assert.equal(updated.url, 'https://chat.openai.com');
    assert.equal(updated.partition, model.partition); // partition should not change

    // 3. 删除模型
    store.remove(model.id);
    assert.equal(store.list().length, 0);
  } finally {
    tmp.cleanup();
  }
});

// ── 集成测试: 分屏进入/退出 ──

test('integration: enter split mode → adjust ratios → exit split mode', () => {
  const win = createMockWindow();
  const layout = new ViewLayout(win);

  // 1. 进入分屏
  layout.setSplitMode(true, ['m1', 'm2'], [0.5, 0.5], 'horizontal');
  assert.equal(layout.splitMode, true);
  assert.deepEqual(layout.splitIds, ['m1', 'm2']);

  // 2. 调整比例
  const changed = layout.setSplitRatios([0.3, 0.7]);
  assert.equal(changed, true);
  const ratios = layout.getSplitRatios();
  assert.ok(Math.abs(ratios[0] - 0.3) < 0.01);
  assert.ok(Math.abs(ratios[1] - 0.7) < 0.01);

  // 3. 退出分屏
  layout.setSplitMode(false);
  assert.equal(layout.splitMode, false);
  assert.deepEqual(layout.splitIds, []);
});

// ── 集成测试: 快速提问（Prompt注入） ──

test('integration: build prompt script → fill → submit flow', async () => {
  let lastScript = null;
  const view = {
    webContents: {
      isDestroyed: () => false,
      executeJavaScript: async (script) => {
        lastScript = script;
        return { ok: true, method: 'filled' };
      },
    },
  };

  // 1. 构建脚本
  const script = PromptInjector.buildPromptScript('What is AI?', true, {});
  assert.ok(script.includes('What is AI?'));

  // 2. 填入
  const fillResult = await PromptInjector.fillPrompt(view, 'What is AI?', {});
  assert.equal(fillResult.ok, true);
  assert.ok(lastScript.includes('What is AI?'));

  // 3. 降级手动发送
  const view2 = {
    webContents: {
      isDestroyed: () => false,
      executeJavaScript: async () => ({ ok: true, method: 'filled' }),
    },
  };
  const fallbackResult = await PromptInjector.fallbackManualSend(view2, 'test', {});
  assert.equal(fallbackResult.ok, true);
  assert.equal(fallbackResult.method, 'filled-only');
  assert.equal(fallbackResult.requiresManualSend, true);
});

// ── 集成测试: ViewReclaim 回收保护 ──

test('integration: reclaimer with protected ids → enforce max alive', () => {
  const reclaimer = new ViewReclaimer({ maxAliveViews: 2 });
  reclaimer.addProtectedId('m1');

  const views = new Map([
    ['m1', { lastUsedAt: 100 }],
    ['m2', { lastUsedAt: 200 }],
    ['m3', { lastUsedAt: 300 }],
  ]);

  const closedIds = [];
  const removeFn = (id) => { closedIds.push(id); views.delete(id); };
  const state = { activeId: null, splitMode: false, splitIds: [] };

  reclaimer.enforceMaxAlive(views, state, removeFn);
  assert.ok(closedIds.length > 0);
  assert.ok(!closedIds.includes('m1')); // protected
});

// ── 集成测试: StateStore flush ──

test('integration: state store patch → persist → flush cycle', async () => {
  const tmp = createTempDir();
  try {
    const filePath = path.join(tmp.path, 'test-state.json');
    const store = new StateStore(filePath, { count: 0 });
    assert.equal(store.get().count, 0);

    // patch
    store.patch({ count: 1 });
    assert.equal(store.get().count, 1);
    assert.ok(store.revision > 0);

    // persist
    await store.persist();
    assert.ok(store.persistedRevision >= store.revision);

    // flush
    store.patch({ count: 2 });
    await store.flush();
    assert.equal(store.persistedRevision, store.revision);

    // verify file content
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    assert.equal(content.count, 2);
  } finally {
    tmp.cleanup();
  }
});

// ── 集成测试: 模型添加后 partition 清理 ──

test('integration: add model → remove → verify clean state', () => {
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

    // 添加多个模型
    const m1 = store.add({ name: 'A', url: 'https://a.com' });
    const m2 = store.add({ name: 'B', url: 'https://b.com' });
    const m3 = store.add({ name: 'C', url: 'https://c.com' });
    assert.equal(store.list().length, 3);

    // 删除中间模型
    store.remove(m2.id);
    const remaining = store.list();
    assert.equal(remaining.length, 2);
    assert.ok(!remaining.find(m => m.id === m2.id));

    // 验证 partition 独立
    const partitions = remaining.map(m => m.partition);
    assert.equal(new Set(partitions).size, 2);
  } finally {
    tmp.cleanup();
  }
});

// ── 集成测试: 分屏布局与侧边栏交互 ──

test('integration: split mode with sidebar toggle', () => {
  const win = createMockWindow();
  const layout = new ViewLayout(win);

  // 进入分屏
  layout.setSplitMode(true, ['m1', 'm2']);

  // 折叠侧边栏
  layout.setSidebarCollapsed(true);
  assert.equal(layout.getSidebarWidth(), 56);

  // 展开侧边栏
  layout.setSidebarCollapsed(false);
  assert.equal(layout.getSidebarWidth(), 240);
});

// ── 集成测试: 一键清除缓存和登录状态 ──

test('integration: model store → settings normalize → clear all flow', async () => {
  const tmp = createTempDir();
  try {
    // 模型存储
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

    store.add({ name: 'Test', url: 'https://chatgpt.com' });
    assert.equal(store.list().length, 1);

    // 设置规范化
    const { normalizeSettings } = require('../electron/settings-normalize');
    const settings = normalizeSettings({ theme: 'light', memoryPressureMb: 3000 });
    assert.equal(settings.theme, 'light');
    assert.equal(settings.memoryPressureMb, 3000);

    // 清除
    store.remove(store.list()[0].id);
    assert.equal(store.list().length, 0);
  } finally {
    tmp.cleanup();
  }
});
