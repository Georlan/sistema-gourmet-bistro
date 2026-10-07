import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const leads = readFileSync(new URL("../src/super-admin/SuperAdminLeadsTab.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/super-admin/SuperAdminPanel.tsx", import.meta.url), "utf8");

test("Super Admin exposes a real Leads CRM surface", () => {
  assert.match(panel, /label: "Leads"/);
  assert.match(panel, /SuperAdminLeadsTab/);
  assert.match(leads, /\/api\/leads\/admin/);
  assert.match(leads, /Chamar no WhatsApp/);
  assert.match(leads, /Marcar como Contatado/);
  assert.match(leads, /Demo agendada/);
  assert.match(leads, /Convertido/);
  assert.match(leads, /Perdido/);
});

test("CRM keeps consent read-only and uses normalized WhatsApp", () => {
  assert.doesNotMatch(leads, /consent_whatsapp:\s*form/);
  assert.match(leads, /whatsapp_normalizado/);
  assert.match(leads, /https:\/\/wa\.me\//);
});
