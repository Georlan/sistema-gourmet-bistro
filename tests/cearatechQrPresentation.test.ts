import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const qr = readFileSync(new URL("../src/landing/CearaTechQrPage.tsx", import.meta.url), "utf8");

test("Ceara Tech exposes a paperless presentation QR route", () => {
  assert.match(main, /pathname === "\/cearatech\/qr"/);
  assert.match(main, /CearaTechQrPage/);
  assert.match(qr, /https:\/\/komafood\.com\.br\/cearatech/);
  assert.match(qr, /QRCodeSVG/);
  assert.match(qr, /@komafood/);
  assert.match(qr, /Sem papel/);
});
