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

test('central legal publica o pacote recorrente v1.3', () => {
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
    assert.match(legacyLegalContent, new RegExp(`slug: '${slug}'`));
  }
  assert.match(legalContent, /LEGAL_VERSION = '1\.3'/);
  assert.match(legalContent, /13\/09\/2026/);
  assert.match(legalContent, /Pix Automático/);
  assert.match(legalContent, /Não existe pagamento antecipado da mensalidade fixa/);
  assert.match(legalPage, /legalContentRecurring/);
  assert.match(legalPage, /DOCUMENTOS VERSIONADOS/);
  assert.match(legalPage, /Fornecedores/);
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

test('proveniência jurídica fixa commit e blob da Legal v1.3 sem dados pessoais sensíveis', () => {
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

test('conteúdo comercial preserva preços oficiais e muda somente a mecânica de cobrança/trial', () => {
  assert.match(legacyLegalContent, /Pocket: R\$ 109 por mês \+ 1,49%/);
  assert.match(legacyLegalContent, /Pro: R\$ 209 por mês \+ 0,69%/);
  assert.match(legacyLegalContent, /Premium: R\$ 309 por mês \+ 0,29%/);
  assert.match(legacyLegalContent, /Pocket R\$ 1\.177,20/);
  assert.match(legacyLegalContent, /Pro R\$ 2\.257,20/);
  assert.match(legacyLegalContent, /Premium R\$ 3\.337,20/);
  assert.match(legalContent, /7 dias grátis/);
  assert.match(legalContent, /total anual somente é cobrado automaticamente após os 7 dias grátis/);
  assert.match(legalContent, /O KÔMA não oferece Pix avulso antecipado/);
  assert.doesNotMatch(legalContent, /12 meses \+ 7 dias de bônus/);
});

test('base jurídica preserva LGPD, transferências, incidentes e restrição etária', () => {
  assert.match(legacyLegalContent, /Railway.*San Francisco/s);
  assert.match(legacyLegalContent, /Supabase.*Oregon/s);
  assert.match(legacyLegalContent, /24 horas após a confirmação/);
  assert.match(legacyLegalContent, /em até 5 dias úteis/);
  assert.match(legacyLegalContent, /Google Fonts/);
  assert.match(legacyLegalContent, /bebida alcoólica/);
  assert.match(legacyLegalContent, /não podem depender apenas de autodeclaração/);
});
