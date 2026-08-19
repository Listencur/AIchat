'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { StateStore } = require('../electron/state-store');

test('state store serializes the latest state atomically', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-chat-hub-state-'));
  const filePath = path.join(dir, 'state.json');
  const store = new StateStore(filePath, { value: 0 }, (value) => ({ value: Number(value.value) || 0 }));
  store.patch({ value: 1 });
  const first = store.persist();
  store.patch({ value: 2 });
  const second = store.persist();
  await Promise.all([first, second]);
  await store.flush();
  assert.deepEqual(JSON.parse(await fs.promises.readFile(filePath, 'utf8')), { value: 2 });
  await fs.promises.rm(dir, { recursive: true, force: true });
});

test('scheduled writes keep the latest quick-state revision', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-chat-hub-state-'));
  const filePath = path.join(dir, 'quick.json');
  const store = new StateStore(filePath, { draft: '' }, (value) => ({ draft: String(value.draft || '') }));
  store.patch({ draft: 'old' });
  store.schedulePersist(20);
  store.patch({ draft: 'new' });
  store.schedulePersist(20);
  await new Promise((resolve) => setTimeout(resolve, 35));
  await store.flush();
  assert.deepEqual(JSON.parse(await fs.promises.readFile(filePath, 'utf8')), { draft: 'new' });
  await fs.promises.rm(dir, { recursive: true, force: true });
});
