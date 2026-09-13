import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('landing hero does not advertise plan-specific features as universal', () => {
  const hero = source('src/landing/sections/Hero.tsx');

  assert.doesNotMatch(hero, /COMANDA SAI AUTOMATICAMENTE/);
  assert.doesNotMatch(hero, /CONTROLE TUDO\./);
  assert.match(hero, /KDS e impressão automática no Pro e Premium/);
  assert.match(hero, /CARDÁPIO DIGITAL DESDE O POCKET/);
});

test('landing management qualifies advanced features by plan', () => {
  const management = source('src/landing/sections/Management.tsx');

  assert.match(management, /KDS e impressão automática no Pro e Premium/);
  assert.match(management, /Estoque, relatórios e financeiro no Pro e Premium/);
  assert.match(management, /Fidelidade e cupons no Premium/);
});

test('landing comparison is framed as an example instead of a universal claim', () => {
  const comparison = source('src/landing/sections/ValueStrip.tsx');

  assert.match(comparison, /OPERAÇÃO FRAGMENTADA/);
  assert.match(comparison, /EXEMPLO: 4 REPASSES/);
  assert.doesNotMatch(comparison, /<strong>SEM KÔMA<\/strong>/);
});

test('landing SEO uses the public root and qualifies advanced features', () => {
  const landing = source('src/landing/LandingPage.tsx');

  assert.match(landing, /canonical\.href = 'https:\/\/komafood\.com\.br\/'/);
  assert.doesNotMatch(landing, /https:\/\/komafood\.com\.br\/landing/);
  assert.match(landing, /recursos avançados disponíveis conforme o plano/i);
  assert.match(landing, /KDS e impressão automática nos planos compatíveis/);
});

test('final conversion copy supports manual or automatic release', () => {
  const finalCta = source('src/landing/sections/FinalCTA.tsx');

  assert.match(finalCta, /Após a confirmação, liberamos o acesso e enviamos o convite/);
  assert.doesNotMatch(finalCta, /Conclua a ativação do restaurante/);
});

test('post-contract flow uses the public tenant domain and does not promise automatic Pix release', () => {
  const contract = source('src/legal/PlanContractPage.tsx');

  assert.doesNotMatch(contract, /activationResult\.slug\}\.koma\.com\.br/);
  assert.match(contract, /activationResult\.slug\}\.komafood\.com\.br/);
  assert.doesNotMatch(contract, /ativação acontece automaticamente/i);
  assert.match(contract, /contratação segue para liberação/i);
});

test('hero benefit line does not use oversized font that overlaps the tablet mockup', () => {
  const css = source('src/landing/landing.css');

  assert.doesNotMatch(css, /\.koma-hero-line--benefit\s*\{\s*font-size:\s*clamp\([^)]*6\.25vw/);
  assert.match(css, /\.koma-hero-line--benefit\s*\{[^}]*white-space:\s*nowrap/);
});

test('hero strip items point to valid product tour anchors and do not strand navigation', () => {
  const hero = source('src/landing/sections/Hero.tsx');

  assert.match(hero, /name:\s*'COZINHA RECEBE NA HORA'[\s\S]*?href:\s*'#salao'/);
  assert.match(hero, /name:\s*'CLIENTE PEDE PELO CELULAR'[\s\S]*?href:\s*'#cardapio'/);
  assert.match(hero, /name:\s*'PEDIDO SEGUE PARA O PREPARO'[\s\S]*?href:\s*'#salao'/);
});

test('how it works tour scrolls cleanly without forcing block start against fixed header', () => {
  const howItWorks = source('src/landing/sections/HowItWorks.tsx');

  assert.doesNotMatch(howItWorks, /scrollIntoView\(\{\s*block:\s*'start'\s*\}\)/);
  assert.match(howItWorks, /scrollIntoView\(\)/);
});

test('legal page links never revive /landing or /landing#planos', () => {
  const legalPage = source('src/legal/LegalPage.tsx');

  assert.doesNotMatch(legalPage, /href="\/landing"/);
  assert.doesNotMatch(legalPage, /href="\/landing#planos"/);
  assert.match(legalPage, /href="\/"/);
  assert.match(legalPage, /href="\/#planos"/);
});

test('inactive landing sections are safe if reintroduced later', () => {
  const ecosystem = source('src/landing/sections/Ecosystem.tsx');
  const capabilities = source('src/landing/sections/Capabilities.tsx');

  assert.doesNotMatch(ecosystem, /TUDO O QUE O RESTAURANTE PRECISA/);
  assert.doesNotMatch(ecosystem, /ACEITE PEDIDOS DE TODO LUGAR/);
  assert.match(ecosystem, /KDS e impressão automática ficam disponíveis no Pro e Premium/);
  assert.match(capabilities, /ESTOQUE E FINANCEIRO — PRO E PREMIUM/);
  assert.match(capabilities, /APP DO ENTREGADOR — PREMIUM/);
});

