import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panel = readFileSync(
  new URL('../src/super-admin/SuperAdminPanel.tsx', import.meta.url),
  'utf8',
);
const trialsTab = readFileSync(
  new URL('../src/super-admin/SuperAdminTrialsTab.tsx', import.meta.url),
  'utf8',
);
const trialModal = readFileSync(
  new URL('../src/super-admin/SuperAdminTrialModal.tsx', import.meta.url),
  'utf8',
);

test('Super Admin expõe a central de períodos grátis na navegação principal', () => {
  assert.match(panel, /SuperAdminTrialsTab/);
  assert.match(panel, /id: "trials" as TabId, label: "Períodos grátis"/);
  assert.match(panel, /activeTab === "trials"/);
});

test('central consulta a fonte real de trials e não inventa cobrança SaaS', () => {
  assert.match(trialsTab, /superAdminFetch\("\/api\/super-admin\/trials"\)/);
  assert.match(trialsTab, /não suspende automaticamente/);
  assert.match(trialsTab, /Mercado Pago do Cardápio Online/);
  assert.doesNotMatch(trialsTab, /MRR\s*[:=]/i);
  assert.doesNotMatch(trialsTab, /monthlyRecurringRevenue|subscriptionPayment|billingCharge/);
});

test('modal usa somente as ações administrativas auditáveis de trial', () => {
  assert.match(trialModal, /type TrialAction = "start" \| "extend" \| "end" \| "renew"/);
  assert.match(trialModal, /\/api\/super-admin\/trials\/restaurantes\/\$\{tenant\.id\}/);
  assert.match(trialModal, /method: "PUT"/);
  assert.match(trialModal, /reason: reason\.trim\(\)/);
  assert.match(trialModal, /days < 1 \|\| days > 90/);
  assert.match(trialModal, /Trial e suspensão são controles separados/);
});

test('payload de mutação do trial não altera status SaaS nem integrações de pagamento', () => {
  const bodyMatch = trialModal.match(
    /body: JSON\.stringify\(\{([\s\S]*?)reason: reason\.trim\(\),\s*\}\),/,
  );
  assert.ok(bodyMatch, 'payload completo de mutação deve existir');
  const mutationBody = bodyMatch[1] || '';

  assert.match(mutationBody, /action: selectedAction/);
  assert.doesNotMatch(mutationBody, /saasStatus|status:|mercado.?pago|access_token|refresh_token|seller_id/i);
});
