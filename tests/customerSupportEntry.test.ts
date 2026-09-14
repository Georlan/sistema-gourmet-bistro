import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('ajuda não usa mais botão flutuante sobre as telas', () => {
  const widget = source('src/components/app/CustomerSupportWidget.tsx');

  assert.doesNotMatch(widget, /top-\[56%\]/);
  assert.doesNotMatch(widget, /Abrir ajuda e suporte/);
  assert.match(widget, /KOMA_OPEN_CUSTOMER_SUPPORT_EVENT/);
  assert.match(widget, /if \(!session\?\.token \|\| !isOpen\) return null/);
});

test('menus autenticados expõem Ajuda e feedback sem adicionar entrada ao SuperAdmin', () => {
  const cashierFooter = source('src/components/caixa/navigation/CashierSidebarFooter.tsx');
  const operationalDrawer = source('src/components/app/OperationalDrawer.tsx');
  const main = source('src/main.tsx');

  assert.match(cashierFooter, /Ajuda e feedback/);
  assert.match(cashierFooter, /openCustomerSupport/);
  assert.match(operationalDrawer, /id="drawer-open-customer-support"/);
  assert.match(operationalDrawer, /Dúvidas, sugestões, problemas ou reclamações/);
  assert.match(main, /!pathname\.startsWith\("\/super-admin"\)/);
});
