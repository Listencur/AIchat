'use strict';

module.exports = {
  id: 'chatgpt',
  matches: (url) => {
    try {
      const hostname = new URL(url).hostname;
      return /(^|\.)chatgpt\.com$/i.test(hostname) || hostname === 'chat.openai.com';
    } catch {
      return false;
    }
  },
  prompt: {
    inputSelectors: [
      'div#prompt-textarea[contenteditable="true"]',
      '[data-testid="prompt-textarea"]',
      'textarea[placeholder*="message" i]',
    ],
    sendSelectors: [
      '[data-testid="send-button"]',
      '[data-testid="composer-send-button"]',
      '#composer-submit-button',
      'button[aria-label*="Send" i]',
    ],
    inputStrategy: 'contenteditable',
    sendStrategy: 'click',
  },
  page: {
    readySelectors: [
      'div#prompt-textarea',
      '[data-testid="prompt-textarea"]',
    ],
    loadingSelectors: [
      '[data-testid="loading"]',
      '.result-streaming',
    ],
  },
  capabilities: {
    canAutoSend: true,
    canFillPrompt: true,
  },
};
