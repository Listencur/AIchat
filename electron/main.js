'use strict';

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
  session,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { ViewManager } = require('./view-manager');
const { createPartitionForModelId, getModelCapabilities, getPersistPartition, isSameModelOrigin } = require('./model-policy');
const { resolveSiteAdapter } = require('./site-adapters');
const { StateStore } = require('./state-store');
const { guarded, isExpectedSender } = require('./ipc-guard');
const { ModelStore, normalizeModelIcon, isSupportedIconPath } = require('./model-store');
const { SessionManager } = require('./session-manager');
const { GroupStore, generateGroupId, normalizeGroupsData } = require('./group-store');
const { SnapshotService, normalizeSnapshot } = require('./snapshot-service');
const { MemoryManager } = require('./memory-manager');

/** @type {BrowserWindow} */
let mainWindow = null;
/** @type {ViewManager} */
let viewManager = null;
/** @type {BrowserWindow} */
let quickWindow = null;
/** @type {Tray} */
let tray = null;
let registeredShortcut = null;
let appIsQuitting = false;
let closeChoiceInProgress = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
const diskCachePath = path.join(app.getPath('temp'), 'ai-chat-hub-cache');
const DISK_CACHE_SIZE_BYTES = 200 * 1024 * 1024;
const isDevMode = process.argv.includes('--dev');
let quickStateStore = null;
let settingsStore = null;
let groupsStore = null;
let snapshotStore = null;
let quitFlushPromise = null;
let quitFlushComplete = false;

// ── 模块实例 ──
const defaultModelsPath = path.join(__dirname, '..', 'data', 'models.json');
const userModelsPath = path.join(app.getPath('userData'), 'models.json');
const userSettingsPath = path.join(app.getPath('userData'), 'settings.json');
const userGroupsPath = path.join(app.getPath('userData'), 'groups.json');
const userSnapshotPath = path.join(app.getPath('userData'), 'snapshot.json');
const userQuickStatePath = path.join(app.getPath('userData'), 'quick-state.json');
const userModelIconsDir = path.join(app.getPath('userData'), 'model-icons');
const appIconPath = path.join(__dirname, '..', 'assets', 'app-icon.ico');

const modelStore = new ModelStore({
  app, fs, path, defaultModelsPath, userModelsPath, userModelIconsDir,
});

const sessionManager = new SessionManager({
  app, session, fs, path, diskCachePath,
});

const groupStore = new GroupStore({
  app, fs, path, userGroupsPath,
});

const snapshotService = new SnapshotService({
  app, fs, path, userSnapshotPath, loadModelsFn: () => modelStore.list(),
});

const memoryManager = new MemoryManager({ app });

const DEFAULT_SETTINGS = {
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
const DEFAULT_QUICK_STATE = {
  draft: '',
  lastModelId: '',
  lastModelIds: [],
  submitMode: 'open',
  pinned: false,
  history: [],
};
const PROXY_URL_PATTERN = /^(https?|socks5?):\/\/.+/;
const QUICK_HISTORY_LIMIT = 10;
const QUICK_MODEL_LIMIT = 3;
const MODIFIER_LABELS = new Map([
  ['CTRL', 'Ctrl'], ['CONTROL', 'Ctrl'], ['CMDORCTRL', 'Ctrl'], ['COMMANDORCONTROL', 'Ctrl'],
  ['SHIFT', 'Shift'], ['ALT', 'Alt'], ['OPTION', 'Alt'], ['META', 'Meta'], ['SUPER', 'Meta'], ['WIN', 'Meta'],
]);
const KEY_LABELS = new Map([
  [' ', 'Space'], ['SPACEBAR', 'Space'], ['ESC', 'Esc'], ['ESCAPE', 'Esc'],
  ['RETURN', 'Enter'], ['ARROWUP', 'Up'], ['ARROWDOWN', 'Down'], ['ARROWLEFT', 'Left'], ['ARROWRIGHT', 'Right'],
]);

if (process.platform === 'win32') {
  app.setAppUserModelId('com.ai-chat-hub.desktop');
}

// 反自动化检测
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('disk-cache-dir', diskCachePath);
if (isDevMode) {
  app.commandLine.appendSwitch('disk-cache-size', '0');
  app.commandLine.appendSwitch('disable-http-cache');
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
} else {
  app.commandLine.appendSwitch('disk-cache-size', String(DISK_CACHE_SIZE_BYTES));
}

// ── 工具函数 ──

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.error(`[main] Failed to read JSON: ${filePath}`, error);
    return fallback;
  }
}

