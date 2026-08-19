'use strict';

const { WebContentsView } = require('electron');
const { installSessionHeaderHook } = require('./session-header-hooks');
const { getPersistPartition, isSameModelOrigin } = require('./model-policy');
const { resolveSiteAdapter } = require('./site-adapters');

const SIDEBAR_WIDTH = 240;
const SIDEBAR_COLLAPSED_WIDTH = 56;
const TOP_BAR_HEIGHT = 36;
const SPLIT_GUTTER_WIDTH = 10;
const DARK_LOADING_BACKGROUND = '#181818';
const LIGHT_LOADING_BACKGROUND = '#ffffff';
const DEBUG = process.argv.includes('--dev');
const PROMPT_SUBMIT_TIMEOUT_MS = 12000;
const PROMPT_INTERACTIVE_TIMEOUT_MS = 8000;


function buildPromptSubmitScript(prompt, allowSend = true, adapterSpec = {}) {
  const serializedPrompt = JSON.stringify(prompt);
  const serializedAllowSend = allowSend === true ? 'true' : 'false';
  const serializedSpec = JSON.stringify(adapterSpec || {});

  return `
(async () => {
  const prompt = ${serializedPrompt};
  const allowSend = ${serializedAllowSend};
  const adapterSpec = ${serializedSpec};
  const normalize = (value) => String(value || '').toLowerCase();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isVisible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 8 && rect.height > 8 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const selectors = [
    ...((adapterSpec.prompt && adapterSpec.prompt.inputSelectors) || []),
    'div#prompt-textarea[contenteditable="true"]',
    '[data-testid="prompt-textarea"]',
    '[data-testid*="composer-input" i]',
    '[data-testid*="prompt" i][contenteditable="true"]',
    'rich-textarea [contenteditable="true"]',
    '.ProseMirror[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    'textarea:not([disabled])',
    '[contenteditable="true"]',
    '[role="textbox"]'
  ];
  const findInput = () => {
    const inputs = selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((element, index, list) => list.indexOf(element) === index)
      .filter(isVisible);
    const named = inputs.find((element) => {
      const label = normalize([
        element.id, element.className,
        element.getAttribute('aria-label'), element.getAttribute('placeholder'),
        element.getAttribute('data-testid')
      ].join(' '));
      return label.includes('prompt') || label.includes('message') || label.includes('输入') || label.includes('提问') || label.includes('ask') || label.includes('query');
    });
    return named || (allowSend ? inputs[0] : (inputs.length === 1 ? inputs[0] : null));
  };
  const waitForInput = async () => {
    const started = Date.now();
    let input = findInput();
    while (!input && Date.now() - started < 5000) { await sleep(45); input = findInput(); }
    return input;
  };
  const input = await waitForInput();
  if (!input) return { ok: false, reason: 'input-not-found' };
  input.focus();
  if ('value' in input) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(input, prompt);
    else input.value = prompt;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertText', false, prompt);
    if (!input.textContent || !input.textContent.includes(prompt)) input.textContent = prompt;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (!allowSend) return { ok: true, method: 'filled' };
  const sendSelectors = [
    ...((adapterSpec.prompt && adapterSpec.prompt.sendSelectors) || []),
    '[data-testid="send-button"]', '[data-testid="composer-send-button"]',
    '[data-testid="composer-submit-button"]', 'button[data-testid*="send" i]',
    '#composer-submit-button', '[aria-label*="Send" i]', '[aria-label*="发送" i]',
    '[aria-label*="submit" i]', 'button[type="submit"]'
  ];
  const findSendButton = () => {
    const scope = input.closest('form') || input.parentElement || document;
    const buttons = sendSelectors
      .flatMap((s) => Array.from(scope.querySelectorAll ? scope.querySelectorAll(s) : []))
      .filter((b, i, a) => a.indexOf(b) === i)
      .filter((b) => isVisible(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true');
    return buttons.find((b) => {
      const l = normalize([b.textContent, b.getAttribute('aria-label'), b.getAttribute('data-testid'), b.id, b.className].join(' '));
      return l.includes('send') || l.includes('发送') || l.includes('submit') || l.includes('提交');
    }) || buttons[0] || null;
  };
  const waitForSendButton = async () => {
    const started = Date.now();
    while (Date.now() - started < 1600) { const b = findSendButton(); if (b) return b; await sleep(35); }
    return findSendButton();
  };
  const sendButton = await waitForSendButton();
  if (sendButton) {
    const rect = sendButton.getBoundingClientRect();
    return { ok: false, inputReady: true, buttonPoint: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) } };
  }
  const form = input.closest('form');
  if (form && typeof form.requestSubmit === 'function') { form.requestSubmit(); return { ok: true, method: 'form' }; }
  return { ok: false, reason: 'send-control-not-found', inputReady: true };
})();
`;
}

