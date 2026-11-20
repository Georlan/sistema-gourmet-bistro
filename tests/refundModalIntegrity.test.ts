import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const refundModal = readFileSync(new URL('../src/components/caixa/EstornoModal.tsx', import.meta.url), 'utf8');

test('EstornoModal guards concurrent submits synchronously and reuses pending idempotency key per payload fingerprint', () => {
  assert.match(refundModal, /submittingRef\s*=\s*useRef\(false\)/);
  assert.match(refundModal, /if\s*\(!selected\s*\|\|\s*submittingRef\.current\)\s*return;/);
  assert.match(refundModal, /pendingIdempotencyRef\s*=\s*useRef<\{\s*fingerprint:\s*string;\s*key:\s*string\s*\}\s*\|\s*null>\(null\)/);
  assert.match(refundModal, /pendingIdempotencyRef\.current\?\.fingerprint\s*!==\s*fingerprint/);
  assert.match(refundModal, /createSecureIdempotencyKey\('refund'\)/);
  assert.match(refundModal, /pendingIdempotencyRef\.current\s*=\s*null;/);
});

test('EstornoModal preserves submission error during post-error list refresh and blocks mid-flight dismissal', () => {
  assert.match(refundModal, /await load\(\{\s*background:\s*true,\s*preserveError:\s*true\s*\}\)/);
  assert.match(refundModal, /const requestClose = \(\) => \{\s*if \(!submittingRef\.current\) onClose\(\);/);
  assert.match(refundModal, /event\.key === 'Escape' && !submittingRef\.current/);
  assert.doesNotMatch(refundModal, /backdrop-blur/);
});
