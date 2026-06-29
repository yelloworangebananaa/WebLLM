import { config } from './config.js';

const cache = new Map();

export function getCached(tabId, hash) {
  const entry = cache.get(tabId);
  if (entry && entry.hash === hash) {
    return entry;
  }
  return null;
}

export function getCachedEntry(tabId) {
  return cache.get(tabId) ?? null;
}

export function setCached(tabId, hash, imageBase64, contentProfile = 'text') {
  cache.set(tabId, {
    hash,
    imageBase64,
    contentProfile,
    capturedAt: Date.now(),
  });

  if (cache.size > config.tabCacheMaxEntries) {
    let oldestKey = null;
    let oldestAt = Infinity;
    for (const [key, value] of cache.entries()) {
      if (value.capturedAt < oldestAt) {
        oldestAt = value.capturedAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) {
      cache.delete(oldestKey);
    }
  }
}

export function clearTabCache() {
  cache.clear();
}
