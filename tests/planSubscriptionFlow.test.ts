import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const planContract = readFileSync('src/legal/PlanContractPage.tsx', 'utf8');
const landingPlans = readFileSync('src/landing/sections/Plans.tsx', 'utf8');
const paymentCatalog = readFileSync('src/config/subscriptionPaymentOptions.ts', 'utf8');
const planStyles = readFileSync('src/legal/planSubscriptionFlow.css', 'utf8');
const paymentCatalogStyles = readFileSync('src/legal/paymentOptionsCatalog.css', 'utf8');
const main = readFileSync('src/main.tsx', 'utf8');

test('fluxo unificado de contratação está disponível em /contratar', () => {
  assert.match(main, /pathname\.startsWith\("\/contratar"\)/);
  assert.match(planContract, /01 · PLANO E COBRANÇA/);
  assert.match(planContract, /02 · DADOS E PAGAMENTO/);
  assert.match(planContract, /SUBSCRIPTION_PLANS\.map/);
});

test('seleção comercial usa somente ciclos suportados pelo backend e explica o anual', () => {
  assert.match(planContract, /'mensal' \| 'anual'/);
  assert.match(planContract, /Economize 10%/);
  assert.match(planContract, /annualMonthlyEquivalent/);
  assert.match(planContract, /Valor mensal equivalente não representa 12 parcelas/);
  assert.match(landingPlans, /É apenas uma referência de preço/);
  assert.match(landingPlans, /condições de pagamento são apresentadas na contratação/);
  assert.doesNotMatch(planContract, /anual_12x/);
});

test('landing não expõe roadmap de meios de pagamento', () => {
  assert.doesNotMatch(landingPlans, /getSubscriptionPaymentOptions/);
  assert.doesNotMatch(landingPlans, /Formas de pagamento da adesão/);
  assert.doesNotMatch(landingPlans, /FORMAS DE PAGAMENTO/);
});

test('catálogo do checkout mantém apenas os meios desejados no roadmap', () => {
  assert.match(planContract, /getSubscriptionPaymentOptions/);
  assert.match(paymentCatalog, /id: 'credit_card'/);
  assert.match(paymentCatalog, /id: 'pix_annual'/);
  assert.match(paymentCatalog, /id: 'pix_automatic'/);
  assert.match(paymentCatalog, /id: 'nupay'/);
  assert.match(paymentCatalog, /id: 'mercado_pago'/);
  assert.match(paymentCatalog, /id: 'annual_installments'/);
  assert.doesNotMatch(paymentCatalog, /id: 'boleto'/);
  assert.match(paymentCatalog, /label: 'Pix'/);
});

test('checkout separa pagamento ativo de previews sem fingir integração', () => {
  assert.match(planContract, /type BillingMethod = 'credit_card' \| 'pix'/);
  assert.match(planContract, /type PaymentPreview = SubscriptionPaymentOptionId/);
  assert.match(planContract, /Forma de pagamento disponível/);
  assert.match(planContract, /payment_method_type: 'credit_card'/);
  assert.match(planContract, /payment_method_type: 'pix'/);
  assert.doesNotMatch(planContract, /payment_method_type: 'nupay'/);
  assert.doesNotMatch(planContract, /payment_method_type: 'mercado_pago'/);
  assert.doesNotMatch(planContract, /payment_method_type: 'pix_automatic'/);
});

test('roadmap respeita pix geral, NuPay separado e parcelamento sem subsídio', () => {
  assert.match(paymentCatalog, /Pix · em validação/);
  assert.match(paymentCatalog, /qualquer banco ou carteira compatível/);
  assert.match(paymentCatalog, /NuPay exige integração própria/);
  assert.match(paymentCatalog, /Não vamos assumir que o valor liquida na conta Mercado Pago/);
  assert.match(paymentCatalog, /Até 12x somente quando os juros do parcelamento ficarem com o comprador\/provedor/);
  assert.match(paymentCatalog, /sem o KÔMA bancar os juros/);
  assert.match(paymentCatalog, /Não usaremos comprovante de Pix agendado como confirmação de pagamento/);
});

test('CNPJ exige representante pessoa física e CPF usa o próprio titular', () => {
  assert.match(planContract, /contractingTaxKind === 'cnpj'/);
  assert.match(planContract, /Responsável pelo aceite/);
  assert.match(planContract, /isValidCpf\(representativeTaxId\)/);
  assert.match(planContract, /Titular da contratação/);
});

test('checkout não fabrica slug e mantém comprovante técnico acessível', () => {
  assert.match(planContract, /payload\.slug \|\| undefined/);
  assert.doesNotMatch(planContract, /toLowerCase\(\)\.replace\(/);
  assert.match(planContract, /Comprovante de Contratação e Licenciamento Eletrônico/);
  assert.match(planContract, /Imprimir \/ salvar em PDF/);
});

test('identidade visual continua KÔMA e catálogo do checkout é responsivo', () => {
  assert.match(planStyles, /--koma-bg: #070908/);
  assert.match(planStyles, /--koma-accent: #0bd6ad/);
  assert.match(planStyles, /\.koma-sub-plan-grid/);
  assert.match(planStyles, /\.koma-sub-timeline/);
  assert.doesNotMatch(planStyles, /#7c3aed/i);
  assert.match(paymentCatalogStyles, /\.koma-sub-coming-grid/);
  assert.match(paymentCatalogStyles, /\.koma-sub-payment-preview/);
  assert.match(paymentCatalogStyles, /@media \(max-width: 760px\)/);
});
