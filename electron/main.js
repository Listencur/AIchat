'use strict';

const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { ViewManager, SIDEBAR_WIDTH } = require('./view-manager');

/** @type {BrowserWindow} */
let mainWindow = null;
/** @type {ViewManager} */
let viewManager = null;

// 全局代理：走 Clash（端口 7897），必须在 app.ready 之前设置
app.commandLine.appendSwitch('proxy-server', 'http://127.0.0.1:7897');
// 反自动化检测：移除 navigator.webdriver 标记，绕过 Cloudflare bot 检测
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

// ── 模型配置存储 ──

const defaultModelsPath = path.join(__dirname, '..', 'data', 'models.json');
const userModelsPath = path.join(app.getPath('userData'), 'models.json');

/**
 * 加载模型列表。
 * 首次启动时从 data/models.json 拷贝到 userData，之后始终读写 userData 副本。
 */
function loadModels() {
  if (!fs.existsSync(userModelsPath)) {
    // 首次启动：拷贝默认配置
    const defaultData = fs.readFileSync(defaultModelsPath, 'utf-8');
    fs.writeFileSync(userModelsPath, defaultData, 'utf-8');
  }
  const data = JSON.parse(fs.readFileSync(userModelsPath, 'utf-8'));
  return data.models || [];
}

/**
 * 保存模型列表到 userData。
 */
function saveModels(models) {
  fs.writeFileSync(userModelsPath, JSON.stringify({ models }, null, 2), 'utf-8');
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
  viewManager = new ViewManager(mainWindow);

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
    let models = loadModels();
    models = models.filter((m) => m.id !== id);
    saveModels(models);

    // 销毁对应的 View
    if (viewManager) viewManager.removeView(id);

    // 通知渲染进程更新
    mainWindow.webContents.send('models:updated', models);
    return true;
  });

  // 切换视图
  ipcMain.handle('view:switch', async (_event, modelId) => {
    const models = loadModels();
    const model = models.find((m) => m.id === modelId);
    if (!model) {
      console.error(`[main] 模型不存在: ${modelId}`);
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

  // 隐藏/显示所有 WebView（用于弹窗时避免遮挡 HTML 覆盖层）
  ipcMain.handle('view:setVisible', (_event, visible) => {
    if (visible) {
      viewManager.showActive();
    } else {
      viewManager.hideAll();
    }
    return true;
  });
}

// ── 应用生命周期 ──

app.whenReady().then(async () => {
  // 默认 session 也设代理（partition session 可能不继承全局开关）
  await session.defaultSession.setProxy({ proxyRules: 'http://127.0.0.1:7897' });

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
