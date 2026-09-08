import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const planContract = readFileSync('src/legal/PlanContractPage.tsx', 'utf8');
const landingPlans = readFileSync('src/landing/sections/Plans.tsx', 'utf8');
const paymentCatalog = readFileSync('src/config/subscriptionPaymentOptions.ts', 'utf8');
const planStyles = readFileSync('src/legal/planSubscriptionFlow.css', 'utf8');
const paymentCatalogStyles = readFileSync('src/legal/paymentOptionsCatalog.css', 'utf8');
const landingPaymentStyles = readFileSync('src/landing/paymentOptions.css', 'utf8');
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
  assert.match(landingPlans, /não 12 parcelas/);
  assert.match(landingPlans, /cobrança do anual é única enquanto o parcelamento estiver em estudo/);
  assert.doesNotMatch(planContract, /anual_12x/);
});

test('landing e checkout consomem o mesmo catálogo de meios de pagamento', () => {
  assert.match(planContract, /getSubscriptionPaymentOptions/);
  assert.match(landingPlans, /getSubscriptionPaymentOptions/);
  assert.match(paymentCatalog, /id: 'credit_card'/);
  assert.match(paymentCatalog, /id: 'pix_annual'/);
  assert.match(paymentCatalog, /id: 'pix_automatic'/);
  assert.match(paymentCatalog, /id: 'nupay'/);
  assert.match(paymentCatalog, /id: 'mercado_pago'/);
  assert.match(paymentCatalog, /id: 'annual_installments'/);
  assert.match(paymentCatalog, /id: 'boleto'/);
  assert.match(paymentCatalog, /statusLabel: 'Disponível'/);
  assert.match(paymentCatalog, /statusLabel: 'Em validação'/);
  assert.match(paymentCatalog, /statusLabel: 'Em breve'/);
  assert.match(paymentCatalog, /statusLabel: 'Em estudo'/);
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
  assert.match(paymentCatalog, /Este preview não gera cobrança/);
  assert.match(planContract, /O cartão continua sendo o método selecionado e disponível nesta etapa/);
});

test('catálogo mantém roadmap de pagamentos com comunicação segura', () => {
  assert.match(paymentCatalog, /Pix anual à vista · em validação/);
  assert.match(paymentCatalog, /Pix Automático · em breve/);
  assert.match(paymentCatalog, /NuPay · em breve/);
  assert.match(paymentCatalog, /Mercado Pago · em breve/);
  assert.match(paymentCatalog, /Anual parcelado no cartão · em estudo/);
  assert.match(paymentCatalog, /Boleto anual · em estudo/);
  assert.match(paymentCatalog, /Não usaremos comprovante de Pix agendado como confirmação de pagamento/);
  assert.match(paymentCatalog, /KÔMA não subsidiará 12x sem juros/);
  assert.match(paymentCatalog, /KÔMA não vai subsidiar juros ou financiamento/);
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

test('identidade visual continua KÔMA e catálogos são responsivos', () => {
  assert.match(planStyles, /--koma-bg: #070908/);
  assert.match(planStyles, /--koma-accent: #0bd6ad/);
  assert.match(planStyles, /\.koma-sub-plan-grid/);
  assert.match(planStyles, /\.koma-sub-timeline/);
  assert.doesNotMatch(planStyles, /#7c3aed/i);
  assert.match(paymentCatalogStyles, /\.koma-sub-coming-grid/);
  assert.match(paymentCatalogStyles, /\.koma-sub-payment-preview/);
  assert.match(paymentCatalogStyles, /@media \(max-width: 760px\)/);
  assert.match(landingPaymentStyles, /\.koma-plans-payment-options-grid/);
  assert.match(landingPaymentStyles, /@media \(max-width: 760px\)/);
});
