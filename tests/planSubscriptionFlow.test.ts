import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const planContract = readFileSync('src/legal/PlanContractPage.tsx', 'utf8');
const planStyles = readFileSync('src/legal/planSubscriptionFlow.css', 'utf8');
const paymentCatalogStyles = readFileSync('src/legal/paymentOptionsCatalog.css', 'utf8');
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

test('checkout separa pagamento ativo de opções futuras sem fingir integração', () => {
  assert.match(planContract, /type BillingMethod = 'credit_card' \| 'pix'/);
  assert.match(planContract, /Forma de pagamento disponível/);
  assert.match(planContract, /Cartão de crédito/);
  assert.match(planContract, /payment_method_type: 'credit_card'/);
  assert.match(planContract, /payment_method_type: 'pix'/);

  assert.match(planContract, /type PaymentPreview = 'pix_annual' \| 'pix_automatic' \| 'nupay' \| 'mercado_pago' \| 'boleto' \| 'annual_installments'/);
  assert.match(planContract, /Pix anual à vista · em validação/);
  assert.match(planContract, /Pix Automático · em breve/);
  assert.match(planContract, /NuPay · em breve/);
  assert.match(planContract, /Mercado Pago · em breve/);
  assert.match(planContract, /Anual parcelado no cartão · em estudo/);
  assert.match(planContract, /Boleto anual · em estudo/);
  assert.match(planContract, /Este preview não gera cobrança/);
  assert.match(planContract, /O cartão continua sendo o método selecionado e disponível nesta etapa/);
});

test('pix não homologado fica em preview e cartão preserva trial', () => {
  assert.match(planContract, /billingCycle === 'anual'/);
  assert.match(planContract, /Pix anual à vista/);
  assert.match(planContract, /Em validação/);
  assert.match(planContract, /7 dias sem mensalidade fixa/);
  assert.match(planContract, /taxa KÔMA sobre pedidos online continua aplicável/);
  assert.match(planContract, /Não usaremos comprovante de Pix agendado como confirmação de pagamento/);
});

test('parcelamento futuro não subsidia juros pelo KÔMA', () => {
  assert.match(planContract, /Parcelas com juros\/condições do emissor, sem subsídio KÔMA/);
  assert.match(planContract, /KÔMA não subsidiará 12x sem juros/);
  assert.match(planContract, /KÔMA não vai subsidiar juros ou financiamento/);
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

test('identidade visual do checkout usa tokens KÔMA e previews responsivos', () => {
  assert.match(planStyles, /--koma-bg: #070908/);
  assert.match(planStyles, /--koma-accent: #0bd6ad/);
  assert.match(planStyles, /\.koma-sub-plan-grid/);
  assert.match(planStyles, /\.koma-sub-timeline/);
  assert.doesNotMatch(planStyles, /#7c3aed/i);
  assert.match(paymentCatalogStyles, /\.koma-sub-coming-grid/);
  assert.match(paymentCatalogStyles, /\.koma-sub-payment-preview/);
  assert.match(paymentCatalogStyles, /@media \(max-width: 760px\)/);
});
