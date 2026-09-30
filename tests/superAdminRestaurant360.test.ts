import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const restaurant360 = readFileSync(
  new URL('../src/super-admin/SuperAdminRestaurant360.tsx', import.meta.url),
  'utf8',
);
const tenantsTab = readFileSync(
  new URL('../src/super-admin/SuperAdminTenantsTab.tsx', import.meta.url),
  'utf8',
);

test('Restaurante 360 usa somente fontes administrativas reais já existentes', () => {
  assert.match(restaurant360, /\/api\/super-admin\/trials/);
  assert.match(restaurant360, /\/api\/super-admin\/onboarding\/restaurantes\//);
  assert.match(restaurant360, /\/api\/super-admin\/access\/restaurantes\//);
  assert.match(restaurant360, /\/api\/super-admin\/audit/);
  assert.match(restaurant360, /linkedRestaurantId === tenant\.id/);
  assert.doesNotMatch(restaurant360, /mock|faker|simulad/i);
});

test('Implantação e trial ficam no mesmo contexto sem misturar suspensão ou Mercado Pago', () => {
  assert.match(restaurant360, /Implantação & liberação/);
  assert.match(restaurant360, /O trial comercial começa após a liberação explícita da operação/);
  assert.match(restaurant360, /Separado de suspensão, cobrança SaaS e Mercado Pago/);
  assert.match(restaurant360, /<SuperAdminReleaseModal/);
  assert.match(restaurant360, /<SuperAdminTrialModal/);
});

test('Plano separa catálogo vigente, contrato congelado e benefícios individuais', () => {
  assert.match(restaurant360, /Plano de recursos atual/);
  assert.match(restaurant360, /Condições contratadas/);
  assert.match(restaurant360, /Mensalidade congelada/);
  assert.match(restaurant360, /Taxa online congelada/);
  assert.match(restaurant360, /Benefícios individuais não alteram automaticamente cobrança/);
  assert.match(restaurant360, /onBenefits\(tenant\)/);
});

test('Lista global usa filtros operacionais e empurra ações para a ficha 360', () => {
  assert.match(tenantsTab, /Todos os status/);
  assert.match(tenantsTab, /Todo pagamento online/);
  assert.match(tenantsTab, /selectedStatus/);
  assert.match(tenantsTab, /selectedPayment/);
  assert.match(tenantsTab, /Abrir 360°/);
  assert.doesNotMatch(tenantsTab, />Recursos\/Benefícios<\/button>/);
  assert.doesNotMatch(tenantsTab, />Editar<\/button>/);
});

test('Pagamentos distingue recebimento do restaurante da cobrança SaaS', () => {
  assert.match(restaurant360, /Mercado Pago do Cardápio Online/);
  assert.match(restaurant360, /Não representa mensalidade SaaS nem Pix anual da contratação/);
  assert.match(restaurant360, /nenhuma taxa é inferida/);
});