function loadModels() {
  return modelStore.list();
}

function saveModels(models) {
  modelStore._writeUserModelsData({
    ...modelStore._readUserModelsData(),
    models,
  });
}

function loadGroups() {
  return groupStore.load();
}

function saveGroups(groups) {
  return groupStore.save(groups);
}

function loadSnapshot() {
  return snapshotService.load();
}

function saveSnapshot(snapshot) {
  return snapshotService.save(snapshot);
}

// ── 设置相关 ──

function normalizeSettings(settings) {
  const rawSettings = settings && typeof settings === 'object' ? settings : {};
  const proxyMode = ['system', 'custom', 'direct'].includes(rawSettings.proxyMode)
    ? rawSettings.proxyMode
    : DEFAULT_SETTINGS.proxyMode;
  const proxyUrl = typeof rawSettings.proxyUrl === 'string' && PROXY_URL_PATTERN.test(rawSettings.proxyUrl.trim())
    ? rawSettings.proxyUrl.trim()
    : DEFAULT_SETTINGS.proxyUrl;
  const restoreSnapshot = rawSettings.restoreSnapshot === true;
  const shortcutEnabled = rawSettings.shortcutEnabled !== false;
  const shortcutAccelerator = normalizeShortcut(rawSettings.shortcutAccelerator) || DEFAULT_SETTINGS.shortcutAccelerator;
  const theme = rawSettings.theme === 'light' ? 'light' : 'dark';
  const closeAction = ['ask', 'minimize', 'quit'].includes(rawSettings.closeAction)
    ? rawSettings.closeAction
    : DEFAULT_SETTINGS.closeAction;
  const trayMemoryMode = ['keepAll', 'closeInactive', 'hibernateAll'].includes(rawSettings.trayMemoryMode)
    ? rawSettings.trayMemoryMode
    : DEFAULT_SETTINGS.trayMemoryMode;
  const maxAliveRaw = Number(rawSettings.maxAliveViews);
  const maxAliveViews = Number.isFinite(maxAliveRaw) && maxAliveRaw > 0
    ? Math.min(12, Math.floor(maxAliveRaw))
    : 0;
  const autoReclaimEnabled = rawSettings.autoReclaimEnabled === true;
  const pressureRaw = Number(rawSettings.memoryPressureMb);
  const memoryPressureMb = Number.isFinite(pressureRaw) && pressureRaw >= 500
    ? Math.min(16000, Math.floor(pressureRaw))
    : DEFAULT_SETTINGS.memoryPressureMb;
  const idleReclaimEnabled = rawSettings.idleReclaimEnabled !== false;
  const idleRaw = Number(rawSettings.inactiveViewTtlMinutes);
  const inactiveViewTtlMinutes = Number.isFinite(idleRaw) && idleRaw >= 0
    ? Math.min(1440, Math.floor(idleRaw))
    : DEFAULT_SETTINGS.inactiveViewTtlMinutes;
  return {
    proxyMode, proxyUrl, restoreSnapshot, shortcutEnabled, shortcutAccelerator,
    theme, closeAction, trayMemoryMode, maxAliveViews, autoReclaimEnabled,
    memoryPressureMb, idleReclaimEnabled, inactiveViewTtlMinutes,
  };
}

function normalizeShortcut(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split('+').map((part) => part.trim()).filter(Boolean);
  const modifiers = [];
  let key = '';
  for (const part of parts) {
    const upper = part.toUpperCase();
    const modifier = MODIFIER_LABELS.get(upper);
    if (modifier) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
      continue;
    }
    if (key) return null;
    if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(part)) {
      key = part.toUpperCase();
    } else if (/^[A-Z0-9]$/i.test(part)) {
      key = part.toUpperCase();
    } else {
      key = KEY_LABELS.get(upper) || part;
    }
  }
  if (modifiers.length === 0 || !key || modifiers.includes(key)) return null;
  return [...modifiers, key].join('+');
}

function toElectronAccelerator(shortcut) {
  const normalized = normalizeShortcut(shortcut) || DEFAULT_SETTINGS.shortcutAccelerator;
  return normalized.split('+').map((part) => (part === 'Ctrl' ? 'CommandOrControl' : part)).join('+');
}

