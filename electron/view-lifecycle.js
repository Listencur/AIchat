'use strict';

const { WebContentsView } = require('electron');
const { installSessionHeaderHook } = require('./session-header-hooks');
const { getPersistPartition, isSameModelOrigin } = require('./model-policy');

const DEBUG = process.argv.includes('--dev');

function debugLog(...args) {
  if (DEBUG) console.log(...args);
}

function debugError(...args) {
  if (DEBUG) console.error(...args);
}

class ViewLifecycle {
  constructor(win, proxyConfig) {
    this.win = win;
    this.views = new Map();
    this.creatingViews = new Map();
    this.proxyConfig = proxyConfig;
    this.restoreEntries = new Map();
  }

  setRestoreEntries(entries) {
    this.restoreEntries = entries;
  }

  getLoadingBackgroundColor() {
    return this.proxyConfig.theme === 'light' ? '#ffffff' : '#181818';
  }

  applyViewBackground(view) {
    if (!view || typeof view.setBackgroundColor !== 'function') return;
    try {
      view.setBackgroundColor(this.getLoadingBackgroundColor());
    } catch (e) {
      debugError('[ViewLifecycle] set view background failed', e);
    }
  }

  emitLoadingState(modelId) {
    if (!this.win || this.win.isDestroyed()) return;
    const entry = this.views.get(modelId);
    this.win.webContents.send('view:loadingChanged', {
      id: modelId,
      loading: entry ? entry.loading : false,
      failed: entry ? entry.loadFailed === true : false,
    });
  }

  setLoadingState(modelId, loading, options = {}) {
    const entry = this.views.get(modelId);
    if (!entry) return;
    let changed = false;
    if (Object.hasOwn(options, 'failed') && entry.loadFailed !== options.failed) {
      entry.loadFailed = options.failed === true;
      changed = true;
    }
    const nextLoading = loading && !entry.hasContent;
    if (entry.loading === nextLoading && !changed) return;
    entry.loading = nextLoading;
    this.emitLoadingState(modelId);
    // 注意：这里原本有更新bounds和可见性的逻辑，但属于布局管理，可能需要在ViewManager中调用
    // 我们暂时不处理，因为布局由view-layout模块负责
  }

  getInitialUrl(model, restoreEntry) {
    if (!restoreEntry || typeof restoreEntry.url !== 'string') return model.url;
    return isSameModelOrigin(restoreEntry.url, model.url) ? restoreEntry.url : model.url;
  }

  async ensureView(model) {
    if (this.views.has(model.id)) return this.views.get(model.id).view;
    if (this.creatingViews.has(model.id)) return this.creatingViews.get(model.id);
    const createPromise = this.createView(model);
    this.creatingViews.set(model.id, createPromise);
    try {
      return await createPromise;
    } finally {
      this.creatingViews.delete(model.id);
    }
  }

  async createView(model) {
    const partition = getPersistPartition(model);
    if (!partition) throw new Error(`invalid partition for model ${model.id}`);
    const view = new WebContentsView({
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: true,
      },
    });
    this.applyViewBackground(view);
    const defaultUA = view.webContents.getUserAgent();
    view.webContents.setUserAgent(defaultUA.replace(/\s*Electron\/[\d.]+/, ''));
    if (typeof view.webContents.setBackgroundThrottling === 'function')
      view.webContents.setBackgroundThrottling(true);

