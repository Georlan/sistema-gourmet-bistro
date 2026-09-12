import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mobileSidebar = readFileSync(
  new URL('../src/components/caixa/navigation/CashierMobileSidebar.tsx', import.meta.url),
  'utf8',
);
const responsiveCss = readFileSync(
  new URL('../src/components/caixa/navigation/cashierLowHeight.css', import.meta.url),
  'utf8',
);

const readZIndex = (source: string, pattern: RegExp, label: string) => {
  const match = source.match(pattern);
  assert.ok(match, `${label} z-index must stay explicit`);
  return Number(match[1]);
};

test('mobile sidebar overlay stays above sticky cashier chrome', () => {
  const sidebarOverlayZ = readZIndex(
    mobileSidebar,
    /fixed inset-0 z-\[(\d+)\] flex lg:hidden animate-fade-in/,
    'mobile sidebar overlay',
  );
  const topbarZ = readZIndex(
    responsiveCss,
    /\.cashier-topbar\s*\{\s*position:\s*sticky;\s*top:\s*0;\s*z-index:\s*(\d+);/,
    'mobile cashier topbar',
  );
  const subnavZ = readZIndex(
    responsiveCss,
    /\.cashier-subnav\s*\{\s*position:\s*sticky;\s*top:\s*3\.5rem;\s*z-index:\s*(\d+);/,
    'mobile cashier subnav',
  );

  assert.ok(sidebarOverlayZ > topbarZ, 'opened sidebar must cover the sticky topbar');
  assert.ok(sidebarOverlayZ > subnavZ, 'opened sidebar must cover the sticky subnav');
});
