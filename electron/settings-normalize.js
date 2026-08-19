'use strict';

const PROXY_URL_PATTERN = /^(https?|socks5?):\/\/.+/;

const MODIFIER_LABELS = new Map([
  ['CTRL', 'Ctrl'], ['CONTROL', 'Ctrl'], ['CMDORCTRL', 'Ctrl'], ['COMMANDORCONTROL', 'Ctrl'],
  ['SHIFT', 'Shift'], ['ALT', 'Alt'], ['OPTION', 'Alt'], ['META', 'Meta'], ['SUPER', 'Meta'], ['WIN', 'Meta'],
]);

const KEY_LABELS = new Map([
  [' ', 'Space'], ['SPACEBAR', 'Space'], ['ESC', 'Esc'], ['ESCAPE', 'Esc'],
  ['RETURN', 'Enter'], ['ARROWUP', 'Up'], ['ARROWDOWN', 'Down'], ['ARROWLEFT', 'Left'], ['ARROWRIGHT', 'Right'],
]);

const DEFAULT_SETTINGS = {
  proxyMode: 'system',
  proxyUrl: 'http://127.0.0.1:7897',
  restoreSnapshot: false,
  shortcutEnabled: true,
  shortcutAccelerator: 'Ctrl+Shift+Space',
  theme: 'dark',
  closeAction: 'ask',
  trayMemoryMode: 'keepAll',
  maxAliveViews: 0,
  autoReclaimEnabled: false,
  memoryPressureMb: 2500,
  idleReclaimEnabled: true,
  inactiveViewTtlMinutes: 30,
};

function normalizeShortcut(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split('+').map((part) => part.trim()).filter(Boolean);
  const modifiers = [];
  let key = '';
  for (const part of parts) {
    const upper = part.toUpperCase();
    const modifier = MODIFIER_LABELS.get(upper);
    if (modifier) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
      continue;
    }
    if (key) return null;
    if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(part)) {
      key = part.toUpperCase();
    } else if (/^[A-Z0-9]$/i.test(part)) {
      key = part.toUpperCase();
    } else {
      key = KEY_LABELS.get(upper) || part;
    }
  }
  if (modifiers.length === 0 || !key || modifiers.includes(key)) return null;
  return [...modifiers, key].join('+');
}

function normalizeSettings(raw) {
  const rawSettings = raw && typeof raw === 'object' ? raw : {};
  const proxyMode = ['system', 'custom', 'direct'].includes(rawSettings.proxyMode)
    ? rawSettings.proxyMode
    : DEFAULT_SETTINGS.proxyMode;
  const proxyUrl = typeof rawSettings.proxyUrl === 'string' && PROXY_URL_PATTERN.test(rawSettings.proxyUrl.trim())
    ? rawSettings.proxyUrl.trim()
    : DEFAULT_SETTINGS.proxyUrl;
  const restoreSnapshot = rawSettings.restoreSnapshot === true;
  const shortcutEnabled = rawSettings.shortcutEnabled !== false;
  const shortcutAccelerator = normalizeShortcut(rawSettings.shortcutAccelerator) || DEFAULT_SETTINGS.shortcutAccelerator;
  const theme = rawSettings.theme === 'light' ? 'light' : 'dark';
  const closeAction = ['ask', 'minimize', 'quit'].includes(rawSettings.closeAction)
    ? rawSettings.closeAction
    : DEFAULT_SETTINGS.closeAction;
  const trayMemoryMode = ['keepAll', 'closeInactive', 'hibernateAll'].includes(rawSettings.trayMemoryMode)
    ? rawSettings.trayMemoryMode
    : DEFAULT_SETTINGS.trayMemoryMode;
  const maxAliveRaw = Number(rawSettings.maxAliveViews);
  const maxAliveViews = Number.isFinite(maxAliveRaw) && maxAliveRaw > 0
    ? Math.min(12, Math.floor(maxAliveRaw))
    : 0;
  const autoReclaimEnabled = rawSettings.autoReclaimEnabled === true;
  const pressureRaw = Number(rawSettings.memoryPressureMb);
  const memoryPressureMb = Number.isFinite(pressureRaw) && pressureRaw >= 500
    ? Math.min(16000, Math.floor(pressureRaw))
    : DEFAULT_SETTINGS.memoryPressureMb;
  const idleReclaimEnabled = rawSettings.idleReclaimEnabled !== false;
  const idleRaw = Number(rawSettings.inactiveViewTtlMinutes);
  const inactiveViewTtlMinutes = Number.isFinite(idleRaw) && idleRaw >= 0
    ? Math.min(1440, Math.floor(idleRaw))
    : DEFAULT_SETTINGS.inactiveViewTtlMinutes;
  return {
    proxyMode, proxyUrl, restoreSnapshot, shortcutEnabled, shortcutAccelerator,
    theme, closeAction, trayMemoryMode, maxAliveViews, autoReclaimEnabled,
    memoryPressureMb, idleReclaimEnabled, inactiveViewTtlMinutes,
  };
}

function getDefaultSettings() {
  return { ...DEFAULT_SETTINGS };
}

function migrateSettings(old) {
  const raw = old && typeof old === 'object' ? { ...old } : {};
  if (typeof raw.shortcutAccelerator === 'string' && raw.shortcutAccelerator.includes(' ')) {
    raw.shortcutAccelerator = raw.shortcutAccelerator.replace(/\s+/g, '+');
  }
  if (raw.theme !== 'light' && raw.theme !== 'dark') {
    raw.theme = DEFAULT_SETTINGS.theme;
  }
  if (!Number.isFinite(Number(raw.memoryPressureMb)) || Number(raw.memoryPressureMb) < 500) {
    raw.memoryPressureMb = DEFAULT_SETTINGS.memoryPressureMb;
  }
  if (!Number.isFinite(Number(raw.inactiveViewTtlMinutes)) || Number(raw.inactiveViewTtlMinutes) < 0) {
    raw.inactiveViewTtlMinutes = DEFAULT_SETTINGS.inactiveViewTtlMinutes;
  }
  if (!Number.isFinite(Number(raw.maxAliveViews)) || Number(raw.maxAliveViews) < 0) {
    raw.maxAliveViews = DEFAULT_SETTINGS.maxAliveViews;
  }
  return normalizeSettings(raw);
}

module.exports = {
  normalizeSettings,
  getDefaultSettings,
  migrateSettings,
  normalizeShortcut,
  DEFAULT_SETTINGS,
  PROXY_URL_PATTERN,
  MODIFIER_LABELS,
  KEY_LABELS,
};
