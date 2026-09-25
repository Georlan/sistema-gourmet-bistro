import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const monitor = readFileSync('src/components/printing/PrintMonitorPanel.tsx', 'utf8');

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
  assert.match(monitor, /PADRAO/);
  assert.match(monitor, /COZINHA/);
  assert.match(monitor, /BAR/);

  // Bluetooth SPP on-demand readiness without requiring CUPS queue
  assert.match(monitor, /isPrinterReady/);
  assert.match(monitor, /printer\.connection === 'bluetooth'/);
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
