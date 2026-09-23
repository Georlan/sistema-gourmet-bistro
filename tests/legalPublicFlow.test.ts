import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync('src/main.tsx', 'utf8');
const legacyLegalContent = readFileSync('src/legal/legalContentLegacy.ts', 'utf8');
const legalV2 = readFileSync('src/legal/legalContentV2.ts', 'utf8');
const legalV25 = readFileSync('src/legal/legalContentRecurring.ts', 'utf8');
const legalV26 = readFileSync('src/legal/legalContentV26.ts', 'utf8');
const legalV27 = readFileSync('src/legal/legalContentV27.ts', 'utf8');
const legalContent = readFileSync('src/legal/legalContentV28.ts', 'utf8');
const legalEvidence = readFileSync('src/legal/legalEvidence.ts', 'utf8');
const legalPage = readFileSync('src/legal/LegalPage.tsx', 'utf8');
const planContract = readFileSync('src/legal/PlanContractPageV2.tsx', 'utf8');
const header = readFileSync('src/landing/sections/Header.tsx', 'utf8');
const plans = readFileSync('src/landing/sections/Plans.tsx', 'utf8');
const finalCta = readFileSync('src/landing/sections/FinalCTA.tsx', 'utf8');
const contractDocumentsPanel = readFileSync('src/components/assinatura/ContractDocumentsPanel.tsx', 'utf8');

test('rotas legal e contratação são públicas e isoladas do app operacional', () => {
  assert.match(main, /pathname\.startsWith\("\/legal"\)/);
  assert.match(main, /pathname\.startsWith\("\/contratar"\)/);
  assert.match(main, /import\("\.\/legal\/LegalPage"\)/);
  assert.match(main, /import\("\.\/legal\/PlanContractPageV2"\)/);
  assert.match(main, /isPublicCommercialRoute\(\)/);
});

test('central legal preserva snapshots 2.0 e 2.5 e publica fachada vigente 2.8', () => {
  for (const slug of ['termos','planos','privacidade','dpa','suboperadores','cookies','cardapio-termos','cardapio-privacidade']) {
    assert.match(legalV2, new RegExp(`slug: '${slug}'`));
  }
  assert.match(legalV2, /LEGAL_VERSION = '2\.0'/);
  assert.match(legalV25, /LEGAL_VERSION = '2\.5'/);
  assert.match(legalV25, /15\/09\/2026/);
  assert.match(legalV26, /LEGAL_VERSION = '2\.6'/);
  assert.match(legalV27, /LEGAL_VERSION = '2\.7'/);
  assert.match(legalContent, /LEGAL_VERSION = '2\.8'/);
  assert.match(legalV26, /18\/09\/2026/);
  assert.match(legalContent, /23\/09\/2026/);
  assert.match(legalContent, /from '\.\/legalContentRecurring'/);
  assert.match(legacyLegalContent, /LEGAL_VERSION = '1\.2'/);
  assert.match(legalPage, /legalContentV28/);
  assert.match(legalPage, /DOCUMENTOS VERSIONADOS/);
});

test('Legal 2.8 documenta Pocket pago e preserva contratos anteriores gratuitos', () => {
  assert.match(legalContent, /mensalidade fixa de R\$ 39,00/);
  assert.match(legalV26, /mensalidade fixa é R\$ 0/);
  assert.match(legalContent, /não criam recorrência de valor zero no provedor/);
  assert.match(legalContent, /cartão de crédito, Pix por QR Code e Pix Copia e Cola interoperável e Saldo Mercado Pago/);
  assert.match(legalContent, /conta Mercado Pago conectada pelo próprio estabelecimento/);
  assert.match(legalContent, /três passos essenciais indicados pelo KÔMA/);
  assert.match(legalV2, /O WhatsApp não é requisito/);
});

test('Legal 2.8 herda a política 18+ da Legal 2.5', () => {
  assert.match(legalV25, /cardápio e o checkout online não são canais destinados à oferta de bebidas alcoólicas/);
  assert.match(legalV25, /tag 18\+ ou classificação equivalente/);
  assert.match(legalV25, /gate de publicação e sincronização/);
  assert.doesNotMatch(legalV25, /autodeclaração.*suficiente/i);
});

test('contratação registra clickwrap com identidade, evidência e comprovante', () => {
  assert.match(planContract, /SUBSCRIPTION_PLANS\.find/);
  assert.match(planContract, /rawPlanId === 'pocket'/);
  assert.match(planContract, /rawPlanId === 'pro'/);
  assert.match(planContract, /rawPlanId === 'premium'/);
  assert.match(planContract, /getSubscriptionPricing/);
  assert.match(planContract, /contractingPartyName/);
  assert.match(planContract, /representativeTaxId/);
  assert.match(planContract, /representativeRole/);
  assert.match(planContract, /possuo poderes/);
  assert.match(planContract, /isValidCpf/);
  assert.match(planContract, /taxIdKind/);
  assert.match(planContract, /\/api\/contracts\/accept/);
  assert.match(planContract, /contractLegalBundle\(\)/);
  assert.match(planContract, /LEGAL_SOURCE_COMMIT/);
  assert.match(planContract, /LEGAL_SOURCE_BLOB_SHA/);
  assert.match(planContract, /Aceitar e registrar contratação/);
  assert.match(planContract, /Comprovante de Contratação e Licenciamento Eletrônico/);
  assert.match(planContract, /Imprimir \/ salvar em PDF/);
  assert.match(planContract, /sourceIp/);
  assert.match(planContract, /documents\.terms\.hash/);
  assert.match(planContract, /type="checkbox"/);
  assert.match(planContract, /disabled=\{!canContinue\}/);
  assert.doesNotMatch(planContract, /defaultChecked/i);
});

