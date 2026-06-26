'use strict';

const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { ViewManager, SIDEBAR_WIDTH } = require('./view-manager');

/** @type {BrowserWindow} */
let mainWindow = null;
/** @type {ViewManager} */
let viewManager = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
const diskCachePath = path.join(app.getPath('temp'), 'ai-chat-hub-cache');

// 反自动化检测：移除 navigator.webdriver 标记，绕过 Cloudflare bot 检测
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
// 避免 Chromium 磁盘缓存/GPU 缓存目录迁移或创建失败时刷屏。
app.commandLine.appendSwitch('disk-cache-dir', diskCachePath);
app.commandLine.appendSwitch('disk-cache-size', '0');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

// ── 模型配置存储 ──

const defaultModelsPath = path.join(__dirname, '..', 'data', 'models.json');
const userModelsPath = path.join(app.getPath('userData'), 'models.json');
const userSettingsPath = path.join(app.getPath('userData'), 'settings.json');
const userGroupsPath = path.join(app.getPath('userData'), 'groups.json');
const userSnapshotPath = path.join(app.getPath('userData'), 'snapshot.json');
const DEFAULT_SETTINGS = {
  proxyMode: 'system',
  proxyUrl: 'http://127.0.0.1:7897',
  restoreSnapshot: false,
};
const PROXY_URL_PATTERN = /^(https?|socks5?):\/\/.+/;
const SNAPSHOT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.error(`[main] Failed to read JSON: ${filePath}`, error);
    return fallback;
  }
}

function normalizeSettings(settings) {
  const rawSettings = settings && typeof settings === 'object' ? settings : {};
  const proxyMode = ['system', 'custom', 'direct'].includes(rawSettings.proxyMode)
    ? rawSettings.proxyMode
    : DEFAULT_SETTINGS.proxyMode;
  const proxyUrl = typeof rawSettings.proxyUrl === 'string' && PROXY_URL_PATTERN.test(rawSettings.proxyUrl.trim())
    ? rawSettings.proxyUrl.trim()
    : DEFAULT_SETTINGS.proxyUrl;

  const restoreSnapshot = rawSettings.restoreSnapshot === true;

  return { proxyMode, proxyUrl, restoreSnapshot };
}

