import assert from 'node:assert/strict';
import test from 'node:test';
import { readAdminShortcut } from '../src/super-admin/adminShortcut';

test('administrative shortcuts open only valid tenant controls', () => {
  assert.deepEqual(readAdminShortcut('?tenant=6&panel=resources'), { tenantId: '6', finance: false, resources: true });
  assert.deepEqual(readAdminShortcut('?panel=finance'), { tenantId: null, finance: true, resources: false });
  for (const tenant of ['0', '-6', 'abc', '6;DROP', '9999999999']) {
    assert.equal(readAdminShortcut(`?tenant=${encodeURIComponent(tenant)}&panel=resources`).resources, false);
  }
});
