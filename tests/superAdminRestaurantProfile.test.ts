import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const modal = readFileSync("src/super-admin/SuperAdminNewTenantModal.tsx", "utf8");
const tenantsTab = readFileSync("src/super-admin/SuperAdminTenantsTab.tsx", "utf8");
const backend = readFileSync("backend/app/routes/super_admin_profile_onboarding.py", "utf8");

test("onboarding do Super Admin oferece perfil operacional explícito", () => {
  assert.match(modal, /Tipo de operação/);
  assert.match(modal, /Outro \/ configurar depois/);
  assert.match(modal, /Pizzaria/);
  assert.match(modal, /Açaí/);
  assert.match(modal, /Churrasco/);
  assert.match(modal, /operation_profile: operationProfile/);
  assert.match(modal, /\/api\/super-admin\/restaurantes\/provisionar/);
});

test("seletor deixa claro que perfil não preenche catálogo automaticamente", () => {
  assert.match(modal, /Isso só adapta sugestões e atalhos/);
  assert.match(modal, /cardápio não é preenchido automaticamente/);
  assert.match(modal, /Nenhum item ou complemento foi criado automaticamente/);
});

test("resumo da criação confirma o perfil salvo", () => {
  assert.match(modal, /operationProfile: string/);
  assert.match(modal, /operationProfileLabel\(created\.operationProfile\)/);
});

test("restaurante existente pode consultar e alterar apenas os tipos suportados", () => {
  assert.match(tenantsTab, /Tipo de operação/);
  assert.match(tenantsTab, /operation-profile/);
  assert.match(tenantsTab, /operation_profile: editOperationProfile/);
  assert.match(tenantsTab, /Outro \/ configurar depois/);
  assert.match(tenantsTab, /Pizzaria/);
  assert.match(tenantsTab, /Açaí/);
  assert.match(tenantsTab, /Churrasco/);

  assert.match(backend, /SUPPORTED_OPERATION_PROFILES = \("generic", "pizzaria", "acai", "churrasco"\)/);
  assert.match(backend, /@router\.get\("\/restaurantes\/\{tenant_id\}\/operation-profile"\)/);
  assert.match(backend, /@router\.patch\("\/restaurantes\/\{tenant_id\}\/operation-profile"\)/);
});

test("alterar tipo continua sendo somente configuração, sem efeito automático", () => {
  assert.match(tenantsTab, /somente uma configuração/);
  assert.match(tenantsTab, /não altera cardápio, preços, complementos, Caixa, Garçom ou regras de pedido automaticamente/);
  assert.match(backend, /behaviorApplied": False/);
  assert.match(backend, /behavior_applied": False/);
  assert.match(backend, /SUPERADMIN_OPERATION_PROFILE_UPDATE/);
});
