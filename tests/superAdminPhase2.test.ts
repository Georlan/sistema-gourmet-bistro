import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tenantsTab = readFileSync("src/super-admin/SuperAdminTenantsTab.tsx", "utf8");
const onboardingModal = readFileSync("src/super-admin/SuperAdminNewTenantModal.tsx", "utf8");
const subscriptionPlans = readFileSync("src/config/subscriptionPlans.ts", "utf8");

test("Super Admin Phase 2 usa o endpoint canônico de onboarding", () => {
  assert.match(
    onboardingModal,
    /superAdminFetch\("\/api\/super-admin\/restaurantes"/,
    "o modal deve provisionar pelo endpoint transacional canônico",
  );
  assert.doesNotMatch(
    onboardingModal,
    /restaurantes\/onboarding/,
    "a UI não deve voltar ao endpoint legado 501",
  );
  assert.match(onboardingModal, /admin_name/);
  assert.match(onboardingModal, /admin_email/);
  assert.match(onboardingModal, /temporary_password/);
  assert.match(onboardingModal, /setTemporaryPassword\(""\)/);
});

test("Super Admin Phase 2 usa o catálogo comercial oficial", () => {
  assert.match(onboardingModal, /SUBSCRIPTION_PLANS/);
  assert.match(tenantsTab, /SUBSCRIPTION_PLANS/);
  assert.match(subscriptionPlans, /price:\s*109/);
  assert.match(subscriptionPlans, /price:\s*209/);
  assert.match(subscriptionPlans, /price:\s*309/);

  for (const staleValue of ["97", "197", "347", "1.79", "0.89", "0.39"]) {
    assert.equal(
      onboardingModal.includes(staleValue),
      false,
      `o onboarding não pode reintroduzir valor comercial antigo: ${staleValue}`,
    );
  }
});

test("Gestão de restaurantes mantém create/list/edit/status no mesmo fluxo real", () => {
  assert.match(tenantsTab, /SuperAdminNewTenantModal/);
  assert.match(tenantsTab, /refreshTenants/);
  assert.match(
    tenantsTab,
    /\/api\/super-admin\/restaurantes\/\$\{editingTenant\.id\}/,
  );
  assert.match(
    tenantsTab,
    /\/api\/super-admin\/restaurantes\/\$\{statusTargetTenant\.id\}\/status/,
  );
  assert.match(onboardingModal, /Mercado Pago do cardápio: desconectado/);
});

test("Novo restaurante nasce com 7 dias grátis sem criar cobrança SaaS automática", () => {
  assert.match(onboardingModal, /7 dias grátis/);
  assert.match(onboardingModal, /daysGranted/);
  assert.match(onboardingModal, /daysRemaining/);
  assert.match(onboardingModal, /A cobrança SaaS recorrente ainda não é criada automaticamente/);
  assert.match(onboardingModal, /não suspende o restaurante automaticamente nesta etapa/);
});