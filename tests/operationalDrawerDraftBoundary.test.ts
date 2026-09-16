import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../src/components/app/OperationalDrawer.tsx', import.meta.url),
  'utf8',
);

const legacy = readFileSync(
  new URL('../src/components/app/OperationalDrawerLegacy.tsx', import.meta.url),
  'utf8',
);

test('operational drawer destroys the tenant-less legacy draft key before rendering', () => {
  assert.match(wrapper, /LEGACY_OPERATIONAL_DRAFTS_KEY/);
  assert.doesNotMatch(wrapper, /localStorage\.getItem/);

  const purgeIndex = wrapper.indexOf('localStorage.removeItem?.(LEGACY_OPERATIONAL_DRAFTS_KEY)');
  const renderIndex = wrapper.indexOf('return OperationalDrawerLegacy(props)');
  assert.ok(purgeIndex >= 0, 'drawer boundary must purge the legacy draft key');
  assert.ok(renderIndex > purgeIndex, 'legacy key must be purged before the drawer implementation executes');
});

test('legacy global draft reader is isolated behind the security boundary', () => {
  assert.match(legacy, /koma_drafts_vFinal_v3/);
  assert.match(wrapper, /from '.\/OperationalDrawerLegacy'/);
  assert.match(wrapper, /return OperationalDrawerLegacy\(props\)/);
});
