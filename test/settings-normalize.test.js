'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeSettings,
  getDefaultSettings,
  migrateSettings,
  normalizeShortcut,
  DEFAULT_SETTINGS,
} = require('../electron/settings-normalize');

// ── getDefaultSettings 测试 ──

test('getDefaultSettings returns default settings object', () => {
  const defaults = getDefaultSettings();
  assert.equal(defaults.proxyMode, 'system');
  assert.equal(defaults.proxyUrl, 'http://127.0.0.1:7897');
  assert.equal(defaults.restoreSnapshot, false);
  assert.equal(defaults.shortcutEnabled, true);
  assert.equal(defaults.shortcutAccelerator, 'Ctrl+Shift+Space');
  assert.equal(defaults.theme, 'dark');
  assert.equal(defaults.closeAction, 'ask');
  assert.equal(defaults.trayMemoryMode, 'keepAll');
  assert.equal(defaults.maxAliveViews, 0);
  assert.equal(defaults.autoReclaimEnabled, false);
  assert.equal(defaults.memoryPressureMb, 2500);
  assert.equal(defaults.idleReclaimEnabled, true);
  assert.equal(defaults.inactiveViewTtlMinutes, 30);
});

test('getDefaultSettings returns a copy', () => {
  const a = getDefaultSettings();
  const b = getDefaultSettings();
  assert.notStrictEqual(a, b);
  a.theme = 'light';
  assert.equal(b.theme, 'dark');
});

// ── normalizeSettings 测试 ──

test('normalizeSettings returns defaults for null input', () => {
  const result = normalizeSettings(null);
  assert.deepEqual(result, DEFAULT_SETTINGS);
});

test('normalizeSettings returns defaults for undefined input', () => {
  const result = normalizeSettings(undefined);
  assert.deepEqual(result, DEFAULT_SETTINGS);
});

test('normalizeSettings returns defaults for non-object input', () => {
  assert.deepEqual(normalizeSettings('string'), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings(42), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings(true), DEFAULT_SETTINGS);
});

test('normalizeSettings normalizes valid proxyMode', () => {
  assert.equal(normalizeSettings({ proxyMode: 'custom' }).proxyMode, 'custom');
  assert.equal(normalizeSettings({ proxyMode: 'direct' }).proxyMode, 'direct');
  assert.equal(normalizeSettings({ proxyMode: 'system' }).proxyMode, 'system');
});

test('normalizeSettings rejects invalid proxyMode', () => {
  assert.equal(normalizeSettings({ proxyMode: 'invalid' }).proxyMode, 'system');
  assert.equal(normalizeSettings({ proxyMode: '' }).proxyMode, 'system');
});

test('normalizeSettings normalizes valid proxyUrl', () => {
  assert.equal(normalizeSettings({ proxyUrl: 'http://127.0.0.1:7897' }).proxyUrl, 'http://127.0.0.1:7897');
  assert.equal(normalizeSettings({ proxyUrl: 'socks5://127.0.0.1:1080' }).proxyUrl, 'socks5://127.0.0.1:1080');
});

test('normalizeSettings rejects invalid proxyUrl', () => {
  assert.equal(normalizeSettings({ proxyUrl: 'invalid' }).proxyUrl, DEFAULT_SETTINGS.proxyUrl);
  assert.equal(normalizeSettings({ proxyUrl: 'ftp://example.com' }).proxyUrl, DEFAULT_SETTINGS.proxyUrl);
  assert.equal(normalizeSettings({ proxyUrl: '' }).proxyUrl, DEFAULT_SETTINGS.proxyUrl);
});

test('normalizeSettings normalizes restoreSnapshot', () => {
  assert.equal(normalizeSettings({ restoreSnapshot: true }).restoreSnapshot, true);
  assert.equal(normalizeSettings({ restoreSnapshot: false }).restoreSnapshot, false);
  assert.equal(normalizeSettings({ restoreSnapshot: 'yes' }).restoreSnapshot, false);
});

test('normalizeSettings normalizes shortcutEnabled', () => {
  assert.equal(normalizeSettings({ shortcutEnabled: true }).shortcutEnabled, true);
  assert.equal(normalizeSettings({ shortcutEnabled: false }).shortcutEnabled, false);
  assert.equal(normalizeSettings({ shortcutEnabled: undefined }).shortcutEnabled, true);
});

