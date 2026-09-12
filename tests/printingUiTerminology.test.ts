import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');

test('waiter table actions distinguish reprint from Conta da Mesa', () => {
  const source = read('src/components/mesas/MesaConsumptionPanel.tsx');

  assert.match(source, /<span>Reimpressão<\/span>/);
  assert.match(source, /<span>Conta da Mesa<\/span>/);
  assert.doesNotMatch(source, /<span>Fechamento<\/span>/);
  assert.doesNotMatch(source, /Extrato Completo|Apenas Valores/);
});

test('cashier table detail names the three physical print scopes explicitly', () => {
  const source = read('src/components/caixa/orders/KanbanOrderDetails.tsx');

  assert.match(source, /<span>Reimprimir produção<\/span>/);
  assert.match(source, /<span>Reimpressão total<\/span>/);
  assert.match(source, /<span>Conta da Mesa<\/span>/);
  assert.doesNotMatch(source, /<span>Fechamento<\/span>/);
  assert.doesNotMatch(source, /Comanda Inteira|Só Valores|Apenas Valores/);
});

test('values-only presentation is named as Conta across waiter and cashier surfaces', () => {
  const waiterDialogs = read('src/components/mesas/MesaPrintDialogs.tsx');
  const checkout = read('src/components/caixa/checkout/CheckoutDialog.tsx');
  const cashierOrders = read('src/components/caixa/orders/useCashierOrders.ts');

  assert.match(waiterDialogs, /Imprimir Conta/);
  assert.match(checkout, /Imprimir Conta/);
  assert.match(cashierOrders, /Erro ao imprimir Conta da Mesa\./);
  assert.doesNotMatch(waiterDialogs, /Apenas Valores|Extrato Completo/);
  assert.doesNotMatch(checkout, /Apenas Valores|Extrato Completo|Imprime apenas o resumo/);
  assert.doesNotMatch(cashierOrders, /Erro ao imprimir apenas valores/);
});
