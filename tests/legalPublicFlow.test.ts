import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync('src/main.tsx', 'utf8');
const legalContent = readFileSync('src/legal/legalContent.ts', 'utf8');
const legalPage = readFileSync('src/legal/LegalPage.tsx', 'utf8');
const pocketContract = readFileSync('src/legal/PocketContractPage.tsx', 'utf8');
const header = readFileSync('src/landing/sections/Header.tsx', 'utf8');
const plans = readFileSync('src/landing/sections/Plans.tsx', 'utf8');
const finalCta = readFileSync('src/landing/sections/FinalCTA.tsx', 'utf8');

test('rotas legal e contratação são públicas e isoladas do app operacional', () => {
  assert.match(main, /pathname\.startsWith\("\/legal"\)/);
  assert.match(main, /pathname\.startsWith\("\/contratar"\)/);
  assert.match(main, /import\("\.\/legal\/LegalPage"\)/);
  assert.match(main, /import\("\.\/legal\/PocketContractPage"\)/);
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

test('Pocket usa catálogo canônico e apresenta aceite explícito', () => {
  assert.match(pocketContract, /SUBSCRIPTION_PLANS\.find\(\(plan\) => plan\.id === 'pocket'\)/);
  assert.match(pocketContract, /Termos de Contratação/);
  assert.match(pocketContract, /Condições Comerciais/);
  assert.match(pocketContract, /Anexo de Tratamento de Dados/);
  assert.match(pocketContract, /Política de Privacidade/);
  assert.match(pocketContract, /type="checkbox"/);
  assert.match(pocketContract, /disabled=\{!canContinue\}/);
  assert.doesNotMatch(pocketContract, /checkbox[^\n]*checked=/i, 'aceite não pode nascer pré-marcado');
});

test('landing oferece caminho direto ao Pocket sem tornar WhatsApp obrigatório', () => {
  assert.match(header, /href="\/contratar\/pocket"/);
  assert.match(plans, /href="\/contratar\/pocket"/);
  assert.match(finalCta, /href="\/contratar\/pocket"/);
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
