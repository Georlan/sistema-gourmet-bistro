/**
 * Contrato do relatório de consumo de complementos (`GET /relatorios/complementos`).
 * Agregação acontece no backend; aqui só normalizamos, ordenamos e filtramos o
 * resultado já agregado (dezenas de linhas), nunca pedidos brutos.
 */

export type ModifierConsumptionOption = {
  opcao_id: string;
  opcao_nome: string;
  quantidade: number;
  /** Participação dentro do grupo. `null` = não calculável (grupo sem seleções). */
  participacao_pct: number | null;
  /** `null` quando a opção não existe mais no cadastro (estado desconhecido). */
  ativa: boolean | null;
  arquivada: boolean | null;
  opcao_origem_id: string | null;
  cadastrada: boolean;
};

export type ModifierConsumptionGroup = {
  grupo_id: string;
  grupo_nome: string;
  grupo_origem_id: string | null;
  arquivado: boolean;
  total_selecoes: number;
  /** Média de seleções deste grupo por unidade vendida do produto (quando produto_id está selecionado). */
  media_selecoes_por_unidade?: number | null;
  opcoes_com_saida: number;
  opcoes_sem_saida: number;
  opcoes: ModifierConsumptionOption[];
};

export type ModifierConsumptionMixRow = {
  produto_id: string;
  grupo_id: string;
  opcao_id: string;
  quantidade: number;
  product_units?: number;
  group_total_selections?: number;
  avg_selections_per_product_unit?: number | null;
};

export type ModifierConsumptionMixSummaryRow = {
  produto_id: string;
  grupo_id: string;
  product_units: number;
  group_total_selections: number;
  avg_selections_per_product_unit: number | null;
};

export type ModifierConsumptionReport = {
  inicio: string;
  fim: string;
  fonte: string;
  produto_id: string | null;
  produto_nome: string | null;
  unidades_produto: number;
  total_selecoes: number;
  selecoes_sem_cadastro: number;
  grupos: ModifierConsumptionGroup[];
  produtos: { produto_id: string; produto_nome: string; unidades: number; product_units: number }[];
  /** produto → grupo → opção → quantidade; base do futuro custo médio ponderado. */
  mix_por_produto: ModifierConsumptionMixRow[];
  /** resumo produto × grupo com denominador product_units. */
  mix_resumo: ModifierConsumptionMixSummaryRow[];
};

export type ModifierConsumptionOrder = 'mais' | 'menos' | 'todos';

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const nullableNum = (value: unknown) => (value == null ? null : num(value));
const nullableBool = (value: unknown) => (value == null ? null : Boolean(value));

export function normalizeModifierConsumption(raw: any): ModifierConsumptionReport {
  return {
    inicio: String(raw?.inicio ?? ''),
    fim: String(raw?.fim ?? ''),
    fonte: String(raw?.fonte ?? ''),
    produto_id: raw?.produto_id == null ? null : String(raw.produto_id),
    produto_nome: raw?.produto_nome == null ? null : String(raw.produto_nome),
    unidades_produto: num(raw?.unidades_produto),
    total_selecoes: num(raw?.total_selecoes),
    selecoes_sem_cadastro: num(raw?.selecoes_sem_cadastro),
    grupos: (Array.isArray(raw?.grupos) ? raw.grupos : []).map((g: any) => ({
      grupo_id: String(g.grupo_id),
      grupo_nome: String(g.grupo_nome ?? ''),
      grupo_origem_id: g.grupo_origem_id == null ? null : String(g.grupo_origem_id),
      arquivado: Boolean(g.arquivado),
      total_selecoes: num(g.total_selecoes),
      media_selecoes_por_unidade: nullableNum(g.media_selecoes_por_unidade),
      opcoes_com_saida: num(g.opcoes_com_saida),
      opcoes_sem_saida: num(g.opcoes_sem_saida),
      opcoes: (Array.isArray(g.opcoes) ? g.opcoes : []).map((o: any) => ({
        opcao_id: String(o.opcao_id),
        opcao_nome: String(o.opcao_nome ?? ''),
        quantidade: num(o.quantidade),
        participacao_pct: nullableNum(o.participacao_pct),
        ativa: nullableBool(o.ativa),
        arquivada: nullableBool(o.arquivada),
        opcao_origem_id: o.opcao_origem_id == null ? null : String(o.opcao_origem_id),
        cadastrada: o.cadastrada !== false,
      })),
    })),
    produtos: (Array.isArray(raw?.produtos) ? raw.produtos : []).map((p: any) => ({
      produto_id: String(p.produto_id),
      produto_nome: String(p.produto_nome ?? ''),
      unidades: num(p.unidades ?? p.product_units),
      product_units: num(p.product_units ?? p.unidades),
    })),
    mix_por_produto: (Array.isArray(raw?.mix_por_produto) ? raw.mix_por_produto : []).map((m: any) => ({
      produto_id: String(m.produto_id),
      grupo_id: String(m.grupo_id),
      opcao_id: String(m.opcao_id),
      quantidade: num(m.quantidade),
      product_units: num(m.product_units),
      group_total_selections: num(m.group_total_selections),
      avg_selections_per_product_unit: nullableNum(m.avg_selections_per_product_unit),
    })),
    mix_resumo: (Array.isArray(raw?.mix_resumo) ? raw.mix_resumo : []).map((r: any) => ({
      produto_id: String(r.produto_id),
      grupo_id: String(r.grupo_id),
      product_units: num(r.product_units),
      group_total_selections: num(r.group_total_selections),
      avg_selections_per_product_unit: nullableNum(r.avg_selections_per_product_unit),
    })),
  };
}

const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

/** Ordena/filtra opções de um grupo. "Todos" = ordem alfabética, incluindo opções sem saída. */
export function arrangeOptions(options: readonly ModifierConsumptionOption[], order: ModifierConsumptionOrder, search = '') {
  const term = fold(search.trim());
  const filtered = term ? options.filter((o) => fold(o.opcao_nome).includes(term)) : [...options];
  const byName = (a: ModifierConsumptionOption, b: ModifierConsumptionOption) => a.opcao_nome.localeCompare(b.opcao_nome, 'pt-BR');
  if (order === 'mais') return filtered.sort((a, b) => b.quantidade - a.quantidade || byName(a, b));
  if (order === 'menos') return filtered.sort((a, b) => a.quantidade - b.quantidade || byName(a, b));
  return filtered.sort(byName);
}

export type ModifierConsumptionSummary = {
  totalSelections: number;
  optionsWithOutput: number;
  topGroup: { name: string; total: number } | null;
  activeWithoutOutput: number;
};

export function summarizeModifierConsumption(report: ModifierConsumptionReport): ModifierConsumptionSummary {
  const groups = report.grupos;
  const top = groups.reduce<ModifierConsumptionGroup | null>((best, g) => (g.total_selecoes > (best?.total_selecoes ?? 0) ? g : best), null);
  return {
    totalSelections: report.total_selecoes,
    optionsWithOutput: groups.reduce((sum, g) => sum + g.opcoes_com_saida, 0),
    topGroup: top ? { name: top.grupo_nome, total: top.total_selecoes } : null,
    // Só opções ativas hoje: pausadas sem saída não indicam baixa preferência.
    activeWithoutOutput: groups.reduce((sum, g) => sum + g.opcoes.filter((o) => o.quantidade === 0 && o.ativa === true).length, 0),
  };
}

export function formatShare(value: number | null) {
  return value == null ? '—' : `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
