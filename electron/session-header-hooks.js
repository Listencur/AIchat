'use strict';

const installedSessions = new WeakSet();

function setHeader(headers, name, value) {
  const existing = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  if (existing && existing !== name) delete headers[existing];
  headers[name] = value;
}

function installSessionHeaderHook(ses, chromeVersion) {
  if (!ses || installedSessions.has(ses)) return false;
  const version = String(chromeVersion || process.versions.chrome || '130').split('.')[0];
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    try {
      const url = new URL(details.url);
      const headers = { ...(details.requestHeaders || {}) };
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        setHeader(headers, 'sec-ch-ua', `"Chromium";v="${version}", "Not;A=Brand";v="99", "Google Chrome";v="${version}"`);
        setHeader(headers, 'sec-ch-ua-mobile', '?0');
        setHeader(headers, 'sec-ch-ua-platform', '"Windows"');
      }
      callback({ requestHeaders: headers });
    } catch {
      callback({ requestHeaders: details.requestHeaders || {} });
    }
  });
  installedSessions.add(ses);
  return true;
}

module.exports = { installSessionHeaderHook };
