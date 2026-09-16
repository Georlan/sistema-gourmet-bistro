import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEGACY_OPERATIONAL_DRAFTS_KEY,
  buildOperationalDraftStorageKey,
  readOperationalDraftsForKey,
  writeOperationalDraftsForKey,
} from '../src/components/app/drafts/operationalDraftStorage';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

const draft = (id: string, nome: string) => ({
  id,
  produtoId: '101',
  nome,
  preco: 42,
  quantidade: 1,
  observacao: '',
  clienteNome: 'Cliente',
}) as any;

test('operational draft storage key is isolated by restaurant and operator', () => {
  assert.equal(buildOperationalDraftStorageKey(1, 'garcom-a'), 'koma_drafts_v4:1:garcom-a');
  assert.equal(buildOperationalDraftStorageKey(2, 'garcom-a'), 'koma_drafts_v4:2:garcom-a');
  assert.equal(buildOperationalDraftStorageKey(1, 'garcom-b'), 'koma_drafts_v4:1:garcom-b');
  assert.equal(buildOperationalDraftStorageKey(0, 'garcom-a'), null);
  assert.equal(buildOperationalDraftStorageKey(1, ''), null);
});

test('same table id cannot leak drafts between restaurants in the same browser', () => {
  const storage = new MemoryStorage();
  const restaurantOneKey = buildOperationalDraftStorageKey(1, 'shared-device-waiter');
  const restaurantTwoKey = buildOperationalDraftStorageKey(2, 'shared-device-waiter');

  assert.ok(restaurantOneKey);
  assert.ok(restaurantTwoKey);

  writeOperationalDraftsForKey(restaurantOneKey, { 7: [draft('r1', 'Pedido restaurante 1')] }, storage);

  const restaurantTwoBeforeWrite = readOperationalDraftsForKey(restaurantTwoKey, storage);
  assert.deepEqual(restaurantTwoBeforeWrite, {});

  writeOperationalDraftsForKey(restaurantTwoKey, { 7: [draft('r2', 'Pedido restaurante 2')] }, storage);

  assert.equal(readOperationalDraftsForKey(restaurantOneKey, storage)[7][0].id, 'r1');
  assert.equal(readOperationalDraftsForKey(restaurantTwoKey, storage)[7][0].id, 'r2');
});

test('legacy global draft storage is discarded instead of guessed into a tenant', () => {
  const storage = new MemoryStorage();
  storage.setItem(
    LEGACY_OPERATIONAL_DRAFTS_KEY,
    JSON.stringify({ 7: [draft('legacy', 'Tenant desconhecido')] }),
  );

  const tenantKey = buildOperationalDraftStorageKey(2, 'garcom-2');
  assert.ok(tenantKey);

  assert.deepEqual(readOperationalDraftsForKey(tenantKey, storage), {});
  assert.equal(storage.getItem(LEGACY_OPERATIONAL_DRAFTS_KEY), null);
  assert.equal(storage.getItem(tenantKey), null);
});
