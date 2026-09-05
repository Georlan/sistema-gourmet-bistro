import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync('src/main.tsx', 'utf8');
const legalContent = readFileSync('src/legal/legalContent.ts', 'utf8');
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

test('central legal publica o pacote v1.1 de lançamento', () => {
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
  assert.match(legalContent, /LEGAL_VERSION = '1\.1'/);
  assert.match(legalContent, /Georlan Gomes e Silva Júnior/);
  assert.match(legalPage, /DOCUMENTOS VERSIONADOS/);
  assert.match(legalPage, /Fornecedores/);
  assert.doesNotMatch(legalPage, /Começar no Pocket/);
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

test('proveniência jurídica fixa commit e blob da Legal v1.1 sem dados pessoais do prestador', () => {
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
  assert.match(header, /href="\/landing#planos"/);
  assert.doesNotMatch(header, /\/contratar\/pocket/);
  assert.match(finalCta, /ESCOLHER MEU PLANO/);
  assert.doesNotMatch(finalCta, /\/contratar\/pocket/);
  assert.match(finalCta, /href="\/legal"/);
  assert.match(finalCta, /href="\/legal\/privacidade"/);
});

test('conteúdo comercial preserva preços oficiais, anual, trial e taxa do provedor separada', () => {
  assert.match(legalContent, /Pocket: R\$ 109 por mês \+ 1,49%/);
  assert.match(legalContent, /Pro: R\$ 209 por mês \+ 0,69%/);
  assert.match(legalContent, /Premium: R\$ 309 por mês \+ 0,29%/);
  assert.match(legalContent, /Pocket R\$ 1\.177,20/);
  assert.match(legalContent, /Pro R\$ 2\.257,20/);
  assert.match(legalContent, /Premium R\$ 3\.337,20/);
  assert.match(legalContent, /7 dias/);
  assert.match(legalContent, /isenta somente a mensalidade fixa/);
  assert.match(legalContent, /taxa KÔMA é separada das tarifas cobradas pelo provedor/);
  assert.match(legalContent, /5 dias corridos/);
  assert.match(legalContent, /IPCA/);
});

test('pacote v1.1 cobre LGPD, transferências, incidentes e restrição etária', () => {
  assert.match(legalContent, /Railway.*San Francisco/s);
  assert.match(legalContent, /Supabase.*Oregon/s);
  assert.match(legalContent, /24 horas após a confirmação/);
  assert.match(legalContent, /em até 5 dias úteis/);
  assert.match(legalContent, /Google Fonts/);
  assert.match(legalContent, /bebida alcoólica/);
  assert.match(legalContent, /não podem depender apenas de autodeclaração/);
});
