import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const settings = readFileSync('src/components/caixa/settings/CashierSettings.tsx', 'utf8');
const appearance = readFileSync('src/components/caixa/settings/CashierAppearanceSettings.tsx', 'utf8');
const responsiveCss = readFileSync('src/components/caixa/navigation/cashierLowHeight.css', 'utf8');

test('cashier settings expose task groups and remember the last operator section', () => {
  assert.match(settings, /CASHIER_SETTINGS_TAB_STORAGE_KEY = 'koma_cashier_settings_tab'/);
  assert.match(settings, /useState<CashierSettingsTab>\(readInitialCashierSettingsTab\)/);
  assert.match(settings, /window\.localStorage\.getItem\(CASHIER_SETTINGS_TAB_STORAGE_KEY\)/);
  assert.match(settings, /window\.localStorage\.setItem\(CASHIER_SETTINGS_TAB_STORAGE_KEY, tab\)/);
  assert.match(settings, /Configurações do Caixa/);
  assert.match(settings, /aria-label="Configurações do caixa"/);
  assert.match(settings, /label: 'Neste dispositivo'/);
  assert.match(settings, /label: 'Operação do salão'/);
  assert.match(settings, /label: 'Aparência'/);
  assert.match(settings, /label: 'Impressão'/);
  assert.match(settings, /label: 'Mesas'/);
  assert.match(settings, /label: 'App do Garçom'/);
  assert.match(settings, /label: 'Taxa de Serviço'/);
  assert.match(settings, /onClick=\{\(\) => selectSettingsTab\(tab\.id\)\}/);
  assert.match(settings, /<CashierAppearanceSettings \/>/);
});

test('appearance settings persist theme and local text size using the cashier preference contract', () => {
  assert.match(appearance, /persistKomaTheme\(nextTheme\)/);
  assert.match(appearance, /localStorage\.setItem\('koma_font_size', nextFontSize\)/);
  assert.match(appearance, /koma_font_size_changed/);
  assert.match(appearance, /aria-label="Tema do caixa"/);
  assert.match(appearance, /aria-label="Tamanho do texto do caixa"/);
  assert.match(appearance, /aria-pressed=\{selected\}/);
});

test('mobile cashier topbar reserves independent 44px touch targets for menu, chat and fullscreen', () => {
  assert.match(responsiveCss, /@media \(max-width: 639px\)/);
  assert.match(responsiveCss, /#btn-mobile-caixa-sidebar-open,[\s\S]*#btn-caixa-conversas-drawer,[\s\S]*#btn-modo-pdv-fullscreen/);
  assert.match(responsiveCss, /width: 2\.75rem/);
  assert.match(responsiveCss, /min-height: 2\.75rem/);
  assert.doesNotMatch(responsiveCss, /(?:width|height|min-width|min-height): 2\.55rem/);
  assert.match(responsiveCss, /#btn-caixa-conversas-drawer > span:not\(\[role="status"\]\)[\s\S]*display: none/);
  assert.match(responsiveCss, /\.cashier-subnav__button[\s\S]*min-height: 2\.75rem/);
});
