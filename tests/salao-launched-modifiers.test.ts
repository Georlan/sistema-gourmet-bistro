import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { mapBackendComandaToOperationalOrder } from '../src/components/app/data/operationalOrderMapping';
import type { Product } from '../src/types';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

const products: Product[] = [
  {
    id: 'burger-1',
    nome: 'Hambúrguer Bovino',
    categoria: 'Hambúrgueres Bovinos',
    categoria_id: 'burgers',
    preco: 19,
    descricao: '',
    ativo: true,
  },
];

test('projeção operacional preserva adicionais persistidos e unidades repetidas', () => {
  const order = mapBackendComandaToOperationalOrder({
    liveProdutos: products,
    comanda: {
      id: 'order-1',
      numero_pedido: 42,
      mesa_id: 16,
      garcom_id: 'waiter-1',
      criado_em: '2026-09-15T11:00:00',
      tipo: 'Consumo no Local',
      lancamentos: [],
      itens: [
        {
          id: 'item-1',
          produto_id: 'burger-1',
          preco_unit: 29,
          observacao: '',
          cliente_nome: 'Consumo Geral',
          status: 'preparando',
          pago: false,
          modificadores: [
            { id: 'egg', nome: 'Ovo', preco: 2 },
            { id: 'egg', nome: 'Ovo', preco: 2 },
            { id: 'bacon', nome: 'Bacon', preco: 4 },
          ],
        },
      ],
    },
  });

  assert.deepEqual(order.itens[0].modificadores, [
    { id: 'egg', nome: 'Ovo', preco: 2 },
    { id: 'egg', nome: 'Ovo', preco: 2 },
    { id: 'bacon', nome: 'Bacon', preco: 4 },
  ]);
});

test('consumo da mesa renderiza nomes e quantidades de adicionais do item lançado', () => {
  const panel = source('src/components/mesas/MesaConsumptionPanel.tsx');

  assert.match(panel, /summarizeItemModifiers/);
  assert.match(panel, /item\.modificadores/);
  assert.match(panel, /placed-item-modifiers-\$\{item\.id\}/);
  assert.match(panel, /quantity > 1 \? `\$\{quantity\}x ` : ''/);
  assert.match(panel, /\{modifier\.nome\}/);
});
