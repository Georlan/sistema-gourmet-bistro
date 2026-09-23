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
  assert.match(planContract, /03 · CONTRATAÇÃO\{fixedBillingRequired \? ' E PAGAMENTO' : ''\}/);
  assert.match(planContract, /Seu contrato anterior mantém mensalidade fixa de R\$ 0/);
  assert.match(planContract, /SUBSCRIPTION_PLANS\.map/);
});

test('seleção comercial mantém Pocket mensal e anual apenas nos planos pagos', () => {
  assert.match(planContract, /type BillingCycle = 'mensal' \| 'anual'/);
  assert.match(planContract, /candidate\.id !== 'pocket'/);
  assert.match(planContract, /function resolveBillingCycle\(planId: SubscriptionPlanId\)/);
  assert.match(planContract, /if \(planId === 'pocket'\) return 'mensal'/);
  assert.match(planContract, /resolveBillingCycle\(initialPlanId\)/);
  assert.match(planContract, /candidate\.id === 'pocket'\) setBillingCycle\('mensal'\)/);
  assert.match(planContract, /selectedPlanId === 'pocket' && billingCycle !== 'mensal'/);
  assert.match(planContract, /setBillingCycle\('mensal'\)/);
  assert.match(planContract, /O desconto anual não altera a taxa percentual/);
  assert.match(planContract, /annualMonthlyEquivalent/);
  assert.match(planContract, /Os 7 dias só começam depois dos 3 passos essenciais/);
  assert.match(landingPlans, /Pro e Premium: valor mensal equivalente/);
  assert.match(landingPlans, /Pocket permanece mensal, sem opção anual/);
  assert.doesNotMatch(planContract, /12 meses \+ 7 dias|dias adicionais de bônus/);
});

test('checkout expõe exatamente cartão Pix e Saldo Mercado Pago', () => {
  assert.match(planContract, /type BillingMethod = 'credit_card' \| 'pix' \| 'account_money'/);
  assert.match(planContract, /Cartão de crédito/);
  assert.match(planContract, /QR Code \+ Pix Copia e Cola/);
  assert.match(planContract, /Saldo Mercado Pago/);
  assert.match(planContract, /payment-methods-v2/);
  assert.doesNotMatch(planContract, /Pix Automático via Mercado Pago/);
});

test('Pix é universal e não gera cobrança no aceite', () => {
  assert.match(planContract, /\/billing\/pix\/select/);
  assert.match(planContract, /pague com qualquer banco/);
  assert.match(planContract, /Você poderá pagar com qualquer banco ou PSP Pix/);
  assert.match(planContract, /Não há débito Pix automático/);
  assert.doesNotMatch(planContract, /Continuar no Mercado Pago.*Pix/);
});

test('checkout diferencia claramente Pix mensal de Pix anual', () => {
  assert.match(planContract, /Escolho Pix anual/);
  assert.match(planContract, /um único QR Code\/Pix Copia e Cola/);
  assert.match(planContract, /quitando os próximos 12 meses/);
  assert.match(planContract, /Escolho Pix mensal/);
  assert.match(planContract, /cada vencimento mensal será pago por um novo QR Code\/Pix Copia e Cola/);
  assert.doesNotMatch(planContract, /cada vencimento será pago por novo QR Code/);
});

test('resumo lateral acompanha o meio de pagamento selecionado', () => {
  assert.match(planContract, /billingMethod === 'pix'[\s\S]*Pix anual não é débito automático/);
  assert.match(planContract, /billingMethod === 'account_money'[\s\S]*Saldo Mercado Pago é recorrente/);
  assert.match(planContract, /Cartão de crédito é recorrente/);
});

test('catálogo contém somente os três meios publicados', () => {
  assert.match(paymentCatalog, /id: 'credit_card'/);
  assert.match(paymentCatalog, /id: 'pix'/);
  assert.match(paymentCatalog, /id: 'account_money'/);
  assert.doesNotMatch(paymentCatalog, /pix_automatic|nupay|annual_installments|boleto/);
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
  assert.doesNotMatch(v1, /<input[^<]*?value=\{form\.taxId\}[^<]*?inputMode="numeric"/);
  assert.match(v1, /<input[^<]*?value=\{form\.taxId\}[^<]*?autoCapitalize="characters"/);
  assert.match(v1, /<input[^<]*?value=\{form\.representativeTaxId\}[^<]*?inputMode="numeric"/);
  assert.doesNotMatch(planContract, /<input[^<]*?value=\{form\.taxId\}[^<]*?inputMode="numeric"/);
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
