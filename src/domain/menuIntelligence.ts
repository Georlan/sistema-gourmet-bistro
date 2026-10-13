export type MenuQuadrant = 'estrela' | 'enigma' | 'cavalo_batalha' | 'baixo_desempenho';
export type MenuSignal = { tipo: string; titulo: string; motivo: string };
export interface MenuProduct {
  produto_id: string; nome: string; categoria: string; categoria_id?: string; ativo: boolean;
  unidades: number; unidades_anteriores: number; variacao_pct: number | null; participacao_pct: number;
  valor_consumo?: number; valor_consumo_anterior?: number; preco_medio: number | null;
  preco_cardapio: number; custo_unitario: number | null; margem_unitaria_cardapio: number | null;
  margem_pct_cardapio: number | null; sugestoes: MenuSignal[];
  unidades_com_modificadores?: number; unidades_cobertas?: number; unidades_anteriores_cobertas?: number;
  valor_coberto?: number; cobertura_custo_pct?: number | null; custo_total_estimado?: number | null;
  contribuicao_estimada?: number | null; contribuicao_anterior_estimada?: number | null;
  margem_unitaria_observada?: number | null; cmv_pct_estimado?: number | null;
  classificacao?: MenuQuadrant | null; classificacao_provisoria?: boolean; motivo_classificacao?: string; participacao_categoria_pct?: number | null;
}
export interface MenuCategory {
  categoria_id: string; nome: string; produtos_comparaveis: number; unidades: number;
  pedidos_distintos: number; unidades_cobertas: number; cobertura_custo_pct: number | null;
  contribuicao_estimada: number | null; limite_popularidade_pct: number; limite_margem_unitaria: number | null;
  triagem_disponivel: boolean; cobertura_completa: boolean;
}
export interface MenuOpportunity extends MenuSignal {
  produto_id: string; produto_nome: string; unidades: number; unidades_anteriores: number;
  contribuicao_estimada: number | null; cobertura_custo_pct: number | null;
}
export interface MenuReport {
  schema_version?: number; metodo_version?: string; base_custo?: string; timezone?: string;
  inicio?: string; fim?: string; inicio_anterior: string; fim_anterior: string; unidades: number;
  produtos: MenuProduct[]; categorias?: MenuCategory[]; oportunidades?: MenuOpportunity[];
  resumo?: {
    valor_itens: number; valor_itens_anterior: number; unidades_anteriores: number;
    unidades_cobertas: number; unidades_anteriores_cobertas: number; cobertura_custo_pct: number | null;
    custo_total_estimado: number | null; contribuicao_estimada: number | null;
    contribuicao_anterior_estimada: number | null; cmv_pct_estimado: number | null;
  };
}
export interface MenuSimulationInput {
  preco_atual: string; custo_atual: string; quantidade_atual: number;
  preco_proposto: string; custo_proposto: string; despesa_variavel_unitaria: string;
  gasto_acao: string; quantidades: [number, number, number];
}
export interface MenuSimulationResult {
  margem_atual: number; margem_proposta: number; contribuicao_referencia: number;
  unidades_para_preservar: number | null; unidades_para_superar: number | null;
  vendas_que_pode_perder: number | null; vendas_adicionais_necessarias: number | null;
  cenarios: { quantidade: number; contribuicao: number; diferenca: number }[]; avisos: string[];
}
export const menuMoney = (value: number | null | undefined) => value == null ? 'Não calculado' : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const menuPercent = (value: number | null | undefined) => value == null ? 'Não calculado' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
export const quadrantLabels: Record<MenuQuadrant, string> = {
  estrela: 'Estrela', enigma: 'Enigma', cavalo_batalha: 'Cavalo de batalha', baixo_desempenho: 'Baixo desempenho',
};
export const quadrantClasses: Record<MenuQuadrant, string> = {
  estrela: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  enigma: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  cavalo_batalha: 'bg-amber-500/10 text-amber-800 dark:text-amber-300',
  baixo_desempenho: 'bg-koma-raised text-koma-muted',
};

// Convert typed money inputs without silently accepting exponents/NaN or empty cost as zero.
export function simulationMoneyInput(value: string): string | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized) || Number(normalized) > 1_000_000) return null;
  return Number(normalized).toFixed(2);
}
export function simulationQuantityInput(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const qty = Number(value);
  return Number.isSafeInteger(qty) && qty <= 1_000_000 ? qty : null;
}

const csvText = (value: string) => `"${(/^\s*[=+\-@]|^[\t\r]/.test(value) ? "'" : '') + value.replace(/"/g, '""')}"`;
export function menuReportCsv(report: MenuReport, inicio: string, fim: string): string {
  const number = (value: number | null | undefined) => value == null ? '' : String(value).replace('.', ',');
  return '\uFEFF' + [
    `Inteligência do Cardápio;${inicio};${fim}`,
    'Base;Unidades pedidas por entrada. Consumo não é recebimento.',
    'Custo;Ingredientes atuais cadastrados nas unidades sem modificadores. Não é lucro histórico.',
    `Método;${csvText(report.metodo_version || 'relatorio_basico')}`,
    'Produto;Categoria;Unidades;Unidades anteriores;Valor dos itens;Unidades cobertas;Custo estimado;Contribuição estimada;CMV estimado (%);Classificação',
    ...report.produtos.map(p => [csvText(p.nome), csvText(p.categoria), p.unidades, p.unidades_anteriores,
      number(p.valor_consumo), number(p.unidades_cobertas), number(p.custo_total_estimado),
      number(p.contribuicao_estimada), number(p.cmv_pct_estimado), csvText(p.classificacao ? quadrantLabels[p.classificacao] : 'Não classificável')].join(';')),
  ].join('\n');
}
