'use strict';

const { getPersistPartition } = require('./model-policy');

const CACHE_STORAGE_TYPES = ['cachestorage'];
const LOGIN_STORAGE_TYPES = [
  'cookies',
  'filesystem',
  'indexdb',
  'localstorage',
  'serviceworkers',
  'cachestorage',
  'websql',
];

function getPartitionDirName(partitionName) {
  return String(partitionName || '').replace(/[^a-zA-Z0-9_-]/g, (ch) => {
    const code = ch.charCodeAt(0).toString(16).toUpperCase();
    return code.length === 2 ? code : `0${code}`;
  });
}

function getPersistPartitionName(model) {
  const partition = getPersistPartition(model);
  if (!partition.startsWith('persist:')) return '';
  return partition.slice('persist:'.length).trim();
}

class SessionManager {
  constructor(deps = {}) {
    this.app = deps.app;
    this.session = deps.session;
    this.fs = deps.fs || require('fs');
    this.path = deps.path || require('path');
    this.diskCachePath = deps.diskCachePath || '';
  }

  getKnownPersistPartitionNames(loadModelsFn) {
    const names = new Set();
    for (const model of loadModelsFn()) {
      const name = getPersistPartitionName(model);
      if (name) names.add(name);
    }
    const userDataPath = this.app.getPath('userData');
    const partitionsDir = this.path.join(userDataPath, 'Partitions');
    if (this.fs.existsSync(partitionsDir)) {
      for (const entry of this.fs.readdirSync(partitionsDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name) names.add(entry.name);
      }
    }
    return Array.from(names);
  }

  getManagedSessions(loadModelsFn) {
    const sessions = new Map([['default', this.session.defaultSession]]);
    for (const name of this.getKnownPersistPartitionNames(loadModelsFn)) {
      sessions.set(`persist:${name}`, this.session.fromPartition(`persist:${name}`));
    }
    return Array.from(sessions, ([partition, ses]) => ({ partition, ses }));
  }

  async clearSessionCacheData(ses) {
    if (typeof ses.clearCache === 'function') await ses.clearCache();
    if (typeof ses.clearCodeCaches === 'function') {
      try { await ses.clearCodeCaches({}); } catch { /* 部分 Electron 版本无此 API */ }
    }
    if (typeof ses.clearStorageData === 'function') {
      await ses.clearStorageData({ storages: CACHE_STORAGE_TYPES });
    }
    if (typeof ses.clearHostResolverCache === 'function') {
      try { await ses.clearHostResolverCache(); } catch { /* ignore */ }
    }
  }

  async clearSessionLoginData(ses) {
    await ses.clearCache();
    await ses.clearStorageData({ storages: LOGIN_STORAGE_TYPES });
    if (typeof ses.clearAuthCache === 'function') await ses.clearAuthCache();
    if (ses.cookies && typeof ses.cookies.flushStore === 'function') {
      await ses.cookies.flushStore();
    }
  }

  clearTempDiskCache() {
    if (!this.diskCachePath) return false;
    const tempDir = this.app.getPath('temp');
    const resolvedCachePath = this.path.resolve(this.diskCachePath);
    const resolvedTempDir = this.path.resolve(tempDir);
    if (!resolvedCachePath.startsWith(resolvedTempDir) || this.path.basename(resolvedCachePath) !== 'ai-chat-hub-cache') {
      return false;
    }
    try {
      this.fs.rmSync(resolvedCachePath, { recursive: true, force: true });
      return true;
    } catch (error) {
      console.warn('[session-manager] clear temp disk cache failed:', error.message);
      return false;
    }
  }

  async clearCacheForModel(model) {
    const partition = getPersistPartition(model);
    if (!partition) return { ok: false, reason: 'no-partition' };
    const ses = this.session.fromPartition(partition);
    await this.clearSessionCacheData(ses);
    return { ok: true, partition };
  }

  async clearLoginStateForModel(model) {
    const partition = getPersistPartition(model);
    if (!partition) return { ok: false, reason: 'no-partition' };
    const ses = this.session.fromPartition(partition);
    try {
      await this.clearSessionLoginData(ses);
      if (typeof ses.clearStorageData === 'function') await ses.clearStorageData();
    } catch (error) {
      console.warn(`[session-manager] clear model session failed (${partition}):`, error.message);
    }
    return { ok: true, partition };
  }

  async removePartitionData(model) {
    const partition = getPersistPartition(model);
    if (!partition) return { ok: false, reason: 'no-partition' };
    const ses = this.session.fromPartition(partition);
    try {
      await this.clearSessionLoginData(ses);
      if (typeof ses.clearStorageData === 'function') await ses.clearStorageData();
    } catch (error) {
      console.warn(`[session-manager] clear model session failed (${partition}):`, error.message);
    }
    const partitionName = getPersistPartitionName(model);
    let diskRemoved = false;
    if (partitionName) {
      const partitionsRoot = this.path.join(this.app.getPath('userData'), 'Partitions');
      const candidates = Array.from(new Set([
        this.path.join(partitionsRoot, partitionName),
        this.path.join(partitionsRoot, getPartitionDirName(partitionName)),
      ]));
      for (const dir of candidates) {
        if (!this.fs.existsSync(dir)) continue;
        try {
          this.fs.rmSync(dir, { recursive: true, force: true });
          diskRemoved = true;
        } catch (error) {
          console.warn(`[session-manager] remove partition dir failed (${dir}):`, error.message);
        }
      }
    }
    return { ok: true, partition, diskRemoved };
  }

  async clearAllCache(loadModelsFn) {
    const sessions = this.getManagedSessions(loadModelsFn);
    for (const item of sessions) {
      await this.clearSessionCacheData(item.ses);
    }
    return {
      ok: true,
      sessions: sessions.length,
      diskCacheCleared: this.clearTempDiskCache(),
    };
  }

  async clearAllLoginState(loadModelsFn) {
    const sessions = this.getManagedSessions(loadModelsFn);
    for (const item of sessions) {
      await this.clearSessionLoginData(item.ses);
    }
    return {
      ok: true,
      sessions: sessions.length,
      diskCacheCleared: this.clearTempDiskCache(),
    };
  }

  createProxyOptions(settings) {
    if (settings.proxyMode === 'direct') return { mode: 'direct' };
    if (settings.proxyMode === 'custom') return { mode: 'fixed_servers', proxyRules: settings.proxyUrl };
    return { mode: 'system' };
  }
}

module.exports = {
  SessionManager,
  getPersistPartitionName,
  getPartitionDirName,
  CACHE_STORAGE_TYPES,
  LOGIN_STORAGE_TYPES,
};
