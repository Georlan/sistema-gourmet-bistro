import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { authenticateStoreSwitch, canSwitchStore, commitStoreSwitch, type StoreSwitchSession } from '../src/utils/storeSwitch';
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
async function withReply(status: number, data: unknown, run: (body: () => any) => Promise<void>) {
  const original = globalThis.fetch;
  let sent: any;
  globalThis.fetch = (async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    assert.equal(new Headers(init?.headers).get('Authorization'), null);
    return new Response(JSON.stringify(data), { status });
  }) as typeof fetch;
  try { await run(() => sent); } finally { globalThis.fetch = original; }
}
const credentials = { username: ' ADMIN@KOMA.TEST ', password: 'senha', restaurantId: 2 };

test('somente administradores e gerentes possuem o seletor', () => {
  assert.equal(canSwitchStore('admin'), true);
  assert.equal(canSwitchStore('gerente'), true);
  for (const role of ['caixa', 'garcom', 'superadmin', 'cozinha', undefined]) assert.equal(canSwitchStore(role), false);
});
test('autentica a unidade exata sem substituir a sessão antes de confirmar', async () => {
  await withReply(200, { access_token: next.token, usuario: { ...next.user, email: 'private', telefone: 'private' } }, async sent => {
    const result = await authenticateStoreSwitch('https://example.test/auth/login', credentials);
    assert.equal(result.kind, 'authenticated');
    assert.deepEqual(sent(), { username: 'admin@koma.test', password: 'senha', restaurante_id: 2 });
    assert.equal(getOperatorSession()?.token, 'unit-a-token');
    assert.doesNotMatch(JSON.stringify(result), /private|senha/);
  });
});
test('seleção retornada pelo login não concede acesso nem muda a sessão', async () => {
  await withReply(409, { detail: { code: 'restaurant_selection_required', restaurantes: [{ id: 1, nome: 'Matriz' }, { id: 2, nome: 'Filial' }, { id: -1 }] } }, async () => {
    assert.deepEqual(await authenticateStoreSwitch('https://example.test/auth/login', { username: 'a', password: 'b' }), {
      kind: 'selection', stores: [{ id: 1, nome: 'Matriz' }, { id: 2, nome: 'Filial' }],
    });
    assert.equal(getOperatorSession()?.token, 'unit-a-token');
  });
});
for (const status of [401, 403, 429, 503]) test(`falha ${status} preserva a loja atual`, async () => {
  await withReply(status, { detail: 'Acesso recusado' }, async () => {
    await assert.rejects(authenticateStoreSwitch('https://example.test/auth/login', credentials), /Acesso recusado/);
    assert.equal(getOperatorSession()?.user.restaurante_id, 1);
  });
});
test('resposta com outra unidade ou perfil não pode ser confirmada', async () => {
  await withReply(200, { access_token: next.token, usuario: { ...next.user, restaurante_id: 3 } }, async () => {
    await assert.rejects(authenticateStoreSwitch('https://example.test/auth/login', credentials), /não corresponde/);
  });
  await withReply(200, { access_token: next.token, usuario: { ...next.user, role: 'caixa' } }, async () => {
    await assert.rejects(authenticateStoreSwitch('https://example.test/auth/login', credentials), /administrador ou gerente/);
  });
  assert.equal(getOperatorSession()?.token, 'unit-a-token');
});
test('resposta incompleta preserva a sessão válida', async () => {
  await withReply(200, { access_token: next.token, usuario: { id: 'b', role: 'admin', restaurante_id: 2 } }, async () => {
    await assert.rejects(authenticateStoreSwitch('https://example.test/auth/login', credentials), /incompleta/);
    assert.equal(getOperatorSession()?.token, 'unit-a-token');
  });
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
