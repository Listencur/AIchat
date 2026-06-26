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
const DEFAULT_SETTINGS = {
  proxyMode: 'system',
  proxyUrl: 'http://127.0.0.1:7897',
};
const PROXY_URL_PATTERN = /^(https?|socks5?):\/\/.+/;

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

  return { proxyMode, proxyUrl };
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
      models.push({ ...existing, ...defaultModel });
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
  viewManager = new ViewManager(mainWindow, loadSettings());

  // 窗口 resize 时重新计算所有 View 的 bounds
  mainWindow.on('resize', () => {
    if (viewManager) viewManager.resizeAll();
  });

  // 开发模式自动打开 DevTools
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

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

  // 删除模型
  ipcMain.handle('models:remove', (_event, id) => {
    const data = readUserModelsData();
    const defaultIds = new Set(readDefaultModelsData().models.map((model) => model.id));

    data.models = data.models.filter((m) => m.id !== id);

    if (defaultIds.has(id) && !data.removedDefaultModelIds.includes(id)) {
      data.removedDefaultModelIds.push(id);
    }

    writeUserModelsData(data);

    // 销毁对应的 View
    if (viewManager) viewManager.removeView(id);

    // 通知渲染进程更新
    mainWindow.webContents.send('models:updated', data.models);
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