function debugLog(...args) {
  if (DEBUG) console.log(...args);
}

function debugError(...args) {
  if (DEBUG) console.error(...args);
}

class ViewManager {
  constructor(win, proxyConfig = { proxyMode: 'system', proxyUrl: '' }, restoreSnapshot = null, memoryOptions = {}) {
    this.win = win;
    this.views = new Map();
    this.activeId = null;
    this.proxyConfig = proxyConfig;
    this.splitMode = false;
    this.splitIds = [];
    this.splitRatios = [];
    this.splitDirection = 'horizontal';
    this.sidebarCollapsed = false;
    this.restoreEntries = this.createRestoreEntryMap(restoreSnapshot);
    this.maxAliveViews = Number(memoryOptions.maxAliveViews) > 0 ? Math.floor(Number(memoryOptions.maxAliveViews)) : 0;
    this.idleReclaimMinutes = Number(memoryOptions.inactiveViewTtlMinutes) > 0 ? Math.min(24 * 60, Math.floor(Number(memoryOptions.inactiveViewTtlMinutes))) : 30;
    this.idleReclaimEnabled = memoryOptions.idleReclaimEnabled !== false;
    this.creatingViews = new Map();
  }

  setMaxAliveViews(value) {
    const next = Number(value) > 0 ? Math.floor(Number(value)) : 0;
    this.maxAliveViews = next;
    return { maxAliveViews: this.maxAliveViews, closedIds: next > 0 ? this.enforceMaxAlive() : [] };
  }

  setIdleReclaimSettings(enabled, minutes) {
    this.idleReclaimEnabled = enabled !== false;
    this.idleReclaimMinutes = Number(minutes) > 0 ? Math.min(24 * 60, Math.floor(Number(minutes))) : 0;
  }

  touchLRU(modelId) {
    const entry = this.views.get(modelId);
    if (entry) { entry.lastUsedAt = Date.now(); entry.inactiveSince = 0; }
  }

  markInactive(modelId) {
    const entry = this.views.get(modelId);
    if (entry && !entry.inactiveSince) entry.inactiveSince = Date.now();
  }

