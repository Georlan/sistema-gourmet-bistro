import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test, { beforeEach } from 'node:test';
import {
  classifyCourierAuthError,
  clearCourierAccess,
  COURIER_ACCESS_KEY,
  COURIER_ACCESS_META_KEY,
  describeCourierRecoveryReason,
  isCourierTokenExpired,
  persistCourierAccess,
  readCourierAccessMeta,
  readCourierTokenExpiryMs,
} from '../src/utils/courierAccessSession';
import {
  COURIER_COPIED_SESSION_DISCARDED_KEY,
  initializeTabSessionOwnership,
  releaseTabSessionOwnershipForNavigation,
} from '../src/utils/tabSessionOwnership';

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
  };
}

function makeCourierJwt(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'motoboy_10', type: 'motoboy_pwa', exp: expSeconds })).toString('base64url');
  return `${header}.${payload}.signature`;
}

beforeEach(() => {
  (globalThis as any).sessionStorage = createMemoryStorage();
  (globalThis as any).localStorage = createMemoryStorage();
});

test('persistCourierAccess armazena token e metadados de expiração de 4h apenas no sessionStorage', () => {
  const expSeconds = Math.floor(Date.now() / 1000) + 4 * 3600;
  const jwt = makeCourierJwt(expSeconds);
  persistCourierAccess(jwt, 'login');

  assert.equal(sessionStorage.getItem(COURIER_ACCESS_KEY), jwt);
  assert.equal(localStorage.getItem(COURIER_ACCESS_KEY), null);
  const meta = readCourierAccessMeta();
  assert.ok(meta);
  assert.equal(meta?.expiresAt, expSeconds * 1000);
  assert.equal(meta?.source, 'login');
  assert.equal(isCourierTokenExpired(jwt), false);

  clearCourierAccess();
  assert.equal(sessionStorage.getItem(COURIER_ACCESS_KEY), null);
  assert.equal(sessionStorage.getItem(COURIER_ACCESS_META_KEY), null);
});

test('classificação de expiração de 4h vs revogação administrativa é determinística', () => {
  const expiredJwt = makeCourierJwt(Math.floor(Date.now() / 1000) - 10);
  const validJwt = makeCourierJwt(Math.floor(Date.now() / 1000) + 3600);

  assert.equal(isCourierTokenExpired(expiredJwt), true);
  assert.equal(readCourierTokenExpiryMs('opaque-fixture-token'), null);
  assert.equal(isCourierTokenExpired('opaque-fixture-token'), false);

  assert.equal(classifyCourierAuthError('Link do entregador expirou (válido por 4 horas).', validJwt), 'expired');
  assert.equal(classifyCourierAuthError('Qualquer mensagem', expiredJwt), 'expired');
  assert.equal(classifyCourierAuthError('Link do entregador foi revogado ou é inválido.', validJwt), 'revoked');

  assert.match(describeCourierRecoveryReason('expired').title, /expirada/i);
  assert.match(describeCourierRecoveryReason('revoked').title, /encerrado/i);
  assert.match(describeCourierRecoveryReason('replaced').title, /sem sessão ativa/i);
  assert.match(describeCourierRecoveryReason('session_lost').title, /Retome seu acesso/i);
  assert.equal(describeCourierRecoveryReason('missing').title, 'Seu acesso às entregas');
});