function loadSettings() {
  if (!fs.existsSync(userSettingsPath)) {
    saveSettings(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }

  return normalizeSettings(readJsonFile(userSettingsPath, DEFAULT_SETTINGS));
}

function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  fs.writeFileSync(userSettingsPath, JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

function normalizeGroupsData(data) {
  const groups = Array.isArray(data.groups) ? data.groups : [];

  return {
    groups: groups
      .filter((group) => group && typeof group.name === 'string' && Array.isArray(group.modelIds))
      .map((group) => ({
        id: String(group.id || generateGroupId(group.name)),
        name: group.name.trim(),
        modelIds: group.modelIds.map(String),
      }))
      .filter((group) => group.name && group.modelIds.length > 0),
  };
}

function loadGroups() {
  if (!fs.existsSync(userGroupsPath)) {
    saveGroups([]);
    return [];
  }

  return normalizeGroupsData(readJsonFile(userGroupsPath, { groups: [] })).groups;
}

function saveGroups(groups) {
  const data = normalizeGroupsData({ groups });
  fs.writeFileSync(userGroupsPath, JSON.stringify(data, null, 2), 'utf-8');
  return data.groups;
}

function isRestorableUrl(url) {
  if (typeof url !== 'string' || !url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeSnapshot(data) {
  const raw = data && typeof data === 'object' ? data : {};
  const savedAt = typeof raw.savedAt === 'string' ? raw.savedAt : '';
  const savedTime = savedAt ? Date.parse(savedAt) : 0;
  const isFresh = savedTime > 0 && Date.now() - savedTime <= SNAPSHOT_MAX_AGE_MS;
  const entries = Array.isArray(raw.entries) ? raw.entries : [];
  const splitIds = Array.isArray(raw.splitIds) ? raw.splitIds.map(String) : [];
  const splitRatios = Array.isArray(raw.splitRatios)
    ? raw.splitRatios.map(Number).filter((ratio) => ratio > 0)
    : [];

  if (!isFresh) {
    return {
      version: 1,
      savedAt: '',
      activeModelId: '',
      splitMode: false,
      splitIds: [],
      splitRatios: [],
      entries: [],
    };
  }

  return {
    version: 1,
    savedAt,
    activeModelId: typeof raw.activeModelId === 'string' ? raw.activeModelId : '',
    splitMode: raw.splitMode === true,
    splitIds: splitIds.slice(0, 3),
    splitRatios: splitRatios.slice(0, 3),
    entries: entries
      .filter((entry) => entry && typeof entry.modelId === 'string' && isRestorableUrl(entry.url))
      .map((entry) => ({
        modelId: entry.modelId,
        url: entry.url,
        scrollY: Math.max(0, Number(entry.scrollY) || 0),
      })),
  };
}

function loadSnapshot() {
  if (!fs.existsSync(userSnapshotPath)) {
    return normalizeSnapshot(null);
  }

  return normalizeSnapshot(readJsonFile(userSnapshotPath, {}));
}

function saveSnapshot(snapshot) {
  const normalized = normalizeSnapshot({
    ...snapshot,
    savedAt: snapshot && snapshot.savedAt ? snapshot.savedAt : new Date().toISOString(),
  });

  fs.writeFileSync(userSnapshotPath, JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

async function persistSessionSnapshot() {
  if (!viewManager || !loadSettings().restoreSnapshot) {
    return null;
  }

  const snapshot = await viewManager.snapshot();
  return saveSnapshot(snapshot);
}

function createProxyOptions(settings) {
  if (settings.proxyMode === 'direct') {
    return { mode: 'direct' };
  }

  if (settings.proxyMode === 'custom') {
    return {
      mode: 'fixed_servers',
      proxyRules: settings.proxyUrl,
    };
  }

  return { mode: 'system' };
}

async function applyProxySettings(settings) {
  const normalized = normalizeSettings(settings);
  await session.defaultSession.setProxy(createProxyOptions(normalized));

  if (viewManager) {
    await viewManager.setProxyConfig(normalized);
  }

  return normalized;
}

function readDefaultModelsData() {
  const data = readJsonFile(defaultModelsPath, { configVersion: 1, models: [] });
  return {
    configVersion: data.configVersion || 1,
    models: Array.isArray(data.models) ? data.models : [],
  };
}

function writeUserModelsData(data) {
  fs.writeFileSync(userModelsPath, JSON.stringify(data, null, 2), 'utf-8');
}

function buildInitialUserModelsData(defaultData) {
  return {
    configVersion: defaultData.configVersion,
    models: defaultData.models,
    removedDefaultModelIds: [],
  };
}

function syncUserModelsData(userData, defaultData) {
  const userModels = Array.isArray(userData.models) ? userData.models : [];
  const removedDefaultModelIds = Array.isArray(userData.removedDefaultModelIds)
    ? userData.removedDefaultModelIds
    : [];

  const defaultIds = new Set(defaultData.models.map((model) => model.id));
  const removedSet = new Set(removedDefaultModelIds);
  const userById = new Map(userModels.map((model) => [model.id, model]));

  const models = [];

  for (const defaultModel of defaultData.models) {
    const existing = userById.get(defaultModel.id);
    if (existing) {
      models.push({
        ...defaultModel,
        ...existing,
        id: defaultModel.id,
        partition: existing.partition || defaultModel.partition,
      });
    } else if (!removedSet.has(defaultModel.id)) {
      models.push(defaultModel);
    }
  }

  for (const userModel of userModels) {
    if (!defaultIds.has(userModel.id)) {
      models.push(userModel);
    }
  }

  return {
    configVersion: defaultData.configVersion,
    models,
    removedDefaultModelIds: removedDefaultModelIds.filter((id) => defaultIds.has(id)),
  };
}

function readUserModelsData() {
  const defaultData = readDefaultModelsData();

  if (!fs.existsSync(userModelsPath)) {
    const initialData = buildInitialUserModelsData(defaultData);
    writeUserModelsData(initialData);
    return initialData;
  }

  const userData = readJsonFile(userModelsPath, buildInitialUserModelsData(defaultData));
  const syncedData = syncUserModelsData(userData, defaultData);

  if (JSON.stringify(userData) !== JSON.stringify(syncedData)) {
    writeUserModelsData(syncedData);
  }

  return syncedData;
}

/**
 * 加载模型列表。
 * 首次启动时从 data/models.json 拷贝到 userData。
 * 后续启动时会按 configVersion 同步默认模型，并保留用户新增模型。
 */
function loadModels() {
  return readUserModelsData().models;
}

/**
 * 保存模型列表到 userData。
 */
function saveModels(models) {
  const data = readUserModelsData();
  data.models = models;
  writeUserModelsData(data);
}

/**
 * 生成模型 id（name 的拼音/英文 slug + 随机数防重复）。
 */
function generateModelId(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `${base}-${Date.now().toString(36)}`;
}

function generateGroupId(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `group-${base || 'custom'}-${Date.now().toString(36)}`;
}

// ── 窗口创建 ──

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1e1e2e',
    title: 'AI对话聚合',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 加载前端界面
  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  // 初始化 ViewManager
  const settings = loadSettings();
  viewManager = new ViewManager(mainWindow, settings, settings.restoreSnapshot ? loadSnapshot() : null);

  // 窗口 resize 时重新计算所有 View 的 bounds
  mainWindow.on('resize', () => {
    if (viewManager) viewManager.resizeAll();
  });

  // 开发模式自动打开 DevTools
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  let closeAfterSnapshot = false;
  mainWindow.on('close', async (event) => {
    if (closeAfterSnapshot) return;

    if (loadSettings().restoreSnapshot && viewManager) {
      event.preventDefault();
      closeAfterSnapshot = true;
      try {
        await persistSessionSnapshot();
      } finally {
        mainWindow.close();
      }
    }
  });

  mainWindow.on('closed', () => {
    if (viewManager) viewManager.destroyAll();
    mainWindow = null;
    viewManager = null;
  });
}

// ── IPC 处理器 ──

function registerIPC() {
  // 模型列表
  ipcMain.handle('models:list', () => {
    return loadModels();
  });

  // 添加模型
  ipcMain.handle('models:add', (_event, config) => {
    const models = loadModels();
    const newModel = {
      id: generateModelId(config.name),
      name: config.name,
      url: config.url,
      icon: config.icon || '🤖',
      color: config.color || '#666666',
      partition: `persist:${config.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
    };
    models.push(newModel);
    saveModels(models);

    // 通知渲染进程更新
    mainWindow.webContents.send('models:updated', models);
    return newModel;
  });

  // 编辑模型
  ipcMain.handle('models:update', (_event, id, config) => {
    const rawConfig = config && typeof config === 'object' ? config : {};
    const name = typeof rawConfig.name === 'string' ? rawConfig.name.trim() : '';
    const url = typeof rawConfig.url === 'string' ? rawConfig.url.trim() : '';

    if (!name || !/^https?:\/\/.+/.test(url)) {
      return null;
    }

    const models = loadModels();
    const index = models.findIndex((model) => model.id === id);
    if (index === -1) {
      return null;
    }

    const updatedModel = {
      ...models[index],
      name,
      url,
      icon: typeof rawConfig.icon === 'string' && rawConfig.icon.trim() ? rawConfig.icon.trim() : '🤖',
      color: typeof rawConfig.color === 'string' && rawConfig.color ? rawConfig.color : '#666666',
    };

    models[index] = updatedModel;
    saveModels(models);

    if (viewManager) {
      viewManager.updateModel(updatedModel);
    }

    mainWindow.webContents.send('models:updated', models);
    return updatedModel;
  });

  // 删除模型
  ipcMain.handle('models:remove', (_event, id) => {
    const data = readUserModelsData();
    const defaultIds = new Set(readDefaultModelsData().models.map((model) => model.id));

    data.models = data.models.filter((m) => m.id !== id);

    if (defaultIds.has(id) && !data.removedDefaultModelIds.includes(id)) {
      data.removedDefaultModelIds.push(id);
    }

    writeUserModelsData(data);

    const groups = loadGroups()
      .map((group) => ({
        ...group,
        modelIds: group.modelIds.filter((modelId) => modelId !== id),
      }))
      .filter((group) => group.modelIds.length > 0);
    saveGroups(groups);

    // 销毁对应的 View
    if (viewManager) viewManager.removeView(id);

    // 通知渲染进程更新
    mainWindow.webContents.send('models:updated', data.models);
    mainWindow.webContents.send('groups:updated', groups);
    return true;
  });

  // 分组列表
  ipcMain.handle('groups:list', () => {
    return loadGroups();
  });

  // 添加分组
  ipcMain.handle('groups:add', (_event, config) => {
    const rawConfig = config && typeof config === 'object' ? config : {};
    const name = typeof rawConfig.name === 'string' ? rawConfig.name.trim() : '';
    const requestedIds = Array.isArray(rawConfig.modelIds) ? rawConfig.modelIds.map(String) : [];
    const validIds = new Set(loadModels().map((model) => model.id));
    const modelIds = Array.from(new Set(requestedIds.filter((id) => validIds.has(id))));

    if (!name || modelIds.length === 0) {
      return null;
    }

    const groups = loadGroups();
    const newGroup = {
      id: generateGroupId(name),
      name,
      modelIds,
    };

    groups.push(newGroup);
    saveGroups(groups);
    mainWindow.webContents.send('groups:updated', groups);
    return newGroup;
  });

  // 删除分组
  ipcMain.handle('groups:remove', (_event, id) => {
    const groups = loadGroups().filter((group) => group.id !== id);
    saveGroups(groups);
    mainWindow.webContents.send('groups:updated', groups);
    return true;
  });

  // 切换视图
  ipcMain.handle('view:switch', async (_event, modelId) => {
    const models = loadModels();
    const model = models.find((m) => m.id === modelId);
    if (!model) {
      console.error(`[main] model not found: ${modelId}`);
      return false;
    }

    await viewManager.switchTo(modelId, model);

    // 通知渲染进程更新 active 状态
    mainWindow.webContents.send('view:switched', { id: modelId });
    return true;
  });

  // 刷新当前视图
  ipcMain.handle('view:refresh', () => {
    viewManager.refreshActive();
    return true;
  });

  // 结束指定模型的 WebView，用于释放内存；不删除模型配置和登录态
  ipcMain.handle('view:close', (_event, modelId) => {
    const state = viewManager.closeView(modelId);
    mainWindow.webContents.send('view:closed', { id: modelId, state });
    mainWindow.webContents.send('view:splitChanged', { enabled: state.splitMode, ids: state.splitIds });
    mainWindow.webContents.send('view:switched', { id: state.activeId });
    return state;
  });

  // 进入分屏模式
  ipcMain.handle('view:enterSplit', async (_event, modelIds) => {
    if (!Array.isArray(modelIds) || modelIds.length < 2 || modelIds.length > 3) {
      return false;
    }

    const models = loadModels();
    const selectedModels = modelIds
      .map((id) => models.find((model) => model.id === id))
      .filter(Boolean);

    if (selectedModels.length !== modelIds.length) {
      return false;
    }

    const ok = await viewManager.enterSplit(selectedModels);
    if (ok) {
      mainWindow.webContents.send('view:splitChanged', { enabled: true, ids: modelIds });
      mainWindow.webContents.send('view:switched', { id: selectedModels[0].id });
    }
    return ok;
  });

  // 退出分屏模式
  ipcMain.handle('view:exitSplit', () => {
    viewManager.exitSplit();
    mainWindow.webContents.send('view:splitChanged', { enabled: false, ids: [] });
    return true;
  });

  // 调整分屏列宽比例
  ipcMain.handle('view:setSplitRatios', (_event, ratios) => {
    return viewManager.setSplitRatios(ratios);
  });

  // 隐藏/显示所有 WebView（用于弹窗时避免遮挡 HTML 覆盖层）
  ipcMain.handle('view:setVisible', (_event, visible) => {
    if (visible) {
      viewManager.showActive();
    } else {
      viewManager.hideAll();
    }
    return true;
  });

  // 设置读取
  ipcMain.handle('settings:get', () => {
    return loadSettings();
  });

  // 设置保存
  ipcMain.handle('settings:set', async (_event, settings) => {
    const savedSettings = saveSettings(settings);
    await applyProxySettings(savedSettings);
    return savedSettings;
  });

  // 会话快照读取
  ipcMain.handle('snapshot:get', () => {
    return loadSnapshot();
  });
}

// ── 应用生命周期 ──

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    await applyProxySettings(loadSettings());

    createWindow();
    registerIPC();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
