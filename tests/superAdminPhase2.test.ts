import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tenantsTab = readFileSync("src/super-admin/SuperAdminTenantsTab.tsx", "utf8");
const onboardingModal = readFileSync("src/super-admin/SuperAdminNewTenantModal.tsx", "utf8");
const subscriptionPlans = readFileSync("src/config/subscriptionPlans.ts", "utf8");

test("Super Admin Phase 2 usa o endpoint canônico de onboarding", () => {
  assert.match(
    onboardingModal,
    /superAdminFetch\("\/api\/super-admin\/restaurantes\/provisionar"/,
    "o modal deve provisionar pelo endpoint transacional profile-aware",
  );
  assert.doesNotMatch(
    onboardingModal,
    /restaurantes\/onboarding/,
    "a UI não deve voltar ao endpoint legado 501",
  );
  assert.match(onboardingModal, /operation_profile/);
  assert.match(onboardingModal, /admin_name/);
  assert.match(onboardingModal, /admin_email/);
  assert.match(onboardingModal, /temporary_password/);
  assert.match(onboardingModal, /setTemporaryPassword\(""\)/);
});

test("Super Admin Phase 2 usa o catálogo comercial oficial", () => {
  assert.match(onboardingModal, /SUBSCRIPTION_PLANS/);
  assert.match(tenantsTab, /SUBSCRIPTION_PLANS/);
  assert.match(subscriptionPlans, /price:\s*39,/);
  assert.match(subscriptionPlans, /price:\s*129/);
  assert.match(subscriptionPlans, /price:\s*249/);

  assert.doesNotMatch(onboardingModal, /formatCurrency\(item\.price\)/);
  assert.doesNotMatch(onboardingModal, /formatPercentage\(item\.splitFeeRate\)/);
  assert.doesNotMatch(onboardingModal, /R\$\s*(?:89|179|269)(?:[,.]00)?/);
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

test("Gestão de restaurantes não oferece mutação direta de plano comercial", () => {
  assert.doesNotMatch(tenantsTab, /const \[editPlan,/);
  assert.doesNotMatch(tenantsTab, /plan:\s*editPlan/);
  assert.doesNotMatch(tenantsTab, /Plano Comercial<\/span><select/);
  assert.match(tenantsTab, /Mudança de plano não é permitida por esta edição genérica/);
  assert.match(tenantsTab, /Mensalidade e taxa transacional efetivas não são inferidas pelo slug do plano/);
  assert.match(tenantsTab, /Consulte o aceite vinculado em <strong>Contratações<\/strong>/);
});

test("Provisionamento manual é administrativo e não finge contratação comercial", () => {
  assert.match(onboardingModal, /Provisionamento administrativo\/QA/);
  assert.match(onboardingModal, /Não registra ContractAcceptance/);
  assert.match(onboardingModal, /commercialTermsStatus/);
  assert.match(onboardingModal, /Janela administrativa de homologação/);
  assert.match(onboardingModal, /Nenhum preço ou taxa comercial foi contratado/);
  assert.doesNotMatch(onboardingModal, /formatCurrency\(item\.price\)/);
  assert.doesNotMatch(onboardingModal, /formatPercentage\(item\.splitFeeRate\)/);
});
