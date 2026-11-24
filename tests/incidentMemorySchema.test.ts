import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  isValidDeepLinkId,
  listAllowedDeepLinkIds,
} from '../src/components/caixa/navigation/cashierDeepLink';

const REQUIRED_FIELDS = [
  'id',
  'title',
  'category',
  'symptom_signatures',
  'log_patterns',
  'likely_causes',
  'verification_steps',
  'safe_remediation',
  'customer_guidance_go_id',
  'prevention_refs',
] as const;

const ARRAY_FIELDS = [
  'symptom_signatures',
  'log_patterns',
  'likely_causes',
  'verification_steps',
  'safe_remediation',
  'prevention_refs',
] as const;

const SECRET_OR_PII_PATTERNS = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /(sk_live|sk_test|pk_live|ghp_|gho_|glpat-|postgres:\/\/|Bearer\s+[A-Za-z0-9._-]{12,})/i,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,
];

test('incident memory index conforms to schema 1.0, contains >= 8 clean entries, and uses valid non-mutating deep link IDs', () => {
  const indexPath = resolve(process.cwd(), 'docs/operations/incident-memory/index.json');
  const raw = readFileSync(indexPath, 'utf8');
  for (const pattern of SECRET_OR_PII_PATTERNS) {
    assert.equal(pattern.test(raw), false, `PII/secret pattern detected in incident memory: ${pattern}`);
  }

  const parsed = JSON.parse(raw);
  assert.equal(parsed.schema_version, '1.0');
  assert.ok(Array.isArray(parsed.entries));
  assert.ok(parsed.entries.length >= 8, `Expected at least 8 incident entries, got ${parsed.entries.length}`);

  const allowedIds = new Set(listAllowedDeepLinkIds());
  const seenIds = new Set<string>();

  for (const entry of parsed.entries) {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(Object.prototype.hasOwnProperty.call(entry, field), `Missing required field ${field} on ${entry.id}`);
    }
    assert.equal(typeof entry.id, 'string');
    assert.ok(/^[a-z0-9-]+$/.test(entry.id), `Invalid slug id: ${entry.id}`);
    assert.equal(seenIds.has(entry.id), false, `Duplicate incident id: ${entry.id}`);
    seenIds.add(entry.id);

    assert.equal(typeof entry.title, 'string');
    assert.ok(entry.title.trim().length > 5);
    assert.equal(typeof entry.category, 'string');
    assert.ok(entry.category.trim().length > 2);

    for (const arrayField of ARRAY_FIELDS) {
      assert.ok(Array.isArray(entry[arrayField]), `${entry.id}.${arrayField} must be an array`);
      assert.ok(entry[arrayField].length > 0, `${entry.id}.${arrayField} must be non-empty`);
      for (const item of entry[arrayField]) {
        assert.equal(typeof item, 'string');
        assert.ok(item.trim().length > 0);
      }
    }

    if (entry.customer_guidance_go_id !== null) {
      assert.equal(typeof entry.customer_guidance_go_id, 'string');
      assert.ok(
        allowedIds.has(entry.customer_guidance_go_id) && isValidDeepLinkId(entry.customer_guidance_go_id),
        `Invalid or mutating customer_guidance_go_id "${entry.customer_guidance_go_id}" in incident "${entry.id}"`,
      );
    }
  }
});
