import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isValidCnpj, taxIdKind } from '../src/legal/taxId';

const planContract = readFileSync('src/legal/PlanContractPageV2.tsx', 'utf8');
const landingPlans = readFileSync('src/landing/sections/Plans.tsx', 'utf8');
const paymentCatalog = readFileSync('src/config/subscriptionPaymentOptions.ts', 'utf8');
const planStyles = readFileSync('src/legal/planSubscriptionFlow.css', 'utf8');
const main = readFileSync('src/main.tsx', 'utf8');

test('fluxo unificado de contratação usa o checkout de três meios', () => {
  assert.match(main, /pathname\.startsWith\("\/contratar"\)/);
  assert.match(main, /PlanContractPageV2/);
  assert.match(planContract, /01 · PLANO E COBRANÇA/);
  assert.match(planContract, /03 · CONTRATAÇÃO E PAGAMENTO/);
  assert.match(planContract, /SUBSCRIPTION_PLANS\.map/);
});

test('seleção comercial mantém mensal e anual com trial após implantação', () => {
  assert.match(planContract, /type BillingCycle = 'mensal' \| 'anual'/);
  assert.match(planContract, /Economize 10%/);
  assert.match(planContract, /annualMonthlyEquivalent/);
  assert.match(planContract, /Os 7 dias só começam depois dos 3 passos essenciais/);
  assert.match(landingPlans, /É apenas uma referência de preço/);
  assert.doesNotMatch(planContract, /12 meses \+ 7 dias|dias adicionais de bônus/);
});

test('checkout expõe exatamente cartão Pix Automático e Saldo Mercado Pago', () => {
  assert.match(planContract, /type BillingMethod = 'credit_card' \| 'pix_automatic' \| 'account_money'/);
  assert.match(planContract, /Cartão de crédito/);
  assert.match(planContract, /Pix Automático/);
  assert.match(planContract, /Saldo Mercado Pago/);
  assert.match(planContract, /\/api\/contracts\/payment-methods/);
});

test('Pix Automático usa o setup recorrente e redireciona para autorização', () => {
  assert.match(planContract, /payment_method_type: billingMethod/);
  assert.match(planContract, /\/billing\/setup/);
  assert.match(planContract, /billingMethod === 'pix_automatic'/);
  assert.match(planContract, /authorization_required/);
  assert.match(planContract, /window\.location\.assign\(String\(payload\.authorizationUrl\)\)/);
  assert.doesNotMatch(planContract, /\/billing\/pix\/select/);
  assert.doesNotMatch(planContract, /QR Code \+ Pix Copia e Cola/);
});

test('catálogo contém somente os três meios publicados', () => {
  assert.match(paymentCatalog, /id: 'credit_card'/);
  assert.match(paymentCatalog, /id: 'pix_automatic'/);
  assert.match(paymentCatalog, /id: 'account_money'/);
  assert.doesNotMatch(paymentCatalog, /id: 'pix'|nupay|annual_installments|boleto/);
});

test('retomada de inscrição é escolha explícita e troca de plano permanece possível', () => {
  assert.match(planContract, /Encontramos uma inscrição salva/);
  assert.match(planContract, /Retomar inscrição/);
  assert.match(planContract, /Começar outra/);
  assert.match(planContract, /Trocar plano ou ciclo/);
  assert.match(planContract, /handleSwitchPlanOrCycle/);
  assert.match(planContract, /localStorage\.removeItem\('koma_signup_resume'\)/);
});

test('CNPJ exige representante pessoa física e CPF usa o próprio titular', () => {
  assert.match(planContract, /contractingTaxKind === 'cnpj'/);
  assert.match(planContract, /Responsável pelo aceite/);
  assert.match(planContract, /isValidCpf\(representativeTaxId\)/);
  assert.match(planContract, /Titular da contratação/);
});

test('campo de CPF / CNPJ da contratação aceita CNPJ alfanumérico e não restringe teclado a numérico', () => {
  const v1 = readFileSync('src/legal/PlanContractPage.tsx', 'utf8');
  assert.doesNotMatch(
    v1,
    /<input[^<]*?value=\{form\.taxId\}[^<]*?inputMode="numeric"/,
    'campo de CPF / CNPJ em PlanContractPage não deve restringir o teclado com inputMode="numeric"',
  );
  assert.match(
    v1,
    /<input[^<]*?value=\{form\.taxId\}[^<]*?autoCapitalize="characters"/,
    'campo de CPF / CNPJ deve permitir texto com autoCapitalize="characters"',
  );
  assert.match(
    v1,
    /<input[^<]*?value=\{form\.representativeTaxId\}[^<]*?inputMode="numeric"/,
    'campo CPF do responsável continua restrito a teclado numérico',
  );
  assert.doesNotMatch(
    planContract,
    /<input[^<]*?value=\{form\.taxId\}[^<]*?inputMode="numeric"/,
    'campo de CPF / CNPJ em PlanContractPageV2 não deve restringir o teclado com inputMode="numeric"',
  );
  assert.equal(taxIdKind('00.000.000/E08G-12'), 'cnpj');
  assert.equal(isValidCnpj('00.000.000/E08G-12'), true);
});

test('checkout mantém comprovante técnico e primeiro acesso seguro', () => {
  assert.match(planContract, /Comprovante de Contratação e Licenciamento Eletrônico/);
  assert.match(planContract, /Imprimir \/ salvar em PDF/);
  assert.match(planContract, /activationToken\?: string/);
  assert.match(planContract, /\/ativar#token=\$\{encodeURIComponent\(activationResult\.activationToken\)\}/);
  assert.match(planContract, /Seu acesso está sendo preparado\. Utilize o convite enviado ao responsável\./);
});

test('identidade visual continua KÔMA e checkout continua responsivo', () => {
  assert.match(planStyles, /--koma-bg: #070908/);
  assert.match(planStyles, /--koma-accent: #0bd6ad/);
  assert.match(planStyles, /\.koma-sub-plan-grid/);
  assert.match(planStyles, /\.koma-sub-timeline/);
  assert.doesNotMatch(planStyles, /#7c3aed/i);
});
