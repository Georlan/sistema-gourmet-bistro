import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  isValidDeepLinkId,
  listAllowedDeepLinkEntries,
} from '../src/components/caixa/navigation/cashierDeepLink';
import {
  buildInvestigationPrompt,
  buildTriageCliCommand,
  normalizeSafeSupportCode,
  normalizeSafeTenantId,
} from '../src/super-admin/investigationBrief';

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('listAllowedDeepLinkEntries exposes canonical support links without mutating actions', () => {
  const entries = listAllowedDeepLinkEntries();
  assert.ok(entries.length >= 15);
  const ids = new Set(entries.map(item => item.id));
  assert.ok(ids.has('online_entrega'));
  assert.ok(ids.has('online_pagamentos'));
  assert.ok(ids.has('config_impressao'));
  assert.ok(ids.has('caixa_turno_atual'));
  assert.ok(ids.has('config_implantacao'));
  assert.equal(ids.has('vendas_novo_pedido'), false);

  for (const entry of entries) {
    assert.equal(isValidDeepLinkId(entry.id), true);
    assert.equal(entry.path, `/?go=${entry.id}`);
    assert.equal(entry.fullUrl, `https://app.komafood.com.br/?go=${entry.id}`);
    assert.ok(entry.groupLabel.length > 0);
    assert.ok(entry.whatsappText.includes(entry.fullUrl));
  }
});

test('investigation brief builds sanitized CLI command and AI prompt with guardrails', () => {
  assert.equal(normalizeSafeSupportCode('abc123def456'), 'abc123def456');
  assert.equal(normalizeSafeSupportCode('bad code; rm -rf'), '');
  assert.equal(normalizeSafeTenantId('14'), '14');
  assert.equal(normalizeSafeTenantId('0'), '');

  const cmd = buildTriageCliCommand({
    tenantId: '14',
    supportCode: '8abbe94133fc',
    symptom: "cliente diz 'impressora offline'\nlinha 2",
  });
  assert.ok(cmd.startsWith('npm run ops:triage -- '));
  assert.ok(cmd.includes('--support-code 8abbe94133fc'));
  assert.ok(cmd.includes('--tenant 14'));
  assert.ok(cmd.endsWith('--json'));

  const prompt = buildInvestigationPrompt({
    tenantId: '14',
    tenantName: 'Bistro Teste',
    tenantPlan: 'pro',
    supportCode: '8abbe94133fc',
    symptom: 'Erro ao imprimir pedido',
    navigationId: 'config_impressao',
    incidents: [{ source: 'impressao', severity: 'high', title: 'Agente offline' }],
  });
  assert.match(prompt, /docs\/operations\/support\/ai-investigation-protocol\.md/);
  assert.match(prompt, /npm run ops:triage --/);
  assert.match(prompt, /npm run ops:doctor/);
  assert.match(prompt, /npm run ops:trace -- 8abbe94133fc/);
  assert.match(prompt, /docs\/operations\/incident-memory\/index\.json/);
  assert.match(prompt, /DADO NÃO CONFIÁVEL/);
  assert.match(prompt, /tenant ID 6 é protegido/);
});

test('Super Admin onboarding, QA, contract invite, and toolkit UI are wired cleanly', () => {
  const qaCard = source('src/super-admin/SuperAdminOnboardingQaCard.tsx');
  const inviteCard = source('src/super-admin/SuperAdminContractInviteCard.tsx');
  const toolkitModal = source('src/super-admin/SuperAdminSupportToolkitModal.tsx');
  const restaurant360 = source('src/super-admin/SuperAdminRestaurant360.tsx');
  const panel = source('src/super-admin/SuperAdminPanel.tsx');
  const acceptPage = source('src/legal/ContractInviteAcceptPage.tsx');

  // Items 1 & 2: QA start/copy/open, status, expiration, end
  assert.match(qaCard, /qaMenuPath/);
  assert.match(qaCard, /Copiar link QA/);
  assert.match(qaCard, /Abrir cardápio QA/);
  assert.match(qaCard, /Encerrar homologação/);
  assert.match(qaCard, /operationalQa\?\.expiresAt/);
  assert.match(qaCard, /action: "end"/);

  // Item 3: Contract invite with payment method + auto release
  assert.match(inviteCard, /payment_method_type/);
  assert.match(inviteCard, /auto_release_on_accept/);
  assert.match(inviteCard, /Copiar link/);
  assert.match(inviteCard, /Abrir aceite/);
  assert.match(restaurant360, /SuperAdminOnboardingQaCard/);
  assert.match(restaurant360, /SuperAdminContractInviteCard/);

  // Item 4: Contract invite acceptance page surfaces transition state
  assert.match(acceptPage, /accepted\.qaEnded/);
  assert.match(acceptPage, /accepted\.autoReleased/);
  assert.match(acceptPage, /accepted\.trialStarted/);
  assert.match(acceptPage, /accepted\.releasePendingReason === 'configuration_incomplete'/);

  // Items 5 & 6: Deep links catalog search + AI/CLI investigation launcher
  assert.match(toolkitModal, /listAllowedDeepLinkEntries/);
  assert.match(toolkitModal, /buildInvestigationPrompt/);
  assert.match(toolkitModal, /buildTriageCliCommand/);
  assert.match(toolkitModal, /\/api\/super-admin\/support\/.*\/feedbacks/);
  assert.match(panel, /SuperAdminSupportToolkitModal/);
  assert.match(panel, /Suporte & Links/);
  assert.match(restaurant360, /Links & Investigação/);
});
