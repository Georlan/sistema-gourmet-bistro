import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const monitor = readFileSync('src/components/printing/PrintMonitorPanel.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');

test('monitor handles multi-transport printing uniformly', () => {
  // Transport badges
  assert.match(monitor, /getTransportBadge/);
  assert.match(monitor, /Bluetooth SPP/);
  assert.match(monitor, /Rede TCP/);
  assert.match(monitor, /CUPS/);
  assert.match(monitor, /Spooler/);

  // Structured endpoints and destinations
  assert.match(monitor, /PrinterEndpointReport/);
  assert.match(monitor, /configuredEndpoints/);
  assert.match(monitor, /configuredDestinations/);
  assert.match(monitor, /Destinos e rotas de impressão/);
  assert.match(monitor, /Rotas ativas/);
  assert.match(monitor, /Object\.entries\(configuredDestinations\)/);

  // Bluetooth SPP continua sob demanda, mas readiness exige presença física atual
  assert.match(monitor, /isPrinterReady/);
  assert.match(monitor, /printer\.connection === 'bluetooth'/);
  assert.match(monitor, /printer\.present === true/);
  assert.match(monitor, /printer\.available/);
  assert.match(monitor, /Impressoras Bluetooth \(SPP\)/);
  assert.match(monitor, /RFCOMM sob demanda/);
  assert.doesNotMatch(monitor, /canTest = \([\s\S]*&& Boolean\(printer\.cups_queue\)[\s\S]*printer\.supportsBluetoothTest\)/);

  // Network printers
  assert.match(monitor, /networkPrinters/);
  assert.match(monitor, /Impressoras de rede \(TCP \/ IP\)/);

  // Generic readiness enables test print
  assert.match(monitor, /hasReadyPrinter = \(/);
  assert.match(monitor, /disabled=\{testInProgress \|\| !hasReadyPrinter\}/);
});

test('monitor presents friendly non-technical UX for users and keeps technical details in diagnostics', () => {
  // Canonical user-friendly terminology in primary UI
  assert.match(monitor, /Impressora encontrada/);
  assert.match(monitor, /Pronta para imprimir/);
  assert.match(monitor, /Desconectada/);
  assert.match(monitor, /Atualização automática/);
  assert.match(monitor, /Imprimir teste/);
  assert.match(monitor, /Impressora principal/);

  // Friendly discrete transport badges
  assert.match(monitor, /getFriendlyTransportBadge/);

  // Diagnostics and support section for technicians
  assert.match(monitor, /Diagnóstico técnico e suporte/);
  assert.match(monitor, /transporte, endpoints, SPP, CUPS, spooler e rede/);
});



test('daily printing status refresh is automatic and websocket-driven', () => {
  assert.match(app, /eventName === "print_monitor_updated"/);
  assert.match(app, /new Event\('koma_print_monitor_refresh'\)/);
  assert.match(monitor, /addEventListener\('koma_print_monitor_refresh', refreshFromRealtime\)/);
  assert.match(monitor, /30_000/);
  assert.match(monitor, /Atualização automática/);
  assert.doesNotMatch(monitor, />\s*Atualizar status\s*</);
  assert.doesNotMatch(monitor, />\s*Atualizar impressoras\s*</);
  assert.match(monitor, /Preparar conexão USB/);
  assert.match(monitor, /Diagnóstico técnico e suporte/);
  assert.doesNotMatch(monitor, /agente online · USB desconectado/);
});


test('monitor shows the physical paper profile without exposing layout internals', () => {
  assert.match(monitor, /paper_width_mm/);
  assert.match(monitor, /Papel \{paperWidthMm\} mm/);
  assert.match(monitor, /options\?\.columns/);
});


test('paired bluetooth alone never appears as connected or ready', () => {
  assert.match(monitor, /const physicallyPresent = Boolean\(/);
  assert.doesNotMatch(monitor, /printer\.present \|\| printer\.paired \|\| printer\.available/);
  assert.match(monitor, /nenhuma impressora disponível/);
  assert.match(monitor, /Ligue ou conecte uma impressora/);
});
