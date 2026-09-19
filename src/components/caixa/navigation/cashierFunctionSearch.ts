import type { CashierNavigationGroup } from './cashierNavigation';

export type CashierFunctionSearchEntry = {
  id: string;
  label: string;
  context: string;
  navigationId: string;
  aliases?: readonly string[];
};

const NAVIGATION_ALIASES: Readonly<Record<string, readonly string[]>> = {
  vendas_pedidos: ['fila', 'fila de pedidos'],
  vendas_novo_pedido: ['pdv', 'balcao', 'balcão', 'comanda', 'abrir pedido'],
  vendas_salao: ['atendimento salao', 'atendimento salão'],
  vendas_cozinha: ['kds', 'producao', 'produção'],
  vendas_retiradas: ['retirada', 'retiradas', 'pickup', 'pedido para retirar', 'retirar pedido', 'balcao retirada', 'balcão retirada'],
  vendas_entregas: ['delivery', 'motoboy', 'entregador', 'entregadores'],
  caixa_turno_atual: ['abrir caixa', 'caixa aberto', 'caixa fechado'],
  caixa_movimentacoes: ['sangria', 'suprimento', 'retirada caixa', 'entrada caixa', 'ajuste caixa'],
  caixa_fechamento: ['fechar caixa', 'conferencia', 'conferência', 'conferencia cega', 'conferência cega'],
  cardapio_produtos: ['produto', 'produtos', 'prato', 'pratos', 'item', 'itens'],
  cardapio_complementos: ['adicional', 'adicionais', 'modificador', 'modificadores'],
  cardapio_preparo: ['categoria', 'categorias', 'preparo', 'impressao cozinha', 'impressão cozinha'],
  estoque_ingredientes: ['insumo', 'insumos', 'ingrediente', 'ingredientes'],
  estoque_historico: ['entrada estoque', 'compras', 'nota entrada', 'notas entrada', 'xml'],
  estoque_inventario: ['contagem', 'inventario', 'inventário'],
  estoque_fornecedores: ['fornecedor', 'fornecedores', 'distribuidor', 'distribuidores'],
  clientes: ['crm', 'cadastro cliente', 'cadastro clientes'],
  online_perfil: ['loja online', 'perfil cardapio', 'perfil cardápio', 'dados restaurante online'],
  online_marca: ['marca cardapio', 'marca cardápio', 'logo cardapio', 'banner cardapio'],
  online_pedidos: ['pedidos online', 'horario', 'horários', 'pedidos agendados'],
  online_bloqueios: ['clientes bloqueados', 'bloqueio cliente', 'desbloquear cliente', 'historico bloqueios', 'histórico bloqueios'],
  online_entrega: ['entrega online', 'delivery online', 'taxa de entrega', 'valor por km', 'frete', 'ponto de partida'],
  online_pagamentos: ['pagamentos online', 'formas de pagamento', 'pix cardapio', 'dinheiro cardapio'],
  online_divulgacao: ['qr code', 'qrcode', 'link cardapio', 'link cardápio'],
  relatorios: ['dashboard', 'indicadores', 'faturamento'],
  relatorios_visao_geral: ['dashboard', 'indicadores', 'visao geral', 'visão geral', 'faturamento'],
  relatorios_financeiro: ['dre', 'fluxo de caixa', 'recebimentos', 'financeiro'],
  relatorios_produtos: ['mais vendidos', 'top produtos', 'cmv', 'produtos'],
  relatorios_equipe: ['desempenho equipe', 'garcom', 'garçom', 'equipe'],
  permissoes_cargos: ['equipe'],
  equipe_pessoas: ['pessoas', 'funcionarios', 'funcionários', 'colaboradores', 'convites'],
  equipe_funcoes_acessos: ['funcoes', 'funções', 'acessos', 'cargos', 'permissoes', 'permissões'],
  impressao_salao: ['configuracao', 'configuração', 'preferencias', 'preferências'],
  config_aparencia: ['tema', 'tema claro', 'tema escuro', 'fonte', 'tamanho do texto', 'texto grande'],
  config_impressao: ['impressora', 'impressoras', 'cupom', 'fila impressao', 'fila impressão', 'teste impressora'],
  config_mesas: ['cadastro mesas', 'capacidade mesa', 'nomes mesas'],
  config_garcom: ['garcom', 'garçom', 'garcons', 'garçons', 'atendente', 'atendimento', 'app garcom', 'app garçom'],
  config_taxa: ['taxa servico', 'taxa serviço', 'gorjeta', 'percentual servico', 'percentual serviço', '10%'],
  config_implantacao: ['implantacao', 'implantação', 'ativacao', 'ativação', 'primeiro acesso', 'onboarding'],
  config_integracoes: ['integracao', 'integração', 'integracoes', 'integrações', 'mercado pago', 'pix', 'oauth'],
  assinatura_pix: ['assinatura', 'cobranca', 'cobrança', 'conta assinatura'],
  assinatura_meu_plano: ['meu plano', 'plano atual', 'assinatura atual'],
  assinatura_planos_upgrade: ['planos', 'upgrade', 'comparar planos', 'mudar plano'],
  assinatura_contrato_documentos: ['contrato', 'documentos', 'comprovante', 'termos'],
};

