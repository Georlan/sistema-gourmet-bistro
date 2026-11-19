import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CART_DRAFT_TTL_MS,
  clearCartDraft,
  loadCartDraft,
  restoreCartDraftFromCatalog,
  saveCartDraft,
  serializeCartDraft,
} from '../src/cardapio/cartDraftStorage.ts';
import type { BrandConfig, Product } from '../src/cardapio/CardapioTypes.ts';
import type { CartItem } from '../src/cardapio/components/CardapioCartDrawer.tsx';

function installSessionStorageMock() {
  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  };
  (globalThis as any).sessionStorage = mockStorage;
  return store;
}

const sampleProduct: Product = {
  id: '101',
  name: 'Classic Burger',
  description: 'Blend 150g',
  price: 28,
  category: 'Burgers',
  image: '',
  isAvailable: true,
  modifierGroups: [
    {
      id: 'ponto',
      name: 'Ponto da carne',
      type: 'obrigatorio',
      minSelection: 1,
      maxSelection: 1,
      options: [
        { id: 'ao-ponto', name: 'Ao ponto', extraPrice: 0, active: true },
        { id: 'bem-passado', name: 'Bem passado', extraPrice: 0, active: true },
      ],
    },
    {
      id: 'extras',
      name: 'Extras',
      type: 'opcional',
      minSelection: 0,
      maxSelection: 2,
      selectionMode: 'porcoes',
      options: [
        { id: 'bacon', name: 'Bacon', extraPrice: 5, active: true },
      ],
    },
  ],
};

const sampleBrand: Pick<BrandConfig, 'id' | 'products' | 'promotions' | 'promotionProducts'> = {
  id: '2',
  products: [sampleProduct],
  promotions: [],
  promotionProducts: [],
};

test('cartDraftStorage isolates drafts per restaurant and never stores PII', () => {
  const store = installSessionStorageMock();
  const cart: CartItem[] = [
    {
      id: '101-ao-ponto-bacon-Sem cebola',
      product: sampleProduct,
      quantity: 2,
      selectedOptions: {
        ponto: [{ id: 'ao-ponto', name: 'Ao ponto', extraPrice: 0 }],
        extras: [{ id: 'bacon', name: 'Bacon', extraPrice: 5 }],
      },
      notes: 'Sem cebola',
    },
  ];

  saveCartDraft('2', cart, 'pickup');
  assert.ok(store.has('koma_cart_draft:2'));
  assert.equal(loadCartDraft('3'), null);

  const loaded = loadCartDraft('2');
  assert.ok(loaded);
  assert.equal(loaded.fulfillment, 'pickup');
  assert.equal(loaded.items.length, 1);
  assert.equal(loaded.items[0].productId, '101');
  assert.equal(loaded.items[0].quantity, 2);
  assert.equal(loaded.items[0].notes, 'Sem cebola');

  clearCartDraft('2');
  assert.equal(loadCartDraft('2'), null);
});

test('restoreCartDraftFromCatalog revalidates live prices and never trusts saved prices', () => {
  const draft = serializeCartDraft('2', [
    {
      id: '101-ao-ponto-bacon-',
      product: { ...sampleProduct, price: 20 }, // preço antigo salvo
      quantity: 1,
      selectedOptions: {
        ponto: [{ id: 'ao-ponto', name: 'Ao ponto', extraPrice: 0 }],
        extras: [{ id: 'bacon', name: 'Bacon', extraPrice: 3 }], // preço antigo salvo
      },
      notes: '',
    },
  ], 'delivery');

  const restored = restoreCartDraftFromCatalog(draft, sampleBrand);
  assert.equal(restored.items.length, 1);
  assert.equal(restored.items[0].product.price, 28); // usa preço vivo do catálogo
  assert.equal(restored.items[0].selectedOptions.extras[0].extraPrice, 5); // usa preço vivo do adicional
  assert.equal(restored.fulfillment, 'delivery');
  assert.ok(restored.issues.some((msg) => msg.includes('preço de Classic Burger foi atualizado')));
  assert.ok(restored.issues.some((msg) => msg.includes('valor de “Bacon” foi atualizado')));
});

test('restoreCartDraftFromCatalog skips unavailable products and unsatisfied required groups', () => {
  const draft = serializeCartDraft('2', [
    {
      id: '101-ao-ponto-',
      product: sampleProduct,
      quantity: 1,
      selectedOptions: {
        ponto: [{ id: 'ao-ponto', name: 'Ao ponto', extraPrice: 0 }],
      },
      notes: '',
    },
  ]);

  // Opção obrigatória removida/desativada no catálogo atual
  const updatedBrand: typeof sampleBrand = {
    ...sampleBrand,
    products: [
      {
        ...sampleProduct,
        modifierGroups: [
          {
            ...sampleProduct.modifierGroups![0],
            options: [
              { id: 'ao-ponto', name: 'Ao ponto', extraPrice: 0, active: false },
              { id: 'bem-passado', name: 'Bem passado', extraPrice: 0, active: true },
            ],
          },
        ],
      },
    ],
  };

  const restored = restoreCartDraftFromCatalog(draft, updatedBrand);
  assert.equal(restored.items.length, 0);
  assert.equal(restored.skippedItems, 1);
  assert.ok(restored.issues.some((msg) => msg.includes('precisa escolher novamente')));
});

test('loadCartDraft discards expired or corrupt payloads safely', () => {
  const store = installSessionStorageMock();
  store.set('koma_cart_draft:2', '{corrupt json');
  assert.equal(loadCartDraft('2'), null);
  assert.equal(store.has('koma_cart_draft:2'), false);

  const now = 1_700_000_000_000;
  const expiredDraft = serializeCartDraft('2', [
    { id: '101--', product: sampleProduct, quantity: 1, selectedOptions: {}, notes: '' },
  ], null, now - CART_DRAFT_TTL_MS - 1000);
  store.set('koma_cart_draft:2', JSON.stringify(expiredDraft));
  assert.equal(loadCartDraft('2', now), null);
  assert.equal(store.has('koma_cart_draft:2'), false);
});
