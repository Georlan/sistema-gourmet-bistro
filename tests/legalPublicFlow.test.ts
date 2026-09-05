import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync('src/main.tsx', 'utf8');
const legalContent = readFileSync('src/legal/legalContent.ts', 'utf8');
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

test('central legal publica os seis documentos de lançamento', () => {
  for (const slug of [
    'termos',
    'planos',
    'privacidade',
    'dpa',
    'cardapio-termos',
    'cardapio-privacidade',
  ]) {
    assert.match(legalContent, new RegExp(`slug: '${slug}'`));
  }
  assert.match(legalContent, /LEGAL_VERSION = '1\.0'/);
  assert.match(legalPage, /DOCUMENTOS VERSIONADOS/);
});

test('contratação resolve os três planos pelo catálogo canônico e apresenta aceite explícito', () => {
  assert.match(planContract, /SUBSCRIPTION_PLANS\.find/);
  assert.match(planContract, /rawPlanId === 'pocket'/);
  assert.match(planContract, /rawPlanId === 'pro'/);
  assert.match(planContract, /rawPlanId === 'premium'/);
  assert.match(planContract, /getSubscriptionPricing/);
  assert.match(planContract, /cobranca.*anual/);
  assert.match(planContract, /Termos de Contratação/);
  assert.match(planContract, /Condições Comerciais/);
  assert.match(planContract, /Anexo de Tratamento de Dados/);
  assert.match(planContract, /Política de Privacidade/);
  assert.match(planContract, /type="checkbox"/);
  assert.match(planContract, /disabled=\{!canContinue\}/);
  assert.doesNotMatch(planContract, /defaultChecked/i, 'aceite não pode nascer pré-marcado');
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

test('conteúdo comercial preserva preços oficiais e separa taxa do provedor', () => {
  assert.match(legalContent, /Pocket: R\$ 109 por mês \+ 1,49%/);
  assert.match(legalContent, /Pro: R\$ 209 por mês \+ 0,69%/);
  assert.match(legalContent, /Premium: R\$ 309 por mês \+ 0,29%/);
  assert.match(legalContent, /desconto de 10% incide somente sobre a mensalidade fixa/);
  assert.match(legalContent, /taxa KÔMA é separada das tarifas eventualmente cobradas pelo provedor/);
});
