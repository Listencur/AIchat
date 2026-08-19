'use strict';

const { pathToFileURL } = require('url');
const { createPartitionForModelId, getModelCapabilities } = require('./model-policy');

const LOCAL_ICON_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.svg']);

function readJsonFile(filePath, fallback, fs) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.error(`[model-store] Failed to read JSON: ${filePath}`, error);
    return fallback;
  }
}

function isRestorableUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function appendUniqueIconUrl(list, iconUrl) {
  if (typeof iconUrl !== 'string') return;
  const value = iconUrl.trim();
  if (!value || list.includes(value)) return;
  list.push(value);
}

function buildFaviconUrls(url) {
  const candidates = [];
  if (typeof url !== 'string' || !url) return candidates;
  try {
    const parsed = new URL(url);
    appendUniqueIconUrl(candidates, `${parsed.origin}/favicon.ico`);
    appendUniqueIconUrl(candidates, `${parsed.origin}/favicon.svg`);
    appendUniqueIconUrl(candidates, `${parsed.origin}/apple-touch-icon.png`);
    appendUniqueIconUrl(candidates, `${parsed.origin}/apple-touch-icon-precomposed.png`);
    appendUniqueIconUrl(candidates, `${parsed.origin}/favicon-32x32.png`);
    appendUniqueIconUrl(candidates, `${parsed.origin}/favicon-16x16.png`);
    appendUniqueIconUrl(candidates, `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=64`);
    appendUniqueIconUrl(candidates, `https://icons.duckduckgo.com/ip3/${parsed.hostname}.ico`);
  } catch {
    return candidates;
  }
  return candidates;
}

function normalizeIconUrls(value) {
  const urls = [];
  const rawUrls = Array.isArray(value) ? value : [];
  rawUrls.forEach((item) => appendUniqueIconUrl(urls, item));
  return urls;
}

function buildModelIconUrls(url, preferredUrl = '', existingUrls = []) {
  const urls = [];
  appendUniqueIconUrl(urls, preferredUrl);
  normalizeIconUrls(existingUrls).forEach((item) => appendUniqueIconUrl(urls, item));
  buildFaviconUrls(url).forEach((item) => appendUniqueIconUrl(urls, item));
  return urls;
}

function isSupportedIconPath(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;
  return LOCAL_ICON_EXTENSIONS.has(require('path').extname(filePath).toLowerCase());
}

function normalizeModelIcon(model) {
  const iconUrls = buildModelIconUrls(model.url, model.iconUrl, model.iconUrls);
  return {
    ...model,
    icon: model.icon || '🤖',
    iconUrl: iconUrls[0] || '',
    iconUrls,
  };
}

class ModelStore {
  constructor(deps = {}) {
    this.fs = deps.fs || require('fs');
    this.path = deps.path || require('path');
    this.app = deps.app;
    this.defaultModelsPath = deps.defaultModelsPath || '';
    this.userModelsPath = deps.userModelsPath || '';
    this.userModelIconsDir = deps.userModelIconsDir || '';
  }

  _readDefaultModelsData() {
    const data = readJsonFile(this.defaultModelsPath, { configVersion: 1, models: [] }, this.fs);
    return {
      configVersion: data.configVersion || 1,
      models: Array.isArray(data.models) ? data.models : [],
    };
  }