  beginBusy(modelId, reason) {
    const entry = this.views.get(modelId);
    if (!entry) return () => {};
    const key = String(reason || 'operation');
    entry.busyReasons.set(key, (entry.busyReasons.get(key) || 0) + 1);
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

  getProtectedIds() {
    const protectedIds = new Set(this.splitMode ? this.splitIds : []);
    if (this.activeId) protectedIds.add(this.activeId);
    return protectedIds;
  }

  canAutoReclaim(modelId) {
    return !this.getProtectedIds().has(modelId) && !this.isBusy(modelId);
  }

  isViewLoaded(modelId) {
    const entry = this.views.get(modelId);
    return Boolean(entry && entry.view && !entry.view.webContents.isDestroyed());
  }

  enforceMaxAlive() {
    if (!this.maxAliveViews || this.maxAliveViews <= 0) return [];
    const closedIds = [];
    const protectedIds = this.getProtectedIds();
    while (this.views.size > this.maxAliveViews) {
      let oldestId = null, oldestAt = Infinity;
      for (const [id, entry] of this.views) {
        if (protectedIds.has(id) || this.isBusy(id)) continue;
        if ((entry.lastUsedAt || 0) < oldestAt) { oldestAt = entry.lastUsedAt || 0; oldestId = id; }
      }
      if (!oldestId) break;
      this.removeView(oldestId);
      closedIds.push(oldestId);
    }
    return closedIds;
  }

  createRestoreEntryMap(snapshot) {
    const entries = snapshot && Array.isArray(snapshot.entries) ? snapshot.entries : [];
    return new Map(entries.map((entry) => [entry.modelId, entry]));
  }

  createProxyOptions() {
    if (this.proxyConfig.proxyMode === 'direct') return { mode: 'direct' };
    if (this.proxyConfig.proxyMode === 'custom') return { mode: 'fixed_servers', proxyRules: this.proxyConfig.proxyUrl };
    return { mode: 'system' };
  }

  async applyProxyToSession(ses, model) {
    await ses.setProxy(this.createProxyOptions());
    if (this.proxyConfig.proxyMode === 'custom') {
      const proxyUsed = await ses.resolveProxy(model.url);
      debugLog(`[${model.name}] proxy: ${proxyUsed} -> ${model.url}`);
    }
  }

  async setProxyConfig(proxyConfig) {
    this.proxyConfig = proxyConfig;
    const sessions = new Map();
    for (const [, entry] of this.views) {
      this.applyViewBackground(entry.view);
      const ses = entry.view.webContents.session;
      if (!sessions.has(ses)) sessions.set(ses, entry.model);
    }
    for (const [ses, model] of sessions) await this.applyProxyToSession(ses, model);
  }

  getSidebarWidth() { return this.sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH; }
  setSidebarCollapsed(collapsed) { this.sidebarCollapsed = collapsed === true; this.resizeAll(); }
  getLoadingBackgroundColor() { return this.proxyConfig.theme === 'light' ? LIGHT_LOADING_BACKGROUND : DARK_LOADING_BACKGROUND; }

  applyViewBackground(view) {
    if (!view || typeof view.setBackgroundColor !== 'function') return;
    try { view.setBackgroundColor(this.getLoadingBackgroundColor()); } catch (e) { debugError('[ViewManager] set view background failed', e); }
  }

  emitLoadingState(modelId) {
    if (!this.win || this.win.isDestroyed()) return;
    const entry = this.views.get(modelId);
    this.win.webContents.send('view:loadingChanged', { id: modelId, loading: entry ? entry.loading : false, failed: entry ? entry.loadFailed === true : false });
  }

  setLoadingState(modelId, loading, options = {}) {
    const entry = this.views.get(modelId);
    if (!entry) return;
    let changed = false;
    if (Object.hasOwn(options, 'failed') && entry.loadFailed !== options.failed) { entry.loadFailed = options.failed === true; changed = true; }
    const nextLoading = loading && !entry.hasContent;
    if (entry.loading === nextLoading && !changed) return;
    entry.loading = nextLoading;
    this.emitLoadingState(modelId);
    if (this.splitMode || this.activeId !== modelId) return;
    if (nextLoading || entry.loadFailed) { entry.view.setVisible(false); return; }
    entry.view.setVisible(true);
    this.updateBounds(modelId);
  }

  async ensureView(model) {
    if (this.views.has(model.id)) return this.views.get(model.id).view;
    if (this.creatingViews.has(model.id)) return this.creatingViews.get(model.id);
    const createPromise = this.createView(model);
    this.creatingViews.set(model.id, createPromise);
    try { return await createPromise; } finally { this.creatingViews.delete(model.id); }
  }

  async createView(model) {
    const partition = getPersistPartition(model);
    if (!partition) throw new Error(`invalid partition for model ${model.id}`);
    const view = new WebContentsView({
      webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true },
    });
    this.applyViewBackground(view);
    const defaultUA = view.webContents.getUserAgent();
    view.webContents.setUserAgent(defaultUA.replace(/\s*Electron\/[\d.]+/, ''));
    if (typeof view.webContents.setBackgroundThrottling === 'function') view.webContents.setBackgroundThrottling(true);

    view.webContents.on('did-start-loading', () => {
      debugLog(`[${model.name}] loading started`);
      const entry = this.views.get(model.id);
      if (entry) entry.busyReasons.set('loading', 1);
      this.setLoadingState(model.id, true, { failed: false });
    });
    view.webContents.on('dom-ready', () => {
      const entry = this.views.get(model.id);
      if (entry) { entry.hasContent = true; entry.busyReasons.delete('loading'); }
      this.setLoadingState(model.id, false, { failed: false });
    });
    const restoreEntry = this.restoreEntries.get(model.id);
    let didRestoreScroll = false;
    view.webContents.on('did-finish-load', () => {
      debugLog(`[${model.name}] loading finished`);
      const entry = this.views.get(model.id);
      if (entry) { entry.hasContent = true; entry.busyReasons.delete('loading'); }
      this.setLoadingState(model.id, false, { failed: false });
      if (didRestoreScroll || !restoreEntry || restoreEntry.scrollY <= 0) return;
      didRestoreScroll = true;
      setTimeout(() => {
        if (view.webContents.isDestroyed()) return;
        view.webContents.executeJavaScript(`window.scrollTo(0, ${Math.floor(restoreEntry.scrollY)});`, false)
          .catch((error) => debugError(`[${model.name}] restore scroll failed`, error));
      }, 600);
    });
    view.webContents.on('did-fail-load', (_e, errorCode, errorDesc, _validatedUrl, isMainFrame) => {
      debugError(`[${model.name}] loading failed: ${errorCode} - ${errorDesc}`);
      if (errorCode === -3 || isMainFrame === false) return;
      const entry = this.views.get(model.id);
      if (entry) entry.busyReasons.delete('loading');
      this.setLoadingState(model.id, false, { failed: true });
    });
    view.webContents.on('did-stop-loading', () => {
      debugLog(`[${model.name}] loading stopped`);
      const entry = this.views.get(model.id);
      if (entry) entry.busyReasons.delete('loading');
      this.setLoadingState(model.id, false);
    });

    this.win.contentView.addChildView(view);
    view.setVisible(false);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    this.views.set(model.id, { view, model, loading: true, hasContent: false, loadFailed: false, lastUsedAt: Date.now(), inactiveSince: 0, busyReasons: new Map([['creating', 1]]) });
    this.emitLoadingState(model.id);

    const ses = view.webContents.session;
    try {
      await this.applyProxyToSession(ses, model);
      const chromeVer = defaultUA.match(/Chrome\/([\d]+)/)?.[1] || '130';
      installSessionHeaderHook(ses, chromeVer);
      if (!view.webContents.isDestroyed() && this.views.get(model.id)?.view === view)
        view.webContents.loadURL(this.getInitialUrl(model, restoreEntry));
    } finally {
      const entry = this.views.get(model.id);
      if (entry && entry.view === view) entry.busyReasons.delete('creating');
    }
    return view;
  }