test('normalizeSettings normalizes shortcutAccelerator', () => {
  assert.equal(normalizeSettings({ shortcutAccelerator: 'Ctrl+Shift+A' }).shortcutAccelerator, 'Ctrl+Shift+A');
});

test('normalizeSettings rejects invalid shortcutAccelerator', () => {
  assert.equal(normalizeSettings({ shortcutAccelerator: 'invalid' }).shortcutAccelerator, DEFAULT_SETTINGS.shortcutAccelerator);
  assert.equal(normalizeSettings({ shortcutAccelerator: '' }).shortcutAccelerator, DEFAULT_SETTINGS.shortcutAccelerator);
});

test('normalizeSettings normalizes theme', () => {
  assert.equal(normalizeSettings({ theme: 'light' }).theme, 'light');
  assert.equal(normalizeSettings({ theme: 'dark' }).theme, 'dark');
  assert.equal(normalizeSettings({ theme: 'invalid' }).theme, 'dark');
});

test('normalizeSettings normalizes closeAction', () => {
  assert.equal(normalizeSettings({ closeAction: 'ask' }).closeAction, 'ask');
  assert.equal(normalizeSettings({ closeAction: 'minimize' }).closeAction, 'minimize');
  assert.equal(normalizeSettings({ closeAction: 'quit' }).closeAction, 'quit');
  assert.equal(normalizeSettings({ closeAction: 'invalid' }).closeAction, 'ask');
});

test('normalizeSettings normalizes trayMemoryMode', () => {
  assert.equal(normalizeSettings({ trayMemoryMode: 'keepAll' }).trayMemoryMode, 'keepAll');
  assert.equal(normalizeSettings({ trayMemoryMode: 'closeInactive' }).trayMemoryMode, 'closeInactive');
  assert.equal(normalizeSettings({ trayMemoryMode: 'hibernateAll' }).trayMemoryMode, 'hibernateAll');
  assert.equal(normalizeSettings({ trayMemoryMode: 'invalid' }).trayMemoryMode, 'keepAll');
});

test('normalizeSettings normalizes maxAliveViews', () => {
  assert.equal(normalizeSettings({ maxAliveViews: 5 }).maxAliveViews, 5);
  assert.equal(normalizeSettings({ maxAliveViews: 15 }).maxAliveViews, 12);
  assert.equal(normalizeSettings({ maxAliveViews: 0 }).maxAliveViews, 0);
  assert.equal(normalizeSettings({ maxAliveViews: -1 }).maxAliveViews, 0);
  assert.equal(normalizeSettings({ maxAliveViews: 'abc' }).maxAliveViews, 0);
  assert.equal(normalizeSettings({ maxAliveViews: 3.7 }).maxAliveViews, 3);
});

test('normalizeSettings normalizes autoReclaimEnabled', () => {
  assert.equal(normalizeSettings({ autoReclaimEnabled: true }).autoReclaimEnabled, true);
  assert.equal(normalizeSettings({ autoReclaimEnabled: false }).autoReclaimEnabled, false);
  assert.equal(normalizeSettings({ autoReclaimEnabled: 'yes' }).autoReclaimEnabled, false);
});

test('normalizeSettings normalizes memoryPressureMb', () => {
  assert.equal(normalizeSettings({ memoryPressureMb: 3000 }).memoryPressureMb, 3000);
  assert.equal(normalizeSettings({ memoryPressureMb: 100 }).memoryPressureMb, 2500);
  assert.equal(normalizeSettings({ memoryPressureMb: 20000 }).memoryPressureMb, 16000);
  assert.equal(normalizeSettings({ memoryPressureMb: 'abc' }).memoryPressureMb, 2500);
});

test('normalizeSettings normalizes idleReclaimEnabled', () => {
  assert.equal(normalizeSettings({ idleReclaimEnabled: true }).idleReclaimEnabled, true);
  assert.equal(normalizeSettings({ idleReclaimEnabled: false }).idleReclaimEnabled, false);
  assert.equal(normalizeSettings({ idleReclaimEnabled: undefined }).idleReclaimEnabled, true);
});