function loadSettings() {
  if (settingsStore) return settingsStore.get();
  if (!fs.existsSync(userSettingsPath)) {
    saveSettings(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }
  return normalizeSettings(readJsonFile(userSettingsPath, DEFAULT_SETTINGS));
}

function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  if (settingsStore) {
    settingsStore.replace(normalized);
    settingsStore.schedulePersist(250);
    return normalized;
  }
  fs.writeFileSync(userSettingsPath, JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

function applyWebsiteTheme(settings) {
  const normalized = normalizeSettings(settings);
  nativeTheme.themeSource = normalized.theme === 'light' ? 'light' : 'dark';
  return normalized;
}

// ── 快速提问状态 ──

function normalizeQuickState(state) {
  const raw = state && typeof state === 'object' ? state : {};
  const history = Array.isArray(raw.history) ? raw.history : [];
  const lastModelIds = Array.isArray(raw.lastModelIds)
    ? raw.lastModelIds.map((id) => String(id)).filter(Boolean).filter((id, i, l) => l.indexOf(id) === i).slice(0, QUICK_MODEL_LIMIT)
    : [];
  const lastModelId = typeof raw.lastModelId === 'string' ? raw.lastModelId : '';
  return {
    draft: typeof raw.draft === 'string' ? raw.draft.slice(0, 10000) : '',
    lastModelId,
    lastModelIds: lastModelIds.length > 0 ? lastModelIds : (lastModelId ? [lastModelId] : []),
    submitMode: raw.submitMode === 'copy' ? 'copy' : 'open',
    pinned: raw.pinned === true,
    history: history
      .filter((item) => typeof item === 'string' && item.trim())
      .map((item) => item.trim())
      .filter((item, index, list) => list.indexOf(item) === index)
      .slice(0, QUICK_HISTORY_LIMIT),
  };
}

function loadQuickState() {
  if (quickStateStore) return quickStateStore.get();
  if (!fs.existsSync(userQuickStatePath)) {
    saveQuickState(DEFAULT_QUICK_STATE);
    return { ...DEFAULT_QUICK_STATE };
  }
  return normalizeQuickState(readJsonFile(userQuickStatePath, DEFAULT_QUICK_STATE));
}

function saveQuickState(state) {
  const normalized = normalizeQuickState(state);
  if (quickStateStore) {
    quickStateStore.replace(normalized);
    quickStateStore.schedulePersist(250).catch((error) => console.warn('[main] quick state persist failed:', error.message));
    return normalized;
  }
  fs.writeFileSync(userQuickStatePath, JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

function updateQuickState(patch) {
  if (quickStateStore) {
    const state = quickStateStore.patch(patch);
    quickStateStore.schedulePersist(250).catch((error) => console.warn('[main] quick state persist failed:', error.message));
    return state;
  }
  return saveQuickState({ ...loadQuickState(), ...(patch && typeof patch === 'object' ? patch : {}) });
}

function addQuickHistory(prompt, patch = {}) {
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  if (!text) return updateQuickState(patch);
  const current = loadQuickState();
  return updateQuickState({
    ...patch,
    history: [text, ...current.history.filter((item) => item !== text)].slice(0, QUICK_HISTORY_LIMIT),
  });
}

// ── StateStore 初始化 ──

async function initializeStateStores() {
  settingsStore = new StateStore(userSettingsPath, DEFAULT_SETTINGS, normalizeSettings);
  await settingsStore.load();
  quickStateStore = new StateStore(userQuickStatePath, DEFAULT_QUICK_STATE, normalizeQuickState);
  await quickStateStore.load();
  groupsStore = new StateStore(userGroupsPath, { groups: [] }, normalizeGroupsData);
  await groupsStore.load();
  groupStore.setStore(groupsStore);
  snapshotStore = new StateStore(userSnapshotPath, normalizeSnapshot(null), normalizeSnapshot);
  await snapshotStore.load();
  snapshotService.setStore(snapshotStore);
}

async function flushStateStores() {
  const stores = [settingsStore, quickStateStore, groupsStore, snapshotStore].filter(Boolean);
  await Promise.all(stores.map((store) => store.flush()));
}

// ── 图标 ──

function getAppIcon(size = null) {
  const icon = nativeImage.createFromPath(appIconPath);
  if (!icon.isEmpty()) {
    return size ? icon.resize({ width: size, height: size }) : icon;
  }
  return nativeImage.createEmpty();
}

// ── 代理 ──

function createProxyOptions(settings) {
  return sessionManager.createProxyOptions(settings);
}

async function applyProxySettings(settings) {
  const normalized = normalizeSettings(settings);
  await session.defaultSession.setProxy(createProxyOptions(normalized));
  if (viewManager) await viewManager.setProxyConfig(normalized);
  return normalized;
}

// ── 快照 ──

async function persistSessionSnapshot() {
  if (!viewManager || !loadSettings().restoreSnapshot) return null;
  const snapshot = await viewManager.snapshot();
  return saveSnapshot(snapshot);
}

// ── 清除数据 ──

async function clearAppCacheData() {
  const result = await sessionManager.clearAllCache(loadModels);
  return result;
}

async function clearAppLoginState() {
  const sessions = sessionManager.getManagedSessions(loadModels);
  let state = null;
  if (viewManager) state = viewManager.destroyAll();
  for (const item of sessions) {
    await sessionManager.clearSessionLoginData(item.ses);
  }
  const result = {
    ok: true,
    sessions: sessions.length,
    diskCacheCleared: sessionManager.clearTempDiskCache(),
    state: state || (viewManager ? viewManager.getState() : null),
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('view:splitChanged', { enabled: false, ids: [], direction: 'horizontal' });
    mainWindow.webContents.send('view:closed', { id: null, state: result.state });
  }
  return result;
}

// ── 内存 ──

function getMemorySummary() {
  return memoryManager.getMemorySummary(loadSettings(), viewManager);
}

function applyMemorySettings(settings) {
  const normalized = normalizeSettings(settings);
  if (viewManager) {
    const limitResult = viewManager.setMaxAliveViews(normalized.maxAliveViews);
    viewManager.setIdleReclaimSettings(normalized.idleReclaimEnabled, normalized.inactiveViewTtlMinutes);
    if (limitResult.closedIds.length > 0) {
      memoryManager.notifyViewStateAfterReclaim({ ...viewManager.getState(), closedIds: limitResult.closedIds, reason: 'limit' }, mainWindow);
    }
  }
  startOrStopMemoryWatch(normalized);
  return normalized;
}

function startOrStopMemoryWatch(settings) {
  memoryManager.stopWatch();
  memoryManager.startWatch(settings, {
    viewManager,
    mainWindow,
    appIsQuittingFn: () => appIsQuitting,
    getMemorySnapshotFn: (force) => memoryManager.getMemorySnapshot(force),
    notifyReclaimFn: (state) => memoryManager.notifyViewStateAfterReclaim(state, mainWindow),
    sendToMainWindowFn: (ch, data) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, data);
    },
  });
}

function applyTrayMemoryPolicy() {
  if (!viewManager) return null;
  return memoryManager.applyTrayMemoryPolicy(viewManager, loadSettings());
}

function notifyViewStateAfterReclaim(state) {
  memoryManager.notifyViewStateAfterReclaim(state, mainWindow);
}

// ── 窗口 ──

function createWindow() {
  const settings = applyWebsiteTheme(loadSettings());
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 800, minHeight: 600,
    icon: getAppIcon(),
    backgroundColor: settings.theme === 'light' ? '#eeeeee' : '#202020',
    title: '', frame: false, autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  viewManager = new ViewManager(mainWindow, settings, settings.restoreSnapshot ? loadSnapshot() : null, {
    maxAliveViews: settings.maxAliveViews,
    idleReclaimEnabled: settings.idleReclaimEnabled,
    inactiveViewTtlMinutes: settings.inactiveViewTtlMinutes,
  });
  applyMemorySettings(settings);
  mainWindow.on('resize', () => { if (viewManager) viewManager.resizeAll(); });
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('close', async (event) => {
    if (appIsQuitting) return;
    event.preventDefault();
    const settings = loadSettings();
    if (settings.closeAction === 'minimize') { minimizeToTray(); return; }
    if (settings.closeAction === 'quit') { await quitApplication(); return; }
    if (closeChoiceInProgress) return;
    closeChoiceInProgress = true;
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question', title: '关闭 AI 对话聚合', message: '关闭窗口时你想怎么处理？',
      detail: '最小化到托盘会保留后台运行和快捷键；退出程序会关闭所有窗口并释放进程。',
      buttons: ['最小化到托盘', '退出程序', '取消'], defaultId: 0, cancelId: 2,
      checkboxLabel: '记住我的选择，可在设置中修改', checkboxChecked: false, noLink: true,
    });
    closeChoiceInProgress = false;
    if (result.response === 0) {
      if (result.checkboxChecked) saveSettings({ ...settings, closeAction: 'minimize' });
      minimizeToTray(); return;
    }
    if (result.response === 1) {
      if (result.checkboxChecked) saveSettings({ ...settings, closeAction: 'quit' });
      await quitApplication();
    }
  });

  mainWindow.on('closed', () => {
    if (viewManager) viewManager.destroyAll();
    if (quickWindow && !quickWindow.isDestroyed()) quickWindow.close();
    mainWindow = null;
    viewManager = null;
  });
}