  getInitialUrl(model, restoreEntry) {
    if (!restoreEntry || typeof restoreEntry.url !== 'string') return model.url;
    return isSameModelOrigin(restoreEntry.url, model.url) ? restoreEntry.url : model.url;
  }

  async switchTo(modelId, model) {
    this.splitMode = false; this.splitIds = []; this.splitRatios = [];
    for (const [, entry] of this.views) { entry.view.setVisible(false); this.markInactive(entry.model.id); }
    const targetModel = model || (this.views.has(modelId) ? this.views.get(modelId).model : null);
    if (!targetModel) { console.error(`[ViewManager] model not found: ${modelId}`); return []; }
    const view = await this.ensureView(targetModel);
    this.updateBounds(modelId);
    this.activeId = modelId;
    this.touchLRU(modelId);
    const closedIds = this.enforceMaxAlive();
    const entry = this.views.get(modelId);
    if (!entry) return closedIds;
    view.setVisible(!entry.loading && !entry.loadFailed);
    return closedIds;
  }

  waitForWebContentsReady(webContents, timeoutMs = PROMPT_SUBMIT_TIMEOUT_MS) {
    if (!webContents || webContents.isDestroyed() || !webContents.isLoading()) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const cleanup = () => { webContents.removeListener('did-stop-loading', done); webContents.removeListener('did-finish-load', done); webContents.removeListener('did-fail-load', done); clearTimeout(timer); };
      const done = () => { if (settled) return; settled = true; cleanup(); resolve(); };
      const timer = setTimeout(done, timeoutMs);
      webContents.once('did-stop-loading', done); webContents.once('did-finish-load', done); webContents.once('did-fail-load', done);
    });
  }

  waitForEntryInteractive(entry, timeoutMs = PROMPT_INTERACTIVE_TIMEOUT_MS) {
    const webContents = entry ? entry.view.webContents : null;
    if (!entry || !webContents || webContents.isDestroyed() || entry.hasContent || !webContents.isLoading()) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const cleanup = () => { webContents.removeListener('dom-ready', done); webContents.removeListener('did-stop-loading', done); webContents.removeListener('did-finish-load', done); webContents.removeListener('did-fail-load', done); clearTimeout(timer); };
      const done = () => { if (settled) return; settled = true; cleanup(); resolve(); };
      const timer = setTimeout(done, timeoutMs);
      webContents.once('dom-ready', done); webContents.once('did-stop-loading', done); webContents.once('did-finish-load', done); webContents.once('did-fail-load', done);
    });
  }

  async submitPrompt(modelId, model, prompt, options = {}) {
    const targetModel = model || (this.views.has(modelId) ? this.views.get(modelId).model : null);
    if (!targetModel || typeof prompt !== 'string' || !prompt.trim()) return { ok: false, reason: 'invalid-prompt' };
    if (options.preserveLayout === true) await this.ensureView(targetModel);
    else await this.switchTo(modelId, targetModel);
    const entry = this.views.get(modelId);
    if (!entry || entry.view.webContents.isDestroyed()) return { ok: false, reason: 'view-not-loaded' };
    const { webContents } = entry.view;
    if (!isSameModelOrigin(webContents.getURL(), targetModel.url)) return { ok: false, reason: 'origin-not-allowed' };
    const endBusy = this.beginBusy(modelId, 'submit');
    try {
      await this.waitForEntryInteractive(entry);
      if (typeof webContents.focus === 'function') webContents.focus();
      const adapter = resolveSiteAdapter(targetModel, webContents.getURL());
      const result = await webContents.executeJavaScript(buildPromptSubmitScript(prompt.trim(), true, adapter.spec), false);
      if (result && result.ok) return result;
      if (result && result.inputReady && result.buttonPoint) {
        const x = Math.max(0, Math.floor(Number(result.buttonPoint.x) || 0));
        const y = Math.max(0, Math.floor(Number(result.buttonPoint.y) || 0));
        webContents.sendInputEvent({ type: 'mouseMove', x, y });
        webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        return { ok: true, method: 'native-button' };
      }
      if (result && result.inputReady) {
        return { ok: true, method: 'filled-only', requiresManualSend: true };
      }
      return result;
    } catch (error) {
      debugError(`[${entry.model.name}] prompt submit failed`, error);
      return { ok: false, reason: 'submit-failed', message: error && error.message ? error.message : String(error) };
    } finally { endBusy(); }
  }

  async fillPromptOnly(modelId, model, prompt, options = {}) {
    const targetModel = model || (this.views.has(modelId) ? this.views.get(modelId).model : null);
    if (!targetModel || typeof prompt !== 'string' || !prompt.trim()) return { ok: false, reason: 'invalid-prompt' };
    if (options.preserveLayout === true) await this.ensureView(targetModel);
    else await this.switchTo(modelId, targetModel);
    const entry = this.views.get(modelId);
    if (!entry || entry.view.webContents.isDestroyed()) return { ok: false, reason: 'view-not-loaded' };
    const { webContents } = entry.view;
    if (!isSameModelOrigin(webContents.getURL(), targetModel.url)) return { ok: false, reason: 'origin-not-allowed' };
    const endBusy = this.beginBusy(modelId, 'fill');
    try {
      await this.waitForEntryInteractive(entry);
      webContents.focus();
      const adapter = resolveSiteAdapter(targetModel, webContents.getURL());
      return await webContents.executeJavaScript(buildPromptSubmitScript(prompt.trim(), false, adapter.spec), false);
    } catch (error) {
      return { ok: false, reason: 'fill-failed', message: error && error.message ? error.message : String(error) };
    } finally { endBusy(); }
  }

  async enterSplit(models, direction = 'horizontal') {
    if (!Array.isArray(models) || models.length < 2 || models.length > 3) { console.error('[ViewManager] split mode requires 2-3 models'); return { ok: false, closedIds: [] }; }
    for (const [, entry] of this.views) entry.view.setVisible(false);
    this.splitMode = true; this.splitIds = models.map(m => m.id); this.splitRatios = models.map(() => 1 / models.length);
    this.splitDirection = direction === 'vertical' ? 'vertical' : 'horizontal';
    this.activeId = this.splitIds[0];
    for (const model of models) { const view = await this.ensureView(model); this.touchLRU(model.id); view.setVisible(true); }
    const closedIds = this.enforceMaxAlive();
    this.updateSplitBounds();
    return { ok: true, closedIds };
  }

  exitSplit() {
    if (!this.splitMode) return;
    this.splitMode = false; this.splitIds = []; this.splitRatios = [];
    for (const [, entry] of this.views) entry.view.setVisible(false);
    this.showActive();
  }

  updateBounds(modelId) {
    const entry = this.views.get(modelId);
    if (!entry) return;
    const [width, height] = this.win.getContentSize();
    const sidebarWidth = this.getSidebarWidth();
    entry.view.setBounds({ x: sidebarWidth, y: TOP_BAR_HEIGHT, width: Math.max(0, width - sidebarWidth), height: Math.max(0, height - TOP_BAR_HEIGHT) });
  }

  resizeAll() {
    if (this.splitMode) { this.updateSplitBounds(); return; }
    for (const [id] of this.views) this.updateBounds(id);
  }

  updateSplitBounds() {
    if (!this.splitMode || this.splitIds.length === 0) return;
    const [width, height] = this.win.getContentSize();
    const sidebarWidth = this.getSidebarWidth();
    const contentHeight = Math.max(0, height - TOP_BAR_HEIGHT);
    const availableWidth = Math.max(0, width - sidebarWidth);
    if (this.splitDirection === 'vertical') {
      const gutterTotal = SPLIT_GUTTER_WIDTH * (this.splitIds.length - 1);
      const contentHeightForRows = Math.max(0, contentHeight - gutterTotal);
      const ratios = this.getNormalizedSplitRatios();
      let y = TOP_BAR_HEIGHT;
      this.splitIds.forEach((id, index) => {
        const entry = this.views.get(id);
        if (!entry) return;
        const isLast = index === this.splitIds.length - 1;
        const rowHeight = isLast ? TOP_BAR_HEIGHT + contentHeight - y : Math.floor(contentHeightForRows * ratios[index]);
        entry.view.setBounds({ x: sidebarWidth, y, width: availableWidth, height: Math.max(0, rowHeight) });
        y += rowHeight + SPLIT_GUTTER_WIDTH;
      });
      return;
    }
    const gutterTotal = SPLIT_GUTTER_WIDTH * (this.splitIds.length - 1);
    const contentWidth = Math.max(0, availableWidth - gutterTotal);
    const ratios = this.getNormalizedSplitRatios();
    let x = sidebarWidth;
    this.splitIds.forEach((id, index) => {
      const entry = this.views.get(id);
      if (!entry) return;
      const isLast = index === this.splitIds.length - 1;
      const columnWidth = isLast ? sidebarWidth + availableWidth - x : Math.floor(contentWidth * ratios[index]);
      entry.view.setBounds({ x, y: TOP_BAR_HEIGHT, width: Math.max(0, columnWidth), height: contentHeight });
      x += columnWidth + SPLIT_GUTTER_WIDTH;
    });
  }

  setSplitRatios(ratios) {
    if (!this.splitMode || !Array.isArray(ratios) || ratios.length !== this.splitIds.length) return false;
    const validRatios = ratios.map(Number).filter(r => r > 0);
    if (validRatios.length !== ratios.length) return false;
    const total = validRatios.reduce((s, r) => s + r, 0);
    if (total <= 0) return false;
    this.splitRatios = validRatios.map(r => r / total);
    this.updateSplitBounds();
    return true;
  }

  getNormalizedSplitRatios() {
    if (!Array.isArray(this.splitRatios) || this.splitRatios.length !== this.splitIds.length) return this.splitIds.map(() => 1 / this.splitIds.length);
    const total = this.splitRatios.reduce((s, r) => s + r, 0);
    if (total <= 0) return this.splitIds.map(() => 1 / this.splitIds.length);
    return this.splitRatios.map(r => r / total);
  }

  refreshActive() { if (!this.activeId) return; const e = this.views.get(this.activeId); if (e) e.view.webContents.reload(); }
  refreshView(modelId) { const e = this.views.get(modelId); if (e && !e.view.webContents.isDestroyed()) { e.view.webContents.reload(); return true; } return false; }


  updateModel(model) {
    const entry = this.views.get(model.id);
    if (!entry) return;
    const previousUrl = entry.model.url;
    entry.model = model;
    if (previousUrl !== model.url && !entry.view.webContents.isDestroyed()) entry.view.webContents.loadURL(model.url);
  }

  async snapshot() {
    const entries = [];
    for (const [modelId, entry] of this.views) {
      const { webContents } = entry.view;
      if (webContents.isDestroyed()) continue;
      const url = webContents.getURL();
      if (!this.isSnapshotUrl(url)) continue;
      let scrollY = 0;
      try { scrollY = await webContents.executeJavaScript('Math.max(0, Math.floor(window.scrollY || 0));', false); }
      catch (error) { debugError(`[${entry.model.name}] snapshot scroll failed`, error); }
      entries.push({ modelId, url, scrollY: Math.max(0, Number(scrollY) || 0) });
    }
    return { version: 1, savedAt: new Date().toISOString(), activeModelId: this.activeId || '', splitMode: this.splitMode, splitIds: this.splitMode ? this.splitIds.slice() : [], splitRatios: this.splitMode ? this.getNormalizedSplitRatios() : [], splitDirection: this.splitMode ? this.splitDirection : 'horizontal', entries };
  }

  isSnapshotUrl(url) {
    if (typeof url !== 'string' || !url) return false;
    try { const p = new URL(url); return p.protocol === 'http:' || p.protocol === 'https:'; } catch { return false; }
  }

  removeView(modelId) {
    const entry = this.views.get(modelId);
    if (!entry) return this.getState();
    this.win.contentView.removeChildView(entry.view);
    entry.view.webContents.destroy();
    this.views.delete(modelId);
    this.splitIds = this.splitIds.filter(id => id !== modelId);
    this.splitRatios = this.splitIds.map(() => 1 / Math.max(1, this.splitIds.length));
    if (this.activeId === modelId) this.activeId = this.splitMode && this.splitIds.length > 0 ? this.splitIds[0] : null;
    if (this.splitMode && this.splitIds.length < 2) this.exitSplit();
    else if (this.splitMode) this.updateSplitBounds();
    return this.getState();
  }

  closeView(modelId) { return this.removeView(modelId); }

  closeInactiveViews() {
    const closedIds = [];
    for (const modelId of Array.from(this.views.keys())) {
      if (!this.canAutoReclaim(modelId)) continue;
      this.removeView(modelId);
      closedIds.push(modelId);
    }
    return { ...this.getState(), closedIds };
  }

  closeIdleViews(idleMinutes = this.idleReclaimMinutes) {
    if (!this.idleReclaimEnabled || !Number(idleMinutes) || idleMinutes <= 0) return { ...this.getState(), closedIds: [] };
    const cutoff = Date.now() - Math.floor(Number(idleMinutes) * 60 * 1000);
    const candidates = Array.from(this.views.entries())
      .filter(([modelId, entry]) => this.canAutoReclaim(modelId) && entry.inactiveSince > 0 && entry.inactiveSince <= cutoff)
      .sort(([, a], [, b]) => a.inactiveSince - b.inactiveSince);
    const closedIds = [];
    candidates.forEach(([modelId]) => { if (!this.canAutoReclaim(modelId)) return; this.removeView(modelId); closedIds.push(modelId); });
    return { ...this.getState(), closedIds };
  }

  hibernateAllViews() {
    const closedIds = Array.from(this.views.keys());
    this.destroyAll();
    return { ...this.getState(), closedIds };
  }

  getState() {
    return { activeId: this.activeId, splitMode: this.splitMode, splitIds: this.splitIds.slice(), splitRatios: this.splitMode ? this.getNormalizedSplitRatios() : [], splitDirection: this.splitMode ? this.splitDirection : 'horizontal', loadedIds: Array.from(this.views.keys()) };
  }

  getStatus(models = [], memoryByPid = new Map()) {
    const state = this.getState();
    const visibleIds = new Set(this.splitMode ? this.splitIds : [this.activeId].filter(Boolean));
    return { ...state, models: models.map(model => {
      const entry = this.views.get(model.id);
      const wc = entry && !entry.view.webContents.isDestroyed() ? entry.view.webContents : null;
      const processId = wc && typeof wc.getOSProcessId === 'function' ? wc.getOSProcessId() : 0;
      return { id: model.id, name: model.name, icon: model.icon || '\ud83e\udd16', iconUrl: model.iconUrl || '', iconUrls: Array.isArray(model.iconUrls) ? model.iconUrls : [], color: model.color || '#666666', loaded: Boolean(wc), active: model.id === this.activeId, visible: visibleIds.has(model.id), inSplit: this.splitMode && this.splitIds.includes(model.id), title: wc ? wc.getTitle() : '', url: wc ? wc.getURL() : model.url, isLoading: entry ? entry.loading || (wc ? wc.isLoading() : false) : false, loadFailed: entry ? entry.loadFailed === true : false, busy: entry ? entry.busyReasons.size > 0 : false, busyReasons: entry ? Array.from(entry.busyReasons.keys()) : [], inactiveSince: entry && entry.inactiveSince ? entry.inactiveSince : null, processId, memoryMb: processId && memoryByPid.has(processId) ? memoryByPid.get(processId) : null };
    }) };
  }

  hideAll() { for (const [, entry] of this.views) entry.view.setVisible(false); }

  showActive() {
    if (this.splitMode) {
      for (const id of this.splitIds) { const entry = this.views.get(id); if (entry) entry.view.setVisible(true); }
      this.updateSplitBounds();
      return;
    }
    if (!this.activeId) return;
    const entry = this.views.get(this.activeId);
    if (entry) { entry.view.setVisible(!entry.loading); this.updateBounds(this.activeId); }
  }

  destroyAll() {
    for (const [, entry] of this.views) { try { this.win.contentView.removeChildView(entry.view); entry.view.webContents.destroy(); } catch (e) {} }
    this.views.clear(); this.activeId = null; this.splitMode = false; this.splitIds = []; this.splitRatios = []; this.splitDirection = 'horizontal';
    return this.getState();
  }
}

module.exports = { ViewManager, SIDEBAR_WIDTH, TOP_BAR_HEIGHT };
