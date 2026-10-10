import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync('src/main.tsx', 'utf8');
const legacyLegalContent = readFileSync('src/legal/legalContentLegacy.ts', 'utf8');
const legalV2 = readFileSync('src/legal/legalContentV2.ts', 'utf8');
const legalV25 = readFileSync('src/legal/legalContentRecurring.ts', 'utf8');
const legalV26 = readFileSync('src/legal/legalContentV26.ts', 'utf8');
const legalV27 = readFileSync('src/legal/legalContentV27.ts', 'utf8');
const legalV28 = readFileSync('src/legal/legalContentV28.ts', 'utf8');
const legalV29 = readFileSync('src/legal/legalContentV29.ts', 'utf8');
const legalV30 = readFileSync('src/legal/legalContentV30.ts', 'utf8');
const legalV31 = readFileSync('src/legal/legalContentV31.ts', 'utf8');
const legalContent = readFileSync('src/legal/legalContentV32.ts', 'utf8');
const legalV34 = readFileSync('src/legal/legalContentV34.ts', 'utf8');
const legalV35 = readFileSync('src/legal/legalContentV35.ts', 'utf8');
const legalV33 = readFileSync('src/legal/legalContentV33.ts', 'utf8');
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

test('central legal preserva snapshots anteriores e publica fachada vigente 3.5', () => {
  for (const slug of ['termos','planos','privacidade','dpa','suboperadores','cookies','cardapio-termos','cardapio-privacidade']) {
    assert.match(legalV2, new RegExp(`slug: '${slug}'`));
  }
  assert.match(legalV2, /LEGAL_VERSION = '2\.0'/);
  assert.match(legalV25, /LEGAL_VERSION = '2\.5'/);
  assert.match(legalV25, /15\/09\/2026/);
  assert.match(legalV26, /LEGAL_VERSION = '2\.6'/);
  assert.match(legalV27, /LEGAL_VERSION = '2\.7'/);
  assert.match(legalV28, /LEGAL_VERSION = '2\.8'/);
  assert.match(legalV29, /LEGAL_VERSION = '2\.9'/);
  assert.match(legalV30, /LEGAL_VERSION = '3\.0'/);
  assert.match(legalV31, /LEGAL_VERSION = '3\.1'/);
  assert.match(legalContent, /LEGAL_VERSION = '3\.2'/);
  assert.match(legalV33, /LEGAL_VERSION = '3\.3'/);
  assert.match(legalV34, /LEGAL_VERSION = '3\.4'/);
  assert.match(legalV35, /LEGAL_VERSION = '3\.5'/);
  assert.match(legalV26, /18\/09\/2026/);
  assert.match(legalV29, /23\/09\/2026/);
  assert.match(legalContent, /24\/09\/2026/);
  assert.match(legalV33, /27\/09\/2026/);
  assert.match(legalV30, /from '\.\/legalContentRecurring'/);
  assert.match(legalV31, /from '\.\/legalContentV30'/);
  assert.match(legalContent, /from '\.\/legalContentV31'/);
  assert.match(legalV33, /from '\.\/legalContentV32'/);
  assert.match(legalV34, /from '\.\/legalContentV33'/);
  assert.match(legalV35, /from '\.\/legalContentV34'/);
  assert.match(legacyLegalContent, /LEGAL_VERSION = '1\.2'/);
  assert.match(legalPage, /from '\.\/legalContent'/);
  assert.match(legalPage, /DOCUMENTOS VERSIONADOS/);
});

test('Legal 3.2 preserva preço vigente e contratos anteriores gratuitos', () => {
  assert.match(legalV30, /mensalidade fixa de R\$ 39,00/);
  assert.match(legalV26, /mensalidade fixa é R\$ 0/);
  assert.match(legalV30, /não criam recorrência de valor zero no provedor/);
  assert.match(legalV30, /cartão de crédito, Pix por QR Code e Pix Copia e Cola interoperável e Saldo Mercado Pago/);
  assert.match(legalV30, /conta Mercado Pago conectada pelo próprio estabelecimento/);
  assert.match(legalV30, /quatro itens/);
  assert.match(legalContent, /from '\.\/legalContentV31'/);
  assert.match(legalV2, /O WhatsApp não é requisito/);
});

test('Legal 3.2 herda a política 18+ da Legal 2.5', () => {
  assert.match(legalV25, /cardápio e o checkout online não são canais destinados à oferta de bebidas alcoólicas/);
  assert.match(legalV25, /tag 18\+ ou classificação equivalente/);
  assert.match(legalV25, /gate de publicação e sincronização/);
  assert.doesNotMatch(legalV25, /autodeclaração.*suficiente/i);
});


