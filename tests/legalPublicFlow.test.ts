import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync('src/main.tsx', 'utf8');
const legacyLegalContent = readFileSync('src/legal/legalContentLegacy.ts', 'utf8');
const legalV2 = readFileSync('src/legal/legalContentV2.ts', 'utf8');
const legalContent = readFileSync('src/legal/legalContentRecurring.ts', 'utf8');
const legalEvidence = readFileSync('src/legal/legalEvidence.ts', 'utf8');
const legalPage = readFileSync('src/legal/LegalPage.tsx', 'utf8');
const planContract = readFileSync('src/legal/PlanContractPageV2.tsx', 'utf8');
const header = readFileSync('src/landing/sections/Header.tsx', 'utf8');
const plans = readFileSync('src/landing/sections/Plans.tsx', 'utf8');
const finalCta = readFileSync('src/landing/sections/FinalCTA.tsx', 'utf8');

test('rotas legal e contratação são públicas e isoladas do app operacional', () => {
  assert.match(main, /pathname\.startsWith\("\/legal"\)/);
  assert.match(main, /pathname\.startsWith\("\/contratar"\)/);
  assert.match(main, /import\("\.\/legal\/LegalPage"\)/);
  assert.match(main, /import\("\.\/legal\/PlanContractPageV2"\)/);
  assert.match(main, /isPublicCommercialRoute\(\)/);
});

test('central legal preserva snapshot 2.0 e publica fachada vigente 2.5', () => {
  for (const slug of ['termos','planos','privacidade','dpa','suboperadores','cookies','cardapio-termos','cardapio-privacidade']) {
    assert.match(legalV2, new RegExp(`slug: '${slug}'`));
  }
  assert.match(legalV2, /LEGAL_VERSION = '2\.0'/);
  assert.match(legalContent, /LEGAL_VERSION = '2\.5'/);
  assert.match(legalContent, /15\/09\/2026/);
  assert.match(legalContent, /from '\.\/legalContentV2'/);
  assert.doesNotMatch(legalContent, /legalContentLegacy/);
  assert.match(legacyLegalContent, /LEGAL_VERSION = '1\.2'/);
  assert.match(legalPage, /legalContentRecurring/);
  assert.match(legalPage, /DOCUMENTOS VERSIONADOS/);
});

test('Legal 2.5 documenta cartão Pix universal e Saldo Mercado Pago', () => {
  assert.match(legalContent, /cartão de crédito, Pix por QR Code e Pix Copia e Cola interoperável e Saldo Mercado Pago/);
  assert.match(legalContent, /esse meio não representa débito automático nem autorização recorrente/);
  assert.match(legalContent, /QR Code da mensalidade é gerado quando houver valor efetivamente devido depois do trial/);
  assert.match(legalContent, /pagável em qualquer banco ou PSP compatível com Pix/);
  assert.match(legalContent, /três passos essenciais indicados pelo KÔMA/);
  assert.match(legalV2, /O WhatsApp não é requisito/);
});

test('Legal 2.5 trata 18+ como gate de publicação e não como checkout com autodeclaração', () => {
  assert.match(legalContent, /cardápio e o checkout online não são canais destinados à oferta de bebidas alcoólicas/);
  assert.match(legalContent, /tag 18\+ ou classificação equivalente/);
  assert.match(legalContent, /gate de publicação e sincronização/);
  assert.doesNotMatch(legalContent, /autodeclaração.*suficiente/i);
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
  assert.match(planContract, /payment-methods-v2/);
});

test('proveniência jurídica fixa commit e blob da Legal 2.5 sem documento fiscal pessoal', () => {
  assert.match(legalEvidence, /legalContentRecurring/);
  assert.match(legalEvidence, /LEGAL_SOURCE_COMMIT = '[0-9a-f]{40}'/);
  assert.match(legalEvidence, /LEGAL_SOURCE_BLOB_SHA = '[0-9a-f]{40}'/);
  assert.match(legalEvidence, /requireDocument\('termos'\)/);
  assert.match(legalEvidence, /requireDocument\('planos'\)/);
  assert.match(legalEvidence, /requireDocument\('dpa'\)/);
  assert.match(legalEvidence, /requireDocument\('privacidade'\)/);
  assert.doesNotMatch(legalEvidence, /KOMA_LEGAL_PROVIDER_TAX_ID/);
});

test('landing não privilegia Pocket e envia cada plano para sua própria contratação', () => {
  assert.match(plans, /href=\{`\/contratar\/\$\{plan\.id\}\?cobranca=\$\{billing\}`\}/);
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

test('condições comerciais preservam catálogo oficial, anual e política vigente', () => {
  assert.match(legalV2, /Pocket: R\$ 109 por mês \+ 1,49%/);
  assert.match(legalV2, /Pro: R\$ 209 por mês \+ 0,69%/);
  assert.match(legalV2, /Premium: R\$ 309 por mês \+ 0,29%/);
  assert.match(legalV2, /Pocket R\$ 1\.177,20/);
  assert.match(legalV2, /Pro R\$ 2\.257,20/);
  assert.match(legalV2, /Premium R\$ 3\.337,20/);
  assert.match(legalV2, /desconto de 10%/);
  assert.doesNotMatch(legalV2, /12 meses \+ 7 dias de bônus/);
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
