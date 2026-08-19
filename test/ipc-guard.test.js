'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isExpectedSender } = require('../electron/ipc-guard');

test('ipc guard accepts only the expected top-level local page', () => {
  const webContents = {};
  const windowRef = { isDestroyed: () => false, webContents };
  const event = { sender: webContents, senderFrame: { url: 'file:///app/src/index.html' } };
  event.sender.mainFrame = event.senderFrame;
  assert.equal(isExpectedSender(event, windowRef, 'index.html'), true);
  assert.equal(isExpectedSender(event, windowRef, 'quick.html'), false);
});
