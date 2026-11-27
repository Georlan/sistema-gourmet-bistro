/**
 * Contratos HTTP e tipos compartilhados do B8 Finance & Production Engine.
 * Fonte de verdade: backend/app/routes/b8_finance.py e backend/app/routes/b8_supply.py.
 */

export interface B8FinanceCategoria {
  id: string;
  codigo: string;
  nome: string;
  tipo: string;
  sistema: boolean;
}

export interface B8FinanceConta {
  id: string;
  nome: string;
  tipo: string;
  saldo_inicial: number;
  padrao: boolean;
}

export interface B8FinanceSetup {
  categorias: B8FinanceCategoria[];
  contas: B8FinanceConta[];
}

export interface B8ContaPagarParcela {
  id: string;
  numero_parcela: number;
  data_vencimento: string;
  valor_parcela: number;
  juros: number;
  desconto: number;
  ajuste: number;
  valor_pago: number;
  saldo_aberto: number;
  status: string;
}

export interface B8ContaPagar {
  id: string;
  categoria_id: string | null;
  distribuidor_id: string | null;
  favorecido_nome: string;
  descricao: string;
  numero_documento: string | null;
  data_emissao: string;
  data_competencia: string;
  valor_original: number;
  total_parcelas: number;
  status: string;
  observacao: string;
  parcelas: B8ContaPagarParcela[];
}

export interface B8ContaReceber {
  id: string;
  categoria_id: string | null;
  origem_tipo: string;
  origem_id: string | null;
  contraparte_nome: string;
  descricao: string;
  data_competencia: string;
  data_vencimento: string;
  valor_previsto: number;
  valor_recebido: number;
  saldo_aberto: number;
  tipo_confirmacao: string;
  status: string;
}

export interface B8Recorrencia {
  id: string;
  categoria_id: string;
  favorecido_nome: string;
  descricao: string;
  valor_previsto: number;
  dia_vencimento: number;
  periodicidade: string;
  ultima_competencia_gerada: string | null;
}

export interface B8Movimentacao {
  id: string;
  conta_financeira_id: string;
  categoria_id: string | null;
  tipo: string;
  origem_tipo: string;
  data_movimento: string;
  valor: number;
  descricao: string;
}

export interface B8DreResponse {
  regime: string;
  periodo: { data_inicio: string; data_fim: string };
  status_completude: 'completo' | 'parcial';
  lacunas: string[];
  linhas: {
    receita_bruta: number;
    receita_vendas_operacionais: number;
    receitas_extras: number;
    deducoes_descontos: number;
    deducoes_estornos: number;
    deducoes_total: number;
    receita_liquida: number;
    cmv: number;
    lucro_bruto: number;
    margem_bruta_pct: number | null;
    despesas_operacionais: number;
    tributos: number;
    resultado_operacional: number;
    resultado_financeiro: number;
    resultado_liquido_gerencial: number;
    margem_liquida_pct: number | null;
  };
  cobertura_cmv: {
    itens_totais: number;
    itens_com_custo: number;
    itens_sem_custo: number;
    cobertura_pct: number;
  };
  despesas_por_categoria: Array<{ categoria: string; tipo: string; valor: number }>;
}

export interface B8FluxoCaixaResponse {
  regime: string;
  periodo: { data_inicio: string; data_fim: string };
  saldo_inicial: number;
  entradas_realizadas: number;
  entradas_operacionais_pdv: number;
  entradas_operacionais_por_meio: { dinheiro: number; pix: number; cartao: number };
  aviso_cartao: string | null;
  entradas_financeiras: number;
  saidas_realizadas: number;
  saldo_final_realizado: number;
  entradas_previstas: number;
  saidas_previstas: number;
  saldo_projetado: number;
  contas: B8FinanceConta[];
  movimentacoes: Array<{
    id: string;
    data: string;
    tipo: string;
    valor: number;
    descricao: string;
    origem_tipo: string;
    conta_financeira_id: string;
  }>;
  vencimentos_futuros: Array<{
    tipo: 'pagar' | 'receber';
    id: string;
    conta_pagar_id?: string;
    descricao: string;
    favorecido?: string;
    contraparte?: string;
    data_vencimento: string;
    valor_aberto: number;
    tipo_confirmacao?: string;
    atrasado: boolean;
  }>;
}

export interface B8SubReceita {
  id: string;
  nome: string;
  unidade_rendimento: string;
  rendimento_esperado: number;
  insumo_saida_id: string | null;
  custo_unitario_estimado: number | null;
  custo_completo: boolean;
  motivo_custo_incompleto: string | null;
  ingredientes: Array<{
    insumo_id: string | null;
    sub_receita_filha_id: string | null;
    quantidade: number;
    unidade_medida: string;
    perda_tecnica_pct: number;
  }>;
}

export interface B8OrdemProducao {
  id: string;
  sub_receita_id: string;
  sub_receita_nome: string | null;
  quantidade_planejada: number;
  quantidade_produzida: number;
  perda_producao: number;
  custo_total_real: number | null;
  custo_unitario_real: number | null;
  status: string;
  data_producao: string | null;
}

export interface B8BuffetLote {
  id: string;
  data_operacional: string;
  nome_preparacao: string;
  unidade_medida: string;
  quantidade_produzida: number;
  quantidade_reposicao: number;
  sobra: number;
  descarte: number;
  custo_lote: number | null;
  observacao: string;
}

export interface B8PedidoCompraItem {
  id: number;
  insumo_id: string;
  quantidade_pedida: number;
  quantidade_recebida: number;
  fator_conversao: number;
  preco_unitario_previsto: number;
}

export interface B8PedidoCompra {
  id: string;
  distribuidor_id: string;
  fornecedor_nome: string | null;
  numero_pedido: string | null;
  data_emissao: string;
  data_entrega_prevista: string | null;
  status: string;
  valor_total_previsto: number;
  itens: B8PedidoCompraItem[];
}

export interface B8LoteEstoque {
  id: string;
  insumo_id: string;
  insumo_nome: string | null;
  codigo_lote: string | null;
  data_entrada: string;
  data_validade: string | null;
  quantidade_inicial: number;
  quantidade_disponivel: number;
  custo_unitario: number;
  origem_tipo: string;
  status: string;
}

export interface B8PerdaEstoque {
  id: string;
  insumo_id: string;
  insumo_nome: string | null;
  quantidade: number;
  custo_unitario: number;
  custo_estimado: number | null;
  categoria_perda: string;
  observacao: string;
  created_at: string | null;
}

export interface B8XmlPreviewResponse {
  chave_acesso: string;
  duplicada: boolean;
  numero_nota: string;
  data_emissao: string | null;
  fornecedor_nome: string;
  fornecedor_cnpj: string;
  valor_total: number;
  itens: Array<{
    codigo_fornecedor: string;
    descricao_fornecedor: string;
    unidade_compra: string;
    quantidade_compra: number;
    valor_unitario_compra: number;
    insumo_id: string | null;
    fator_conversao: number;
    mapeado: boolean;
  }>;
}

export interface B8OpcaoModificador {
  id: string;
  nome: string;
  grupo_id: string;
  grupo_nome: string;
  preco: number;
}

export interface B8CustoProduto {
  produto_id: string;
  nome: string;
  preco_venda: number;
  custo_unitario: number | null;
  custo_completo: boolean;
  margem_contribuicao_reais: number | null;
  margem_contribuicao_pct: number | null;
  motivo_incompleto: string | null;
}
