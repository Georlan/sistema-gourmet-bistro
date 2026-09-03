import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tenantsTab = readFileSync(
  new URL('../src/super-admin/SuperAdminTenantsTab.tsx', import.meta.url),
  'utf8',
);
const supportModal = readFileSync(
  new URL('../src/super-admin/SuperAdminSupportModal.tsx', import.meta.url),
  'utf8',
);
const banner = readFileSync(
  new URL('../src/components/app/SupportSessionBanner.tsx', import.meta.url),
  'utf8',
);
const app = readFileSync(
  new URL('../src/App.tsx', import.meta.url),
  'utf8',
);

test('Super Admin expõe Modo Suporte na listagem e nos detalhes do estabelecimento', () => {
  assert.match(tenantsTab, /SuperAdminSupportModal/);
  assert.match(tenantsTab, /setSupportTenant\(tenant\)/);
  assert.match(tenantsTab, /Acessar estabelecimento em Modo Suporte auditado/);
  assert.match(tenantsTab, /Entrar em Modo Suporte/);
  assert.match(tenantsTab, /supportTenant &&/);
});

test('modal de suporte exige motivo obrigatório e não manipula senhas de clientes', () => {
  assert.match(supportModal, /\/api\/super-admin\/support\/\$\{tenant\.id\}\/start/);
  assert.match(supportModal, /cleanReason\.length < 5/);
  assert.match(supportModal, /O motivo da intervenção é obrigatório/);
  assert.match(supportModal, /Nenhuma senha de cliente/);
  assert.match(supportModal, /início, o motivo, a duração e o encerramento desta sessão/);
  assert.match(supportModal, /auditoria administrativa/);
  assert.doesNotMatch(supportModal, /Todas as ações nesta sessão serão registradas/);
  assert.match(supportModal, /saveOperatorSession/);
  assert.doesNotMatch(supportModal, /senha_hash|password|client_secret/i);
});

test('banner de suporte informa contexto operacional, tempo restante e encerramento', () => {
  assert.match(banner, /Modo Suporte Ativo/);
  assert.match(banner, /Restaurante:/);
  assert.match(banner, /Operador:/);
  assert.match(banner, /Encerrar Suporte/);
  assert.match(banner, /\/api\/super-admin\/support\/end-current/);
  assert.match(banner, /clearOperatorSession/);
});

test('App.tsx integra o banner de suporte nos shells operacionais', () => {
  assert.match(app, /import \{ SupportSessionBanner \} from '\.\/components\/app\/SupportSessionBanner'/);
  assert.match(app, /<SupportSessionBanner \/>/);
});