    view.webContents.on('did-start-loading', () => {
      debugLog(`[${model.name}] loading started`);
      const entry = this.views.get(model.id);
      if (entry) entry.busyReasons.set('loading', 1);
      this.setLoadingState(model.id, true, { failed: false });
    });
    view.webContents.on('dom-ready', () => {
      const entry = this.views.get(model.id);
      if (entry) {
        entry.hasContent = true;
        entry.busyReasons.delete('loading');
      }
      this.setLoadingState(model.id, false, { failed: false });
    });
    const restoreEntry = this.restoreEntries.get(model.id);
    let didRestoreScroll = false;
    view.webContents.on('did-finish-load', () => {
      debugLog(`[${model.name}] loading finished`);
      const entry = this.views.get(model.id);
      if (entry) {
        entry.hasContent = true;
        entry.busyReasons.delete('loading');
      }
      this.setLoadingState(model.id, false, { failed: false });
      if (didRestoreScroll || !restoreEntry || restoreEntry.scrollY <= 0) return;
      didRestoreScroll = true;
      setTimeout(() => {
        if (view.webContents.isDestroyed()) return;
        view.webContents
          .executeJavaScript(
            `window.scrollTo(0, ${Math.floor(restoreEntry.scrollY)});`,
            false
          )
          .catch((error) =>
            debugError(`[${model.name}] restore scroll failed`, error)
          );
      }, 600);
    });
    view.webContents.on(
      'did-fail-load',
      (_e, errorCode, errorDesc, _validatedUrl, isMainFrame) => {
        debugError(
          `[${model.name}] loading failed: ${errorCode} - ${errorDesc}`
        );
        if (errorCode === -3 || isMainFrame === false) return;
        const entry = this.views.get(model.id);
        if (entry) entry.busyReasons.delete('loading');
        this.setLoadingState(model.id, false, { failed: true });
      }
    );
    view.webContents.on('did-stop-loading', () => {
      debugLog(`[${model.name}] loading stopped`);
      const entry = this.views.get(model.id);
      if (entry) entry.busyReasons.delete('loading');
      this.setLoadingState(model.id, false);
    });

    this.win.contentView.addChildView(view);
    view.setVisible(false);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    this.views.set(model.id, {
      view,
      model,
      loading: true,
      hasContent: false,
      loadFailed: false,
      lastUsedAt: Date.now(),
      inactiveSince: 0,
      busyReasons: new Map([['creating', 1]]),
    });
    this.emitLoadingState(model.id);

    const ses = view.webContents.session;
    try {
      await this.applyProxyToSession(ses, model);
      const chromeVer = defaultUA.match(/Chrome\/([\d]+)/)?.[1] || '130';
      installSessionHeaderHook(ses, chromeVer);
      if (
        !view.webContents.isDestroyed() &&
        this.views.get(model.id)?.view === view
      )
        view.webContents.loadURL(this.getInitialUrl(model, restoreEntry));
    } finally {
      const entry = this.views.get(model.id);
      if (entry && entry.view === view) entry.busyReasons.delete('creating');
    }
    return view;
  }

  async applyProxyToSession(ses, model) {
    await ses.setProxy(this.createProxyOptions());
    if (this.proxyConfig.proxyMode === 'custom') {
      const proxyUsed = await ses.resolveProxy(model.url);
      debugLog(`[${model.name}] proxy: ${proxyUsed} -> ${model.url}`);
    }
  }

  createProxyOptions() {
    if (this.proxyConfig.proxyMode === 'direct') return { mode: 'direct' };
    if (this.proxyConfig.proxyMode === 'custom')
      return {
        mode: 'fixed_servers',
        proxyRules: this.proxyConfig.proxyUrl,
      };
    return { mode: 'system' };
  }

  removeView(modelId) {
    const entry = this.views.get(modelId);
    if (!entry) return;
    this.win.contentView.removeChildView(entry.view);
    entry.view.webContents.destroy();
    this.views.delete(modelId);
  }

  destroyView(modelId) {
    const entry = this.views.get(modelId);
    if (!entry) return;
    try {
      this.win.contentView.removeChildView(entry.view);
      entry.view.webContents.destroy();
    } catch (e) {}
    this.views.delete(modelId);
  }

  isViewLoaded(modelId) {
    const entry = this.views.get(modelId);
    return Boolean(entry && entry.view && !entry.view.webContents.isDestroyed());
  }

  beginBusy(modelId, reason) {
    const entry = this.views.get(modelId);
    if (!entry) return () => {};
    const key = String(reason || 'operation');
    entry.busyReasons.set(
      key,
      (entry.busyReasons.get(key) || 0) + 1
    );
    return () => {
      const current = this.views.get(modelId);
      if (!current) return;
      const count = current.busyReasons.get(key) || 0;
      if (count <= 1) current.busyReasons.delete(key);
      else current.busyReasons.set(key, count - 1);
    };
  }

  isBusy(modelId) {
    const entry = this.views.get(modelId);
    return Boolean(entry && entry.busyReasons && entry.busyReasons.size > 0);
  }

  touchLRU(modelId) {
    const entry = this.views.get(modelId);
    if (entry) {
      entry.lastUsedAt = Date.now();
      entry.inactiveSince = 0;
    }
  }

  markInactive(modelId) {
    const entry = this.views.get(modelId);
    if (entry && !entry.inactiveSince) entry.inactiveSince = Date.now();
  }
}

module.exports = { ViewLifecycle };