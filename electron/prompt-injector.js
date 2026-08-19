'use strict';

const DEBUG = process.argv.includes('--dev');

function debugLog(...args) {
  if (DEBUG) console.log(...args);
}

function debugError(...args) {
  if (DEBUG) console.error(...args);
}

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

class PromptInjector {
  static buildPromptScript(prompt, allowSend = true, adapter = {}) {
    return buildPromptSubmitScript(prompt, allowSend, adapter.spec || {});
  }

  static async fillPrompt(view, prompt, adapter) {
    if (!view || !view.webContents || view.webContents.isDestroyed()) {
      return { ok: false, reason: 'view-not-available' };
    }
    const script = buildPromptSubmitScript(prompt, false, adapter.spec || {});
    try {
      return await view.webContents.executeJavaScript(script, false);
    } catch (error) {
      debugError('[PromptInjector] fillPrompt failed', error);
      return {
        ok: false,
        reason: 'fill-failed',
        message: error && error.message ? error.message : String(error),
      };
    }
  }

  static async submitPrompt(view, prompt, adapter) {
    if (!view || !view.webContents || view.webContents.isDestroyed()) {
      return { ok: false, reason: 'view-not-available' };
    }
    const script = buildPromptSubmitScript(prompt, true, adapter.spec || {});
    try {
      return await view.webContents.executeJavaScript(script, false);
    } catch (error) {
      debugError('[PromptInjector] submitPrompt failed', error);
      return {
        ok: false,
        reason: 'submit-failed',
        message: error && error.message ? error.message : String(error),
      };
    }
  }

  static async fallbackManualSend(view, prompt, adapter) {
    // 降级：先填入，然后尝试点击发送按钮
    const fillResult = await PromptInjector.fillPrompt(view, prompt, adapter);
    if (!fillResult || !fillResult.ok) return fillResult;

    // 如果填入成功但需要手动发送，尝试查找并点击发送按钮
    if (fillResult.method === 'filled') {
      // 这里可以添加点击发送按钮的逻辑，但原脚本中已经处理了
      // 我们返回一个提示，表示需要手动发送
      return { ok: true, method: 'filled-only', requiresManualSend: true };
    }
    return fillResult;
  }

  static findSendButton(adapter) {
    // 这个函数返回发送按钮的选择器，但实际上在脚本中已经处理
    // 我们可以返回一个脚本片段，用于查找发送按钮
    const sendSelectors = [
      ...((adapter && adapter.prompt && adapter.prompt.sendSelectors) || []),
      '[data-testid="send-button"]',
      '[data-testid="composer-send-button"]',
      '[data-testid="composer-submit-button"]',
      'button[data-testid*="send" i]',
      '#composer-submit-button',
      '[aria-label*="Send" i]',
      '[aria-label*="发送" i]',
      '[aria-label*="submit" i]',
      'button[type="submit"]',
    ];
    return sendSelectors;
  }

  static clickSendButton(adapter) {
    // 返回点击发送按钮的脚本，但实际点击逻辑在buildPromptSubmitScript中已经实现
    // 这里可以返回一个独立的脚本，但为了简单，我们返回一个空字符串
    return '';
  }
}

module.exports = { PromptInjector, buildPromptSubmitScript };