test('Legal 3.2 inclui App do Garçom e gestão de equipe no Pocket sem liberar impressão', () => {
  assert.match(legalContent, /App do Garçom para atendimento de mesas e lançamento em comandas/);
  assert.match(legalContent, /Gestão de equipe com cadastro de pessoas, funções e permissões por cargo/);
  assert.match(legalContent, /Fila de preparo na tela, sem KDS dedicado e sem impressão automática/);
  assert.match(legalContent, /Inclui todos os recursos do Pocket, inclusive App do Garçom e gestão de equipe/);
  assert.doesNotMatch(legalContent, /gestão avançada de equipe/);
  assert.match(legalV31, /gestão avançada de equipe/);
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

test('proveniência jurídica fixa commit e blob da Legal 3.5 sem documento fiscal pessoal', () => {
  assert.match(legalEvidence, /legalContentV35/);
  assert.match(legalEvidence, /LEGAL_SOURCE_COMMIT = '[0-9a-f]{40}'/);
  assert.match(legalEvidence, /LEGAL_SOURCE_BLOB_SHA = '[0-9a-f]{40}'/);
  assert.match(legalEvidence, /requireDocument\('termos'\)/);
  assert.match(legalEvidence, /requireDocument\('planos'\)/);
  assert.match(legalEvidence, /requireDocument\('dpa'\)/);
  assert.match(legalEvidence, /requireDocument\('privacidade'\)/);
  assert.doesNotMatch(legalEvidence, /KOMA_LEGAL_PROVIDER_TAX_ID/);
});

test('Legal 3.3 vincula o início dos sete dias à liberação pelo SuperAdmin', () => {
  assert.match(legalV33, /equipe KÔMA confere a implantação e libera a operação por meio do SuperAdmin/);
  assert.match(legalV33, /liberação explícita pelo SuperAdmin KÔMA/);
});

test('segunda via reproduz o snapshot aceito sem confundir com a versão pública atual', () => {
  assert.match(contractDocumentsPanel, /acceptedDocuments/);
  assert.match(contractDocumentsPanel, /snapshot v\{receipt\.documents\.version\}/);
  assert.match(contractDocumentsPanel, /Conteúdo jurídico congelado no aceite/);
  assert.match(contractDocumentsPanel, /Ver versão pública atual/);
  assert.match(contractDocumentsPanel, /Integridade/);
  assert.doesNotMatch(contractDocumentsPanel, />\{label\}\s*<ExternalLink/);
});

test('landing envia cada plano e ciclo para sua própria contratação', () => {
  assert.match(plans, /cobranca=\$\{billing\}/);
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

test('condições comerciais 3.2 preservam Pocket anual sem apagar snapshots anteriores', () => {
  assert.match(legalV30, /Pocket: R\$ 39,00 por mês \+ 1,79%/);
  assert.match(legalV30, /Pocket R\$ 421,20 por ano/);
  assert.match(legalV30, /R\$ 35,10 por mês/);
  assert.match(legalV28, /apenas no ciclo mensal, sem opção anual/);
  assert.match(legalV27, /Pocket: R\$ 39,90 por mês \+ 1,79%/);
  assert.match(legalV26, /Pocket: R\$ 0 por mês \+ 1,79%/);
  assert.match(legalV30, /Pro: R\$ 129 por mês \+ 0,50%/);
  assert.match(legalV30, /Premium: R\$ 249 por mês \+ 0,20%/);
  assert.match(legalV30, /Pro R\$ 1\.393,20 por ano/);
  assert.match(legalV30, /R\$ 116,10 por mês/);
  assert.match(legalV30, /Premium R\$ 2\.689,20 por ano/);
  assert.match(legalV30, /R\$ 224,10 por mês/);
  assert.match(legalV30, /10% de desconto exclusivamente ao componente fixo/);
  assert.match(legalV30, /taxa percentual sobre pagamentos online não recebe desconto anual/);
  assert.match(legalV30, /não realiza upgrade automático de plano com base em volume de vendas ou GMV/);
  assert.match(legalV30, /snapshot comercial aceito/);

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

// Preserva as asserções históricas acima e verifica os documentos renderizados atuais.
test('Legal 3.4 preserva snapshot histórico com preços oficiais e comissão zero', async () => {
  const { LEGAL_DOCUMENTS, LEGAL_VERSION } = await import('../src/legal/legalContentV34');
  assert.equal(LEGAL_VERSION, '3.4');
  assert.match(legalV34, /from '\.\/legalContentV33'/);
  const serialized = JSON.stringify(LEGAL_DOCUMENTS);
  for (const amount of ['79,90', '179,90', '329,90', '862,92', '1.942,92', '3.562,92', '71,91', '161,91', '296,91']) {
    assert.ok(serialized.includes(`R$ ${amount}`), `Preço ausente: ${amount}`);
  }
  assert.match(serialized, /0% de comissão KÔMA/);
  assert.doesNotMatch(serialized, /R\$ (?:39,00|129 por mês|249 por mês|421,20|1\.393,20|2\.689,20)/);
  assert.ok(LEGAL_DOCUMENTS.every(document => document.version === '3.4'));
});

test('Legal 3.5 publica modernização jurídica com CRM, PagBank e Pix Direto', async () => {
  const { LEGAL_DOCUMENTS, LEGAL_VERSION } = await import('../src/legal/legalContentV35');
  assert.equal(LEGAL_VERSION, '3.5');
  assert.match(legalV35, /from '\.\/legalContentV34'/);
  assert.match(readFileSync('src/legal/legalContent.ts', 'utf8'), /export \* from '\.\/legalContentV35'/);
  const serialized = JSON.stringify(LEGAL_DOCUMENTS);
  for (const amount of ['79,90', '179,90', '329,90', '862,92', '1.942,92', '3.562,92']) {
    assert.ok(serialized.includes(`R$ ${amount}`), `Preço ausente: ${amount}`);
  }
  assert.match(serialized, /0% de comissão KÔMA/);
  assert.match(serialized, /PagBank/);
  assert.match(serialized, /Pix Direto/);
  assert.match(serialized, /Web Push/);
  assert.match(serialized, /CRM/);
  assert.ok(LEGAL_DOCUMENTS.every(document => document.version === '3.5'));
});

test('Legal 3.5 compõe exatamente 8 documentos com seções sequenciais e sem duplicidade', async () => {
  const { LEGAL_DOCUMENTS } = await import('../src/legal/legalContentV35');
  assert.equal(LEGAL_DOCUMENTS.length, 8);
  const expectedSlugs = [
    'termos', 'planos', 'privacidade', 'dpa',
    'suboperadores', 'cookies', 'cardapio-termos', 'cardapio-privacidade'
  ];
  for (const slug of expectedSlugs) {
    const doc = LEGAL_DOCUMENTS.find(d => d.slug === slug);
    assert.ok(doc, `Documento ${slug} não encontrado`);
    const sectionNumbers = doc.sections.map(s => {
      const match = s.title.match(/^(\d+)\./);
      assert.ok(match, `Seção "${s.title}" no documento ${slug} não começa com número`);
      return parseInt(match[1], 10);
    });
    // Verifica que não há duplicação de números
    const uniqueNumbers = new Set(sectionNumbers);
    assert.equal(uniqueNumbers.size, sectionNumbers.length, `Duplicidade de numeração encontrada em ${slug}: ${sectionNumbers}`);
    // Verifica que a sequência começa em 1 e é contígua
    for (let i = 0; i < sectionNumbers.length; i++) {
      assert.equal(sectionNumbers[i], i + 1, `Sequência quebrada em ${slug}: esperado ${i + 1}, recebido ${sectionNumbers[i]}`);
    }
  }
});

test('Legal 3.5 suboperadores possui exatamente 13 seções na ordem estrita com PagBank e Pix Direto', async () => {
  const { LEGAL_DOCUMENTS } = await import('../src/legal/legalContentV35');
  const subops = LEGAL_DOCUMENTS.find(d => d.slug === 'suboperadores');
  assert.ok(subops);
  assert.equal(subops.sections.length, 13);
  const titles = subops.sections.map(s => s.title);
  assert.match(titles[0], /^1\. Como interpretar esta lista/);
  assert.match(titles[1], /^2\. Railway/);
  assert.match(titles[2], /^3\. Supabase/);
  assert.match(titles[3], /^4\. Cloudflare/);
  assert.match(titles[4], /^5\. Mercado Pago/);
  assert.match(titles[5], /^6\. PagBank/);
  assert.match(titles[6], /^7\. Instituições Bancárias e Pix Direto/);
  assert.match(titles[7], /^8\. Resend/);
  assert.match(titles[8], /^9\. WhatsApp/);
  assert.match(titles[9], /^10\. Google Fonts/);
  assert.match(titles[10], /^11\. Sentry/);
  assert.match(titles[11], /^12\. Transferência internacional/);
  assert.match(titles[12], /^13\. Atualizações/);
});

test('Legal 3.5 cardápio substitui seções 4 preservando itens operacionais essenciais', async () => {
  const { LEGAL_DOCUMENTS } = await import('../src/legal/legalContentV35');
  const cardapioTermos = LEGAL_DOCUMENTS.find(d => d.slug === 'cardapio-termos');
  assert.ok(cardapioTermos);
  const sec4Termos = cardapioTermos.sections.find(s => s.title.startsWith('4.'));
  assert.ok(sec4Termos);
  assert.equal(sec4Termos.title, '4. Pagamentos online e Pix');
  const sec4TermosText = JSON.stringify(sec4Termos);
  assert.match(sec4TermosText, /Mercado Pago|PagBank/);
  assert.match(sec4TermosText, /Pix Direto/);
  assert.match(sec4TermosText, /devolução de valores|estorno/i);

  const cardapioPriv = LEGAL_DOCUMENTS.find(d => d.slug === 'cardapio-privacidade');
  assert.ok(cardapioPriv);
  const sec4Priv = cardapioPriv.sections.find(s => s.title.startsWith('4.'));
  assert.ok(sec4Priv);
  assert.equal(sec4Priv.title, '4. Finalidades e CRM do Restaurante');
  const sec4PrivText = JSON.stringify(sec4Priv);
  assert.match(sec4PrivText, /Registrar, confirmar, preparar, cobrar, entregar e acompanhar o pedido/);
  assert.match(sec4PrivText, /Prevenir duplicidade de pedidos, fraude e abuso na plataforma/);
  assert.match(sec4PrivText, /Prestar atendimento ao cliente e resolver cancelamentos, contestações ou reembolsos/);
  assert.match(sec4PrivText, /Cumprir obrigação legal, fiscal ou regulatória/);
  assert.match(sec4PrivText, /Gerar histórico e indicadores de relacionamento para o restaurante controlador/);
});

test('Legal 3.5 preserva garantias do WhatsApp, estorno de Pix e notificação DPA em até 24h', async () => {
  const { LEGAL_DOCUMENTS } = await import('../src/legal/legalContentV35');
  const termos = LEGAL_DOCUMENTS.find(d => d.slug === 'termos');
  assert.ok(termos);
  const sec6Termos = termos.sections.find(s => s.title.startsWith('6.'));
  assert.ok(sec6Termos);
  const sec6TermosText = JSON.stringify(sec6Termos);
  assert.match(sec6TermosText, /O WhatsApp não é requisito para o consumidor realizar uma compra quando o checkout próprio do cardápio estiver disponível/);
  assert.match(sec6TermosText, /idempotência/i);
  assert.match(sec6TermosText, /confirmação e aceite prévio do restaurante antes do início do preparo/);

  const sec8Termos = termos.sections.find(s => s.title.startsWith('8.'));
  assert.ok(sec8Termos);
  const sec8TermosText = JSON.stringify(sec8Termos);
  assert.match(sec8TermosText, /compete ao estabelecimento recebedor realizar os procedimentos de devolução de valores ao consumidor por meio da instituição financeira responsável/);
  assert.match(sec8TermosText, /O KÔMA não realiza a liquidação nem a devolução financeira de valores que não tenha recebido/);

  const dpa = LEGAL_DOCUMENTS.find(d => d.slug === 'dpa');
  assert.ok(dpa);
  const sec10Dpa = dpa.sections.find(s => s.title.startsWith('10.'));
  assert.ok(sec10Dpa);
  const sec10DpaText = JSON.stringify(sec10Dpa);
  assert.match(sec10DpaText, /até 24 \(vinte e quatro\) horas a partir da ciência qualificada/);
  assert.match(sec10DpaText, /complementação progressiva/);
  assert.match(sec10DpaText, /Resolução CD\/ANPD nº 15\/2024/);

  const planos = LEGAL_DOCUMENTS.find(d => d.slug === 'planos');
  assert.ok(planos);
  const planosStr = JSON.stringify(planos);
  assert.doesNotMatch(planosStr, /enquanto vigente a política de comissão zero/);
  assert.doesNotMatch(planosStr, /caso a política de comissão zero seja alterada/);
});
