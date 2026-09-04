import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panel = readFileSync(
  new URL('../src/super-admin/SuperAdminPanel.tsx', import.meta.url),
  'utf8',
);
const accessTab = readFileSync(
  new URL('../src/super-admin/SuperAdminAccessTab.tsx', import.meta.url),
  'utf8',
);

test('Super Admin expõe Acessos e equipe como ferramenta do control plane', () => {
  assert.match(panel, /SuperAdminAccessTab/);
  assert.match(panel, /id: "access" as TabId, label: "Acessos e equipe"/);
  assert.match(panel, /activeTab === "access"/);
});

test('central usa somente endpoints administrativos reais e exige motivo', () => {
  assert.match(accessTab, /superAdminFetch\("\/api\/super-admin\/access"\)/);
  assert.match(accessTab, /\/api\/super-admin\/access\/restaurantes\/\$\{encodeURIComponent\(selected\.restaurantId\)\}\/usuarios\//);
  assert.match(accessTab, /\/revogar-sessoes/);
  assert.match(accessTab, /method: "PUT"/);
  assert.match(accessTab, /method: "POST"/);
  assert.match(accessTab, /reason/);
  assert.match(accessTab, /force: editor\.force/);
  assert.match(accessTab, /Forçar override administrativo/);
  assert.match(accessTab, /Nenhum estado é simulado/);
});

test('central não expõe ou manipula credenciais sensíveis', () => {
  assert.doesNotMatch(accessTab, /senha_hash|token_convite|access_token|refresh_token|seller_id/i);
  assert.match(accessTab, /não lê, redefine ou revela senha/);
  assert.match(accessTab, /token Mercado Pago/);
  assert.match(accessTab, /sem alterar senha, cargo, status ou dados do usuário/);
});

test('papéis de tenant não permitem atribuir superadmin', () => {
  assert.match(accessTab, /const roleOptions = \["admin", "gerente", "caixa", "garcom", "motoboy"\]/);
  assert.match(accessTab, /O cargo superadmin não pode ser atribuído a usuários de tenant/);
});

test('interface deixa claro que revogação sobrevive à reativação', () => {
  assert.match(accessTab, /Bloquear acesso revoga as sessões já emitidas/);
  assert.match(accessTab, /Reativar o usuário não restaura tokens antigos/);
  assert.match(accessTab, /Encerrar sessões/);
  assert.doesNotMatch(accessTab, /revogação permanente de sessões terá uma camada dedicada/);
});
