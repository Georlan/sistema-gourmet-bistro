import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');

test('waiter table actions distinguish reprint from closing', () => {
  const source = read('src/components/mesas/MesaConsumptionPanel.tsx');

  assert.match(source, /<span>Reimpressão<\/span>/);
  assert.match(source, /<span>Fechamento<\/span>/);
  assert.doesNotMatch(source, /Extrato Completo/);
});

test('cashier table detail names the three physical print scopes explicitly', () => {
  const source = read('src/components/caixa/orders/KanbanOrderDetails.tsx');

  assert.match(source, /<span>Reimprimir produção<\/span>/);
  assert.match(source, /<span>Reimpressão total<\/span>/);
  assert.match(source, /<span>Fechamento<\/span>/);
  assert.doesNotMatch(source, /Comanda Inteira|Só Valores/);
});