  _writeUserModelsData(data) {
    this.fs.writeFileSync(this.userModelsPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  _buildInitialUserModelsData(defaultData) {
    return {
      configVersion: defaultData.configVersion,
      models: defaultData.models.map(normalizeModelIcon),
      removedDefaultModelIds: [],
    };
  }

  _syncUserModelsData(userData, defaultData) {
    const userModels = Array.isArray(userData.models) ? userData.models : [];
    const removedDefaultModelIds = Array.isArray(userData.removedDefaultModelIds)
      ? userData.removedDefaultModelIds
      : [];

    const defaultIds = new Set(defaultData.models.map((model) => model.id));
    const defaultById = new Map(defaultData.models.map((model) => [model.id, model]));
    const removedSet = new Set(removedDefaultModelIds);
    const seenIds = new Set();
    const models = [];

    for (const userModel of userModels) {
      if (!userModel || !userModel.id || seenIds.has(userModel.id)) continue;
      if (defaultIds.has(userModel.id)) {
        if (removedSet.has(userModel.id)) continue;
        const defaultModel = defaultById.get(userModel.id);
        models.push(normalizeModelIcon({
          ...defaultModel,
          ...userModel,
          id: defaultModel.id,
          partition: userModel.partition || defaultModel.partition,
        }));
        seenIds.add(userModel.id);
        continue;
      }
      models.push(normalizeModelIcon(userModel));
      seenIds.add(userModel.id);
    }

    for (const defaultModel of defaultData.models) {
      if (!seenIds.has(defaultModel.id) && !removedSet.has(defaultModel.id)) {
        models.push(normalizeModelIcon(defaultModel));
        seenIds.add(defaultModel.id);
      }
    }

    return {
      configVersion: defaultData.configVersion,
      models,
      removedDefaultModelIds: removedDefaultModelIds.filter((id) => defaultIds.has(id)),
    };
  }

  _readUserModelsData() {
    const defaultData = this._readDefaultModelsData();
    if (!this.fs.existsSync(this.userModelsPath)) {
      const initialData = this._buildInitialUserModelsData(defaultData);
      this._writeUserModelsData(initialData);
      return initialData;
    }
    const userData = readJsonFile(this.userModelsPath, this._buildInitialUserModelsData(defaultData), this.fs);
    const syncedData = this._syncUserModelsData(userData, defaultData);
    if (JSON.stringify(userData) !== JSON.stringify(syncedData)) {
      this._writeUserModelsData(syncedData);
    }
    return syncedData;
  }

  list() {
    return this._readUserModelsData().models.map((model) => ({
      ...model,
      capabilities: getModelCapabilities(model),
    }));
  }

  add(config) {
    const rawConfig = config && typeof config === 'object' ? config : {};
    const id = generateModelId(rawConfig.name, this.path);
    const iconUrls = resolveModelIconUrls(rawConfig, id, rawConfig.url, this.fs, this.userModelIconsDir, this.path);
    const newModel = {
      id,
      name: rawConfig.name,
      url: rawConfig.url,
      icon: rawConfig.icon || '🤖',
      iconUrl: iconUrls[0] || '',
      iconUrls,
      color: rawConfig.color || '#666666',
      partition: createPartitionForModelId(id),
    };
    const data = this._readUserModelsData();
    data.models.push(newModel);
    this._writeUserModelsData(data);
    return { ...newModel, capabilities: getModelCapabilities(newModel) };
  }

  update(id, config) {
    const rawConfig = config && typeof config === 'object' ? config : {};
    const name = typeof rawConfig.name === 'string' ? rawConfig.name.trim() : '';
    const url = typeof rawConfig.url === 'string' ? rawConfig.url.trim() : '';
    if (!name || !/^https?:\/\/.+/.test(url)) return null;

    const data = this._readUserModelsData();
    const index = data.models.findIndex((model) => model.id === id);
    if (index === -1) return null;

    const iconUrls = resolveModelIconUrls(rawConfig, id, url, this.fs, this.userModelIconsDir, this.path);
    const updatedModel = {
      ...data.models[index],
      name,
      url,
      icon: typeof rawConfig.icon === 'string' && rawConfig.icon.trim() ? rawConfig.icon.trim() : '🤖',
      iconUrl: iconUrls[0] || '',
      iconUrls,
      color: typeof rawConfig.color === 'string' && rawConfig.color ? rawConfig.color : '#666666',
    };

    data.models[index] = updatedModel;
    this._writeUserModelsData(data);
    return { ...updatedModel, capabilities: getModelCapabilities(updatedModel) };
  }

  remove(id) {
    const data = this._readUserModelsData();
    const defaultIds = new Set(this._readDefaultModelsData().models.map((item) => item.id));
    data.models = data.models.filter((m) => m.id !== id);
    if (defaultIds.has(id) && !data.removedDefaultModelIds.includes(id)) {
      data.removedDefaultModelIds.push(id);
    }
    this._writeUserModelsData(data);
    return true;
  }

  reorder(orderedIds) {
    if (!Array.isArray(orderedIds)) return this.list();
    const models = this.list();
    const byId = new Map(models.map((model) => [model.id, model]));
    const nextModels = [];
    const usedIds = new Set();
    orderedIds.map(String).forEach((id) => {
      const model = byId.get(id);
      if (model && !usedIds.has(id)) {
        nextModels.push(model);
        usedIds.add(id);
      }
    });
    models.forEach((model) => {
      if (!usedIds.has(model.id)) nextModels.push(model);
    });
    const data = this._readUserModelsData();
    data.models = nextModels.map((m) => {
      const cap = m.capabilities;
      const { capabilities, ...rest } = m;
      return rest;
    });
    this._writeUserModelsData(data);
    return nextModels;
  }

  removeLocalIcons(modelId) {
    const safeId = String(modelId || '').replace(/[^a-z0-9_-]/gi, '-');
    if (!safeId || !this.fs.existsSync(this.userModelIconsDir)) return 0;
    let removed = 0;
    for (const entry of this.fs.readdirSync(this.userModelIconsDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.startsWith(`${safeId}-`)) continue;
      try {
        this.fs.unlinkSync(this.path.join(this.userModelIconsDir, entry.name));
        removed += 1;
      } catch (error) {
        console.warn(`[model-store] remove model icon failed (${entry.name}):`, error.message);
      }
    }
    return removed;
  }
}

function generateModelId(name, pathMod) {
  const base = String(name || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `${base}-${Date.now().toString(36)}`;
}

function resolveModelIconUrls(rawConfig, modelId, url, fs, userModelIconsDir, pathMod) {
  if (rawConfig.localIconPath) {
    const copiedUrl = copyLocalModelIcon(modelId, rawConfig.localIconPath, fs, userModelIconsDir, pathMod);
    if (copiedUrl) return [copiedUrl];
  }
  if (typeof rawConfig.iconUrl === 'string' && rawConfig.iconUrl.trim()) {
    return buildModelIconUrls(url, rawConfig.iconUrl.trim(), rawConfig.iconUrls);
  }
  return buildModelIconUrls(url, '', rawConfig.iconUrls);
}

function copyLocalModelIcon(modelId, sourcePath, fs, userModelIconsDir, pathMod) {
  if (!isSupportedIconPath(sourcePath) || !fs.existsSync(sourcePath)) return '';
  const stat = fs.statSync(sourcePath);
  if (!stat.isFile()) return '';
  fs.mkdirSync(userModelIconsDir, { recursive: true });
  const ext = pathMod.extname(sourcePath).toLowerCase();
  const safeId = String(modelId).replace(/[^a-z0-9_-]/gi, '-');
  const targetPath = pathMod.join(userModelIconsDir, `${safeId}-${Date.now()}${ext}`);
  fs.copyFileSync(sourcePath, targetPath);
  return pathToFileURL(targetPath).href;
}

module.exports = {
  ModelStore,
  generateModelId,
  isRestorableUrl,
  buildModelIconUrls,
  normalizeModelIcon,
  normalizeIconUrls,
  isSupportedIconPath,
};