function createTray() {
  if (tray) return;
  tray = new Tray(getAppIcon(16));
  tray.setToolTip('AI 对话聚合');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: showMainWindow },
    { label: '快速提问', click: showQuickWindow },
    { type: 'separator' },
    { label: '退出程序', click: () => { quitApplication(); } },
  ]));
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
}

function minimizeToTray() {
  if (!mainWindow) return;
  createTray();
  const reclaimState = applyTrayMemoryPolicy();
  notifyViewStateAfterReclaim(reclaimState);
  mainWindow.hide();
}

async function quitApplication() {
  if (appIsQuitting) return;
  appIsQuitting = true;
  try {
    await persistSessionSnapshot();
    await flushStateStores();
    quitFlushComplete = true;
  } catch (error) {
    console.error('[main] Failed to save snapshot before quit', error);
  }
  if (quickWindow && !quickWindow.isDestroyed()) quickWindow.close();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  else app.quit();
}

function setQuickMenuOpen(open) {
  if (!quickWindow || quickWindow.isDestroyed()) return;
  const bounds = quickWindow.getBounds();
  const nextHeight = open === true ? 258 : 138;
  if (bounds.height !== nextHeight) quickWindow.setBounds({ ...bounds, height: nextHeight });
}

function createQuickWindow() {
  const quickState = loadQuickState();
  quickWindow = new BrowserWindow({
    width: 700, height: 138, minWidth: 560, minHeight: 138,
    show: false, frame: false, transparent: true, resizable: false,
    maximizable: false, minimizable: false, skipTaskbar: true,
    title: '快速提问', icon: getAppIcon(), backgroundColor: '#00000000',
    autoHideMenuBar: true, alwaysOnTop: quickState.pinned,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  quickWindow.loadFile(path.join(__dirname, '..', 'src', 'quick.html'));
  quickWindow.on('blur', () => {
    if (quickWindow && !quickWindow.webContents.isDevToolsOpened() && !loadQuickState().pinned) {
      setQuickMenuOpen(false); quickWindow.hide();
    }
  });
  quickWindow.on('closed', () => { quickWindow = null; });
}

function showMainWindow() {
  if (!mainWindow) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function showQuickWindow() {
  if (!quickWindow) createQuickWindow();
  const quickState = loadQuickState();
  setQuickMenuOpen(false);
  quickWindow.setAlwaysOnTop(quickState.pinned, 'floating');
  quickWindow.center();
  quickWindow.show();
  quickWindow.focus();
  quickWindow.webContents.send('quick:show');
}

function registerGlobalShortcut(settings) {
  if (registeredShortcut) { globalShortcut.unregister(registeredShortcut); registeredShortcut = null; }
  const normalized = normalizeSettings(settings);
  if (!normalized.shortcutEnabled) return { registered: false, accelerator: normalized.shortcutAccelerator, reason: 'disabled' };
  const accelerator = toElectronAccelerator(normalized.shortcutAccelerator);
  const ok = globalShortcut.register(accelerator, showQuickWindow);
  if (!ok) {
    console.error(`[main] Failed to register shortcut: ${normalized.shortcutAccelerator}`);
    return { registered: false, accelerator: normalized.shortcutAccelerator, reason: 'register-failed' };
  }
  registeredShortcut = accelerator;
  return { registered: true, accelerator: normalized.shortcutAccelerator };
}

async function submitQuickAction(payload) {
  const rawPayload = payload && typeof payload === 'object' ? payload : {};
  const modelId = typeof rawPayload.modelId === 'string' ? rawPayload.modelId : '';
  const requestedIds = Array.isArray(rawPayload.modelIds)
    ? rawPayload.modelIds.map((id) => String(id)).filter(Boolean) : [];
  const prompt = typeof rawPayload.prompt === 'string' ? rawPayload.prompt.trim() : '';
  const models = loadModels();
  const ids = (requestedIds.length > 0 ? requestedIds : [modelId])
    .filter((id, index, list) => id && list.indexOf(id) === index).slice(0, QUICK_MODEL_LIMIT);
  const selectedModels = ids.map((id) => models.find((item) => item.id === id)).filter(Boolean);
  const targetModels = selectedModels.length > 0 ? selectedModels : (models[0] ? [models[0]] : []);
  const primaryModel = targetModels[0] || null;
  if (quickWindow) quickWindow.hide();
  showMainWindow();
  if (prompt) clipboard.writeText(prompt);
  updateQuickState({
    draft: '',
    lastModelId: primaryModel ? primaryModel.id : modelId,
    lastModelIds: targetModels.map((model) => model.id),
    submitMode: 'open',
  });
  if (targetModels.length === 0 || !viewManager) return { ok: false, mode: 'open' };
  const results = [];
  const targetIds = targetModels.map((model) => model.id);
  if (targetModels.length >= 2) {
    const splitResult = await viewManager.enterSplit(targetModels, 'horizontal');
    if (splitResult && splitResult.ok) {
      if (Array.isArray(splitResult.closedIds) && splitResult.closedIds.length > 0) {
        notifyViewStateAfterReclaim({ ...viewManager.getState(), closedIds: splitResult.closedIds });
      }
      mainWindow.webContents.send('view:splitChanged', { enabled: true, ids: targetIds, direction: 'horizontal' });
      mainWindow.webContents.send('view:switched', { id: primaryModel.id });
    }
  } else if (primaryModel) {
    mainWindow.webContents.send('view:switched', { id: primaryModel.id });
  }
  const submitToModel = async (model) => {
    if (viewManager && !viewManager.isViewLoaded(model.id)) {
      return { modelId: model.id, ok: false, reason: 'view-not-loaded', adapterId: resolveSiteAdapter(model, model.url).id };
    }
    const adapter = resolveSiteAdapter(model, model.url);
    if (!adapter.capabilities.canAutoSend) {
      const filled = await viewManager.fillPromptOnly(model.id, model, prompt, { preserveLayout: targetModels.length >= 2 });
      return { modelId: model.id, ok: filled.ok, action: filled.ok ? 'filled-manual-send' : 'opened', requiresManualSend: true, adapterId: adapter.id, submitResult: filled };
    }
    const submitResult = await viewManager.submitPrompt(model.id, model, prompt, { preserveLayout: targetModels.length >= 2 });
    return { modelId: model.id, ok: submitResult.ok, action: submitResult.ok ? (submitResult.requiresManualSend ? 'filled-manual-send' : 'sent') : 'failed', requiresManualSend: submitResult.requiresManualSend === true, adapterId: adapter.id, submitResult };
  };
  results.push(...await Promise.all(targetModels.map(submitToModel)));
  if (targetModels.length >= 2) {
    mainWindow.webContents.send('view:splitChanged', { enabled: true, ids: targetIds, direction: 'horizontal' });
    mainWindow.webContents.send('view:switched', { id: primaryModel.id });
  }
  return { ok: results.some((r) => r.ok), mode: 'open', modelId: primaryModel.id, modelIds: targetIds, results };
}

// ── IPC 处理器 ──

function registerIPC() {
  const fromMain = (event) => isExpectedSender(event, mainWindow, 'index.html');
  const fromQuick = (event) => isExpectedSender(event, quickWindow, 'quick.html');
  const fromShell = (event) => fromMain(event) || fromQuick(event);
  const handleMain = (channel, handler, fallback = null) => ipcMain.handle(channel, guarded(handler, fromMain, fallback));
  const handleQuick = (channel, handler, fallback = null) => ipcMain.handle(channel, guarded(handler, fromQuick, fallback));
  const handleShell = (channel, handler, fallback = null) => ipcMain.handle(channel, guarded(handler, fromShell, fallback));

  // 模型列表
  handleShell('models:list', () => loadModels(), []);

  // 添加模型
  handleMain('models:add', (_event, config) => {
    const newModel = modelStore.add(config);
    mainWindow.webContents.send('models:updated', loadModels());
    return newModel;
  });

  // 编辑模型
  handleMain('models:update', (_event, id, config) => {
    const updated = modelStore.update(id, config);
    if (!updated) return null;
    if (viewManager) viewManager.updateModel(updated);
    mainWindow.webContents.send('models:updated', loadModels());
    return updated;
  });

  // 选择本地图标
  handleMain('models:selectIcon', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择模型图标',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'ico', 'svg'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    if (!isSupportedIconPath(filePath)) return null;
    return { localIconPath: filePath, iconUrl: pathToFileURL(filePath).href, name: path.basename(filePath) };
  });

  // 模型排序
  handleMain('models:reorder', (_event, orderedIds) => {
    const nextModels = modelStore.reorder(orderedIds);
    mainWindow.webContents.send('models:updated', nextModels);
    return nextModels;
  });

  // 删除模型
  handleMain('models:remove', async (_event, id) => {
    const modelId = String(id || '');
    const model = loadModels().find((item) => item.id === modelId);
    if (!model) return { ok: false, reason: 'not-found' };

    let viewState = null;
    if (viewManager) viewState = viewManager.removeView(modelId);

    const sessionResult = await sessionManager.removePartitionData(model);
    const iconsRemoved = modelStore.removeLocalIcons(modelId);
    snapshotService.purgeModelEntries(modelId);
    modelStore.remove(modelId);
    groupStore.purgeModelReferences(modelId);

    const models = loadModels();
    const groups = loadGroups();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('models:updated', models);
      mainWindow.webContents.send('groups:updated', groups);
      if (viewState) {
        mainWindow.webContents.send('view:closed', { id: modelId, state: viewState });
        mainWindow.webContents.send('view:splitChanged', { enabled: viewState.splitMode, ids: viewState.splitIds, direction: viewState.splitDirection });
        mainWindow.webContents.send('view:switched', { id: viewState.activeId });
      }
    }
    return {
      ok: true, modelId,
      partition: sessionResult.partition || getPersistPartition(model),
      diskRemoved: sessionResult.diskRemoved === true,
      iconsRemoved,
    };
  });

  // 分组
  handleMain('groups:list', () => loadGroups(), []);
  handleMain('groups:add', (_event, config) => {
    const rawConfig = config && typeof config === 'object' ? config : {};
    const name = typeof rawConfig.name === 'string' ? rawConfig.name.trim() : '';
    const requestedIds = Array.isArray(rawConfig.modelIds) ? rawConfig.modelIds.map(String) : [];
    const validIds = new Set(loadModels().map((m) => m.id));
    const modelIds = Array.from(new Set(requestedIds.filter((id) => validIds.has(id))));
    if (!name || modelIds.length === 0) return null;
    const groups = loadGroups();
    const newGroup = { id: generateGroupId(name), name, modelIds };
    groups.push(newGroup);
    saveGroups(groups);
    mainWindow.webContents.send('groups:updated', groups);
    return newGroup;
  });
  handleMain('groups:remove', (_event, id) => {
    const groups = loadGroups().filter((g) => g.id !== id);
    saveGroups(groups);
    mainWindow.webContents.send('groups:updated', groups);
    return true;
  });

  // 视图
  handleMain('view:switch', async (_event, modelId) => {
    const models = loadModels();
    const model = models.find((m) => m.id === modelId);
    if (!model) { console.error(`[main] model not found: ${modelId}`); return { ok: false, reason: 'not-found' }; }
    const closedIds = await viewManager.switchTo(modelId, model);
    if (Array.isArray(closedIds) && closedIds.length > 0) {
      const state = viewManager.getState();
      closedIds.forEach((id) => {
        mainWindow.webContents.send('view:closed', { id, state: { ...state, closedIds } });
      });
    }
    mainWindow.webContents.send('view:switched', { id: modelId });
    return { ok: true };
  });
  handleMain('view:refresh', () => { viewManager.refreshActive(); return true; });
  handleMain('view:refreshModel', (_event, modelId) => viewManager.refreshView(modelId));
  handleMain('view:getStatus', () => {
    const status = viewManager.getStatus(loadModels(), memoryManager.getProcessMemoryByPid());
    return { ...status, memory: getMemorySummary() };
  }, { models: [], loadedIds: [], splitIds: [], splitRatios: [], splitMode: false, activeId: null, memory: {} });
  handleMain('memory:getSummary', () => getMemorySummary(), {});

  handleMain('view:close', (_event, modelId) => {
    const state = viewManager.closeView(modelId);
    mainWindow.webContents.send('view:closed', { id: modelId, state });
    mainWindow.webContents.send('view:splitChanged', { enabled: state.splitMode, ids: state.splitIds, direction: state.splitDirection });
    mainWindow.webContents.send('view:switched', { id: state.activeId });
    return state;
  });
  handleMain('view:closeInactive', () => {
    const state = viewManager.closeInactiveViews();
    state.closedIds.forEach((id) => { mainWindow.webContents.send('view:closed', { id, state }); });
    mainWindow.webContents.send('view:splitChanged', { enabled: state.splitMode, ids: state.splitIds, direction: state.splitDirection });
    mainWindow.webContents.send('view:switched', { id: state.activeId });
    return state;
  });
  handleMain('view:enterSplit', async (_event, modelIds, direction = 'horizontal') => {
    if (!Array.isArray(modelIds) || modelIds.length < 2 || modelIds.length > 3) return { ok: false, reason: 'invalid-models' };
    const splitDirection = direction === 'vertical' ? 'vertical' : 'horizontal';
    const models = loadModels();
    const selectedModels = modelIds.map((id) => models.find((m) => m.id === id)).filter(Boolean);
    if (selectedModels.length !== modelIds.length) return { ok: false, reason: 'model-not-found' };
    const splitResult = await viewManager.enterSplit(selectedModels, splitDirection);
    if (splitResult && splitResult.ok) {
      if (Array.isArray(splitResult.closedIds) && splitResult.closedIds.length > 0) {
        notifyViewStateAfterReclaim({ ...viewManager.getState(), closedIds: splitResult.closedIds });
      }
      mainWindow.webContents.send('view:splitChanged', { enabled: true, ids: modelIds, direction: splitDirection });
      mainWindow.webContents.send('view:switched', { id: selectedModels[0].id });
      return { ok: true };
    }
    return { ok: false, reason: 'split-failed' };
  });
  handleMain('view:exitSplit', () => {
    viewManager.exitSplit();
    mainWindow.webContents.send('view:splitChanged', { enabled: false, ids: [], direction: 'horizontal' });
    return { ok: true };
  });
  handleMain('view:setSplitRatios', (_event, ratios) => viewManager.setSplitRatios(ratios));
  handleMain('view:setVisible', (_event, visible) => {
    if (visible) viewManager.showActive(); else viewManager.hideAll();
    return true;
  });
  handleMain('view:setSidebarCollapsed', (_event, collapsed) => {
    if (viewManager) viewManager.setSidebarCollapsed(collapsed === true);
    return true;
  });

  // 设置
  handleMain('settings:get', () => loadSettings());
  handleMain('settings:set', async (_event, settings) => {
    const savedSettings = applyWebsiteTheme(saveSettings(settings));
    await applyProxySettings(savedSettings);
    applyMemorySettings(savedSettings);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(savedSettings.theme === 'light' ? '#eeeeee' : '#202020');
    }
    const shortcutStatus = registerGlobalShortcut(savedSettings);
    if (quickWindow) quickWindow.webContents.send('settings:updated', savedSettings);
    return { ...savedSettings, shortcutStatus };
  });
  handleMain('settings:clearCache', () => clearAppCacheData());
  handleMain('settings:clearLoginState', () => clearAppLoginState());

  // 快照
  handleMain('snapshot:get', () => loadSnapshot());

  // 快速提问
  handleQuick('quick:submit', async (_event, payload) => submitQuickAction(payload));
  handleQuick('quick:stateGet', () => loadQuickState());
  handleQuick('quick:stateSet', (_event, patch) => {
    const state = updateQuickState(patch);
    if (quickWindow && typeof patch === 'object' && patch && Object.hasOwn(patch, 'pinned')) {
      quickWindow.setAlwaysOnTop(state.pinned, 'floating');
    }
    return state;
  });
  handleQuick('quick:setPinned', (_event, pinned) => {
    const state = updateQuickState({ pinned: pinned === true });
    if (quickWindow) quickWindow.setAlwaysOnTop(state.pinned, 'floating');
    return state;
  });
  handleQuick('quick:hide', () => {
    if (quickWindow) { setQuickMenuOpen(false); quickWindow.hide(); }
    return true;
  });
  handleQuick('quick:setMenuOpen', (_event, open) => { setQuickMenuOpen(open); return true; });

  // 窗口
  handleMain('window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
    return true;
  });
  handleMain('window:toggleMaximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (mainWindow.isMaximized()) { mainWindow.unmaximize(); return false; }
    mainWindow.maximize();
    return true;
  });
  handleMain('window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    return true;
  });
}

// ── 应用生命周期 ──

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => { showMainWindow(); });
  app.whenReady().then(async () => {
    await initializeStateStores();
    const settings = applyWebsiteTheme(loadSettings());
    await applyProxySettings(settings);
    Menu.setApplicationMenu(null);
    createWindow();
    createTray();
    registerIPC();
    registerGlobalShortcut(settings);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (appIsQuitting && process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', (event) => {
    if (quitFlushComplete) return;
    if (quitFlushPromise) { event.preventDefault(); return; }
    appIsQuitting = true;
    memoryManager.stopWatch();
    globalShortcut.unregisterAll();
    if (tray) { tray.destroy(); tray = null; }
    event.preventDefault();
    quitFlushPromise = flushStateStores()
      .catch((error) => console.warn('[main] state flush failed:', error.message))
      .finally(() => { quitFlushPromise = null; app.quit(); });
  });
}
