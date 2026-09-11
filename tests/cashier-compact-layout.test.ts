import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const footer = readFileSync(
  new URL('../src/components/caixa/navigation/CashierSidebarFooter.tsx', import.meta.url),
  'utf8',
);
const compactCss = readFileSync(
  new URL('../src/components/caixa/navigation/cashierCompactLayout.css', import.meta.url),
  'utf8',
);

test('sidebar keeps display preferences out of the persistent operational footer', () => {
  assert.match(footer, /cashierCompactLayout\.css/);
  assert.match(footer, /cashier-operator/);
  assert.doesNotMatch(footer, /cashier-display-controls/);
  assert.doesNotMatch(footer, /cashier-sidebar__compact-theme/);
  assert.doesNotMatch(footer, /nextKomaTheme|persistKomaTheme/);
});

test('short desktop layout protects emergency action and PDV cart space', () => {
  assert.match(compactCss, /max-width:\s*1440px/);
  assert.match(compactCss, /max-height:\s*820px/);
  assert.match(compactCss, /--sidebar-width:\s*14rem/);
  assert.match(compactCss, /#online-orders-emergency-trigger/);
  assert.match(compactCss, /:has\(> form > #pdv-submit-btn\)/);
  assert.match(compactCss, /min-width:\s*22\.5rem/);
  assert.match(compactCss, /#pdv-target-table\[data-table-status="free"\]/);
  assert.match(compactCss, /#pdv-submit-btn > span:last-child/);
});
