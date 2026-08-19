'use strict';

const { getModelCapabilities, isSameModelOrigin } = require('./model-policy');
const { resolveAdapter } = require('./site-adapters/registry');

function resolveSiteAdapter(model, currentUrl) {
  const url = currentUrl || (model && model.url) || '';
  const spec = resolveAdapter(url);
  return {
    id: spec.id,
    spec,
    capabilities: getModelCapabilities({ ...(model || {}), url }),
    isExpectedOrigin: Boolean(model && isSameModelOrigin(url, model.url)),
  };
}

module.exports = { resolveSiteAdapter };
