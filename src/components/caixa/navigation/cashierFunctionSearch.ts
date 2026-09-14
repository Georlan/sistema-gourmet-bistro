import type { CashierSettingsTab } from '../settings/cashierSettingsNavigation';
import type { CashierNavigationGroup } from './cashierNavigation';

export type CashierFunctionSearchEntry = {
  id: string;
  label: string;
  context: string;
  navigationId: string;
  settingsTab?: CashierSettingsTab;
  aliases?: readonly string[];
};

const NAVIGATION_ALIASES: Readonly<Record<string, readonly string[]>> = {
  vendas_pedidos: ['fila', 'fila de pedidos'],
  vendas_novo_pedido: ['pdv', 'balcao', 'balcão', 'comanda', 'abrir pedido'],
  vendas_salao: ['atendimento salao', 'atendimento salão'],
  vendas_cozinha: ['kds', 'producao', 'produção'],
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
  online_loja: ['loja online', 'perfil cardapio', 'perfil cardápio', 'marca cardapio', 'marca cardápio'],
  online_operacao: ['pedidos online', 'entrega online', 'pagamentos online', 'delivery online'],
  online_divulgacao: ['qr code', 'qrcode', 'link cardapio', 'link cardápio'],
  relatorios: ['dashboard', 'indicadores', 'faturamento', 'dre', 'fluxo de caixa', 'mais vendidos'],
  permissoes_cargos: ['equipe', 'funcionarios', 'funcionários', 'cargos', 'permissoes', 'permissões'],
  config_operacao: ['configuracao', 'configuração', 'preferencias', 'preferências'],
  config_integracoes: ['integracao', 'integração', 'integracoes', 'integrações', 'mercado pago', 'pix', 'oauth'],
  assinatura_pix: ['plano', 'planos', 'assinatura', 'cobranca', 'cobrança'],
};

const SETTINGS_DEEP_LINKS: readonly CashierFunctionSearchEntry[] = [
  {
    id: 'settings_aparencia',
    label: 'Aparência',
    context: 'Configurações › Neste dispositivo',
    navigationId: 'config_operacao',
    settingsTab: 'aparencia',
    aliases: ['tema', 'tema claro', 'tema escuro', 'fonte', 'tamanho do texto', 'texto grande'],
  },
  {
    id: 'settings_impressao',
    label: 'Impressão',
    context: 'Configurações › Neste dispositivo',
    navigationId: 'config_operacao',
    settingsTab: 'impressao',
    aliases: ['impressora', 'impressoras', 'cupom', 'fila impressao', 'fila impressão', 'teste impressora'],
  },
  {
    id: 'settings_mesas',
    label: 'Mesas',
    context: 'Configurações › Operação do salão',
    navigationId: 'config_operacao',
    settingsTab: 'mesas',
    aliases: ['cadastro mesas', 'capacidade mesa', 'nomes mesas'],
  },
  {
    id: 'settings_garcom',
    label: 'App do Garçom',
    context: 'Configurações › Operação do salão',
    navigationId: 'config_operacao',
    settingsTab: 'garcom',
    aliases: ['garcom', 'garçom', 'garcons', 'garçons', 'atendente', 'atendimento', 'app garcom', 'app garçom'],
  },
  {
    id: 'settings_taxa',
    label: 'Taxa de Serviço',
    context: 'Configurações › Operação do salão',
    navigationId: 'config_operacao',
    settingsTab: 'taxa',
    aliases: ['taxa servico', 'taxa serviço', 'gorjeta', 'percentual servico', 'percentual serviço', '10%'],
  },
];

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

  return [...SETTINGS_DEEP_LINKS, ...navigationEntries];
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
