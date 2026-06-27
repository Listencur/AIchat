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
const userQuickStatePath = path.join(app.getPath('userData'), 'quick-state.json');
const userModelIconsDir = path.join(app.getPath('userData'), 'model-icons');
const appIconPath = path.join(__dirname, '..', 'assets', 'app-icon.ico');
const DEFAULT_SETTINGS = {
  proxyMode: 'system',
  proxyUrl: 'http://127.0.0.1:7897',
  restoreSnapshot: false,
  shortcutEnabled: true,
  shortcutAccelerator: 'Ctrl+Shift+Space',
  theme: 'dark',
  closeAction: 'ask',
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
const SNAPSHOT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
const QUICK_HISTORY_LIMIT = 10;
const QUICK_MODEL_LIMIT = 3;
const MODIFIER_LABELS = new Map([
  ['CTRL', 'Ctrl'],
  ['CONTROL', 'Ctrl'],
  ['CMDORCTRL', 'Ctrl'],
  ['COMMANDORCONTROL', 'Ctrl'],
  ['SHIFT', 'Shift'],
  ['ALT', 'Alt'],
  ['OPTION', 'Alt'],
  ['META', 'Meta'],
  ['SUPER', 'Meta'],
  ['WIN', 'Meta'],
]);
const KEY_LABELS = new Map([
  [' ', 'Space'],
  ['SPACEBAR', 'Space'],
  ['ESC', 'Esc'],
  ['ESCAPE', 'Esc'],
  ['RETURN', 'Enter'],
  ['ARROWUP', 'Up'],
  ['ARROWDOWN', 'Down'],
  ['ARROWLEFT', 'Left'],
  ['ARROWRIGHT', 'Right'],
]);
const LOCAL_ICON_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.svg']);

if (process.platform === 'win32') {
  app.setAppUserModelId('com.ai-chat-hub.desktop');
}

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
  const shortcutEnabled = rawSettings.shortcutEnabled !== false;
  const shortcutAccelerator = normalizeShortcut(rawSettings.shortcutAccelerator) || DEFAULT_SETTINGS.shortcutAccelerator;
  const theme = rawSettings.theme === 'light' ? 'light' : 'dark';
  const closeAction = ['ask', 'minimize', 'quit'].includes(rawSettings.closeAction)
    ? rawSettings.closeAction
    : DEFAULT_SETTINGS.closeAction;

  return { proxyMode, proxyUrl, restoreSnapshot, shortcutEnabled, shortcutAccelerator, theme, closeAction };
}

function normalizeShortcut(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const parts = value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  const modifiers = [];
  let key = '';

  for (const part of parts) {
    const upper = part.toUpperCase();
    const modifier = MODIFIER_LABELS.get(upper);
    if (modifier) {
      if (!modifiers.includes(modifier)) {
        modifiers.push(modifier);
      }
      continue;
    }

    if (key) {
      return null;
    }

    if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(part)) {
      key = part.toUpperCase();
    } else if (/^[A-Z0-9]$/i.test(part)) {
      key = part.toUpperCase();
    } else {
      key = KEY_LABELS.get(upper) || part;
    }
  }

  if (modifiers.length === 0 || !key || modifiers.includes(key)) {
    return null;
  }

  return [...modifiers, key].join('+');
}

function toElectronAccelerator(shortcut) {
  const normalized = normalizeShortcut(shortcut) || DEFAULT_SETTINGS.shortcutAccelerator;
  return normalized
    .split('+')
    .map((part) => (part === 'Ctrl' ? 'CommandOrControl' : part))
    .join('+');
}

