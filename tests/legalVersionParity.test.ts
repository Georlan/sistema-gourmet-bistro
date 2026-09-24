import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const frontendLegal = readFileSync('src/legal/legalContentV31.ts', 'utf8');
const frontendEvidence = readFileSync('src/legal/legalEvidence.ts', 'utf8');
const backendLegal = readFileSync('backend/app/legal_config.py', 'utf8');

function capture(source: string, pattern: RegExp, label: string): string {
  const match = source.match(pattern);
  assert.ok(match?.[1], `não encontrou ${label}`);
  return match[1];
}

test('frontend e backend publicam a mesma versão e evidência jurídica', () => {
  const frontendVersion = capture(frontendLegal, /LEGAL_VERSION = '([^']+)'/, 'versão frontend');
  const backendVersion = capture(backendLegal, /LEGAL_VERSION = "([^"]+)"/, 'versão backend');
  const frontendCommit = capture(frontendEvidence, /LEGAL_SOURCE_COMMIT = '([0-9a-f]{40})'/, 'commit frontend');
  const backendCommit = capture(backendLegal, /LEGAL_SOURCE_COMMIT = "([0-9a-f]{40})"/, 'commit backend');
  const frontendBlob = capture(frontendEvidence, /LEGAL_SOURCE_BLOB_SHA = '([0-9a-f]{40})'/, 'blob frontend');
  const backendBlob = capture(backendLegal, /LEGAL_SOURCE_BLOB_SHA = "([0-9a-f]{40})"/, 'blob backend');

  assert.equal(backendVersion, frontendVersion);
  assert.equal(backendCommit, frontendCommit);
  assert.equal(backendBlob, frontendBlob);
});
