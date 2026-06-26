'use strict';

const { WebContentsView } = require('electron');

// ⚠️ 此值必须与 src/css/style.css 中 --sidebar-width 保持一致
const SIDEBAR_WIDTH = 240;
const SPLIT_GUTTER_WIDTH = 10;
const DEBUG = process.argv.includes('--dev');

function debugLog(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

function debugError(...args) {
  if (DEBUG) {
    console.error(...args);
  }
}

/**
 * ViewManager — 管理多个 WebContentsView 的创建、切换、隐藏和 resize。
 * 每个模型对应一个独立 View，通过 setVisible 切换显隐，不销毁状态。
 */
class ViewManager {
  constructor(win, proxyConfig = { proxyMode: 'system', proxyUrl: '' }, restoreSnapshot = null) {
    this.win = win;
    /** @type {Map<string, {view: WebContentsView, model: object}>} */
    this.views = new Map();
    this.activeId = null;
    this.proxyConfig = proxyConfig;
    this.splitMode = false;
    this.splitIds = [];
    this.splitRatios = [];
    this.restoreEntries = this.createRestoreEntryMap(restoreSnapshot);
  }

  createRestoreEntryMap(snapshot) {
    const entries = snapshot && Array.isArray(snapshot.entries) ? snapshot.entries : [];
    return new Map(entries.map((entry) => [entry.modelId, entry]));
  }

  createProxyOptions() {
    if (this.proxyConfig.proxyMode === 'direct') {
      return { mode: 'direct' };
    }

    if (this.proxyConfig.proxyMode === 'custom') {
      return {
        mode: 'fixed_servers',
        proxyRules: this.proxyConfig.proxyUrl,
      };
    }

    return { mode: 'system' };
  }

  async applyProxyToSession(ses, model) {
    await ses.setProxy(this.createProxyOptions());

    if (this.proxyConfig.proxyMode === 'custom') {
      const proxyUsed = await ses.resolveProxy(model.url);
      debugLog(`[${model.name}] proxy: ${proxyUsed} -> ${model.url}`);
      return;
    }

    debugLog(`[${model.name}] proxy: ${this.proxyConfig.proxyMode} -> ${model.url}`);
  }

  async setProxyConfig(proxyConfig) {
    this.proxyConfig = proxyConfig;

    for (const [, entry] of this.views) {
      await this.applyProxyToSession(entry.view.webContents.session, entry.model);
    }
  }

  /**
   * 获取或懒创建某个模型的 View。
   * 首次切换时才创建，避免启动时加载全部网站。
   */
  async ensureView(model) {
    if (this.views.has(model.id)) {
      return this.views.get(model.id).view;
    }

    const partition = model.partition || `persist:${model.id}`;

    const view = new WebContentsView({
      webPreferences: {
        partition: partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // 用默认 UA 去掉 Electron 标识（保留真实 Chrome 版本号，避免 Cloudflare 检测版本不匹配）
    const defaultUA = view.webContents.getUserAgent();
    view.webContents.setUserAgent(defaultUA.replace(/\s*Electron\/[\d.]+/, ''));

    // ── 调试日志：排查白屏问题 ──
    view.webContents.on('did-start-loading', () => {
      debugLog(`[${model.name}] loading started`);
    });
    const restoreEntry = this.restoreEntries.get(model.id);
    let didRestoreScroll = false;

    view.webContents.on('did-finish-load', () => {
      debugLog(`[${model.name}] loading finished`);

      if (didRestoreScroll || !restoreEntry || restoreEntry.scrollY <= 0) {
        return;
      }

      didRestoreScroll = true;
      setTimeout(() => {
        if (view.webContents.isDestroyed()) return;
        view.webContents
          .executeJavaScript(`window.scrollTo(0, ${Math.floor(restoreEntry.scrollY)});`, false)
          .catch((error) => debugError(`[${model.name}] restore scroll failed`, error));
      }, 600);
    });
    view.webContents.on('did-fail-load', (_e, errorCode, errorDesc) => {
      debugError(`[${model.name}] loading failed: ${errorCode} - ${errorDesc}`);
    });
    view.webContents.on('did-stop-loading', () => {
      debugLog(`[${model.name}] loading stopped`);
    });

    // 添加到窗口（在上层，覆盖 HTML 的侧边栏右侧区域）
    this.win.contentView.addChildView(view);

    // 默认隐藏，等 switchTo 时再显示
    view.setVisible(false);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

    this.views.set(model.id, { view, model });

    // 设置代理后再加载 URL。
    const ses = view.webContents.session;
    await this.applyProxyToSession(ses, model);

    // 伪装 sec-ch-ua 头，移除 Electron 品牌标识（Cloudflare 关键检测点）
    const chromeVer = defaultUA.match(/Chrome\/([\d]+)/)?.[1] || '130';
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['sec-ch-ua'] = `"Chromium";v="${chromeVer}", "Not;A=Brand";v="99", "Google Chrome";v="${chromeVer}"`;
      details.requestHeaders['sec-ch-ua-mobile'] = '?0';
      details.requestHeaders['sec-ch-ua-platform'] = '"Windows"';
      callback({ requestHeaders: details.requestHeaders });
    });

    view.webContents.loadURL(this.getInitialUrl(model, restoreEntry));

    return view;
  }

  getInitialUrl(model, restoreEntry) {
    if (!restoreEntry || typeof restoreEntry.url !== 'string') {
      return model.url;
    }

    try {
      const url = new URL(restoreEntry.url);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return restoreEntry.url;
      }
    } catch {
      return model.url;
    }

    return model.url;
  }

  /**
   * 切换到指定模型。
   * 隐藏当前 View，显示目标 View 并更新 bounds。
   */
  async switchTo(modelId, model) {
    this.splitMode = false;
    this.splitIds = [];
    this.splitRatios = [];

    // 隐藏所有 View
    for (const [, entry] of this.views) {
      entry.view.setVisible(false);
    }

    // 确保目标 View 存在（懒创建）
    const targetModel = model || (this.views.has(modelId) ? this.views.get(modelId).model : null);
    if (!targetModel) {
      console.error(`[ViewManager] model not found: ${modelId}`);
      return;
    }

    const view = await this.ensureView(targetModel);
    view.setVisible(true);
    this.updateBounds(modelId);

    this.activeId = modelId;
  }

  /**
   * 进入分屏模式，同时显示 2-3 个模型。
   */
  async enterSplit(models) {
    if (!Array.isArray(models) || models.length < 2 || models.length > 3) {
      console.error('[ViewManager] split mode requires 2-3 models');
      return false;
    }

    for (const [, entry] of this.views) {
      entry.view.setVisible(false);
    }

    this.splitMode = true;
    this.splitIds = models.map((model) => model.id);
    this.splitRatios = models.map(() => 1 / models.length);
    this.activeId = this.splitIds[0];

    for (const model of models) {
      const view = await this.ensureView(model);
      view.setVisible(true);
    }

    this.updateSplitBounds();
    return true;
  }

  /**
   * 退出分屏模式，恢复当前活跃单视图。
   */
  exitSplit() {
    if (!this.splitMode) return;

    this.splitMode = false;
    this.splitIds = [];
    this.splitRatios = [];

    for (const [, entry] of this.views) {
      entry.view.setVisible(false);
    }

    this.showActive();
  }

  /**
   * 更新单个 View 的位置和大小（铺满侧边栏右侧区域）。
   */
  updateBounds(modelId) {
    const entry = this.views.get(modelId);
    if (!entry) return;

    const [width, height] = this.win.getContentSize();
    entry.view.setBounds({
      x: SIDEBAR_WIDTH,
      y: 0,
      width: Math.max(0, width - SIDEBAR_WIDTH),
      height: height,
    });
  }

  /**
   * 窗口 resize 时重算所有可见 View 的 bounds。
   */
  resizeAll() {
    if (this.splitMode) {
      this.updateSplitBounds();
      return;
    }

    for (const [id] of this.views) {
      this.updateBounds(id);
    }
  }

  /**
   * 更新分屏模式下多个 View 的位置和大小。
   */
  updateSplitBounds() {
    if (!this.splitMode || this.splitIds.length === 0) return;

    const [width, height] = this.win.getContentSize();
    const availableWidth = Math.max(0, width - SIDEBAR_WIDTH);
    const gutterTotal = SPLIT_GUTTER_WIDTH * (this.splitIds.length - 1);
    const contentWidth = Math.max(0, availableWidth - gutterTotal);
    const ratios = this.getNormalizedSplitRatios();
    let x = SIDEBAR_WIDTH;

    this.splitIds.forEach((id, index) => {
      const entry = this.views.get(id);
      if (!entry) return;

      const isLast = index === this.splitIds.length - 1;
      const columnWidth = isLast
        ? SIDEBAR_WIDTH + availableWidth - x
        : Math.floor(contentWidth * ratios[index]);

      entry.view.setBounds({
        x,
        y: 0,
        width: Math.max(0, columnWidth),
        height,
      });

      x += columnWidth + SPLIT_GUTTER_WIDTH;
    });
  }

  /**
   * 更新分屏列宽比例。
   */
  setSplitRatios(ratios) {
    if (!this.splitMode || !Array.isArray(ratios) || ratios.length !== this.splitIds.length) {
      return false;
    }

    const validRatios = ratios.map((ratio) => Number(ratio)).filter((ratio) => ratio > 0);
    if (validRatios.length !== ratios.length) {
      return false;
    }

    const total = validRatios.reduce((sum, ratio) => sum + ratio, 0);
    if (total <= 0) {
      return false;
    }

    this.splitRatios = validRatios.map((ratio) => ratio / total);
    this.updateSplitBounds();
    return true;
  }

  /**
   * 获取当前分屏比例；缺失或异常时回退到均分。
   */
  getNormalizedSplitRatios() {
    if (!Array.isArray(this.splitRatios) || this.splitRatios.length !== this.splitIds.length) {
      return this.splitIds.map(() => 1 / this.splitIds.length);
    }

    const total = this.splitRatios.reduce((sum, ratio) => sum + ratio, 0);
    if (total <= 0) {
      return this.splitIds.map(() => 1 / this.splitIds.length);
    }

    return this.splitRatios.map((ratio) => ratio / total);
  }

  /**
   * 刷新当前活跃 View。
   */
  refreshActive() {
    if (!this.activeId) return;
    const entry = this.views.get(this.activeId);
    if (entry) {
      entry.view.webContents.reload();
    }
  }

  /**
   * 生成当前会话快照。只保存页面位置，不触碰 Cookie/LocalStorage 等登录态。
   */
  async snapshot() {
    const entries = [];

    for (const [modelId, entry] of this.views) {
      const { webContents } = entry.view;
      if (webContents.isDestroyed()) continue;

      const url = webContents.getURL();
      if (!this.isSnapshotUrl(url)) continue;

      let scrollY = 0;
      try {
        scrollY = await webContents.executeJavaScript('Math.max(0, Math.floor(window.scrollY || 0));', false);
      } catch (error) {
        debugError(`[${entry.model.name}] snapshot scroll failed`, error);
      }

      entries.push({
        modelId,
        url,
        scrollY: Math.max(0, Number(scrollY) || 0),
      });
    }

    return {
      version: 1,
      savedAt: new Date().toISOString(),
      activeModelId: this.activeId || '',
      splitMode: this.splitMode,
      splitIds: this.splitMode ? this.splitIds.slice() : [],
      splitRatios: this.splitMode ? this.getNormalizedSplitRatios() : [],
      entries,
    };
  }

  isSnapshotUrl(url) {
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

  /**
   * 移除并销毁某个模型的 View。
   */
  removeView(modelId) {
    const entry = this.views.get(modelId);
    if (!entry) return;

    this.win.contentView.removeChildView(entry.view);
    entry.view.webContents.destroy();
    this.views.delete(modelId);
    this.splitIds = this.splitIds.filter((id) => id !== modelId);
    this.splitRatios = this.splitIds.map(() => 1 / Math.max(1, this.splitIds.length));

    if (this.activeId === modelId) {
      this.activeId = null;
    }

    if (this.splitMode && this.splitIds.length < 2) {
      this.exitSplit();
    }
  }

  /**
   * 隐藏所有 View（用于弹窗遮挡时让 HTML 覆盖层可见）。
   */
  hideAll() {
    for (const [, entry] of this.views) {
      entry.view.setVisible(false);
    }
  }

  /**
   * 恢复显示当前活跃 View（弹窗关闭后调用）。
   */
  showActive() {
    if (this.splitMode) {
      for (const id of this.splitIds) {
        const entry = this.views.get(id);
        if (entry) {
          entry.view.setVisible(true);
        }
      }
      this.updateSplitBounds();
      return;
    }

    if (!this.activeId) return;
    const entry = this.views.get(this.activeId);
    if (entry) {
      entry.view.setVisible(true);
    }
  }

  /**
   * 销毁所有 View（窗口关闭时调用）。
   */
  destroyAll() {
    for (const [, entry] of this.views) {
      try {
        this.win.contentView.removeChildView(entry.view);
        entry.view.webContents.destroy();
      } catch (e) {
        // 忽略销毁错误
      }
    }
    this.views.clear();
    this.activeId = null;
  }
}

module.exports = { ViewManager, SIDEBAR_WIDTH };
