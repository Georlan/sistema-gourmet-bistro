/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Product {
  id: string;
  nome: string;
  categoria: string;
  preco: number;
  descricao: string;
  imagem?: string;
}

export interface DraftItem {
  id: string; // Unique ID (timestamp + random) for each single item in draft
  produtoId: string;
  nome: string;
  preco: number;
  observacao: string;
  clienteNome: string;
  quantidade: number; // Selected quantity for this item entry
}

export interface OrderItem {
  id: string; // Unique ID
  produtoId: string;
  nome: string;
  preco: number;
  observacao: string;
  clienteNome: string;
  status: 'preparando' | 'pronto' | 'entregue';
  pago?: boolean;
  lancamentoId?: string;
}

export interface Order {
  id: string;
  mesaId: number;
  garcomId: string;
  garcomNome: string;
  timestamp: number; // Order creation time
  itens: OrderItem[];
  tipo?: 'Consumo no Local' | 'Retirada' | 'Entrega'; // Order type
  valorPago?: number;
  identificador?: string;
  statusComanda?: 'aguardando_pagamento' | null; // Adicionado para compatibilidade com o fluxo do caixa
  mesaOrigemId?: number | null;
  mesaTransferidaDe?: number | null;
}

export interface TableDraft {
  mesaId: number;
  garcomId: string;
  itens: DraftItem[];
}

export interface Table {
  id: number;
  capacidade: number;
  nome?: string;
}

export interface Waiter {
  id: string;
  nome: string;
}

export type AppRole = 'garcom' | 'caixa' | 'cozinha' | 'admin';

export interface AppSettings {
  exibirImagens: boolean;
  exibirDescricoes: boolean;
  tamanhoFonte?: 'padrao' | 'grande' | 'gigante';
}

export interface Usuario {
  id: string;
  nome: string;
  usuario: string;
  role: AppRole;
}

export interface CaixaTurno {
  id: number;
  aberto_por_id: string;
  aberto_em: string;
  fechado_em?: string;
  fechado_por_id?: string;
  saldo_inicial: number;
  declarado_dinheiro?: number;
  declarado_pix?: number;
  declarado_cartao?: number;
  status: 'aberto' | 'fechado';
  movimentacoes?: CaixaMovimentacao[];
  pagamentos?: Pagamento[];
  total_esperado_dinheiro?: number;
  total_esperado_pix?: number;
  total_esperado_cartao?: number;
}

export interface CaixaMovimentacao {
  id: number;
  turno_id: number;
  tipo: 'suprimento' | 'sangria';
  valor: number;
  descricao: string;
  criado_em: string;
}

export interface Pagamento {
  id: string;
  comanda_id: string;
  turno_id: number;
  valor: number;
  metodo: 'dinheiro' | 'pix' | 'cartao';
  criado_em: string;
}
