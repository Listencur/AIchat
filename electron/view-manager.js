'use strict';

const { WebContentsView } = require('electron');

// ⚠️ 此值必须与 src/css/style.css 中 --sidebar-width 保持一致
const SIDEBAR_WIDTH = 240;

/**
 * ViewManager — 管理多个 WebContentsView 的创建、切换、隐藏和 resize。
 * 每个模型对应一个独立 View，通过 setVisible 切换显隐，不销毁状态。
 */
class ViewManager {
  constructor(win, proxyConfig = { proxyMode: 'system', proxyUrl: '' }) {
    this.win = win;
    /** @type {Map<string, {view: WebContentsView, model: object}>} */
    this.views = new Map();
    this.activeId = null;
    this.proxyConfig = proxyConfig;
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
      console.log(`[${model.name}] proxy: ${proxyUsed} -> ${model.url}`);
      return;
    }

    console.log(`[${model.name}] proxy: ${this.proxyConfig.proxyMode} -> ${model.url}`);
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
      console.log(`[${model.name}] loading started`);
    });
    view.webContents.on('did-finish-load', () => {
      console.log(`[${model.name}] loading finished`);
    });
    view.webContents.on('did-fail-load', (_e, errorCode, errorDesc) => {
      console.error(`[${model.name}] loading failed: ${errorCode} - ${errorDesc}`);
    });
    view.webContents.on('did-stop-loading', () => {
      console.log(`[${model.name}] loading stopped`);
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

    view.webContents.loadURL(model.url);

    return view;
  }

  /**
   * 切换到指定模型。
   * 隐藏当前 View，显示目标 View 并更新 bounds。
   */
  async switchTo(modelId, model) {
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
    for (const [id] of this.views) {
      this.updateBounds(id);
    }
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
   * 移除并销毁某个模型的 View。
   */
  removeView(modelId) {
    const entry = this.views.get(modelId);
    if (!entry) return;

    this.win.contentView.removeChildView(entry.view);
    entry.view.webContents.destroy();
    this.views.delete(modelId);

    if (this.activeId === modelId) {
      this.activeId = null;
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
