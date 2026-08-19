'use strict';

const chatgpt = require('./chatgpt');
const deepseek = require('./deepseek');
const gemini = require('./gemini');
const qwen = require('./qwen');
const grok = require('./grok');
const generic = require('./generic-fill');

const adapters = [chatgpt, deepseek, gemini, qwen, grok];

function getAdapter(url) {
  for (const adapter of adapters) {
    try {
      if (adapter.matches(url)) return adapter;
    } catch {
      // 继续尝试下一个适配器
    }
  }
  return generic;
}

function getAdapterById(id) {
  if (id === generic.id) return generic;
  const adapter = adapters.find((a) => a.id === id);
  return adapter || null;
}

function listAdapters() {
  return [...adapters];
}

function matchSite(url) {
  for (const adapter of adapters) {
    try {
      if (adapter.matches(url)) return { matched: true, adapterId: adapter.id };
    } catch {
      // 继续尝试
    }
  }
  return { matched: false, adapterId: generic.id };
}

function resolveAdapter(url) {
  return getAdapter(url);
}

module.exports = {
  getAdapter,
  getAdapterById,
  listAdapters,
  matchSite,
  resolveAdapter,
};
