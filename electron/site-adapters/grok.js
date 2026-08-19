'use strict';

module.exports = {
  id: 'grok',
  matches: (url) => {
    try {
      const hostname = new URL(url).hostname;
      return hostname === 'grok.com' || hostname === 'www.grok.com';
    } catch {
      return false;
    }
  },
  prompt: {
    inputSelectors: [
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="message" i]',
      '[role="textbox"][aria-label*="Ask" i]',
      'textarea[placeholder*="提问" i]',
    ],
    sendSelectors: [
      'button[aria-label*="Send" i]',
      '[data-testid*="send" i]',
      'button[type="submit"]',
    ],
    inputStrategy: 'textarea',
    sendStrategy: 'click',
  },
  page: {
    readySelectors: [
      'textarea[placeholder*="Ask" i]',
      '[role="textbox"]',
    ],
    loadingSelectors: [
      '.loading',
      '[class*="spinner" i]',
    ],
  },
  capabilities: {
    canAutoSend: true,
    canFillPrompt: true,
  },
};
