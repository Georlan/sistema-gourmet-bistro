import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readiness = readFileSync(
  new URL('../src/super-admin/SuperAdminHomologationReadiness.tsx', import.meta.url),
  'utf8',
);
const signups = readFileSync(
  new URL('../src/super-admin/SuperAdminSignupsTab.tsx', import.meta.url),
  'utf8',
);
const saasMp = readFileSync(
  new URL('../backend/app/services/saas_mercadopago.py', import.meta.url),
  'utf8',
);

test('SuperAdmin exposes actionable SaaS diagnostics', () => {
  assert.match(readiness, /\/api\/super-admin\/homologation\/readiness/);
  assert.match(readiness, /Diagnóstico operacional SaaS/);
  assert.match(readiness, /Diagnóstico SaaS/);
  assert.match(readiness, /Abrir checkout Pro anual/);
  assert.match(readiness, /\/contratar\/pro\?cobranca=anual/);
  assert.match(readiness, /Webhook SaaS/);
  assert.match(readiness, /Copiar webhook/);
  assert.match(readiness, /Roteiro manual/);
  assert.match(readiness, /Ações necessárias \(bloqueadores\)/);
  assert.match(readiness, /KOMA_SAAS_CHECKOUT_ENABLED=false/);
  assert.match(readiness, /E-mail e alertas administrativos/);
  assert.doesNotMatch(readiness, /Automação WhatsApp/);
  assert.doesNotMatch(readiness, /WhatsApp do operador KÔMA/);
});

test('Signups tab mounts diagnostics before manual release operations', () => {
  assert.match(signups, /SuperAdminHomologationReadiness/);
  assert.match(signups, /<SuperAdminHomologationReadiness \/>/);
  assert.match(signups, /awaiting_release/);
  assert.match(signups, /Liberar acesso/);
  assert.match(signups, /Confira o Diagnóstico SaaS acima/);
  assert.doesNotMatch(signups, /e-mail\/WhatsApp/);
});

test('public checkout explains unavailability without exposing internal gateway configuration', () => {
  const contractPage = readFileSync(
    new URL('../src/legal/PlanContractPageV2.tsx', import.meta.url),
    'utf8',
  );
  assert.match(contractPage, /Os pagamentos estão temporariamente indisponíveis/);
  assert.match(contractPage, /Sua inscrição fica salva para continuar depois/);
  assert.doesNotMatch(contractPage, /KOMA_SAAS_CHECKOUT_ENABLED=false|credenciais TEST do gateway/);
});

test('SaaS diagnostics protects canonical webhook, required events, and KOMA_PUBLIC_API_URL', () => {
  assert.match(readiness, /Backend de produção/);
  assert.match(readiness, /Backend de homologação/);
  assert.match(readiness, /KOMA_PUBLIC_API_URL/);
  assert.match(readiness, /Webhook SaaS/);
  assert.match(readiness, /Eventos necessários/);
  assert.match(readiness, /subscription_authorized_payment/);
  assert.match(
    readiness,
    /Não use o webhook de pagamentos dos restaurantes\. Este endpoint é exclusivo da cobrança da assinatura KÔMA\./,
  );
  assert.match(readiness, /Copiar webhook/);
  assert.match(readiness, /Copiar configuração/);
  assert.match(readiness, /Webhook:\s*\\n\${data\.webhookUrl}/);
  assert.match(saasMp, /\/api\/integrations\/saas-billing\/mercado-pago\/webhook/);
});

test('SaaS diagnostics uses current checkout policy and fails closed for unavailable Pix', () => {
  assert.match(readiness, /publicApiFetch/);
  assert.match(readiness, /\/api\/contracts\/payment-methods-v2/);
  assert.match(readiness, /Política ativa do checkout/);
  assert.match(readiness, /A cobrança depende do meio escolhido no contrato/);
  assert.match(readiness, /Pix mensal ou anual exige pagamento por QR Code/);
  assert.match(readiness, /sem débito automático/);
  assert.doesNotMatch(readiness, /label="Pix Automático"|label="Saldo Mercado Pago"/);
  assert.match(readiness, /capabilities\.pix === true/);
  assert.match(readiness, /if \(!capabilitiesResponse\.ok\)/);
  assert.match(readiness, /upfrontPaymentAllowed/);
  assert.match(readiness, /Em homologação, use credenciais de teste; em produção, não simule cobranças em clientes reais/);
  assert.doesNotMatch(readiness, /todos.*mesma regra recorrente/i);
});
