/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Product {
  id: string;
  nome: string;
  categoria: string;
  categoria_id?: string;
  preco: number;
  descricao: string;
  imagem?: string;
  imagens_galeria?: string[];
  ativo?: boolean;
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
  cliente_nome?: string;
  status: 'preparando' | 'pronto' | 'entregue' | 'cancelado';
  pago?: boolean;
  lancamentoId?: string;
  comandaId?: string;
}

export interface Order {
  id: string;
  /** Número curto e humano exibido na operação. */
  numeroPedido?: number;
  /** Números preservados quando um card agrega famílias mescladas. */
  numeroPedidos?: number[];
  /** Canal que originou o primeiro lançamento da comanda. */
  origemOperacional?: 'smartpos' | 'cardapio' | 'caixa' | 'garcom' | 'desconhecida';
  /** Quando o card representa um lote específico, mantém o id real do lançamento. */
  lancamentoId?: string;
  clienteId?: string | null;
  clientePhone?: string | null;
  mesaId: number;
  garcomId: string;
  garcomNome: string;
  timestamp: number; // Order creation time
  itens: OrderItem[];
  /** Alias legado ainda aceito em alguns componentes durante a normalização. */
  items?: OrderItem[];
  tipo?: 'Consumo no Local' | 'Retirada' | 'Entrega'; // Order type
  valorPago?: number;
  identificador?: string;
  statusComanda?: 'aguardando_pagamento' | null; // Adicionado para compatibilidade com o fluxo do caixa
  deliveryStatus?: 'pendente' | 'producao' | 'pronto' | 'transito' | 'finalizado' | 'recusado' | null;
  mesaOrigemId?: number | null;
  mesaTransferidaDe?: number | null;
  isGrouped?: boolean;
  originalOrders?: any[];
  created_at?: string;
  status?: string;
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
  numero?: number;
  status?: string;
}

export interface Waiter {
  id: string;
  nome: string;
}

export type AppRole = 'garcom' | 'caixa' | 'gerente' | 'cozinha' | 'admin';

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
  usuario_id?: string | null;
  usuario_nome?: string | null;
  tipo: 'suprimento' | 'sangria' | string;
  valor: number;
  saldo_anterior?: number;
  saldo_posterior?: number;
  descricao: string;
  observacao?: string;
  criado_em: string;
}

export interface CaixaAtividadeRecente {
  id: string;
  tipo: 'recebimento' | 'suprimento' | 'sangria' | string;
  valor: number;
  metodo?: string | null;
  origem: string;
  descricao: string;
  operador_nome?: string | null;
  criado_em: string;
}

export interface CaixaTurnoResumo {
  turno_id?: number | null;
  status: 'aberto' | 'fechado' | 'sem_turno' | string;
  operador_id?: string | null;
  operador_nome?: string | null;
  aberto_em?: string | null;
  tempo_aberto_minutos: number;
  turno_esquecido?: boolean;
  saldo_inicial: number;
  total_vendas: number;
  total_dinheiro: number;
  total_pix: number;
  total_cartao: number;
  total_sangrias: number;
  total_suprimentos: number;
  saldo_esperado_dinheiro: number;
  total_pedidos_pagos: number;
  atividades_recentes?: CaixaAtividadeRecente[];
  comandas_abertas_count?: number;
  ultima_movimentacao?: {
    id: number;
    tipo: string;
    valor: number;
    descricao: string;
    criado_em?: string;
    operador_nome?: string;
  } | null;
  resumo_dia?: {
    total_vendas: number;
    pedidos_pagos: number;
  } | null;
}

export interface FechamentoCaixaResult {
  turno_id: number;
  status: 'fechado' | string;
  fechado_em: string;
  fechado_por_nome: string;
  declarado_dinheiro: number;
  esperado_dinheiro: number;
  diferenca_dinheiro: number;
  declarado_cartao: number;
  esperado_cartao: number;
  diferenca_cartao: number;
  declarado_pix: number;
  esperado_pix: number;
  diferenca_pix: number;
  total_declarado: number;
  total_esperado: number;
  diferenca_total: number;
}

export interface Pagamento {
  id: string;
  comanda_id: string;
  turno_id: number;
  valor: number;
  metodo: 'dinheiro' | 'pix' | 'cartao';
  criado_em: string;
}

export interface Courier {
  id: number;
  nome: string;
  telefone: string;
  placa: string;
  status: 'disponivel' | 'em_entrega' | 'indisponivel';
  corridas: number;
}

export interface AccountItem {
  id: number;
  descricao: string;
  valor: number;
  vencimento: string;
  status: 'pago' | 'pendente' | 'atrasado';
  tipo: 'pagar' | 'receber';
}

export interface SimulatedDeliveryOrder {
  id: string;
  cliente: string;
  telefone: string;
  itens: string;
  total: number;
  canal: 'ifood' | 'site' | 'whats';
  status: 'pendente' | 'analise' | 'producao' | 'pronto' | 'transito';
  endereco?: string;
  criadoEm: string;
  pagoOnline?: boolean;
  mesaId?: number;
}

export interface SystemUser {
  id: string;
  nome: string;
  telefone?: string;
  cargo?: string;
  usuario?: string;
  role?: string;
  status?: 'pendente_ativacao' | 'ativo' | 'inativo' | string;
  created_at?: string;
  token_convite?: string;
}

export interface BotChatMessage {
  sender: 'user' | 'bot';
  text: string;
  timestamp: string;
}

export interface Motoboy {
  id: number;
  nome: string;
  telefone: string;
  ativo: boolean;
}

export interface PdvCartItem {
  product: Product;
  quantity: number;
  obs: string;
  client: string;
}

export interface Insumo {
  id: string;
  nome: string;
  estoque_atual: number;
  estoque_minimo: number;
  estoque_maximo: number;
  unidade_medida: string;
  preco_medio_custo: number;
}

export interface Distribuidor {
  id: string;
  nome_fantasia: string;
  razao_social?: string | null;
  cnpj?: string | null;
  lead_time_dias: number;
}

export interface ItemEntradaEstoque {
  id?: number;
  entrada_id?: string;
  insumo_id: string;
  quantidade: number;
  unidade_medida: string;
  custo_unitario: number;
  subtotal: number;
  insumo?: Insumo;
}

export interface EntradaEstoque {
  id: string;
  numero_documento?: string | null;
  data_emissao?: string | null;
  observacao: string;
  valor_total: number;
  tipo_entrada: 'MANUAL' | 'XML' | string;
  distribuidor_id?: string | null;
  distribuidor?: Distribuidor | null;
  created_at: string;
  itens: ItemEntradaEstoque[];
}

export interface MovimentacaoEstoque {
  id: number;
  insumo_id: string;
  tipo: 'entrada' | 'saida' | 'perda' | 'ajuste_positivo' | 'ajuste_negativo' | 'contagem';
  quantidade: number;
  saldo_anterior: number;
  saldo_posterior: number;
  custo_unitario: number;
  motivo: string;
  observacao: string;
  origem: string;
  referencia_id?: string | null;
  usuario_id?: string | null;
  created_at: string;
  insumo?: Insumo;
}

export interface ItemContagemEstoque {
  id?: number;
  contagem_id?: string;
  insumo_id: string;
  quantidade_sistema: number;
  quantidade_contada: number;
  diferenca: number;
  ajustado?: boolean;
  insumo?: Insumo;
}

export interface SessaoContagemEstoque {
  id: string;
  status: 'rascunho' | 'confirmada';
  observacao: string;
  usuario_id?: string | null;
  created_at: string;
  confirmada_em?: string | null;
  itens: ItemContagemEstoque[];
}
