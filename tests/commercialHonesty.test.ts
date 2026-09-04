import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('super admin does not present inferred catalog values as received revenue', () => {
  const billing = read('src/super-admin/SuperAdminBillingTab.tsx');
  const overview = read('src/super-admin/SuperAdminOverviewTab.tsx');

  for (const source of [billing, overview]) {
    assert.doesNotMatch(source, /\bMRR\b|Faturamento Total Estimado|Receita Variável Split/);
    assert.match(source, /Referência mensal do catálogo/);
    assert.match(source, /não (?:é receita recebida|confirma recebimento)/);
  }
  assert.match(billing, /Valores cobrados, vencidos ou recebidos não são exibidos sem uma fonte financeira/);
});

test('active admin and integration screens contain no future-phase placeholders or fake webhook feed', () => {
  const files = [
    'src/super-admin/SuperAdminPanel.tsx',
    'src/super-admin/SuperAdminOverviewTab.tsx',
    'src/super-admin/SuperAdminBillingTab.tsx',
    'src/super-admin/SuperAdminPaymentsTab.tsx',
    'src/components/caixa/settings/CashierIntegrationsSettings.tsx',
  ];
  const source = files.map(read).join('\n');

  assert.doesNotMatch(source, /Em breve|aguardando (?:endpoint|consolidação)|entra na Fase|serão agregados na Fase/);
  assert.doesNotMatch(source, /failedWebhooks|webhooksAvailable/);
  assert.match(source, /Esta tela não infere transações, webhooks ou valores recebidos/);
});

test('commercial split copy matches the official paid-online-order scope', () => {
  const billing = read('src/super-admin/SuperAdminBillingTab.tsx');
  const payments = read('src/super-admin/SuperAdminPaymentsTab.tsx');
  assert.match(billing, /por pedido online pago/);
  assert.match(payments, /incide somente em pedido online pago/);
  assert.match(billing, /Tarifas do provedor de pagamento são cobradas separadamente/);
});
