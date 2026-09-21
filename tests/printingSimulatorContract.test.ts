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
const apiClient = readFileSync("print-agent/api_client.py", "utf8");

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


test("automatic simulator observes new jobs without becoming the print queue authority", () => {
  assert.match(routes, /\/simulator\/agent-feed/);
  assert.match(routes, /Depends\(get_current_agent\)/);
  assert.match(routes, /PrintJob\.restaurante_id == agent\.restaurante_id/);
  assert.match(apiClient, /get_simulator_feed/);
  assert.match(simulator, /class AutoSimulationState/);
  assert.match(simulator, /authoritative_queue_mutation": False/);
  assert.match(simulator, /physical_usb_write": False/);
  assert.match(simulator, /\/simulator\/auto\/start/);
  assert.match(simulator, /\/simulator\/auto\/status/);
  assert.match(worker, /process_shadow_simulation/);
  assert.match(worker, /simulate_payload\(job\["payload_text"\]\)/);
  assert.match(page, /Observar novos pedidos automaticamente/);
  assert.match(page, /Modo sombra: não faz claim, não altera o status do PrintJob/);
  assert.match(page, /2026\.09\.20\.2/);
});


test("simulator surfaces print origin instead of hiding reprints among normal jobs", () => {
  assert.match(routes, /"origin_kind": _print_job_origin\(job\)\["kind"\]/);
  assert.match(routes, /"origin_label": _print_job_origin\(job\)\["label"\]/);
  assert.match(page, /Origem da impressão/);
  assert.match(page, /item\.origin_label \|\| item\.source_type/);
});
