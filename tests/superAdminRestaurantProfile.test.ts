import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const modal = readFileSync("src/super-admin/SuperAdminNewTenantModal.tsx", "utf8");

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
