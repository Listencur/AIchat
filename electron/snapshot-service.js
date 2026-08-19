'use strict';

const { isSameModelOrigin } = require('./model-policy');
const { isRestorableUrl } = require('./model-store');

const SNAPSHOT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

function readJsonFile(filePath, fallback, fs) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.error(`[snapshot-service] Failed to read JSON: ${filePath}`, error);
    return fallback;
  }
}

function normalizeSnapshot(data) {
  const raw = data && typeof data === 'object' ? data : {};
  const savedAt = typeof raw.savedAt === 'string' ? raw.savedAt : '';
  const savedTime = savedAt ? Date.parse(savedAt) : 0;
  const isFresh = savedTime > 0 && Date.now() - savedTime <= SNAPSHOT_MAX_AGE_MS;
  const entries = Array.isArray(raw.entries) ? raw.entries : [];
  const splitIds = Array.isArray(raw.splitIds) ? raw.splitIds.map(String) : [];
  const splitRatios = Array.isArray(raw.splitRatios)
    ? raw.splitRatios.map(Number).filter((ratio) => ratio > 0)
    : [];

  if (!isFresh) {
    return {
      version: 1,
      savedAt: '',
      activeModelId: '',
      splitMode: false,
      splitIds: [],
      splitRatios: [],
      splitDirection: 'horizontal',
      entries: [],
    };
  }

  return {
    version: 1,
    savedAt,
    activeModelId: typeof raw.activeModelId === 'string' ? raw.activeModelId : '',
    splitMode: raw.splitMode === true,
    splitIds: splitIds.slice(0, 3),
    splitRatios: splitRatios.slice(0, 3),
    splitDirection: raw.splitDirection === 'vertical' ? 'vertical' : 'horizontal',
    entries: entries
      .filter((entry) => entry && typeof entry.modelId === 'string' && isRestorableUrl(entry.url))
      .map((entry) => ({
        modelId: entry.modelId,
        url: entry.url,
        scrollY: Math.max(0, Number(entry.scrollY) || 0),
      })),
  };
}

class SnapshotService {
  constructor(deps = {}) {
    this.fs = deps.fs || require('fs');
    this.path = deps.path || require('path');
    this.app = deps.app;
    this.userSnapshotPath = deps.userSnapshotPath || '';
    this._store = deps.store || null;
    this._loadModelsFn = deps.loadModelsFn || (() => []);
  }

  setStore(store) {
    this._store = store;
  }

  load() {
    if (this._store) {
      const snapshot = this._store.get();
      this._validateEntries(snapshot);
      return snapshot;
    }
    if (!this.fs.existsSync(this.userSnapshotPath)) {
      return normalizeSnapshot(null);
    }
    const snapshot = normalizeSnapshot(readJsonFile(this.userSnapshotPath, {}, this.fs));
    this._validateEntries(snapshot);
    return snapshot;
  }

  save(snapshot) {
    const normalized = normalizeSnapshot({
      ...snapshot,
      savedAt: snapshot && snapshot.savedAt ? snapshot.savedAt : new Date().toISOString(),
    });
    if (this._store) {
      this._store.replace(normalized);
      this._store.schedulePersist(250);
      return normalized;
    }
    this.fs.writeFileSync(this.userSnapshotPath, JSON.stringify(normalized, null, 2), 'utf-8');
    return normalized;
  }

  _validateEntries(snapshot) {
    const modelsById = new Map(this._loadModelsFn().map((model) => [model.id, model]));
    snapshot.entries = snapshot.entries.filter((entry) => {
      const model = modelsById.get(entry.modelId);
      return model && isSameModelOrigin(entry.url, model.url);
    });
  }

  purgeModelEntries(modelId) {
    const snapshot = this.load();
    const nextEntries = (snapshot.entries || []).filter((entry) => entry.modelId !== modelId);
    const nextSplitIds = (snapshot.splitIds || []).filter((id) => id !== modelId);
    const next = {
      ...snapshot,
      activeModelId: snapshot.activeModelId === modelId ? '' : snapshot.activeModelId,
      splitMode: nextSplitIds.length >= 2 ? snapshot.splitMode : false,
      splitIds: nextSplitIds.length >= 2 ? nextSplitIds : [],
      splitRatios: nextSplitIds.length >= 2 ? nextSplitIds.map(() => 1 / nextSplitIds.length) : [],
      entries: nextEntries,
    };
    return this.save(next);
  }
}

module.exports = {
  SnapshotService,
  normalizeSnapshot,
  SNAPSHOT_MAX_AGE_MS,
};
