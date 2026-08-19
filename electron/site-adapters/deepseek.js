'use strict';

module.exports = {
  id: 'deepseek',
  matches: (url) => {
    try {
      return new URL(url).hostname === 'chat.deepseek.com';
    } catch {
      return false;
    }
  },
  prompt: {
    inputSelectors: [
      'textarea[placeholder*="输入" i]',
      'textarea[placeholder*="message" i]',
      '[role="textbox"][aria-label*="输入" i]',
      'textarea[placeholder*="Send a message" i]',
    ],
    sendSelectors: [
      '[aria-label*="发送" i]',
      '[aria-label*="Send" i]',
      'button[data-testid*="send" i]',
      'div[role="button"][aria-label*="发送" i]',
    ],
    inputStrategy: 'textarea',
    sendStrategy: 'click',
  },
  page: {
    readySelectors: [
      'textarea[placeholder*="输入" i]',
      'textarea[placeholder*="message" i]',
    ],
    loadingSelectors: [
      '.ds-loading',
      '[class*="loading" i]',
    ],
  },
  capabilities: {
    canAutoSend: true,
    canFillPrompt: true,
  },
};
