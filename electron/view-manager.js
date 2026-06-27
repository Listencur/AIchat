'use strict';

const { WebContentsView } = require('electron');

// ⚠️ 此值必须与 src/css/style.css 中 --sidebar-width 保持一致
const SIDEBAR_WIDTH = 240;
// ⚠️ 此值必须与 src/css/style.css 中 --top-bar-height 保持一致
const TOP_BAR_HEIGHT = 36;
const SPLIT_GUTTER_WIDTH = 10;
const DEBUG = process.argv.includes('--dev');
const PROMPT_SUBMIT_TIMEOUT_MS = 12000;
const CONVERSATION_EXTRACT_SCRIPT = `
(async () => {
  const normalize = (text) => String(text || '')
    .replace(/\\r/g, '')
    .replace(/[\\t\\f\\v]+/g, ' ')
    .replace(/[ \\u00a0]+\\n/g, '\\n')
    .replace(/\\n[ \\u00a0]+/g, '\\n')
    .replace(/\\n{3,}/g, '\\n\\n')
    .trim();

  const textFromElement = (element) => {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('script, style, noscript, svg, button, nav, header, footer, [aria-hidden="true"]').forEach((node) => node.remove());
    clone.querySelectorAll('pre').forEach((pre) => {
      const code = normalize(pre.innerText || pre.textContent);
      const replacement = document.createElement('div');
      const fence = String.fromCharCode(96, 96, 96);
      replacement.textContent = code ? '\\n\\n' + fence + '\\n' + code + '\\n' + fence + '\\n\\n' : '';
      pre.replaceWith(replacement);
    });
    return normalize(clone.innerText || clone.textContent);
  };

  const roleLabel = (role) => {
    const value = String(role || '').toLowerCase();
    if (value.includes('user') || value.includes('human') || value.includes('query')) return '用户';
    if (value.includes('assistant') || value.includes('model') || value.includes('bot') || value.includes('ai')) return 'AI';
    return '';
  };

  const title = normalize(document.title) || '未命名对话';
  const url = location.href;
  const main = document.querySelector('main, [role="main"], article') || document.body;
  const messages = [];
  const seen = new Set();

  const pushMessage = (role, element) => {
    if (!element || seen.has(element)) return;
    const content = textFromElement(element);
    if (!content || content.length < 2) return;
    seen.add(element);
    messages.push({
      role: roleLabel(role) || '内容',
      content,
    });
  };

  document.querySelectorAll('[data-message-author-role]').forEach((element) => {
    pushMessage(element.getAttribute('data-message-author-role'), element);
  });

  if (messages.length === 0) {
    const selector = [
      'user-query',
      'model-response',
      'message-content',
      '[data-test-id*="user" i]',
      '[data-test-id*="response" i]',
      '[class*="user-query" i]',
      '[class*="model-response" i]',
      '[class*="assistant" i]',
      '[class*="message" i]'
    ].join(',');

    Array.from(main.querySelectorAll(selector))
      .filter((element) => !element.querySelector(selector))
      .forEach((element) => {
        const descriptor = [
          element.tagName,
          element.getAttribute('data-test-id'),
          element.className,
          element.getAttribute('aria-label')
        ].join(' ');
        pushMessage(descriptor, element);
      });
  }

  if (messages.length > 0) {
    const compact = [];
    const textSeen = new Set();
    messages.forEach((message) => {
      const key = message.role + '\\n' + message.content;
      if (textSeen.has(key)) return;
      textSeen.add(key);
      compact.push(message);
    });
    return { title, url, messages: compact };
  }

  const text = textFromElement(main);
  return { title, url, messages: [], text };
})();
`;