export function normalizeCashierFunctionSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function labelTokens(value: string): string[] {
  return normalizeCashierFunctionSearch(value).split(' ').filter(Boolean);
}

function scoreEntry(entry: CashierFunctionSearchEntry, normalizedQuery: string): number | null {
  if (!normalizedQuery) return null;

  const label = normalizeCashierFunctionSearch(entry.label);
  const context = normalizeCashierFunctionSearch(entry.context);
  const aliases = (entry.aliases ?? []).map(normalizeCashierFunctionSearch);
  const labelWords = labelTokens(entry.label);

  if (label === normalizedQuery) return 1200;
  if (aliases.includes(normalizedQuery)) return 1150;
  if (label.startsWith(normalizedQuery)) return 1050;
  if (labelWords.includes(normalizedQuery)) return 1000;
  if (aliases.some((alias) => alias.startsWith(normalizedQuery))) return 950;
  if (label.includes(normalizedQuery)) return 900;
  if (aliases.some((alias) => alias.includes(normalizedQuery))) return 850;

  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  const searchable = [label, context, ...aliases].join(' ');
  if (queryTokens.every((token) => searchable.includes(token))) {
    const labelHits = queryTokens.filter((token) => label.includes(token)).length;
    const aliasHits = queryTokens.filter((token) => aliases.some((alias) => alias.includes(token))).length;
    return 600 + (labelHits * 40) + (aliasHits * 20);
  }

  return null;
}

export function buildCashierFunctionSearchEntries(
  groups: readonly CashierNavigationGroup[],
  hasOnlineMenu: boolean,
): CashierFunctionSearchEntry[] {
  const navigationEntries = groups.flatMap((group) =>
    group.items.flatMap((item) => {
      if (item.capability === 'online-menu' && !hasOnlineMenu) return [];

      const parent: CashierFunctionSearchEntry = {
        id: item.id,
        label: item.label,
        context: group.category,
        navigationId: item.id,
        aliases: NAVIGATION_ALIASES[item.id],
      };
      const children = (item.children ?? []).map<CashierFunctionSearchEntry>((child) => ({
        id: child.id,
        label: child.label,
        context: `${group.category} › ${item.label}`,
        navigationId: child.id,
        aliases: NAVIGATION_ALIASES[child.id],
      }));

      return [parent, ...children];
    }),
  );

  return navigationEntries;
}

export function searchCashierFunctions(
  entries: readonly CashierFunctionSearchEntry[],
  query: string,
  limit = 7,
): CashierFunctionSearchEntry[] {
  const normalizedQuery = normalizeCashierFunctionSearch(query);
  if (!normalizedQuery) return [];

  return entries
    .map((entry) => ({ entry, score: scoreEntry(entry, normalizedQuery) }))
    .filter((candidate): candidate is { entry: CashierFunctionSearchEntry; score: number } => candidate.score !== null)
    .sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label, 'pt-BR'))
    .slice(0, limit)
    .map(({ entry }) => entry);
}