function getAppIcon(size = null) {
  const icon = nativeImage.createFromPath(appIconPath);
  if (!icon.isEmpty()) {
    return size ? icon.resize({ width: size, height: size }) : icon;
  }

  return nativeImage.createEmpty();
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

function applyWebsiteTheme(settings) {
  const normalized = normalizeSettings(settings);
  nativeTheme.themeSource = normalized.theme === 'light' ? 'light' : 'dark';
  return normalized;
}

function normalizeQuickState(state) {
  const raw = state && typeof state === 'object' ? state : {};
  const history = Array.isArray(raw.history) ? raw.history : [];
  const lastModelIds = Array.isArray(raw.lastModelIds)
    ? raw.lastModelIds
      .map((id) => String(id))
      .filter(Boolean)
      .filter((id, index, list) => list.indexOf(id) === index)
      .slice(0, QUICK_MODEL_LIMIT)
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
  if (!fs.existsSync(userQuickStatePath)) {
    saveQuickState(DEFAULT_QUICK_STATE);
    return { ...DEFAULT_QUICK_STATE };
  }

  return normalizeQuickState(readJsonFile(userQuickStatePath, DEFAULT_QUICK_STATE));
}

function saveQuickState(state) {
  const normalized = normalizeQuickState(state);
  fs.writeFileSync(userQuickStatePath, JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

function updateQuickState(patch) {
  return saveQuickState({
    ...loadQuickState(),
    ...(patch && typeof patch === 'object' ? patch : {}),
  });
}

function addQuickHistory(prompt, patch = {}) {
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  const current = loadQuickState();

  if (!text) {
    return updateQuickState(patch);
  }

  return saveQuickState({
    ...current,
    ...patch,
    history: [text, ...current.history.filter((item) => item !== text)].slice(0, QUICK_HISTORY_LIMIT),
  });
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

function buildFaviconUrl(url) {
  if (typeof url !== 'string' || !url) {
    return '';
  }

  try {
    const parsed = new URL(url);
    return `${parsed.origin}/favicon.ico`;
  } catch {
    return '';
  }
}

function isSupportedIconPath(filePath) {
  if (typeof filePath !== 'string' || !filePath) {
    return false;
  }

  return LOCAL_ICON_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function copyLocalModelIcon(modelId, sourcePath) {
  if (!isSupportedIconPath(sourcePath) || !fs.existsSync(sourcePath)) {
    return '';
  }

  const stat = fs.statSync(sourcePath);
  if (!stat.isFile()) {
    return '';
  }

  fs.mkdirSync(userModelIconsDir, { recursive: true });
  const ext = path.extname(sourcePath).toLowerCase();
  const safeId = String(modelId).replace(/[^a-z0-9_-]/gi, '-');
  const targetPath = path.join(userModelIconsDir, `${safeId}-${Date.now()}${ext}`);
  fs.copyFileSync(sourcePath, targetPath);
  return pathToFileURL(targetPath).href;
}

function resolveModelIconUrl(rawConfig, modelId, url) {
  if (rawConfig.localIconPath) {
    const copiedUrl = copyLocalModelIcon(modelId, rawConfig.localIconPath);
    if (copiedUrl) {
      return copiedUrl;
    }
  }

  if (typeof rawConfig.iconUrl === 'string' && rawConfig.iconUrl.trim()) {
    return rawConfig.iconUrl.trim();
  }

  return buildFaviconUrl(url);
}

function normalizeModelIcon(model) {
  return {
    ...model,
    icon: model.icon || '🤖',
    iconUrl: typeof model.iconUrl === 'string' && model.iconUrl
      ? model.iconUrl
      : buildFaviconUrl(model.url),
  };
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
      splitDirection: 'horizontal',
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
    splitDirection: raw.splitDirection === 'vertical' ? 'vertical' : 'horizontal',
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
    models: defaultData.models.map(normalizeModelIcon),
    removedDefaultModelIds: [],
  };
}

function syncUserModelsData(userData, defaultData) {
  const userModels = Array.isArray(userData.models) ? userData.models : [];
  const removedDefaultModelIds = Array.isArray(userData.removedDefaultModelIds)
    ? userData.removedDefaultModelIds
    : [];

  const defaultIds = new Set(defaultData.models.map((model) => model.id));
  const defaultById = new Map(defaultData.models.map((model) => [model.id, model]));
  const removedSet = new Set(removedDefaultModelIds);
  const seenIds = new Set();

  const models = [];

  for (const userModel of userModels) {
    if (!userModel || !userModel.id || seenIds.has(userModel.id)) {
      continue;
    }

    if (defaultIds.has(userModel.id)) {
      if (removedSet.has(userModel.id)) {
        continue;
      }

      const defaultModel = defaultById.get(userModel.id);
      models.push(normalizeModelIcon({
        ...defaultModel,
        ...userModel,
        id: defaultModel.id,
        partition: userModel.partition || defaultModel.partition,
      }));
      seenIds.add(userModel.id);
      continue;
    }

    models.push(normalizeModelIcon(userModel));
    seenIds.add(userModel.id);
  }

  for (const defaultModel of defaultData.models) {
    if (!seenIds.has(defaultModel.id) && !removedSet.has(defaultModel.id)) {
      models.push(normalizeModelIcon(defaultModel));
      seenIds.add(defaultModel.id);
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

function sanitizeFileName(name) {
  const value = typeof name === 'string' && name.trim() ? name.trim() : 'AI对话导出';
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').slice(0, 80);
}

function formatDateForFile(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join('');
}

function normalizeExportText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildConversationMarkdown(exportData) {
  const exportedAt = new Date().toLocaleString('zh-CN', { hour12: false });
  const title = normalizeExportText(exportData.title) || '未命名对话';
  const modelName = normalizeExportText(exportData.modelName) || '未知模型';
  const sourceUrl = normalizeExportText(exportData.url) || '';
  const messages = Array.isArray(exportData.messages) ? exportData.messages : [];
  const lines = [`# ${title}`, '', `- 模型：${modelName}`];

  if (sourceUrl) {
    lines.push(`- 来源：${sourceUrl}`);
  }

  lines.push(`- 导出时间：${exportedAt}`, '', '---', '');

  if (messages.length > 0) {
    messages.forEach((message, index) => {
      const role = normalizeExportText(message.role) || `内容 ${index + 1}`;
      const content = normalizeExportText(message.content);
      if (!content) return;

      lines.push(`## ${role}`);
      lines.push('');
      lines.push(content);
      lines.push('');
    });
  } else {
    const text = normalizeExportText(exportData.text);
    if (text) {
      lines.push('## 页面正文');
      lines.push('');
      lines.push(text);
      lines.push('');
    }
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function hasExportContent(exportData) {
  const messages = Array.isArray(exportData.messages) ? exportData.messages : [];
  return messages.some((message) => normalizeExportText(message.content))
    || Boolean(normalizeExportText(exportData.text));
}

function getProcessMemoryByPid() {
  const memoryByPid = new Map();

  app.getAppMetrics().forEach((metric) => {
    const workingSetSize = metric && metric.memory ? Number(metric.memory.workingSetSize) : 0;
    if (!metric.pid || !workingSetSize) {
      return;
    }

    memoryByPid.set(metric.pid, Math.round((workingSetSize / 1024) * 10) / 10);
  });

  return memoryByPid;
}

// ── 窗口创建 ──

function createWindow() {
  const settings = applyWebsiteTheme(loadSettings());

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: getAppIcon(),
    backgroundColor: settings.theme === 'light' ? '#eeeeee' : '#202020',
    title: '',
    frame: false,
    autoHideMenuBar: true,
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
  viewManager = new ViewManager(mainWindow, settings, settings.restoreSnapshot ? loadSnapshot() : null);

  // 窗口 resize 时重新计算所有 View 的 bounds
  mainWindow.on('resize', () => {
    if (viewManager) viewManager.resizeAll();
  });

  // 开发模式自动打开 DevTools
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('close', async (event) => {
    if (appIsQuitting) return;

    event.preventDefault();

    const settings = loadSettings();
    if (settings.closeAction === 'minimize') {
      minimizeToTray();
      return;
    }

    if (settings.closeAction === 'quit') {
      await quitApplication();
      return;
    }

    if (closeChoiceInProgress) {
      return;
    }

    closeChoiceInProgress = true;
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: '关闭 AI 对话聚合',
      message: '关闭窗口时你想怎么处理？',
      detail: '最小化到托盘会保留后台运行和快捷键；退出程序会关闭所有窗口并释放进程。',
      buttons: ['最小化到托盘', '退出程序', '取消'],
      defaultId: 0,
      cancelId: 2,
      checkboxLabel: '记住我的选择，可在设置中修改',
      checkboxChecked: false,
      noLink: true,
    });
    closeChoiceInProgress = false;

    if (result.response === 0) {
      if (result.checkboxChecked) {
        saveSettings({ ...settings, closeAction: 'minimize' });
      }
      minimizeToTray();
      return;
    }

    if (result.response === 1) {
      if (result.checkboxChecked) {
        saveSettings({ ...settings, closeAction: 'quit' });
      }
      await quitApplication();
    }
  });

  mainWindow.on('closed', () => {
    if (viewManager) viewManager.destroyAll();
    if (quickWindow && !quickWindow.isDestroyed()) {
      quickWindow.close();
    }
    mainWindow = null;
    viewManager = null;
  });
}

function createTray() {
  if (tray) {
    return;
  }

  tray = new Tray(getAppIcon(16));
  tray.setToolTip('AI 对话聚合');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: showMainWindow,
    },
    {
      label: '快速提问',
      click: showQuickWindow,
    },
    { type: 'separator' },
    {
      label: '退出程序',
      click: () => {
        quitApplication();
      },
    },
  ]));

  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
}

function minimizeToTray() {
  if (!mainWindow) return;

  createTray();
  mainWindow.hide();
}

async function quitApplication() {
  if (appIsQuitting) return;

  appIsQuitting = true;

  try {
    await persistSessionSnapshot();
  } catch (error) {
    console.error('[main] Failed to save snapshot before quit', error);
  }

  if (quickWindow && !quickWindow.isDestroyed()) {
    quickWindow.close();
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  } else {
    app.quit();
  }
}

function setQuickMenuOpen(open) {
  if (!quickWindow || quickWindow.isDestroyed()) {
    return;
  }

  const bounds = quickWindow.getBounds();
  const nextHeight = open === true ? 270 : 150;
  if (bounds.height !== nextHeight) {
    quickWindow.setBounds({ ...bounds, height: nextHeight });
  }
}

function createQuickWindow() {
  const quickState = loadQuickState();

  quickWindow = new BrowserWindow({
    width: 700,
    height: 150,
    minWidth: 560,
    minHeight: 140,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    title: '快速提问',
    icon: getAppIcon(),
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    alwaysOnTop: quickState.pinned,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  quickWindow.loadFile(path.join(__dirname, '..', 'src', 'quick.html'));

  quickWindow.on('blur', () => {
    if (quickWindow && !quickWindow.webContents.isDevToolsOpened() && !loadQuickState().pinned) {
      setQuickMenuOpen(false);
      quickWindow.hide();
    }
  });

  quickWindow.on('closed', () => {
    quickWindow = null;
  });
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function showQuickWindow() {
  if (!quickWindow) {
    createQuickWindow();
  }

  const quickState = loadQuickState();
  setQuickMenuOpen(false);
  quickWindow.setAlwaysOnTop(quickState.pinned, 'floating');
  quickWindow.center();
  quickWindow.show();
  quickWindow.focus();
  quickWindow.webContents.send('quick:show');
}

function registerGlobalShortcut(settings) {
  if (registeredShortcut) {
    globalShortcut.unregister(registeredShortcut);
    registeredShortcut = null;
  }

  const normalized = normalizeSettings(settings);
  if (!normalized.shortcutEnabled) {
    return { registered: false, accelerator: normalized.shortcutAccelerator, reason: 'disabled' };
  }

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
    ? rawPayload.modelIds.map((id) => String(id)).filter(Boolean)
    : [];
  const prompt = typeof rawPayload.prompt === 'string' ? rawPayload.prompt.trim() : '';
  const models = loadModels();
  const ids = (requestedIds.length > 0 ? requestedIds : [modelId])
    .filter((id, index, list) => id && list.indexOf(id) === index)
    .slice(0, QUICK_MODEL_LIMIT);
  const selectedModels = ids
    .map((id) => models.find((item) => item.id === id))
    .filter(Boolean);
  const targetModels = selectedModels.length > 0 ? selectedModels : (models[0] ? [models[0]] : []);
  const primaryModel = targetModels[0] || null;

  if (prompt) {
    clipboard.writeText(prompt);
  }

  updateQuickState({
    draft: '',
    lastModelId: primaryModel ? primaryModel.id : modelId,
    lastModelIds: targetModels.map((model) => model.id),
    submitMode: 'open',
  });

  if (quickWindow) {
    quickWindow.hide();
  }

  showMainWindow();

  if (targetModels.length === 0 || !viewManager) {
    return { ok: false, mode: 'open' };
  }

  const results = [];
  const targetIds = targetModels.map((model) => model.id);
  if (targetModels.length >= 2) {
    const ok = await viewManager.enterSplit(targetModels, 'horizontal');
    if (ok) {
      mainWindow.webContents.send('view:splitChanged', { enabled: true, ids: targetIds, direction: 'horizontal' });
      mainWindow.webContents.send('view:switched', { id: primaryModel.id });
    }
  }

  for (const model of targetModels) {
    const submitResult = await viewManager.submitPrompt(model.id, model, prompt, {
      preserveLayout: targetModels.length >= 2,
    });
    if (targetModels.length === 1) {
      mainWindow.webContents.send('view:switched', { id: model.id });
    }
    results.push({ modelId: model.id, ok: submitResult.ok, submitResult });
  }

  if (targetModels.length >= 2) {
    mainWindow.webContents.send('view:splitChanged', { enabled: true, ids: targetIds, direction: 'horizontal' });
    mainWindow.webContents.send('view:switched', { id: primaryModel.id });
  }

  return {
    ok: results.some((result) => result.ok),
    mode: 'open',
    modelId: primaryModel.id,
    modelIds: targetIds,
    results,
  };
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
    const rawConfig = config && typeof config === 'object' ? config : {};
    const id = generateModelId(rawConfig.name);
    const newModel = {
      id,
      name: rawConfig.name,
      url: rawConfig.url,
      icon: rawConfig.icon || '🤖',
      iconUrl: resolveModelIconUrl(rawConfig, id, rawConfig.url),
      color: rawConfig.color || '#666666',
      partition: `persist:${rawConfig.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
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
      iconUrl: resolveModelIconUrl(rawConfig, id, url),
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

  // 选择本地图标
  ipcMain.handle('models:selectIcon', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择模型图标',
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'ico', 'svg'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    if (!isSupportedIconPath(filePath)) {
      return null;
    }

    return {
      localIconPath: filePath,
      iconUrl: pathToFileURL(filePath).href,
      name: path.basename(filePath),
    };
  });

  // 模型排序
  ipcMain.handle('models:reorder', (_event, orderedIds) => {
    if (!Array.isArray(orderedIds)) {
      return loadModels();
    }

    const models = loadModels();
    const byId = new Map(models.map((model) => [model.id, model]));
    const nextModels = [];
    const usedIds = new Set();

    orderedIds.map(String).forEach((id) => {
      const model = byId.get(id);
      if (model && !usedIds.has(id)) {
        nextModels.push(model);
        usedIds.add(id);
      }
    });

    models.forEach((model) => {
      if (!usedIds.has(model.id)) {
        nextModels.push(model);
      }
    });

    saveModels(nextModels);
    mainWindow.webContents.send('models:updated', nextModels);
    return nextModels;
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

  // 刷新指定模型视图
  ipcMain.handle('view:refreshModel', (_event, modelId) => {
    return viewManager.refreshView(modelId);
  });

  // 读取模型状态面板数据
  ipcMain.handle('view:getStatus', () => {
    return viewManager.getStatus(loadModels(), getProcessMemoryByPid());
  });

  // 导出当前活跃模型的对话为 Markdown
  ipcMain.handle('view:exportConversation', async () => {
    if (!viewManager) {
      return { ok: false, reason: 'view-manager-missing' };
    }

    const exportData = await viewManager.extractActiveConversation();
    if (!exportData.ok) {
      return exportData;
    }

    if (!hasExportContent(exportData)) {
      return { ok: false, reason: 'empty-content' };
    }

    const markdown = buildConversationMarkdown(exportData);
    const defaultName = `${sanitizeFileName(exportData.modelName)}-${formatDateForFile()}.md`;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出对话为 Markdown',
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: '文本文件', extensions: ['txt'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }

    fs.writeFileSync(result.filePath, markdown, 'utf-8');
    return {
      ok: true,
      filePath: result.filePath,
      messageCount: Array.isArray(exportData.messages) ? exportData.messages.length : 0,
    };
  });

  // 结束指定模型的 WebView，用于释放内存；不删除模型配置和登录态
  ipcMain.handle('view:close', (_event, modelId) => {
    const state = viewManager.closeView(modelId);
    mainWindow.webContents.send('view:closed', { id: modelId, state });
    mainWindow.webContents.send('view:splitChanged', { enabled: state.splitMode, ids: state.splitIds, direction: state.splitDirection });
    mainWindow.webContents.send('view:switched', { id: state.activeId });
    return state;
  });

  // 结束后台已加载但当前未展示的模型视图
  ipcMain.handle('view:closeInactive', () => {
    const state = viewManager.closeInactiveViews();
    state.closedIds.forEach((id) => {
      mainWindow.webContents.send('view:closed', { id, state });
    });
    mainWindow.webContents.send('view:splitChanged', { enabled: state.splitMode, ids: state.splitIds, direction: state.splitDirection });
    mainWindow.webContents.send('view:switched', { id: state.activeId });
    return state;
  });

  // 进入分屏模式
  ipcMain.handle('view:enterSplit', async (_event, modelIds, direction = 'horizontal') => {
    if (!Array.isArray(modelIds) || modelIds.length < 2 || modelIds.length > 3) {
      return false;
    }
    const splitDirection = direction === 'vertical' ? 'vertical' : 'horizontal';

    const models = loadModels();
    const selectedModels = modelIds
      .map((id) => models.find((model) => model.id === id))
      .filter(Boolean);

    if (selectedModels.length !== modelIds.length) {
      return false;
    }

    const ok = await viewManager.enterSplit(selectedModels, splitDirection);
    if (ok) {
      mainWindow.webContents.send('view:splitChanged', { enabled: true, ids: modelIds, direction: splitDirection });
      mainWindow.webContents.send('view:switched', { id: selectedModels[0].id });
    }
    return ok;
  });

  // 退出分屏模式
  ipcMain.handle('view:exitSplit', () => {
    viewManager.exitSplit();
    mainWindow.webContents.send('view:splitChanged', { enabled: false, ids: [], direction: 'horizontal' });
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

  ipcMain.handle('view:setSidebarCollapsed', (_event, collapsed) => {
    if (viewManager) {
      viewManager.setSidebarCollapsed(collapsed === true);
    }
    return true;
  });

  // 设置读取
  ipcMain.handle('settings:get', () => {
    return loadSettings();
  });

  // 设置保存
  ipcMain.handle('settings:set', async (_event, settings) => {
    const savedSettings = applyWebsiteTheme(saveSettings(settings));
    await applyProxySettings(savedSettings);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(savedSettings.theme === 'light' ? '#eeeeee' : '#202020');
    }
    const shortcutStatus = registerGlobalShortcut(savedSettings);
    if (quickWindow) {
      quickWindow.webContents.send('settings:updated', savedSettings);
    }
    return { ...savedSettings, shortcutStatus };
  });

  // 会话快照读取
  ipcMain.handle('snapshot:get', () => {
    return loadSnapshot();
  });

  ipcMain.handle('quick:submit', async (_event, payload) => {
    return submitQuickAction(payload);
  });

  ipcMain.handle('quick:stateGet', () => {
    return loadQuickState();
  });

  ipcMain.handle('quick:stateSet', (_event, patch) => {
    const state = updateQuickState(patch);
    if (quickWindow && typeof patch === 'object' && patch && Object.hasOwn(patch, 'pinned')) {
      quickWindow.setAlwaysOnTop(state.pinned, 'floating');
    }
    return state;
  });

  ipcMain.handle('quick:setPinned', (_event, pinned) => {
    const state = updateQuickState({ pinned: pinned === true });
    if (quickWindow) {
      quickWindow.setAlwaysOnTop(state.pinned, 'floating');
    }
    return state;
  });

  ipcMain.handle('quick:hide', () => {
    if (quickWindow) {
      setQuickMenuOpen(false);
      quickWindow.hide();
    }
    return true;
  });

  ipcMain.handle('quick:setMenuOpen', (_event, open) => {
    setQuickMenuOpen(open);
    return true;
  });

  ipcMain.handle('window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
    }
    return true;
  });

  ipcMain.handle('window:toggleMaximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return false;
    }

    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return false;
    }

    mainWindow.maximize();
    return true;
  });

  ipcMain.handle('window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
    return true;
  });
}

// ── 应用生命周期 ──

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(async () => {
    const settings = applyWebsiteTheme(loadSettings());
    await applyProxySettings(settings);

    Menu.setApplicationMenu(null);
    createWindow();
    createTray();
    registerIPC();
    registerGlobalShortcut(settings);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (appIsQuitting && process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('will-quit', () => {
    appIsQuitting = true;
    globalShortcut.unregisterAll();
    if (tray) {
      tray.destroy();
      tray = null;
    }
  });
}
