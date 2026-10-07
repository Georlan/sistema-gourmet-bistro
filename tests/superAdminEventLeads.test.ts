import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(path, "utf8");

test("Super Admin exposes the event lead CRM and WhatsApp workflow", () => {
  const panel = source("src/super-admin/SuperAdminPanel.tsx");
  const crm = source("src/super-admin/SuperAdminLeadsTab.tsx");

  assert.match(panel, /label: "Leads"/);
  assert.match(panel, /SuperAdminLeadsTab/);
  assert.match(crm, /new/);
  assert.match(crm, /contacted/);
  assert.match(crm, /qualified/);
  assert.match(crm, /demo_scheduled/);
  assert.match(crm, /converted/);
  assert.match(crm, /lost/);
  assert.match(crm, /https:\/\/wa\.me\//);
  assert.match(crm, /Marcar como contatado agora/);
  assert.match(crm, /consent_whatsapp/);
});

test("Ceará Tech QR screen is presentation-first and targets the canonical lead landing", () => {
  const main = source("src/main.tsx");
  const qr = source("src/landing/CearaTechQrPage.tsx");
  const lead = source("src/landing/CearaTechLeadPage.tsx");

  assert.match(main, /isCearaTechQrRoute/);
  assert.match(main, /CearaTechQrPage/);
  assert.match(qr, /https:\/\/komafood\.com\.br\/cearatech\?source=qr_tela/);
  assert.match(qr, /QRCodeSVG/);
  assert.match(qr, /@komafood/);
  assert.match(lead, /consent: false/);
  assert.match(lead, /resolveLeadSource/);
});
