import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('consumo do salão mantém adicionais abaixo do nome e antes da observação', () => {
  const panel = source('src/components/mesas/MesaConsumptionPanel.tsx');
  const modifiers = panel.indexOf('placed-item-modifiers-${item.id}');
  const observation = panel.indexOf('Obs: "{item.observacao}"');

  assert.ok(modifiers >= 0, 'chips de adicionais precisam existir na comanda lançada');
  assert.ok(observation > modifiers, 'adicionais devem aparecer antes da observação de preparo');
  assert.match(panel, /bg-emerald-500\/10/);
  assert.match(panel, /\+ \{quantity > 1 \? `\$\{quantity\}x ` : ''\}\{modifier\.nome\}/);
});
