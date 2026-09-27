import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

test('capacity smoke recusa backend de produção', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/capacity-smoke.mjs'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        KOMA_CAPACITY_API_URL: 'https://sistema-gourmet-bistro-production.up.railway.app',
        KOMA_CAPACITY_ALLOW_HOST: 'sistema-gourmet-bistro-production.up.railway.app',
      },
      encoding: 'utf8',
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /bloqueado contra produção/i);
});


test('capacity smoke exige hostname de homologação explícito', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/capacity-smoke.mjs'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        KOMA_CAPACITY_API_URL: 'https://homolog.example.test',
        KOMA_CAPACITY_ALLOW_HOST: '',
      },
      encoding: 'utf8',
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /KOMA_CAPACITY_ALLOW_HOST/i);
});
