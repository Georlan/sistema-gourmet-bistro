import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('five-tenant capacity gate refuses production before reading credentials', () => {
  const result = spawnSync(process.execPath, ['scripts/capacity-five-tenants.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KOMA_CAPACITY_API_URL: 'https://sistema-gourmet-bistro-production.up.railway.app',
      KOMA_CAPACITY_ALLOW_HOST: 'sistema-gourmet-bistro-production.up.railway.app',
      KOMA_CAPACITY_PASSWORD_FILE: '/nonexistent-password',
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires the explicitly allowed Railway homologation host/);
  assert.doesNotMatch(result.stderr, /nonexistent-password/);
});
