import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync('src/main.tsx', 'utf8');
const legacyLegalContent = readFileSync('src/legal/legalContentLegacy.ts', 'utf8');
const legalContent = readFileSync('src/legal/legalContentRecurring.ts', 'utf8');
const legalEvidence = readFileSync('src/legal/legalEvidence.ts', 'utf8');
const legalPage = readFileSync('src/legal/LegalPage.tsx', 'utf8');
const planContract = readFileSync('src/legal/PlanContractPage.tsx', 'utf8');
const header = readFileSync('src/landing/sections/Header.tsx', 'utf8');
const plans = readFileSync('src/landing/sections/Plans.tsx', 'utf8');
const finalCta = readFileSync('src/landing/sections/FinalCTA.tsx', 'utf8');

test('rotas legal e contratação são públicas e isoladas do app operacional', () => {
  assert.match(main, /pathname\.startsWith\("\/legal"\)/);
  assert.match(main, /pathname\.startsWith\("\/contratar"\)/);
  assert.match(main, /import\("\.\/legal\/LegalPage"\)/);
  assert.match(main, /import\("\.\/legal\/PlanContractPage"\)/);
  assert.match(main, /isPublicCommercialRoute\(\)/);
});

test('central legal publica pacote canônico Legal 2.0 sem herdar a v1.2', () => {
  for (const slug of [
    'termos',
    'planos',
    'privacidade',
    'dpa',
    'suboperadores',
    'cookies',
    'cardapio-termos',
    'cardapio-privacidade',
  ]) {
    assert.match(legalContent, new RegExp(`slug: '${slug}'`));
  }

  assert.match(legalContent, /LEGAL_VERSION = '2\.0'/);
  assert.match(legalContent, /13\/09\/2026/);
  assert.doesNotMatch(legalContent, /LEGACY_LEGAL_DOCUMENTS/);
  assert.doesNotMatch(legalContent, /from '\.\/legalContentLegacy'/);
  assert.match(legacyLegalContent, /LEGAL_VERSION = '1\.2'/, 'snapshot histórico deve continuar preservado');
  assert.match(legalPage, /legalContentRecurring/);
  assert.match(legalPage, /DOCUMENTOS VERSIONADOS/);
  assert.match(legalPage, /Fornecedores/);
});

test('Legal 2.0 descreve cobrança recorrente, PDV não fiscal e limites do SmartPOS', () => {
  assert.match(legalContent, /Pix Automático/);
  assert.match(legalContent, /Pix avulso antecipado não integra o checkout/);
  assert.match(legalContent, /7 dias de teste sem cobrança do componente fixo/);
  assert.match(legalContent, /documentos não fiscais/);
  assert.match(legalContent, /não substituem NFC-e, NF-e, NFS-e, CF-e/);
  assert.match(legalContent, /simulador, bridge de desenvolvimento ou código experimental não significa homologação/);
  assert.match(legalContent, /O WhatsApp não é requisito/);
});

test('contratação registra clickwrap com identidade, evidência e comprovante', () => {
  assert.match(planContract, /SUBSCRIPTION_PLANS\.find/);
  assert.match(planContract, /rawPlanId === 'pocket'/);
  assert.match(planContract, /rawPlanId === 'pro'/);
  assert.match(planContract, /rawPlanId === 'premium'/);
  assert.match(planContract, /getSubscriptionPricing/);
  assert.match(planContract, /cobranca.*anual/);
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
  assert.doesNotMatch(planContract, /defaultChecked/i, 'aceite não pode nascer pré-marcado');
});

test('proveniência jurídica fixa commit e blob da Legal 2.0 sem documento fiscal pessoal', () => {
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

test('condições comerciais preservam catálogo oficial e política recorrente atual', () => {
  assert.match(legalContent, /Pocket: R\$ 109 por mês \+ 1,49%/);
  assert.match(legalContent, /Pro: R\$ 209 por mês \+ 0,69%/);
  assert.match(legalContent, /Premium: R\$ 309 por mês \+ 0,29%/);
  assert.match(legalContent, /Pocket R\$ 1\.177,20/);
  assert.match(legalContent, /Pro R\$ 2\.257,20/);
  assert.match(legalContent, /Premium R\$ 3\.337,20/);
  assert.match(legalContent, /desconto de 10%/);
  assert.match(legalContent, /cartão de crédito e Pix Automático/);
  assert.doesNotMatch(legalContent, /12 meses \+ 7 dias de bônus/);
});

test('pacote jurídico cobre LGPD, transferências, incidentes, sensíveis e restrição etária', () => {
  assert.match(legalContent, /Railway/);
  assert.match(legalContent, /Supabase/);
  assert.match(legalContent, /Cloudflare/);
  assert.match(legalContent, /Resend/);
  assert.match(legalContent, /Google Fonts/);
  assert.match(legalContent, /Sentry, quando habilitado/);
  assert.match(legalContent, /Resolução CD\/ANPD nº 19\/2024/);
  assert.match(legalContent, /em até 24 horas da confirmação/);
  assert.match(legalContent, /até 5 dias úteis/);
  assert.match(legalContent, /alergia, intolerância ou outra condição de saúde/);
  assert.match(legalContent, /verificação de idade além de simples autodeclaração/);
});
