import test from 'node:test';
import assert from 'node:assert/strict';
import { getCached, setCached, clearTabCache } from '../extension/inference/tabCache.js';

test('getCached returns null when tab or hash misses', () => {
  clearTabCache();
  assert.equal(getCached(1, 'abc'), null);
  setCached(1, 'abc', 'img-data', 'text');
  assert.equal(getCached(1, 'wrong'), null);
});

test('getCached returns stored entry including contentProfile', () => {
  clearTabCache();
  setCached(42, 'hash-a', 'base64-image', 'image');
  const entry = getCached(42, 'hash-a');
  assert.ok(entry);
  assert.equal(entry.imageBase64, 'base64-image');
  assert.equal(entry.contentProfile, 'image');
});

test('setCached evicts oldest entry beyond max entries', () => {
  clearTabCache();
  setCached(1, 'h1', 'a', 'text');
  setCached(2, 'h2', 'b', 'text');
  setCached(3, 'h3', 'c', 'text');
  setCached(4, 'h4', 'd', 'text');
  assert.equal(getCached(1, 'h1'), null);
  assert.ok(getCached(4, 'h4'));
});
