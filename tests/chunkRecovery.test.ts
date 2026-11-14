import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INITIAL_ENTRY_WINDOW_MS,
  isChunkLoadError,
  shouldAutoRecoverChunkSkew,
} from '../src/utils/chunkRecovery';

test('classifies failed Vite imports, not generic API/network failures', () => {
  assert.equal(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /assets/CaixaPanel-old.js')), true);
  assert.equal(isChunkLoadError(new Error('Loading chunk 27 failed')), true);
  assert.equal(isChunkLoadError(new Error('ChunkLoadError')), true);
  assert.equal(isChunkLoadError(new TypeError('Importing a module script failed.')), true);
  assert.equal(isChunkLoadError(new TypeError('Failed to fetch')), false);
  assert.equal(isChunkLoadError(new Error('Failed to load a REST response')), false);
});

test('only the untouched initial entry can auto-reload a stale chunk once per build', () => {
  const safe = {
    isChunkFailure: true,
    elapsedMs: 350,
    interacted: false,
    online: true,
    currentBuild: 'sha-a:2026-11-14T19:00:00Z',
    lastAttemptedBuild: null,
  };
  assert.equal(shouldAutoRecoverChunkSkew(safe), true);
  assert.equal(shouldAutoRecoverChunkSkew({ ...safe, elapsedMs: INITIAL_ENTRY_WINDOW_MS }), true);

  // Clicking an operational tab or editing a draft must not unload live work.
  assert.equal(shouldAutoRecoverChunkSkew({ ...safe, interacted: true }), false);
  assert.equal(shouldAutoRecoverChunkSkew({ ...safe, elapsedMs: INITIAL_ENTRY_WINDOW_MS + 1 }), false);
  assert.equal(shouldAutoRecoverChunkSkew({ ...safe, online: false }), false);
  assert.equal(shouldAutoRecoverChunkSkew({ ...safe, isChunkFailure: false }), false);
  assert.equal(shouldAutoRecoverChunkSkew({ ...safe, currentBuild: '' }), false);
  assert.equal(shouldAutoRecoverChunkSkew({ ...safe, lastAttemptedBuild: safe.currentBuild }), false);

  // A *different* deployed frontend is allowed a new recovery attempt.
  assert.equal(shouldAutoRecoverChunkSkew({ ...safe, lastAttemptedBuild: 'sha-previous:2026-11-14T18:00:00Z' }), true);
});
