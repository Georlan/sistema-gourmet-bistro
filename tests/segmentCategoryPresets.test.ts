import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultPresetForOperationProfile,
  RESTAURANT_SEGMENT_PRESETS,
} from '../src/domain/segmentCategoryPresets';

test('segment category presets cover core restaurant segments with valid print destinations', () => {
  const ids = new Set(RESTAURANT_SEGMENT_PRESETS.map((p) => p.id));
  for (const required of ['hamburgueria', 'pizzaria', 'marmitaria', 'pastelaria', 'acaiteria', 'restaurante']) {
    assert.ok(ids.has(required as any), `Missing segment preset ${required}`);
  }
  for (const preset of RESTAURANT_SEGMENT_PRESETS) {
    assert.ok(preset.categories.length >= 3);
    for (const cat of preset.categories) {
      assert.ok(cat.id.startsWith('cat-'));
      assert.ok(['COZINHA', 'BAR', 'NENHUM'].includes(cat.destino_impressao));
    }
  }
});

test('maps operation_profile cleanly to default preset', () => {
  assert.equal(defaultPresetForOperationProfile('pizzaria'), 'pizzaria');
  assert.equal(defaultPresetForOperationProfile('acai'), 'acaiteria');
  assert.equal(defaultPresetForOperationProfile('churrasco'), 'restaurante');
  assert.equal(defaultPresetForOperationProfile('generic'), 'hamburgueria');
});
