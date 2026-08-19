'use strict';

module.exports = {
  id: 'gemini',
  matches: (url) => {
    try {
      const hostname = new URL(url).hostname;
      return hostname === 'gemini.google.com' || hostname === 'www.gemini.google.com';
    } catch {
      return false;
    }
  },
  prompt: {
    inputSelectors: [
      'rich-textarea [contenteditable="true"]',
      '[data-testid*="prompt" i][contenteditable="true"]',
      '.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
    ],
    sendSelectors: [
      '[aria-label*="Send" i]',
      '[aria-label*="发送" i]',
      'button[aria-label*="Submit" i]',
      'mat-icon[data-mat-icon-name="send"]',
    ],
    inputStrategy: 'contenteditable',
    sendStrategy: 'click',
  },
  page: {
    readySelectors: [
      'rich-textarea',
      '[data-testid*="prompt" i]',
    ],
    loadingSelectors: [
      '.loading-indicator',
      '[class*="progress" i]',
    ],
  },
  capabilities: {
    canAutoSend: true,
    canFillPrompt: true,
  },
};
