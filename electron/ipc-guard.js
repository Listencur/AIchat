'use strict';

function isExpectedSender(event, windowRef, expectedFile) {
  if (!event || !windowRef || windowRef.isDestroyed()) return false;
  if (event.sender !== windowRef.webContents || event.senderFrame !== event.sender.mainFrame) return false;
  const url = event.senderFrame.url || '';
  return !expectedFile || url.toLowerCase().endsWith(`/${expectedFile.toLowerCase()}`);
}

function guarded(handler, isAllowed, fallback) {
  return async (event, ...args) => {
    if (!isAllowed(event)) return typeof fallback === 'function' ? fallback() : fallback;
    return handler(event, ...args);
  };
}

module.exports = { guarded, isExpectedSender };
