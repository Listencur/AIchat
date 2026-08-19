'use strict';

function generateGroupId(name) {
  const base = String(name || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `group-${base || 'custom'}-${Date.now().toString(36)}`;
}

function normalizeGroupsData(data) {
  const groups = Array.isArray(data.groups) ? data.groups : [];
  return {
    groups: groups
      .filter((group) => group && typeof group.name === 'string' && Array.isArray(group.modelIds))
      .map((group) => ({
        id: String(group.id || generateGroupId(group.name)),
        name: group.name.trim(),
        modelIds: group.modelIds.map(String),
      }))
      .filter((group) => group.name && group.modelIds.length > 0),
  };
}

function readJsonFile(filePath, fallback, fs) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.error(`[group-store] Failed to read JSON: ${filePath}`, error);
    return fallback;
  }
}

class GroupStore {
  constructor(deps = {}) {
    this.fs = deps.fs || require('fs');
    this.path = deps.path || require('path');
    this.app = deps.app;
    this.userGroupsPath = deps.userGroupsPath || '';
    this._store = deps.store || null;
  }

  setStore(store) {
    this._store = store;
  }

  load() {
    if (this._store) return this._store.get().groups;
    if (!this.fs.existsSync(this.userGroupsPath)) {
      this.save([]);
      return [];
    }
    return normalizeGroupsData(readJsonFile(this.userGroupsPath, { groups: [] }, this.fs)).groups;
  }

  save(groups) {
    const data = normalizeGroupsData({ groups });
    if (this._store) {
      this._store.replace(data);
      this._store.schedulePersist(250);
      return data.groups;
    }
    this.fs.writeFileSync(this.userGroupsPath, JSON.stringify(data, null, 2), 'utf-8');
    return data.groups;
  }

  purgeModelReferences(modelId) {
    const groups = this.load()
      .map((group) => ({
        ...group,
        modelIds: group.modelIds.filter((gid) => gid !== modelId),
      }))
      .filter((group) => group.modelIds.length > 0);
    return this.save(groups);
  }
}

module.exports = {
  GroupStore,
  generateGroupId,
  normalizeGroupsData,
};
