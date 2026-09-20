import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync("src/main.tsx", "utf8");
const page = readFileSync("src/printing-simulator/PrintingSimulatorPage.tsx", "utf8");
const worker = readFileSync("print-agent/worker.py", "utf8");
const simulator = readFileSync("print-agent/simulator.py", "utf8");
const routes = readFileSync("backend/app/routes/print_agents.py", "utf8");
const cashierPrinting = readFileSync("src/components/caixa/settings/CashierPrintingSettings.tsx", "utf8");
const supportBanner = readFileSync("src/components/app/SupportSessionBanner.tsx", "utf8");
const linuxInstaller = readFileSync("print-agent/install-linux.sh", "utf8");
const windowsInstaller = readFileSync("print-agent/install-windows.ps1", "utf8");

test("thermal simulator has a standalone operational route", () => {
  assert.match(main, /\/ferramentas\/simulador-impressao/);
  assert.match(main, /printing-simulator\/PrintingSimulatorPage/);
  assert.match(page, /Simulador térmico ESC\/POS/);
});

test("browser does not own a second receipt formatter", () => {
  assert.match(page, /payload_text/);
  assert.match(page, /\/api\/print-agents\/simulator\/sources/);
  assert.doesNotMatch(page, /render_canonical_comanda|generate_receipt|PrintItem/);
});

test("local simulator reuses production ESC POS builder without physical writes", () => {
  assert.match(simulator, /from adapters\.escpos import build_escpos_payload/);
  assert.match(simulator, /build_escpos_payload\(payload_text, encoding="cp860"\)/);
  assert.match(simulator, /physical_usb_write": False/);
  assert.match(simulator, /physical_print_time_ms": None/);
  assert.match(worker, /start_simulator_server\(type\(adapter\)\.__name__\)/);
});

test("simulator is internal support tooling, not a restaurant feature", () => {
  assert.match(routes, /require_internal_print_simulator_user/);
  assert.match(routes, /is_support_mode/);
  assert.match(routes, /Simulador térmico restrito ao Modo Suporte interno do KÔMA/);
  assert.match(routes, /PrintJob\.restaurante_id == rest_id/);
  assert.match(page, /getSuperAdminToken/);
  assert.match(page, /koma_support_session/);
  assert.match(page, /Esta bancada não faz parte das ferramentas do restaurante/);
  assert.doesNotMatch(cashierPrinting, /simulador-impressao|Abrir simulador térmico|Bancada virtual de impressão/);
  assert.match(page, /Tempo físico/);
  assert.match(page, /não medido/);
});


test("support mode exposes one-click simulator access and installers ship the bridge", () => {
  assert.match(supportBanner, /\/ferramentas\/simulador-impressao/);
  assert.match(supportBanner, /Simulador térmico/);
  assert.match(linuxInstaller, /simulator\.py/);
  assert.match(windowsInstaller, /"simulator\.py"/);
  assert.match(windowsInstaller, /"wake_listener\.py"/);
  assert.match(page, /2026\.09\.20\.1/);
});
