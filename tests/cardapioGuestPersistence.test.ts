import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import test, { afterEach, beforeEach } from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CART_DRAFT_TTL_MS,
  clearCartDraft,
  loadCartDraft,
  restoreCartDraftFromCatalog,
  saveCartDraft,
  serializeCartDraft,
} from '../src/cardapio/cartDraftStorage.ts';
import type { BrandConfig, CatalogPromotion, Product } from '../src/cardapio/CardapioTypes.ts';
import type { CartItem } from '../src/cardapio/components/CardapioCartDrawer.tsx';
import {
  ACTIVE_ORDER_TTL_MS,
  ACTIVE_ORDERS_STORAGE_KEY,
  clearAllStoredOrders,
  customerOrderLabel,
  fallbackOrderState,
  isOrderVisibleOnHome,
  loadStoredOrders,
  mergeLocalOrderSnapshots,
  orderFulfillmentLabel,
  orderProgress,
  removeStoredOrder,
  resolveOrderState,
  restoreDurableStoredOrders,
  saveStoredOrder,
  updateStoredOrderStatus,
  type StoredOrder,
} from '../src/cardapio/orderTracking.ts';
import {
  clearOrderResumes,
  loadOrderResumes,
  persistOrderResume,
} from '../src/cardapio/orderResumeStore.ts';
import {
  allowCustomerBrowserRestore,
  blockCustomerBrowserRestore,
  customerSignedOutKey,
} from '../src/cardapio/customerBrowserSession.ts';

register('./helpers/staticAssetsLoader.mjs', import.meta.url);

const { MenuActiveOrderCard } = await import('../src/cardapio/v2/MenuActiveOrderCard.tsx');

function createMemoryStorage(): Storage & { dump(): Map<string, string> } {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
    dump() {
      return map;
    },
  };
}

function createThrowingStorage(): Storage {
  const throwSecurity = () => {
    throw new DOMException('Storage blocked by browser privacy policy', 'SecurityError');
  };
  return {
    get length() {
      return 0;
    },
    clear: throwSecurity,
    getItem: throwSecurity,
    key: () => null,
    removeItem: throwSecurity,
    setItem: throwSecurity,
  };
}

