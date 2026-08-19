'use strict';

module.exports = {
  id: 'qwen',
  matches: (url) => {
    try {
      const hostname = new URL(url).hostname;
      return hostname === 'tongyi.aliyun.com' || hostname === 'qianwen.aliyun.com';
    } catch {
      return false;
    }
  },
  prompt: {
    inputSelectors: [
      'textarea[placeholder*="输入" i]',
      'textarea[placeholder*="message" i]',
      'textarea[placeholder*="请输入" i]',
      '[role="textbox"][aria-label*="输入" i]',
    ],
    sendSelectors: [
      'button[aria-label*="发送" i]',
      '[data-testid*="send" i]',
      'div[role="button"][aria-label*="发送" i]',
    ],
    inputStrategy: 'textarea',
    sendStrategy: 'click',
  },
  page: {
    readySelectors: [
      'textarea[placeholder*="输入" i]',
      'textarea[placeholder*="请输入" i]',
    ],
    loadingSelectors: [
      '.loading',
      '[class*="generating" i]',
    ],
  },
  capabilities: {
    canAutoSend: true,
    canFillPrompt: true,
  },
};