test('checkout reconhece cartão Pix universal e Saldo Mercado Pago', () => {
  assert.match(planContract, /type BillingMethod = 'credit_card' \| 'pix' \| 'account_money'/);
  assert.match(planContract, /QR Code \+ Pix Copia e Cola/);
  assert.match(planContract, /Saldo Mercado Pago/);
  assert.match(planContract, /\/billing\/pix\/select/);
  assert.match(planContract, /\/billing\/activate-free/);
  assert.match(planContract, /payment-methods-v2/);
});

test('proveniência jurídica fixa commit e blob da Legal 2.8 sem documento fiscal pessoal', () => {
  assert.match(legalEvidence, /legalContentV28/);
  assert.match(legalEvidence, /LEGAL_SOURCE_COMMIT = '[0-9a-f]{40}'/);
  assert.match(legalEvidence, /LEGAL_SOURCE_BLOB_SHA = '[0-9a-f]{40}'/);
  assert.match(legalEvidence, /requireDocument\('termos'\)/);
  assert.match(legalEvidence, /requireDocument\('planos'\)/);
  assert.match(legalEvidence, /requireDocument\('dpa'\)/);
  assert.match(legalEvidence, /requireDocument\('privacidade'\)/);
  assert.doesNotMatch(legalEvidence, /KOMA_LEGAL_PROVIDER_TAX_ID/);
});

test('segunda via reproduz o snapshot aceito sem confundir com a versão pública atual', () => {
  assert.match(contractDocumentsPanel, /acceptedDocuments/);
  assert.match(contractDocumentsPanel, /snapshot v\{receipt\.documents\.version\}/);
  assert.match(contractDocumentsPanel, /Conteúdo jurídico congelado no aceite/);
  assert.match(contractDocumentsPanel, /Ver versão pública atual/);
  assert.match(contractDocumentsPanel, /Integridade/);
  assert.doesNotMatch(contractDocumentsPanel, />\{label\}\s*<ExternalLink/);
});

test('landing não privilegia Pocket e envia cada plano para sua própria contratação', () => {
  assert.match(plans, /plan\.id === 'pocket' \? 'mensal' : billing/);
  assert.match(plans, /CONTRATAR \{planLabel\}/);
  assert.match(header, /href="\/#planos"/);
  assert.doesNotMatch(header, /href="\/landing#planos"/);
  assert.doesNotMatch(header, /\/contratar\/pocket/);
  assert.match(finalCta, /ESCOLHER MEU PLANO/);
  assert.match(finalCta, /href="\/#planos"/);
  assert.doesNotMatch(finalCta, /\/contratar\/pocket/);
  assert.match(finalCta, /href="\/legal"/);
  assert.match(finalCta, /href="\/legal\/privacidade"/);
});

test('condições comerciais 2.8 publicam Pocket pago sem apagar o snapshot 2.6', () => {
  assert.match(legalContent, /Pocket: R\$ 39,00 por mês \+ 1,79%/);
  assert.match(legalV27, /Pocket: R\$ 39,90 por mês \+ 1,79%/);
  assert.match(legalV26, /Pocket: R\$ 0 por mês \+ 1,79%/);
  assert.match(legalContent, /Pro: R\$ 129 por mês \+ 0,50%/);
  assert.match(legalContent, /Premium: R\$ 249 por mês \+ 0,20%/);
  assert.match(legalContent, /Pro R\$ 1\.393,20 por ano/);
  assert.match(legalContent, /R\$ 116,10 por mês/);
  assert.match(legalContent, /Premium R\$ 2\.689,20 por ano/);
  assert.match(legalContent, /R\$ 224,10 por mês/);
  assert.match(legalContent, /10% de desconto exclusivamente ao componente fixo/);
  assert.match(legalContent, /taxa percentual sobre pagamentos online não recebe desconto anual/);
  assert.match(legalContent, /não realiza upgrade automático de plano com base em volume de vendas ou GMV/);
  assert.match(legalContent, /snapshot comercial aceito/);

  assert.match(legalV25, /LEGAL_VERSION = '2\.5'/);
  assert.match(legalV25, /LEGAL_EFFECTIVE_DATE = '15\/09\/2026'/);
  assert.doesNotMatch(legalV25, /Pocket: R\$ 0 por mês \+ 1,79%/);
  assert.doesNotMatch(legalV25, /Pro: R\$ 129 por mês \+ 0,50%/);
  assert.doesNotMatch(legalV25, /Premium: R\$ 249 por mês \+ 0,20%/);
});

test('pacote jurídico cobre LGPD, transferências, incidentes e dados sensíveis', () => {
  assert.match(legalV2, /Railway/);
  assert.match(legalV2, /Supabase/);
  assert.match(legalV2, /Cloudflare/);
  assert.match(legalV2, /Resend/);
  assert.match(legalV2, /Google Fonts/);
  assert.match(legalV2, /Sentry, quando habilitado/);
  assert.match(legalV2, /Resolução CD\/ANPD nº 19\/2024/);
  assert.match(legalV2, /em até 24 horas da confirmação/);
  assert.match(legalV2, /até 5 dias úteis/);
  assert.match(legalV2, /alergia, intolerância ou outra condição de saúde/);
});