test('normalizeSettings normalizes inactiveViewTtlMinutes', () => {
  assert.equal(normalizeSettings({ inactiveViewTtlMinutes: 60 }).inactiveViewTtlMinutes, 60);
  assert.equal(normalizeSettings({ inactiveViewTtlMinutes: -1 }).inactiveViewTtlMinutes, 30);
  assert.equal(normalizeSettings({ inactiveViewTtlMinutes: 2000 }).inactiveViewTtlMinutes, 1440);
  assert.equal(normalizeSettings({ inactiveViewTtlMinutes: 'abc' }).inactiveViewTtlMinutes, 30);
});

// ── normalizeShortcut 测试 ──

test('normalizeShortcut returns null for non-string', () => {
  assert.equal(normalizeShortcut(null), null);
  assert.equal(normalizeShortcut(undefined), null);
  assert.equal(normalizeShortcut(42), null);
});

test('normalizeShortcut normalizes valid shortcuts', () => {
  assert.equal(normalizeShortcut('Ctrl+Shift+Space'), 'Ctrl+Shift+Space');
  assert.equal(normalizeShortcut('ctrl+shift+a'), 'Ctrl+Shift+A');
  assert.equal(normalizeShortcut('Alt+F4'), 'Alt+F4');
});

test('normalizeShortcut returns null for shortcuts without modifiers', () => {
  assert.equal(normalizeShortcut('A'), null);
  assert.equal(normalizeShortcut('Space'), null);
});

test('normalizeShortcut returns null for modifier-only shortcuts', () => {
  assert.equal(normalizeShortcut('Ctrl+'), null);
  assert.equal(normalizeShortcut('Ctrl+Ctrl'), null);
});

test('normalizeShortcut handles F-keys', () => {
  assert.equal(normalizeShortcut('Ctrl+F1'), 'Ctrl+F1');
  assert.equal(normalizeShortcut('Ctrl+F12'), 'Ctrl+F12');
});

test('normalizeShortcut handles arrow keys', () => {
  assert.equal(normalizeShortcut('Ctrl+ArrowUp'), 'Ctrl+Up');
  assert.equal(normalizeShortcut('Ctrl+ArrowDown'), 'Ctrl+Down');
});

test('normalizeShortcut handles special key names', () => {
  assert.equal(normalizeShortcut('Ctrl+Space'), 'Ctrl+Space');
  assert.equal(normalizeShortcut('Ctrl+Esc'), 'Ctrl+Esc');
  assert.equal(normalizeShortcut('Ctrl+Return'), 'Ctrl+Enter');
});

test('normalizeShortcut deduplicates modifiers', () => {
  assert.equal(normalizeShortcut('Ctrl+Ctrl+A'), 'Ctrl+A');
});

// ── migrateSettings 测试 ──

test('migrateSettings normalizes old settings', () => {
  const old = { theme: 'light', memoryPressureMb: 3000 };
  const result = migrateSettings(old);
  assert.equal(result.theme, 'light');
  assert.equal(result.memoryPressureMb, 3000);
});

test('migrateSettings fixes space-separated shortcut', () => {
  const old = { shortcutAccelerator: 'Ctrl + Shift + A' };
  const result = migrateSettings(old);
  assert.equal(result.shortcutAccelerator, 'Ctrl+Shift+A');
});

test('migrateSettings returns defaults for null input', () => {
  const result = migrateSettings(null);
  assert.deepEqual(result, DEFAULT_SETTINGS);
});

test('migrateSettings returns defaults for empty object', () => {
  const result = migrateSettings({});
  assert.deepEqual(result, DEFAULT_SETTINGS);
});

test('migrateSettings fixes invalid theme', () => {
  const old = { theme: 'invalid' };
  const result = migrateSettings(old);
  assert.equal(result.theme, 'dark');
});

test('migrateSettings fixes invalid memoryPressureMb', () => {
  const old = { memoryPressureMb: 100 };
  const result = migrateSettings(old);
  assert.equal(result.memoryPressureMb, 2500);
});

test('migrateSettings fixes invalid inactiveViewTtlMinutes', () => {
  const old = { inactiveViewTtlMinutes: -5 };
  const result = migrateSettings(old);
  assert.equal(result.inactiveViewTtlMinutes, 30);
});

test('migrateSettings fixes invalid maxAliveViews', () => {
  const old = { maxAliveViews: -1 };
  const result = migrateSettings(old);
  assert.equal(result.maxAliveViews, 0);
});

test('migrateSettings does not mutate original', () => {
  const old = { theme: 'light', memoryPressureMb: 3000 };
  const original = { ...old };
  migrateSettings(old);
  assert.deepEqual(old, original);
});
