import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync("src/main.tsx", "utf8");
const page = readFileSync("src/printing-simulator/PrintingSimulatorPage.tsx", "utf8");
const worker = readFileSync("print-agent/worker.py", "utf8");
const simulator = readFileSync("print-agent/simulator.py", "utf8");
const routes = readFileSync("backend/app/routes/print_agents.py", "utf8");

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

test("simulator source endpoints are read only and tenant scoped", () => {
  assert.match(routes, /\/simulator\/sources/);
  assert.match(routes, /PrintJob\.restaurante_id == rest_id/);
  assert.match(routes, /require_permission\("impressao:administrar"\)/);
  assert.match(page, /Tempo físico/);
  assert.match(page, /não medido/);
});