function buildPromptSubmitScript(prompt) {
  const serializedPrompt = JSON.stringify(prompt);

  return `
(async () => {
  const prompt = ${serializedPrompt};
  const normalize = (value) => String(value || '').toLowerCase();
  const isVisible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 8 && rect.height > 8 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const selectors = [
    'textarea:not([disabled])',
    'div#prompt-textarea[contenteditable="true"]',
    '[data-testid="prompt-textarea"]',
    'rich-textarea [contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
    '[role="textbox"]'
  ];
  const inputs = selectors
    .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
    .filter((element, index, list) => list.indexOf(element) === index)
    .filter(isVisible);
  const input = inputs.find((element) => {
    const label = normalize([
      element.id,
      element.className,
      element.getAttribute('aria-label'),
      element.getAttribute('placeholder'),
      element.getAttribute('data-testid')
    ].join(' '));
    return label.includes('prompt') || label.includes('message') || label.includes('输入') || label.includes('提问') || label.includes('ask') || label.includes('query');
  }) || inputs[0];

  if (!input) {
    return { ok: false, reason: 'input-not-found' };
  }

  input.focus();
  if ('value' in input) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(input, prompt);
    } else {
      input.value = prompt;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertText', false, prompt);
    if (!input.textContent || !input.textContent.includes(prompt)) {
      input.textContent = prompt;
    }
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: prompt,
    }));
  }

  await new Promise((resolve) => setTimeout(resolve, 250));

  const sendSelectors = [
    '[data-testid="send-button"]',
    '[aria-label*="Send" i]',
    '[aria-label*="发送" i]',
    '[aria-label*="submit" i]',
    'button[type="submit"]',
    'button.send-button'
  ];
  const buttons = sendSelectors
    .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
    .filter((button, index, list) => list.indexOf(button) === index)
    .filter((button) => isVisible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true');
  const sendButton = buttons.find((button) => {
    const label = normalize([
      button.textContent,
      button.getAttribute('aria-label'),
      button.getAttribute('data-testid'),
      button.className
    ].join(' '));
    return label.includes('send') || label.includes('发送') || label.includes('submit') || label.includes('arrow') || label.includes('提交');
  }) || buttons[0];

  if (sendButton) {
    sendButton.click();
    return { ok: true, method: 'button' };
  }

  input.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    bubbles: true,
    cancelable: true,
  }));
  input.dispatchEvent(new KeyboardEvent('keyup', {
    key: 'Enter',
    code: 'Enter',
    bubbles: true,
    cancelable: true,
  }));
  return { ok: true, method: 'enter' };
})();
`;
}

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

  waitForWebContentsReady(webContents, timeoutMs = PROMPT_SUBMIT_TIMEOUT_MS) {
    if (!webContents || webContents.isDestroyed() || !webContents.isLoading()) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        webContents.removeListener('did-stop-loading', done);
        webContents.removeListener('did-finish-load', done);
        webContents.removeListener('did-fail-load', done);
        clearTimeout(timer);
      };
      const done = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);

      webContents.once('did-stop-loading', done);
      webContents.once('did-finish-load', done);
      webContents.once('did-fail-load', done);
    });
  }

  /**
   * 向指定模型页面填入 Prompt 并发送。只操作当前模型网页，不触碰 session 数据。
   */
  async submitPrompt(modelId, model, prompt) {
    const targetModel = model || (this.views.has(modelId) ? this.views.get(modelId).model : null);
    if (!targetModel || typeof prompt !== 'string' || !prompt.trim()) {
      return { ok: false, reason: 'invalid-prompt' };
    }

    await this.switchTo(modelId, targetModel);

    const entry = this.views.get(modelId);
    if (!entry || entry.view.webContents.isDestroyed()) {
      return { ok: false, reason: 'view-not-loaded' };
    }

    const { webContents } = entry.view;
    await this.waitForWebContentsReady(webContents);

    try {
      return await webContents.executeJavaScript(buildPromptSubmitScript(prompt.trim()), false);
    } catch (error) {
      debugError(`[${entry.model.name}] prompt submit failed`, error);
      return {
        ok: false,
        reason: 'submit-failed',
        message: error && error.message ? error.message : String(error),
      };
    }
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
    const contentHeight = Math.max(0, height - TOP_BAR_HEIGHT);
    entry.view.setBounds({
      x: SIDEBAR_WIDTH,
      y: TOP_BAR_HEIGHT,
      width: Math.max(0, width - SIDEBAR_WIDTH),
      height: contentHeight,
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
    const contentHeight = Math.max(0, height - TOP_BAR_HEIGHT);
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
        y: TOP_BAR_HEIGHT,
        width: Math.max(0, columnWidth),
        height: contentHeight,
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
   * 刷新指定模型的 View；未加载时不做任何操作。
   */
  refreshView(modelId) {
    const entry = this.views.get(modelId);
    if (entry && !entry.view.webContents.isDestroyed()) {
      entry.view.webContents.reload();
      return true;
    }

    return false;
  }

  /**
   * 只读提取当前活跃模型的页面内容，用于导出 Markdown。
   */
  async extractActiveConversation() {
    if (!this.activeId) {
      return { ok: false, reason: 'no-active-view' };
    }

    const entry = this.views.get(this.activeId);
    if (!entry || entry.view.webContents.isDestroyed()) {
      return { ok: false, reason: 'view-not-loaded' };
    }

    try {
      const data = await entry.view.webContents.executeJavaScript(CONVERSATION_EXTRACT_SCRIPT, false);
      return {
        ok: true,
        modelId: this.activeId,
        modelName: entry.model.name,
        ...data,
      };
    } catch (error) {
      debugError(`[${entry.model.name}] conversation export failed`, error);
      return {
        ok: false,
        reason: 'extract-failed',
        message: error && error.message ? error.message : String(error),
      };
    }
  }

  /**
   * 更新已创建 View 的模型信息；URL 变化时复用当前 session 重新加载。
   */
  updateModel(model) {
    const entry = this.views.get(model.id);
    if (!entry) return;

    const previousUrl = entry.model.url;
    entry.model = model;

    if (previousUrl !== model.url && !entry.view.webContents.isDestroyed()) {
      entry.view.webContents.loadURL(model.url);
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
    if (!entry) return this.getState();

    this.win.contentView.removeChildView(entry.view);
    entry.view.webContents.destroy();
    this.views.delete(modelId);
    this.splitIds = this.splitIds.filter((id) => id !== modelId);
    this.splitRatios = this.splitIds.map(() => 1 / Math.max(1, this.splitIds.length));

    if (this.activeId === modelId) {
      this.activeId = this.splitMode && this.splitIds.length > 0 ? this.splitIds[0] : null;
    }

    if (this.splitMode && this.splitIds.length < 2) {
      this.exitSplit();
    } else if (this.splitMode) {
      this.updateSplitBounds();
    }

    return this.getState();
  }

  /**
   * 结束单个模型页面进程，用于主动释放内存，不删除模型配置和登录态。
   */
  closeView(modelId) {
    return this.removeView(modelId);
  }

  /**
   * 结束后台已加载但当前未展示的模型页面。
   */
  closeInactiveViews() {
    const visibleIds = new Set(this.splitMode ? this.splitIds : [this.activeId].filter(Boolean));
    const closedIds = [];

    for (const modelId of Array.from(this.views.keys())) {
      if (visibleIds.has(modelId)) continue;
      this.removeView(modelId);
      closedIds.push(modelId);
    }

    return {
      ...this.getState(),
      closedIds,
    };
  }

  /**
   * 获取当前视图状态，供渲染进程同步 UI。
   */
  getState() {
    return {
      activeId: this.activeId,
      splitMode: this.splitMode,
      splitIds: this.splitIds.slice(),
      splitRatios: this.splitMode ? this.getNormalizedSplitRatios() : [],
      loadedIds: Array.from(this.views.keys()),
    };
  }

  /**
   * 获取模型运行状态，供状态面板展示。
   */
  getStatus(models = [], memoryByPid = new Map()) {
    const state = this.getState();
    const visibleIds = new Set(this.splitMode ? this.splitIds : [this.activeId].filter(Boolean));

    return {
      ...state,
      models: models.map((model) => {
        const entry = this.views.get(model.id);
        const webContents = entry && !entry.view.webContents.isDestroyed()
          ? entry.view.webContents
          : null;
        const processId = webContents && typeof webContents.getOSProcessId === 'function'
          ? webContents.getOSProcessId()
          : 0;

        return {
          id: model.id,
          name: model.name,
          icon: model.icon || '🤖',
          iconUrl: model.iconUrl || '',
          color: model.color || '#666666',
          loaded: Boolean(webContents),
          active: model.id === this.activeId,
          visible: visibleIds.has(model.id),
          inSplit: this.splitMode && this.splitIds.includes(model.id),
          title: webContents ? webContents.getTitle() : '',
          url: webContents ? webContents.getURL() : model.url,
          isLoading: webContents ? webContents.isLoading() : false,
          processId,
          memoryMb: processId && memoryByPid.has(processId) ? memoryByPid.get(processId) : null,
        };
      }),
    };
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
      this.updateBounds(this.activeId);
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

module.exports = { ViewManager, SIDEBAR_WIDTH, TOP_BAR_HEIGHT };
