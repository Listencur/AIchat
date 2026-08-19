'use strict';

module.exports = {
  id: 'generic-fill',
  matches: () => true,
  prompt: {
    inputSelectors: [
      'textarea[placeholder*="message" i]',
      'textarea[placeholder*="prompt" i]',
      'textarea[placeholder*="输入" i]',
      'textarea[placeholder*="请输入" i]',
      '[role="textbox"][aria-label*="message" i]',
      '[role="textbox"][aria-label*="prompt" i]',
      '[role="textbox"][aria-label*="输入" i]',
      'div[contenteditable="true"][role="textbox"]',
    ],
    sendSelectors: [],
    inputStrategy: 'textarea',
    sendStrategy: 'none',
  },
  page: {
    readySelectors: [
      'textarea',
      '[role="textbox"]',
      '[contenteditable="true"]',
    ],
    loadingSelectors: [],
  },
  capabilities: {
    canAutoSend: false,
    canFillPrompt: true,
  },
};
