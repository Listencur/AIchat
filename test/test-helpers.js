'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

/**
 * 创建临时测试目录，测试结束后自动清理
 */
function createTempDir(prefix = 'ai-chat-hub-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    path: dir,
    cleanup() {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    },
  };
}

/**
 * 创建模拟的 WebContents 对象
 */
function createMockWebContents(overrides = {}) {
  return {
    isDestroyed: () => false,
    isLoading: () => false,
    getTitle: () => '',
    getURL: () => 'https://example.com',
    getUserAgent: () => 'Mozilla/5.0 (Electron/1.0) Chrome/130.0.0.0',
    setUserAgent: () => {},
    loadURL: () => Promise.resolve(),
    reload: () => {},
    focus: () => {},
    destroy: () => {},
    executeJavaScript: () => Promise.resolve({ ok: true }),
    send: () => {},
    sendInputEvent: () => {},
    openDevTools: () => {},
    isDevToolsOpened: () => false,
    getOSProcessId: () => 0,
    session: createMockSession(),
    mainFrame: { url: '' },
    on: () => {},
    once: () => {},
    removeListener: () => {},
    removeAllListeners: () => {},
    ...overrides,
  };
}

/**
 * 创建模拟的 WebContentsView 对象
 */
function createMockView(overrides = {}) {
  const webContents = createMockWebContents(overrides.webContents || {});
  return {
    webContents,
    setVisible: () => {},
    setBounds: () => {},
    setBackgroundColor: () => {},
    getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    isDestroyed: () => false,
    destroy: () => {},
    ...overrides,
  };
}

/**
 * 创建模拟的 Session 对象
 */
function createMockSession(overrides = {}) {
  return {
    setProxy: () => Promise.resolve(),
    resolveProxy: () => Promise.resolve('DIRECT'),
    clearCache: () => Promise.resolve(),
    clearStorageData: () => Promise.resolve(),
    clearAuthCache: () => Promise.resolve(),
    clearCodeCaches: () => Promise.resolve(),
    clearHostResolverCache: () => Promise.resolve(),
    cookies: {
      flushStore: () => Promise.resolve(),
    },
    ...overrides,
  };
}

/**
 * 创建模拟的 BrowserWindow 对象
 */
function createMockWindow(overrides = {}) {
  const webContents = createMockWebContents(overrides.webContents || {});
  const childViews = [];

  return {
    webContents,
    isDestroyed: () => false,
    isMinimized: () => false,
    isMaximized: () => false,
    show: () => {},
    hide: () => {},
    focus: () => {},
    close: () => {},
    minimize: () => {},
    maximize: () => {},
    unmaximize: () => {},
    restore: () => {},
    setBounds: () => {},
    getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    getContentSize: () => [1200, 800],
    setAlwaysOnTop: () => {},
    setContextMenu: () => {},
    setBackgroundColor: () => {},
    loadFile: () => Promise.resolve(),
    on: () => {},
    once: () => {},
    removeListener: () => {},
    contentView: {
      addChildView: () => {},
      removeChildView: () => {},
      childViews,
    },
    ...overrides,
  };
}

/**
 * 创建模拟的 app 对象
 */
function createMockApp(overrides = {}) {
  return {
    getPath: (name) => {
      const paths = {
        userData: '/tmp/test-user-data',
        temp: os.tmpdir(),
      };
      return paths[name] || '/tmp';
    },
    getAppMetrics: () => [],
    commandLine: {
      appendSwitch: () => {},
    },
    requestSingleInstanceLock: () => true,
    quit: () => {},
    on: () => {},
    once: () => {},
    removeListener: () => {},
    isReady: () => Promise.resolve(),
    whenReady: () => Promise.resolve(),
    ...overrides,
  };
}

/**
 * 创建模拟的 ipcMain 对象
 */
function createMockIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, handler) => {
      handlers.set(channel, handler);
    },
    _handlers: handlers,
    _invoke: async (channel, ...args) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler for channel: ${channel}`);
      return handler({}, ...args);
    },
  };
}

/**
 * 创建模拟的 session.fromPartition
 */
function createMockSessionFactory() {
  const sessions = new Map();
  return {
    fromPartition: (partition) => {
      if (!sessions.has(partition)) {
        sessions.set(partition, createMockSession());
      }
      return sessions.get(partition);
    },
    defaultSession: createMockSession(),
    _sessions: sessions,
  };
}

module.exports = {
  createTempDir,
  createMockWebContents,
  createMockView,
  createMockSession,
  createMockWindow,
  createMockApp,
  createMockIpcMain,
  createMockSessionFactory,
};