test('tabSessionOwnership mantém o Web Lock durante suspensão em segundo plano (visibilitychange hidden), libera em pagehide/handoff e re-adquire em pageshow', async () => {
  const activeLocks = new Set<string>();
  const mockWindow = new EventTarget();
  const mockDocument = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const beforeWindow = (globalThis as any).window;
  const beforeDocument = (globalThis as any).document;
  const beforeNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: async (name: string, _options: unknown, callback: (lock: object | null) => Promise<void> | void) => {
          if (activeLocks.has(name)) {
            await callback(null);
            return;
          }
          activeLocks.add(name);
          try {
            await callback({ name });
          } finally {
            activeLocks.delete(name);
          }
        },
      },
    },
  });
  (globalThis as any).window = mockWindow;
  (globalThis as any).document = mockDocument;

  try {
    const token = makeCourierJwt(Math.floor(Date.now() / 1000) + 7200);
    persistCourierAccess(token, 'login');

    await initializeTabSessionOwnership();
    const tabId = sessionStorage.getItem('koma_auth_tab_id_v1');
    assert.ok(tabId);
    assert.equal(activeLocks.has(`koma-auth-tab:${tabId}`), true);
    assert.equal(sessionStorage.getItem(COURIER_ACCESS_KEY), token);

    // 1. Aba suspensa em segundo plano (ex.: alternância para o Google Maps): visibilityState='hidden' NÃO libera o lock!
    mockDocument.visibilityState = 'hidden';
    mockDocument.dispatchEvent(new Event('visibilitychange'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(activeLocks.has(`koma-auth-tab:${tabId}`), true);

    // 2. Tentativa de duplicar a aba enquanto a aba original está suspensa/oculta é bloqueada deterministicamente
    const originalStorage = sessionStorage;
    const clonedWhileHidden = createMemoryStorage();
    for (const key of ['koma_auth_tab_id_v1', COURIER_ACCESS_KEY, COURIER_ACCESS_META_KEY]) {
      const val = originalStorage.getItem(key);
      if (val !== null) clonedWhileHidden.setItem(key, val);
    }
    const duplicateWindow = new EventTarget();
    (globalThis as any).window = duplicateWindow;
    (globalThis as any).sessionStorage = clonedWhileHidden;
    await initializeTabSessionOwnership();

    assert.notEqual(clonedWhileHidden.getItem('koma_auth_tab_id_v1'), tabId);
    assert.equal(clonedWhileHidden.getItem(COURIER_ACCESS_KEY), null);
    assert.equal(clonedWhileHidden.getItem(COURIER_COPIED_SESSION_DISCARDED_KEY), '1');
    assert.equal(originalStorage.getItem(COURIER_ACCESS_KEY), token);

    // Restaura contexto da aba original
    (globalThis as any).window = mockWindow;
    (globalThis as any).sessionStorage = originalStorage;

    // 3. Em pagehide com persisted=true (BFCache sem handoff), o documento ainda detém o lock da aba
    const bfcacheHideEvent = Object.assign(new Event('pagehide'), { persisted: true });
    mockWindow.dispatchEvent(bfcacheHideEvent);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(activeLocks.has(`koma-auth-tab:${tabId}`), true);

    // 4. Em pagehide com persisted=false (unload/descarte real da aba), o lock é liberado
    const unloadHideEvent = Object.assign(new Event('pagehide'), { persisted: false });
    mockWindow.dispatchEvent(unloadHideEvent);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(activeLocks.has(`koma-auth-tab:${tabId}`), false);

    // 5. Retorno de BFCache via pageshow(persisted=true) quando o navegador liberou o lock re-adquire o lock sem descartar a sessão
    mockDocument.visibilityState = 'visible';
    const pageShowEvent = Object.assign(new Event('pageshow'), { persisted: true });
    mockWindow.dispatchEvent(pageShowEvent);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(activeLocks.has(`koma-auth-tab:${tabId}`), true);
    assert.equal(sessionStorage.getItem(COURIER_ACCESS_KEY), token);

    // 6. Handoff explícito de navegação na mesma aba (ex.: login -> /entregador) libera o lock imediatamente mesmo que entre em BFCache
    releaseTabSessionOwnershipForNavigation();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(activeLocks.has(`koma-auth-tab:${tabId}`), false);

    // A nova página na mesma aba re-adquire o mesmo tabId e preserva o token
    await initializeTabSessionOwnership();
    assert.equal(sessionStorage.getItem('koma_auth_tab_id_v1'), tabId);
    assert.equal(sessionStorage.getItem(COURIER_ACCESS_KEY), token);
    assert.equal(activeLocks.has(`koma-auth-tab:${tabId}`), true);
  } finally {
    (globalThis as any).window = beforeWindow;
    (globalThis as any).document = beforeDocument;
    if (beforeNavigator) Object.defineProperty(globalThis, 'navigator', beforeNavigator);
  }
});

test('tabSessionOwnership sem suporte a Web Locks falha de forma segura descartando sessão potencialmente copiada', async () => {
  const beforeNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {},
  });

  try {
    const token = makeCourierJwt(Math.floor(Date.now() / 1000) + 7200);
    persistCourierAccess(token, 'login');
    await initializeTabSessionOwnership();

    assert.equal(sessionStorage.getItem(COURIER_ACCESS_KEY), null);
    assert.equal(sessionStorage.getItem(COURIER_COPIED_SESSION_DISCARDED_KEY), '1');
  } finally {
    if (beforeNavigator) Object.defineProperty(globalThis, 'navigator', beforeNavigator);
  }
});

