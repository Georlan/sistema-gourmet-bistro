import React from 'react';
import { TABLES } from '../../data';
import { Order } from '../../types';

export const DEMO_ORDERS: Order[] = [
  {
    id: 'ord-demo-01',
    mesaId: 3,
    garcomId: 'g-01',
    garcomNome: 'Georlan',
    itens: [
      {
        id: 'item-01',
        produtoId: '001',
        nome: 'Cheese Bacon 120g',
        preco: 25.80,
        observacao: '',
        clienteNome: 'Carlos Silva',
        status: 'preparando',
      },
    ],
    timestamp: Date.now() - 1000 * 60 * 12,
    status: 'aberta',
  },
  {
    id: 'ord-demo-02',
    mesaId: 4,
    garcomId: 'g-02',
    garcomNome: 'Mateus',
    itens: [
      {
        id: 'item-02',
        produtoId: '002',
        nome: 'Batata Rústica 300g',
        preco: 19.80,
        observacao: '',
        clienteNome: 'Fernanda Lima',
        status: 'pronto',
      },
    ],
    timestamp: Date.now() - 1000 * 60 * 8,
    status: 'aberta',
  },
  {
    id: 'ord-demo-03',
    mesaId: 12,
    garcomId: 'g-03',
    garcomNome: 'Sarah',
    itens: [
      {
        id: 'item-03',
        produtoId: '003',
        nome: 'Duplo Frango Pôr do Sol',
        preco: 32.00,
        observacao: '',
        clienteNome: 'Lucas Mendes',
        status: 'preparando',
      },
    ],
    timestamp: Date.now() - 1000 * 60 * 15,
    status: 'aberta',
  },
];

export function getMarketingDemoData() {
  return {
    salonTables: TABLES,
    orders: DEMO_ORDERS,
  };
}