function installMockIndexedDB() {
  type StoreData = {
    keyPath: string;
    records: Map<string, any>;
    indexes: Map<string, string>;
  };
  const dbs = new Map<string, Map<string, StoreData>>();

  const makeRequest = <T = any>() => {
    const req: any = {
      result: undefined as T,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    return req;
  };

  const factory = {
    open(name: string) {
      const req = makeRequest<any>();
      queueMicrotask(() => {
        let stores = dbs.get(name);
        const needsUpgrade = !stores;
        if (!stores) {
          stores = new Map<string, StoreData>();
          dbs.set(name, stores);
        }

        const db: any = {
          objectStoreNames: {
            contains: (storeName: string) => stores!.has(storeName),
          },
          createObjectStore(storeName: string, opts: { keyPath: string }) {
            const store: StoreData = {
              keyPath: opts.keyPath,
              records: new Map(),
              indexes: new Map(),
            };
            stores!.set(storeName, store);
            return {
              createIndex(indexName: string, keyPath: string) {
                store.indexes.set(indexName, keyPath);
              },
            };
          },
          transaction(storeName: string) {
            const store = stores!.get(storeName)!;
            const tx: any = {
              oncomplete: null,
              onerror: null,
              onabort: null,
              objectStore() {
                const wrapOp = (fn: () => any) => {
                  const opReq = makeRequest();
                  queueMicrotask(() => {
                    try {
                      opReq.result = fn();
                      opReq.onsuccess?.();
                      tx.oncomplete?.();
                    } catch (err) {
                      opReq.error = err;
                      opReq.onerror?.();
                      tx.onerror?.();
                    }
                  });
                  return opReq;
                };
                return {
                  get: (key: string) => wrapOp(() => store.records.get(key)),
                  put: (value: any) =>
                    wrapOp(() => {
                      const key = value[store.keyPath];
                      store.records.set(key, value);
                      return key;
                    }),
                  delete: (key: string) =>
                    wrapOp(() => {
                      store.records.delete(key);
                    }),
                  clear: () =>
                    wrapOp(() => {
                      store.records.clear();
                    }),
                  index(indexName: string) {
                    const idxPath = store.indexes.get(indexName)!;
                    return {
                      getAll: (query: any) =>
                        wrapOp(() =>
                          [...store.records.values()].filter((row) => row[idxPath] === query),
                        ),
                    };
                  },
                };
              },
            };
            return tx;
          },
          close() {},
        };

        req.result = db;
        if (needsUpgrade) {
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req;
    },
    _dbs: dbs,
  };

  (globalThis as any).indexedDB = factory;
  return factory;
}

const originalSessionDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const originalLocalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalIndexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');

function setGlobalProperty(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

beforeEach(() => {
  setGlobalProperty('sessionStorage', createMemoryStorage());
  setGlobalProperty('localStorage', createMemoryStorage());
});

afterEach(() => {
  if (originalSessionDescriptor) {
    Object.defineProperty(globalThis, 'sessionStorage', originalSessionDescriptor);
  }
  if (originalLocalDescriptor) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalDescriptor);
  }
  if (originalIndexedDbDescriptor) {
    Object.defineProperty(globalThis, 'indexedDB', originalIndexedDbDescriptor);
  } else {
    delete (globalThis as any).indexedDB;
  }
});

const burgerProduct: Product = {
  id: 'prod-1',
  name: 'X-Bacon Artesanal',
  description: 'Blend 160g',
  price: 32,
  category: 'Burgers',
  image: '',
  isAvailable: true,
  modifierGroups: [
    {
      id: 'grp-adicionais',
      name: 'Adicionais',
      type: 'opcional',
      minSelection: 0,
      maxSelection: 3,
      selectionMode: 'porcoes',
      options: [
        { id: 'opt-bacon', name: 'Bacon extra', extraPrice: 6, active: true },
        { id: 'opt-cheddar', name: 'Cheddar', extraPrice: 4, active: true },
      ],
    },
  ],
};

const sodaProduct: Product = {
  id: 'prod-2',
  name: 'Refrigerante Lata',
  description: '350ml',
  price: 8,
  category: 'Bebidas',
  image: '',
  isAvailable: true,
};

const comboPromo: CatalogPromotion = {
  id: 'promo-combo',
  nome: 'Combo Duplo',
  descricao: 'Burger + Refri',
  tipo: 'combo',
  preco: 35,
  componentes: [['prod-1'], ['prod-2']],
  quantidades: [1, 1],
};

const restaurantA: Pick<BrandConfig, 'id' | 'products' | 'promotions' | 'promotionProducts'> = {
  id: '10',
  products: [burgerProduct, sodaProduct],
  promotions: [comboPromo],
  promotionProducts: [],
};

const restaurantB: Pick<BrandConfig, 'id' | 'products' | 'promotions' | 'promotionProducts'> = {
  id: '20',
  products: [{ ...burgerProduct, id: 'prod-99', name: 'Outro Burger' }],
  promotions: [],
  promotionProducts: [],
};

test('cartDraftStorage: persiste por até 6h com adicionais, promoções e modalidade', () => {
  assert.equal(CART_DRAFT_TTL_MS, 6 * 60 * 60 * 1000);
  const now = 1_750_000_000_000;

  const cart: CartItem[] = [
    {
      id: 'prod-1-opt-bacon-',
      product: burgerProduct,
      quantity: 2,
      selectedOptions: {
        'grp-adicionais': [
          { id: 'opt-bacon', name: 'Bacon extra', extraPrice: 6 },
        ],
      },
      notes: 'Sem picles',
    },
    {
      id: 'promotion:promo-combo:1',
      product: {
        id: 'promotion:promo-combo',
        name: comboPromo.nome,
        description: comboPromo.descricao,
        price: comboPromo.preco,
        category: 'Promoções',
        image: '',
        isAvailable: true,
      },
      quantity: 2,
      selectedOptions: {},
      notes: '',
      promotionId: comboPromo.id,
      promotionParts: [
        {
          product: burgerProduct,
          quantity: 1,
          selectedOptions: {
            'grp-adicionais': [{ id: 'opt-cheddar', name: 'Cheddar', extraPrice: 4 }],
          },
          notes: 'Bem passado',
        },
        {
          product: sodaProduct,
          quantity: 1,
          selectedOptions: {},
          notes: 'Com gelo',
        },
      ],
    },
  ];

  const serialized = serializeCartDraft('10', cart, 'delivery', now);
  sessionStorage.setItem('koma_cart_draft:10', JSON.stringify(serialized));

  // Ainda válido dentro das 6 horas (5h59m59s)
  const almostExpired = loadCartDraft('10', now + CART_DRAFT_TTL_MS - 1000);
  assert.ok(almostExpired);
  assert.equal(almostExpired.fulfillment, 'delivery');
  assert.equal(almostExpired.items.length, 2);

  const restored = restoreCartDraftFromCatalog(almostExpired, restaurantA, now + 1000);
  assert.equal(restored.fulfillment, 'delivery');
  assert.equal(restored.items.length, 2);
  assert.equal(restored.items[0].quantity, 2);
  assert.equal(restored.items[0].selectedOptions['grp-adicionais'][0].id, 'opt-bacon');
  assert.equal(restored.items[1].promotionId, 'promo-combo');
  assert.equal(restored.items[1].quantity, 2);
  assert.equal(restored.items[1].promotionParts?.[0].selectedOptions['grp-adicionais'][0].id, 'opt-cheddar');
});

test('cartDraftStorage: expira após >6h e isola estritamente restaurante A vs B', () => {
  const now = 1_750_000_000_000;
  const expired = serializeCartDraft(
    '10',
    [{ id: 'prod-1--', product: burgerProduct, quantity: 1, selectedOptions: {}, notes: '' }],
    'pickup',
    now - CART_DRAFT_TTL_MS - 1,
  );
  sessionStorage.setItem('koma_cart_draft:10', JSON.stringify(expired));

  assert.equal(loadCartDraft('10', now), null);
  assert.equal(sessionStorage.getItem('koma_cart_draft:10'), null);

  // Isolamento restaurante A (10) vs B (20)
  saveCartDraft('10', [{ id: 'prod-1--', product: burgerProduct, quantity: 1, selectedOptions: {}, notes: '' }], 'pickup');
  assert.equal(loadCartDraft('20'), null);
  const draftA = loadCartDraft('10');
  assert.ok(draftA);
  const leakedIntoB = restoreCartDraftFromCatalog(draftA, restaurantB);
  assert.equal(leakedIntoB.items.length, 0);
  assert.equal(leakedIntoB.fulfillment, null);
});

test('cartDraftStorage: nunca quebra quando storage está indisponível ou lança SecurityError', () => {
  setGlobalProperty('localStorage', createThrowingStorage());
  setGlobalProperty('sessionStorage', createThrowingStorage());

  const cart: CartItem[] = [
    { id: 'prod-1--', product: burgerProduct, quantity: 1, selectedOptions: {}, notes: '' },
  ];

  assert.doesNotThrow(() => saveCartDraft('10', cart, 'delivery'));
  assert.equal(loadCartDraft('10'), null);
  assert.doesNotThrow(() => clearCartDraft('10'));

  setGlobalProperty('sessionStorage', undefined);
  setGlobalProperty('localStorage', undefined);
  assert.doesNotThrow(() => saveCartDraft('10', cart, 'pickup'));
  assert.equal(loadCartDraft('10'), null);
  assert.doesNotThrow(() => clearCartDraft('10'));
});

test('orderTracking: TTL 24h, alternância entre 2 pedidos anônimos e isolamento por restaurante_id', () => {
  assert.equal(ACTIVE_ORDER_TTL_MS, 24 * 60 * 60 * 1000);
  const now = Date.now();

  const expiredOrder: StoredOrder = {
    id: 'ord-expired',
    numero_pedido: 99,
    timestamp: now - ACTIVE_ORDER_TTL_MS - 5000,
    restaurante_id: 10,
    tipo: 'Delivery',
    total: 40,
    idempotency_key: '',
    status: 'aceito',
    tracking_token: 'tok-expired',
  };
  const orderA1: StoredOrder = {
    id: 'ord-a1',
    numero_pedido: 101,
    timestamp: now - 10_000,
    restaurante_id: 10,
    tipo: 'Delivery',
    total: 42,
    idempotency_key: '',
    status: 'aceito',
    tracking_token: 'tok-a1',
    delivery_receipt_code: '042',
  };
  const orderA2: StoredOrder = {
    id: 'ord-a2',
    numero_pedido: 102,
    timestamp: now,
    restaurante_id: 10,
    tipo: 'Retirada',
    total: 19.5,
    idempotency_key: '',
    status: 'pronto',
    tracking_token: 'tok-a2',
    delivery_receipt_code: '999',
  };
  const orderB1: StoredOrder = {
    id: 'ord-b1',
    numero_pedido: 201,
    timestamp: now,
    restaurante_id: 20,
    tipo: 'Delivery',
    total: 88,
    idempotency_key: '',
    status: 'pendente',
    tracking_token: 'tok-b1',
  };

  saveStoredOrder(expiredOrder);
  saveStoredOrder(orderA1);
  saveStoredOrder(orderA2);
  saveStoredOrder(orderB1);

  const rawSession = sessionStorage.getItem(ACTIVE_ORDERS_STORAGE_KEY) || '';
  assert.doesNotMatch(rawSession, /ord-expired/);
  assert.doesNotMatch(rawSession, /042/);
  assert.doesNotMatch(rawSession, /999/);

  const ordersA = loadStoredOrders(10);
  assert.equal(ordersA.length, 2);
  assert.deepEqual(ordersA.map((o) => o.id), ['ord-a2', 'ord-a1']);

  const ordersB = loadStoredOrders(20);
  assert.equal(ordersB.length, 1);
  assert.equal(ordersB[0].id, 'ord-b1');

  // Reconciliação em memória preserva código somente no pedido correspondente
  const mergedA = mergeLocalOrderSnapshots(ordersA, [orderA1, orderA2]);
  assert.equal(mergedA.find((o) => o.id === 'ord-a1')?.delivery_receipt_code, '042');
  assert.equal(mergedA.find((o) => o.id === 'ord-a2')?.delivery_receipt_code, '999');

  // Limpar pedidos do restaurante 10 preserva restaurante 20
  clearAllStoredOrders(10);
  assert.equal(loadStoredOrders(10).length, 0);
  assert.equal(loadStoredOrders(20).length, 1);
});

test('orderTracking: degrada com segurança quando sessionStorage/localStorage lançam erro ou estão ausentes', () => {
  setGlobalProperty('sessionStorage', createThrowingStorage());
  setGlobalProperty('localStorage', createThrowingStorage());

  const guestOrder: StoredOrder = {
    id: 'ord-safe',
    numero_pedido: 55,
    timestamp: Date.now(),
    restaurante_id: 10,
    tipo: 'Retirada',
    total: 30,
    idempotency_key: '',
    status: 'aceito',
    tracking_token: 'tok-safe',
  };

  const originalWarn = console.warn;
  let warnCount = 0;
  console.warn = () => {
    warnCount += 1;
  };
  try {
    assert.deepEqual(loadStoredOrders(10), []);
    assert.doesNotThrow(() => saveStoredOrder(guestOrder));
    assert.doesNotThrow(() => updateStoredOrderStatus('ord-safe', { status: 'pronto' }));
    assert.doesNotThrow(() => removeStoredOrder('ord-safe'));
    assert.doesNotThrow(() => clearAllStoredOrders(10));
    assert.ok(warnCount > 0);
  } finally {
    console.warn = originalWarn;
  }

  setGlobalProperty('sessionStorage', undefined);
  setGlobalProperty('localStorage', undefined);
  assert.deepEqual(loadStoredOrders(10), []);
  assert.doesNotThrow(() => saveStoredOrder(guestOrder));
  assert.doesNotThrow(() => clearAllStoredOrders());
});

test('orderResumeStore: cifra snapshot no IndexedDB, expira após 24h e isola por restaurante', async () => {
  const idb = installMockIndexedDB();
  const now = Date.now();

  await persistOrderResume({
    id: 'res-valid-10',
    numero_pedido: 301,
    timestamp: now - 60_000,
    restaurante_id: 10,
    tipo: 'Delivery',
    total: 54,
    idempotency_key: '',
    status: 'aceito',
    tracking_token: 'secret-token-r10',
  });

  await persistOrderResume({
    id: 'res-valid-20',
    numero_pedido: 401,
    timestamp: now - 30_000,
    restaurante_id: 20,
    tipo: 'Retirada',
    total: 25,
    idempotency_key: '',
    status: 'pendente',
    tracking_token: 'secret-token-r20',
  });

  // Registro expirado (>24h) inserido diretamente no store deve ser descartado na leitura
  const dbStores = idb._dbs.get('koma_order_resume_v1')!;
  const ordersStore = dbStores.get('orders')!;
  ordersStore.records.set('res-expired-10', {
    orderId: 'res-expired-10',
    restaurantId: 10,
    ciphertext: 'AAAA',
    iv: 'BBBB',
    createdAt: now - ACTIVE_ORDER_TTL_MS - 10_000,
    expiresAt: now - 1_000,
  });

  // Verifica que o token nunca fica em texto puro no IndexedDB
  const rawCipher = ordersStore.records.get('res-valid-10').ciphertext;
  assert.equal(rawCipher.includes('secret-token-r10'), false);

  const resumed10 = await loadOrderResumes(10);
  assert.equal(resumed10.length, 1);
  assert.equal(resumed10[0].id, 'res-valid-10');
  assert.equal(resumed10[0].tracking_token, 'secret-token-r10');
  assert.equal(ordersStore.records.has('res-expired-10'), false);

  const resumed20 = await loadOrderResumes(20);
  assert.equal(resumed20.length, 1);
  assert.equal(resumed20[0].id, 'res-valid-20');

  await clearOrderResumes(10);
  assert.deepEqual(await loadOrderResumes(10), []);
  assert.equal((await loadOrderResumes(20)).length, 1);

  // Sem IndexedDB disponível: degrada sem erro
  setGlobalProperty('indexedDB', undefined);
  assert.deepEqual(await loadOrderResumes(20), []);

  // IndexedDB lançando SecurityError no open(): restoreDurableStoredOrders degrada com segurança
  setGlobalProperty('indexedDB', {
    open() {
      throw new DOMException('IndexedDB disabled in private context', 'SecurityError');
    },
  });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(await restoreDurableStoredOrders(20), []);
  } finally {
    console.warn = originalWarn;
  }
});

test('customerBrowserSession: isola marcador de logout por restaurante e tolera localStorage bloqueado', () => {
  blockCustomerBrowserRestore('10');
  assert.equal(localStorage.getItem(customerSignedOutKey('10')), '1');
  assert.equal(localStorage.getItem(customerSignedOutKey('20')), null);

  allowCustomerBrowserRestore('10');
  assert.equal(localStorage.getItem(customerSignedOutKey('10')), null);

  setGlobalProperty('localStorage', createThrowingStorage());
  assert.doesNotThrow(() => blockCustomerBrowserRestore('10'));
  assert.doesNotThrow(() => allowCustomerBrowserRestore('10'));
});

test('MenuActiveOrderCard + orderProgress: "accepted" NUNCA avança para "preparing" em nenhuma modalidade', () => {
  for (const tipo of ['Delivery', 'Retirada', 'Consumo no Local']) {
    const acceptedState = fallbackOrderState('aceito', tipo);
    const progress = orderProgress(acceptedState);
    assert.ok(progress);
    assert.equal(acceptedState.phase, 'accepted');
    assert.equal(progress.current, 1);

    const acceptedOrder: StoredOrder = {
      id: `ord-acc-${tipo}`,
      numero_pedido: 710,
      timestamp: Date.now(),
      restaurante_id: 10,
      tipo,
      total: 45,
      idempotency_key: '',
      status: 'aceito',
      state: acceptedState,
      delivery_receipt_code: '318',
    };

    const html = renderToStaticMarkup(
      createElement(MenuActiveOrderCard, {
        activeOrder: acceptedOrder,
        activeState: acceptedState,
        statusLabel: customerOrderLabel(acceptedState),
        fulfillmentLabel: orderFulfillmentLabel(acceptedState.fulfillment),
        storedOrders: [acceptedOrder],
        isRefreshingOrders: false,
        onSelectOrderId() {},
        onRefreshOrders() {},
        onOrdersClick() {},
      }),
    );

    assert.match(html, /id="active-order-banner"/);
    assert.match(html, /Aceito · aguardando preparo/);
    assert.match(html, /Aceito pela loja · próximo: preparo/);
    assert.doesNotMatch(html, /Em preparo/);
    assert.match(html, /data-progress-current="1"/);
    assert.match(html, /data-step-index="1"[^>]*data-step-state="active"/);
    assert.match(html, /data-step-index="1"[^>]*aria-current="step"/);
    assert.match(html, /data-step-index="2"[^>]*data-step-state="upcoming"/);
    assert.match(html, /k-delivery-receipt--compact/);
    assert.match(html, /318/);
  }

  // Em preparo explícito mantém passo confirmado em 1 conforme orderProgress, mas mostra detalhe real
  const preparingState = fallbackOrderState('producao', 'Delivery');
  assert.equal(orderProgress(preparingState)?.current, 1);
  const preparingHtml = renderToStaticMarkup(
    createElement(MenuActiveOrderCard, {
      activeOrder: {
        id: 'ord-prep',
        numero_pedido: 711,
        timestamp: Date.now(),
        restaurante_id: 10,
        tipo: 'Delivery',
        total: 45,
        idempotency_key: '',
        status: 'producao',
        state: preparingState,
      },
      activeState: preparingState,
      statusLabel: customerOrderLabel(preparingState),
      fulfillmentLabel: orderFulfillmentLabel(preparingState.fulfillment),
      storedOrders: [],
      isRefreshingOrders: false,
    }),
  );
  assert.match(preparingHtml, /<h2[^>]*>Em preparo<\/h2>/);
  assert.match(preparingHtml, /Em preparo na loja · próximo: ficar pronto/);
  assert.match(preparingHtml, /data-step-index="1"[^>]*data-step-state="active"/);
  assert.match(preparingHtml, /data-step-index="2"[^>]*data-step-state="upcoming"/);
});

test('MenuActiveOrderCard: alternância entre 2 pedidos não vaza status, código nem ações; terminal oculta código', () => {
  const state1 = fallbackOrderState('aceito', 'Delivery');
  const state2 = fallbackOrderState('pronto', 'Retirada');
  const order1: StoredOrder = {
    id: 'ord-1',
    numero_pedido: 501,
    timestamp: Date.now() - 10_000,
    restaurante_id: 10,
    tipo: 'Delivery',
    total: 64,
    idempotency_key: '',
    status: 'aceito',
    state: state1,
    delivery_receipt_code: '123',
  };
  const order2: StoredOrder = {
    id: 'ord-2',
    numero_pedido: 502,
    timestamp: Date.now(),
    restaurante_id: 10,
    tipo: 'Retirada',
    total: 22.5,
    idempotency_key: '',
    status: 'pronto',
    state: state2,
    delivery_receipt_code: '987',
  };

  const viewOrder1 = renderToStaticMarkup(
    createElement(MenuActiveOrderCard, {
      activeOrder: order1,
      activeState: state1,
      statusLabel: customerOrderLabel(state1),
      fulfillmentLabel: orderFulfillmentLabel(state1.fulfillment),
      storedOrders: [order2, order1],
      isRefreshingOrders: false,
      onSelectOrderId() {},
      onRefreshOrders() {},
      onOrdersClick() {},
    }),
  );
  assert.match(viewOrder1, /#502/);
  assert.match(viewOrder1, /#501/);
  assert.match(viewOrder1, /Pedido #501/);
  assert.match(viewOrder1, /123/);
  assert.doesNotMatch(viewOrder1, /987/);
  assert.doesNotMatch(viewOrder1, /Pronto para retirar/);

  const viewOrder2 = renderToStaticMarkup(
    createElement(MenuActiveOrderCard, {
      activeOrder: order2,
      activeState: state2,
      statusLabel: customerOrderLabel(state2),
      fulfillmentLabel: orderFulfillmentLabel(state2.fulfillment),
      storedOrders: [order2, order1],
      isRefreshingOrders: false,
      onSelectOrderId() {},
      onRefreshOrders() {},
      onOrdersClick() {},
    }),
  );
  assert.match(viewOrder2, /Pedido #502/);
  assert.match(viewOrder2, /Pronto para retirar/);
  assert.match(viewOrder2, /data-progress-current="2"/);
  assert.match(viewOrder2, /987/);
  assert.doesNotMatch(viewOrder2, /123/);

  const completedState = fallbackOrderState('finalizado', 'Delivery');
  const terminalView = renderToStaticMarkup(
    createElement(MenuActiveOrderCard, {
      activeOrder: { ...order1, status: 'finalizado', state: completedState, fechado: true },
      activeState: completedState,
      statusLabel: customerOrderLabel(completedState),
      fulfillmentLabel: orderFulfillmentLabel(completedState.fulfillment),
      storedOrders: [order1],
      isRefreshingOrders: false,
      onDismissTrackedOrder() {},
    }),
  );
  assert.doesNotMatch(terminalView, /123/);
  assert.doesNotMatch(terminalView, /k-delivery-receipt/);
  assert.match(terminalView, /Entendi/);
});

test('home: reconhecer resultado terminal preserva pedido, não esconde ativos ou nova fase', () => {
  const order: StoredOrder = {
    id: 'dismiss-1', numero_pedido: 71, timestamp: Date.now(),
    restaurante_id: 10, tipo: 'Retirada', total: 36.90,
    idempotency_key: 'legacy-key', status: 'recusado',
  };
  saveStoredOrder(order);
  assert.equal(isOrderVisibleOnHome(loadStoredOrders(10)[0]), true);
  updateStoredOrderStatus(order.id, { homeAcknowledgedPhase: 'rejected' });
  const history = loadStoredOrders(10);
  assert.equal(history.length, 1);
  assert.equal(history[0].homeAcknowledgedPhase, 'rejected');
  assert.equal(isOrderVisibleOnHome(history[0]), false);
  assert.equal(isOrderVisibleOnHome(mergeLocalOrderSnapshots([order], history)[0]), false);
  updateStoredOrderStatus(order.id, { ...order, homeAcknowledgedPhase: undefined });
  assert.equal(isOrderVisibleOnHome(loadStoredOrders(10)[0]), false);
  assert.equal(isOrderVisibleOnHome({ ...history[0], status: 'aceito' }), true);
  assert.equal(isOrderVisibleOnHome({ ...history[0], status: 'cancelado' }), true);
  assert.deepEqual(loadStoredOrders(20), []);
});

test('home: reconhecimento sobrevive à retomada cifrada após fechamento da aba', async () => {
  installMockIndexedDB();
  await persistOrderResume({
    id: 'dismiss-resume', numero_pedido: 71, timestamp: Date.now(),
    restaurante_id: 10, tipo: 'Retirada', total: 36.90,
    idempotency_key: '', tracking_token: 'resume-token',
    status: 'recusado', homeAcknowledgedPhase: 'rejected',
  });
  sessionStorage.clear();
  const restored = await restoreDurableStoredOrders(10);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].homeAcknowledgedPhase, 'rejected');
  assert.equal(isOrderVisibleOnHome(restored[0]), false);
});

test('DeliveryReceiptCode + menuActiveOrder.css usam tokens --km-* (com fallback legado) sem cores fixas', () => {
  const receiptCss = readFileSync('src/cardapio/components/deliveryReceipt.css', 'utf8');
  const orderCss = readFileSync('src/cardapio/v2/menuActiveOrder.css', 'utf8');

  assert.match(receiptCss, /border-color:\s*var\(--km-accent-border,\s*var\(--koma-accent-border\)\)/);
  assert.match(receiptCss, /background:\s*var\(--km-accent-soft,\s*var\(--koma-accent-soft\)\)/);
  assert.match(receiptCss, /color:\s*var\(--km-ink,\s*var\(--koma-text-primary\)\)/);
  assert.match(receiptCss, /color:\s*var\(--km-accent-text,\s*var\(--koma-accent-text,\s*inherit\)\)/);
  assert.match(receiptCss, /color:\s*var\(--km-muted,\s*var\(--koma-text-secondary\)\)/);
  assert.match(receiptCss, /\.k-delivery-receipt--compact[\s\S]*margin:\s*0;[\s\S]*padding:\s*10px 12px;/);

  assert.match(orderCss, /var\(--km-surface-soft\)/);
  assert.match(orderCss, /var\(--km-accent\)/);
  assert.match(orderCss, /var\(--km-on-accent\)/);
  assert.doesNotMatch(orderCss, /#[0-9a-fA-F]{3,8}|--koma-accent/);
});

test('mergeLocalOrderSnapshots: pedido legado sem tracking_token preserva delivery_receipt_code só com idempotency_key e restaurante iguais', () => {
  const current: StoredOrder = {
    id: 'ord-legacy-1',
    numero_pedido: 808,
    timestamp: Date.now(),
    restaurante_id: 10,
    tipo: 'Delivery',
    total: 49,
    idempotency_key: 'aa-01',
    status: 'aceito',
    delivery_receipt_code: '4819',
  };
  const { delivery_receipt_code: _omitted, ...localBase } = current;

  // Mesmo id, restaurante_id e idempotency_key -> preserva código efêmero
  assert.equal(mergeLocalOrderSnapshots([localBase], [current])[0].delivery_receipt_code, '4819');

  // idempotency_key diferente -> bloqueado
  assert.equal(
    mergeLocalOrderSnapshots([{ ...localBase, idempotency_key: 'bb-02' }], [current])[0].delivery_receipt_code,
    undefined,
  );

  // Sem credencial alguma (nem token nem idempotency_key) -> bloqueado (nunca casa só por id)
  assert.equal(
    mergeLocalOrderSnapshots([{ ...localBase, idempotency_key: '' }], [{ ...current, idempotency_key: '' }])[0].delivery_receipt_code,
    undefined,
  );

  // Outro restaurante -> bloqueado
  assert.equal(
    mergeLocalOrderSnapshots([{ ...localBase, restaurante_id: 20 }], [current])[0].delivery_receipt_code,
    undefined,
  );

  // Pedido terminal ou com código explicitamente nulo -> não reintroduz código
  assert.equal(
    mergeLocalOrderSnapshots([{ ...localBase, status: 'finalizado' }], [current])[0].delivery_receipt_code,
    undefined,
  );
  assert.equal(
    mergeLocalOrderSnapshots([{ ...localBase, delivery_receipt_code: null }], [current])[0].delivery_receipt_code,
    null,
  );
});
