import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const planContract = readFileSync('src/legal/PlanContractPage.tsx', 'utf8');
const planStyles = readFileSync('src/legal/planSubscriptionFlow.css', 'utf8');
const main = readFileSync('src/main.tsx', 'utf8');

test('fluxo unificado de contratação está disponível em /contratar', () => {
  assert.match(main, /pathname\.startsWith\("\/contratar"\)/);
  assert.match(planContract, /01 · PLANO E COBRANÇA/);
  assert.match(planContract, /02 · DADOS E PAGAMENTO/);
  assert.match(planContract, /SUBSCRIPTION_PLANS\.map/);
});

test('seleção comercial usa somente ciclos suportados pelo backend', () => {
  assert.match(planContract, /'mensal' \| 'anual'/);
  assert.match(planContract, /Economize 10%/);
  assert.match(planContract, /annualMonthlyEquivalent/);
  assert.match(planContract, /annualSavings/);
  assert.doesNotMatch(planContract, /anual_12x/);
  assert.doesNotMatch(planContract, /Plano anual \(parcelado em 12x\)/);
});

test('checkout expõe apenas pagamentos implementados no backend', () => {
  assert.match(planContract, /type BillingMethod = 'credit_card' \| 'pix'/);
  assert.match(planContract, /Cartão de crédito/);
  assert.match(planContract, /Pix anual à vista/);
  assert.match(planContract, /payment_method_type: 'credit_card'/);
  assert.match(planContract, /payment_method_type: 'pix'/);
  assert.doesNotMatch(planContract, /NuPay/);
  assert.doesNotMatch(planContract, /Pix Automático/);
  assert.doesNotMatch(planContract, /mercado_pago.*BillingMethod/);
});

test('pix fica restrito ao anual antecipado e cartão preserva trial', () => {
  assert.match(planContract, /billingCycle === 'anual'/);
  assert.match(planContract, /O Pix anual é pagamento antecipado/);
  assert.match(planContract, /7 dias sem mensalidade fixa/);
  assert.match(planContract, /taxa KÔMA sobre pedidos online continua aplicável/);
});

test('CNPJ exige representante pessoa física e CPF usa o próprio titular', () => {
  assert.match(planContract, /contractingTaxKind === 'cnpj'/);
  assert.match(planContract, /Responsável pelo aceite/);
  assert.match(planContract, /isValidCpf\(representativeTaxId\)/);
  assert.match(planContract, /Titular da contratação/);
});

test('checkout não fabrica slug e mantém comprovante técnico acessível', () => {
  assert.match(planContract, /payload\.slug \|\| undefined/);
  assert.doesNotMatch(planContract, /toLowerCase\(\)\.replace\(\/\[\^a-z0-9\]\//);
  assert.match(planContract, /Comprovante de Contratação e Licenciamento Eletrônico/);
  assert.match(planContract, /Imprimir \/ salvar em PDF/);
});

test('identidade visual do checkout usa tokens KÔMA', () => {
  assert.match(planStyles, /--koma-bg: #070908/);
  assert.match(planStyles, /--koma-accent: #0bd6ad/);
  assert.match(planStyles, /\.koma-sub-plan-grid/);
  assert.match(planStyles, /\.koma-sub-timeline/);
  assert.doesNotMatch(planStyles, /#7c3aed/i);
});
