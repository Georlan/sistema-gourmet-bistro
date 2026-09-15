import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const planContract = readFileSync('src/legal/PlanContractPage.tsx', 'utf8');
const landingPlans = readFileSync('src/landing/sections/Plans.tsx', 'utf8');
const paymentCatalog = readFileSync('src/config/subscriptionPaymentOptions.ts', 'utf8');
const planStyles = readFileSync('src/legal/planSubscriptionFlow.css', 'utf8');
const main = readFileSync('src/main.tsx', 'utf8');

test('fluxo unificado de contratação está disponível em /contratar', () => {
  assert.match(main, /pathname\.startsWith\("\/contratar"\)/);
  assert.match(planContract, /01 · PLANO E COBRANÇA/);
  assert.match(planContract, /03 · CONTRATAÇÃO E PAGAMENTO/);
  assert.match(planContract, /SUBSCRIPTION_PLANS\.map/);
});

test('seleção comercial mantém mensal e anual com trial antes da primeira cobrança', () => {
  assert.match(planContract, /'mensal' \| 'anual'/);
  assert.match(planContract, /Economize 10%/);
  assert.match(planContract, /annualMonthlyEquivalent/);
  assert.match(planContract, /cobrado automaticamente somente após os 7 dias grátis/);
  assert.match(landingPlans, /É apenas uma referência de preço/);
  assert.doesNotMatch(planContract, /anual_12x/);
  assert.doesNotMatch(planContract, /12 meses \+ 7 dias/);
  assert.doesNotMatch(planContract, /dias adicionais de bônus/);
});

test('landing não expõe roadmap de meios de pagamento', () => {
  assert.doesNotMatch(landingPlans, /getSubscriptionPaymentOptions/);
  assert.doesNotMatch(landingPlans, /Formas de pagamento da adesão/);
  assert.doesNotMatch(landingPlans, /FORMAS DE PAGAMENTO/);
});

test('catálogo remove Pix antecipado e preserva o trial até a implantação', () => {
  assert.match(paymentCatalog, /id: 'credit_card'/);
  assert.match(paymentCatalog, /id: 'pix_automatic'/);
  assert.match(paymentCatalog, /id: 'nupay'/);
  assert.match(paymentCatalog, /id: 'mercado_pago'/);
  assert.match(paymentCatalog, /id: 'annual_installments'/);
  assert.doesNotMatch(paymentCatalog, /id: 'pix_annual'/);
  assert.doesNotMatch(paymentCatalog, /id: 'boleto'/);
  assert.match(paymentCatalog, /Pix Automático · em validação/);
  assert.match(paymentCatalog, /recorrência fica preservada durante a implantação/);
  assert.match(paymentCatalog, /7 dias grátis começam somente depois dos 3 passos essenciais/);
});

test('checkout só oferece meios recorrentes com R$ 0 hoje e 7 dias grátis', () => {
  assert.match(planContract, /type BillingMethod = 'credit_card' \| 'pix_automatic' \| 'account_money'/);
  assert.match(planContract, /payment_method_type: billingMethod/);
  assert.match(planContract, /Pix Automático via Mercado Pago/);
  assert.match(planContract, /Saldo Mercado Pago/);
  assert.match(planContract, /R\$ 0 de mensalidade fixa hoje/);
  assert.match(planContract, /primeira cobrança automática/);
  assert.doesNotMatch(planContract, /payment_method_type: 'pix'/);
  assert.doesNotMatch(planContract, /Gerar Pix anual/);
  assert.doesNotMatch(planContract, /pagamento único/);
});

test('Pix hospedado não é apresentado como QR Code bancário', () => {
  assert.match(planContract, /Pix Automático via Mercado Pago/);
  assert.match(planContract, /não gera QR Code/);
  assert.match(planContract, /Este método não exibe QR Code Pix para leitura em outro banco/);
  assert.match(planContract, /Continuar no Mercado Pago/);
  assert.doesNotMatch(planContract, /<QrCode size=\{19\}/);
});

test('roadmap exige autorização recorrente, implantação sem consumo e trial completo', () => {
  assert.match(paymentCatalog, /NuPay exige integração própria/);
  assert.match(paymentCatalog, /implantação sem consumir trial e 7 dias grátis completos/);
  assert.match(paymentCatalog, /Carteira, saldo ou crédito do Mercado Pago só entram no checkout/);
  assert.match(paymentCatalog, /preservar os 7 dias grátis completos para depois do setup essencial/);
  assert.match(paymentCatalog, /O KÔMA não exibirá pagamento antecipado disfarçado de trial nem dias de bônus/);
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

test('identidade visual continua KÔMA e checkout continua responsivo', () => {
  assert.match(planStyles, /--koma-bg: #070908/);
  assert.match(planStyles, /--koma-accent: #0bd6ad/);
  assert.match(planStyles, /\.koma-sub-plan-grid/);
  assert.match(planStyles, /\.koma-sub-timeline/);
  assert.doesNotMatch(planStyles, /#7c3aed/i);
});

test('primeiro acesso após contratação utiliza fragment #token= e possui fallback seguro', () => {
  assert.match(planContract, /activationToken\?: string/);
  assert.match(planContract, /activationToken:\s*payload\.activationToken/);
  assert.match(planContract, /\/ativar#token=\$\{encodeURIComponent\(activationResult\.activationToken\)\}/);
  assert.doesNotMatch(planContract, /href=["']\/ativar["']/);
  assert.doesNotMatch(planContract, /\/ativar\?token=/);
  assert.match(planContract, /Seu acesso está sendo preparado\. Utilize o convite enviado ao responsável\./);
});

test('permite trocar de plano depois de uma tentativa cancelada ou falha sem perder dados', () => {
  assert.doesNotMatch(planContract, /koma-sub-back[^>]*disabled=\{contractLocked\}/);
  assert.doesNotMatch(planContract, /Plano congelado nesta contratação/);
  assert.match(planContract, /Trocar plano ou ciclo/);
  assert.match(planContract, /handleSwitchPlanOrCycle/);
  assert.match(planContract, /\/billing\/status/);
  assert.match(planContract, /billingStatus === 'pending' \|\| billingStatus === 'ready'/);
  assert.match(planContract, /Cancele essa autorização antes de iniciar outro plano ou ciclo/);
  assert.match(planContract, /Inscrição anterior encerrada para edição\. Seus dados foram preservados/);
  assert.match(planContract, /localStorage\.removeItem\('koma_signup_resume'\)/);
  assert.match(planContract, /setSignupToken\(''\)/);
  assert.match(planContract, /setRequestId\(newRequestId\(\)\)/);
  assert.match(planContract, /setReceipt\(null\)/);
});
