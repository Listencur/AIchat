'use strict';

function getPersistPartition(model) {
  const partition = model && typeof model.partition === 'string' ? model.partition.trim() : '';
  if (partition.startsWith('persist:') && partition.length > 'persist:'.length) return partition;
  const id = model && typeof model.id === 'string' ? model.id.trim() : '';
  return id ? `persist:model-${id}` : '';
}

function createPartitionForModelId(modelId) {
  const id = String(modelId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-');
  if (!id) throw new Error('model id is required for a persistent partition');
  return `persist:model-${id}`;
}

function isModelUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname));
  } catch {
    return false;
  }
}

function isSameModelOrigin(candidateUrl, modelUrl) {
  try {
    const candidate = new URL(candidateUrl);
    const model = new URL(modelUrl);
    return isModelUrl(candidate.href) && candidate.origin === model.origin;
  } catch {
    return false;
  }
}

function getAdapterId(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'chatgpt.com' || host.endsWith('.chatgpt.com') || host === 'chat.openai.com') return 'chatgpt';
    if (host === 'gemini.google.com') return 'gemini';
    if (host === 'chat.deepseek.com') return 'deepseek';
  } catch {
    // Fall through to the conservative generic adapter.
  }
  return 'generic-fill';
}

function getModelCapabilities(model) {
  const adapterId = getAdapterId(model && model.url);
  const supported = adapterId !== 'generic-fill';
  return {
    adapterId,
    canFillPrompt: true,
    canAutoSend: supported,
  };
}

module.exports = {
  createPartitionForModelId,
  getAdapterId,
  getModelCapabilities,
  getPersistPartition,
  isModelUrl,
  isSameModelOrigin,
};
