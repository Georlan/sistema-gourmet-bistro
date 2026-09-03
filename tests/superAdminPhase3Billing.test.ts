import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const billing = readFileSync("src/super-admin/SuperAdminBillingTab.tsx", "utf8");
const pricing = readFileSync("src/config/subscriptionPlans.ts", "utf8");

test("Fase 3 lê contratos persistidos em vez de inferir MRR por tenant ativo", () => {
  assert.match(billing, /\/api\/super-admin\/billing/);
  assert.match(billing, /contractedMrrCents/);
  assert.match(billing, /currentMrrCents/);
  assert.match(billing, /recurringRevenueReceivedAvailable/);
  assert.doesNotMatch(billing, /activeTenants\.reduce/);
  assert.doesNotMatch(billing, /Faturamento Total Estimado/);
});

test("gestão contratual exige motivo e usa endpoint administrativo dedicado", () => {
  assert.match(billing, /billing\/restaurantes\/\$\{encodeURIComponent\(editing\.restaurantId\)\}/);
  assert.match(billing, /reason\.trim\(\)\.length < 3/);
  assert.match(billing, /billing_cycle/);
  assert.match(billing, /past_due/);
  assert.match(billing, /needs_review/);
});

test("tela mantém valores no catálogo compartilhado e não reintroduz preços antigos", () => {
  assert.match(billing, /SUBSCRIPTION_PLANS/);
  assert.match(billing, /getSubscriptionPricing/);
  assert.match(pricing, /price:\s*109/);
  assert.match(pricing, /price:\s*209/);
  assert.match(pricing, /price:\s*309/);

  for (const stale of ["R$ 89", "R$ 179", "R$ 269", "1,79%", "0,89%", "0,39%"] ) {
    assert.equal(billing.includes(stale), false, `valor comercial antigo encontrado: ${stale}`);
  }
});

test("inadimplência não suspende tenant implicitamente", () => {
  assert.match(billing, /Inadimplência contratual é separada de suspensão SaaS/);
  assert.match(billing, /Não suspende o tenant automaticamente nesta etapa/);
});
