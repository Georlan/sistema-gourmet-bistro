import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { getStoreIndex, requestStoreSwitch, canSwitchStore, commitStoreSwitch, type StoreSwitchSession } from '../src/utils/storeSwitch';
import { getOperatorSession, saveOperatorSession } from '../src/utils/authSession';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
}
const next: StoreSwitchSession = { token: 'unit-b-token', user: { id: 'manager-b', nome: 'Gerente B', role: 'gerente', restaurante_id: 2 } };
beforeEach(() => {
  (globalThis as any).sessionStorage = storage();
  (globalThis as any).localStorage = storage();
  saveOperatorSession('unit-a-token', { id: 'admin-a', nome: 'Admin A', role: 'admin', restaurante_id: 1 });
});
test('somente administradores e gerentes possuem o seletor', () => {
  assert.equal(canSwitchStore('admin'), true);
  assert.equal(canSwitchStore('gerente'), true);
  for (const role of ['caixa', 'garcom', 'superadmin', 'cozinha', undefined]) assert.equal(canSwitchStore(role), false);
});
test('troca limpa contexto antigo e preserva outra aba e preferências', () => {
  const otherTab = storage();
  otherTab.setItem('koma_caixa_token', 'other-tab-token');
  localStorage.setItem('koma_font_size', 'grande');
  for (const key of ['koma_restaurant_name_v3', 'koma_settings_vFinal_v3', 'koma_caixa_selected_table_v3', 'koma_active_tab', 'koma_active_subtab', 'koma_onboarding_test_order']) sessionStorage.setItem(key, 'old');
  commitStoreSwitch(next, 'unit-a-token');
  assert.equal(getOperatorSession()?.token, next.token);
  assert.equal(getOperatorSession()?.user.restaurante_id, 2);
  for (const key of ['koma_restaurant_name_v3', 'koma_settings_vFinal_v3', 'koma_caixa_selected_table_v3', 'koma_active_tab', 'koma_active_subtab', 'koma_onboarding_test_order']) assert.equal(sessionStorage.getItem(key), null);
  assert.equal(otherTab.getItem('koma_caixa_token'), 'other-tab-token');
  assert.equal(localStorage.getItem('koma_font_size'), 'grande');
});
test('confirmação antiga não substitui uma sessão que já mudou', () => {
  saveOperatorSession('new-source', { id: 'new-admin', nome: 'Novo Admin', role: 'admin', restaurante_id: 3 });
  assert.throws(() => commitStoreSwitch(next, 'unit-a-token'), /sessão mudou/);
  assert.equal(getOperatorSession()?.token, 'new-source');
});
test('a loja atual e destino inválido não substituem a sessão', () => {
  assert.throws(() => commitStoreSwitch({ ...next, user: { ...next.user, restaurante_id: 1 } }, 'unit-a-token'), /já está/);
  assert.throws(() => commitStoreSwitch({ ...next, user: { ...next.user, role: 'caixa' } }, 'unit-a-token'), /inválido/);
  assert.equal(getOperatorSession()?.token, 'unit-a-token');
});
test('sessão de suporte não pode herdar a identidade de outra unidade', () => {
  sessionStorage.setItem('koma_support_session', 'support-context');
  assert.throws(() => commitStoreSwitch(next, 'unit-a-token'), /sessão de suporte/);
  assert.equal(getOperatorSession()?.token, 'unit-a-token');
  sessionStorage.removeItem('koma_support_session');
  saveOperatorSession('support-token', { id: 'support:operator', nome: 'Suporte', role: 'admin', restaurante_id: 1 });
  assert.throws(() => commitStoreSwitch(next, 'support-token'), /sessão de suporte/);
});

async function storeReply(status: number, data: unknown, run: (request: () => { url: string; init: RequestInit }) => Promise<void>) {
  const original = globalThis.fetch;
  let sent: any;
  globalThis.fetch = (async (url, init) => { sent = { url, init }; return new Response(JSON.stringify(data), { status }); }) as typeof fetch;
  try { await run(() => sent); } finally { globalThis.fetch = original; }
}
test('índice independente vem do servidor, sem inferir rede por e-mail', async () => {
  const index = { current: { id: 1, nome: 'Matriz' }, network: null, units: [] };
  await storeReply(200, index, async request => {
    assert.deepEqual(await getStoreIndex('https://example.test', 'unit-a-token'), index);
    assert.equal(request().url, 'https://example.test/auth/lojas');
    assert.equal(new Headers(request().init.headers).get('Authorization'), 'Bearer unit-a-token');
    assert.equal(getOperatorSession()?.token, 'unit-a-token');
  });
});
test('falha do índice não é apresentada como loja independente', async () => {
  await storeReply(503, { detail: 'Índice indisponível' }, async () => {
    await assert.rejects(getStoreIndex('https://example.test', 'unit-a-token'), /indisponível/);
  });
  await storeReply(200, { current: { id: 1, nome: 'Matriz' }, units: [] }, async () => {
    await assert.rejects(getStoreIndex('https://example.test', 'unit-a-token'), /incompleta/);
  });
});
test('troca usa sessão atual e ID exato sem enviar credenciais', async () => {
  await storeReply(200, { access_token: next.token, usuario: next.user }, async request => {
    const result = await requestStoreSwitch('https://example.test', 'unit-a-token', 2);
    assert.equal(result.user.restaurante_id, 2);
    assert.equal(request().url, 'https://example.test/auth/lojas/2/entrar');
    assert.equal(request().init.method, 'POST');
    assert.equal(request().init.body, undefined);
    assert.equal(new Headers(request().init.headers).get('Authorization'), 'Bearer unit-a-token');
    assert.equal(getOperatorSession()?.token, 'unit-a-token');
  });
});
test('destino não autorizado ou resposta com outro tenant preserva a origem', async () => {
  await storeReply(403, { detail: 'Unidade não autorizada' }, async () => {
    await assert.rejects(requestStoreSwitch('https://example.test', 'unit-a-token', 2), /não autorizada/);
  });
  await storeReply(200, { access_token: next.token, usuario: { ...next.user, restaurante_id: 3 } }, async () => {
    await assert.rejects(requestStoreSwitch('https://example.test', 'unit-a-token', 2), /não corresponde/);
  });
  assert.equal(getOperatorSession()?.token, 'unit-a-token');
});
