import {
  ClipboardList,
  CreditCard,
  DollarSign,
  Globe,
  Package,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { CashierTab } from '../cashierContracts';
import type { SubscriptionPlanId } from '../../../config/subscriptionPlans';

export type CashierNavigationTarget = {
  tab: CashierTab;
  subTab: string;
};

export type CashierNavigationAction = 'open-counter';

export type CashierNavigationChild = {
  id: string;
  label: string;
  target: CashierNavigationTarget;
  action?: CashierNavigationAction;
  badge?: 'orders';
  plans?: readonly SubscriptionPlanId[];
};

export type CashierNavigationItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  target: CashierNavigationTarget;
  capability?: 'online-menu';
  plans?: readonly SubscriptionPlanId[];
  children?: readonly CashierNavigationChild[];
};

export type CashierNavigationGroup = {
  category: 'Operação' | 'Cadastros' | 'Vendas online' | 'Gestão' | 'Sistema';
  items: readonly CashierNavigationItem[];
};

/**
 * Navigation Tree v2.
 *
 * This catalog owns information architecture, default destinations and the
 * semantic action required before a route transition. Desktop, mobile and
 * future command-palette/breadcrumb presentations consume the same tree.
 *
 * Keep parent IDs compatible with the existing CashierTab contract while the
 * internal views migrate independently. Child IDs are stable navigation IDs;
 * their targets continue to use the existing tab/subtab screen owners.
 */
export const CASHIER_SIDEBAR_GROUPS: readonly CashierNavigationGroup[] = [
  {
    category: 'Operação',
    items: [
      {
        id: 'operacao',
        label: 'Vendas',
        icon: ShoppingCart,
        target: { tab: 'operacao', subTab: 'pedidos' },
        children: [
          { id: 'vendas_pedidos', label: 'Pedidos', target: { tab: 'operacao', subTab: 'pedidos' }, badge: 'orders' },
          {
            id: 'vendas_novo_pedido',
            label: 'Novo pedido',
            target: { tab: 'operacao', subTab: 'balcao' },
            action: 'open-counter',
          },
          { id: 'vendas_salao', label: 'Salão', target: { tab: 'operacao', subTab: 'mesas' } },
          { id: 'vendas_cozinha', label: 'Cozinha', target: { tab: 'operacao', subTab: 'kds' } },
          { id: 'vendas_retiradas', label: 'Retiradas', target: { tab: 'operacao', subTab: 'retiradas' } },
          { id: 'vendas_entregas', label: 'Entregas', target: { tab: 'operacao', subTab: 'entregadores' } },
        ],
      },
      {
        id: 'financeiro',
        label: 'Caixa',
        icon: DollarSign,
        target: { tab: 'financeiro', subTab: 'turno_atual' },
        children: [
          { id: 'caixa_turno_atual', label: 'Turno atual', target: { tab: 'financeiro', subTab: 'turno_atual' } },
          { id: 'caixa_movimentacoes', label: 'Movimentações', target: { tab: 'financeiro', subTab: 'movimentacoes' } },
          { id: 'caixa_fechamento', label: 'Fechamento', target: { tab: 'financeiro', subTab: 'fechamento' } },
        ],
      },
    ],
  },
  {
    category: 'Cadastros',
    items: [
      {
        id: 'cardapio',
        label: 'Cardápio',
        icon: ClipboardList,
        target: { tab: 'cardapio', subTab: 'produtos' },
        children: [
          { id: 'cardapio_produtos', label: 'Produtos', target: { tab: 'cardapio', subTab: 'produtos' } },
          { id: 'cardapio_complementos', label: 'Complementos', target: { tab: 'cardapio', subTab: 'complementos' } },
          { id: 'cardapio_preparo', label: 'Preparo e impressão', target: { tab: 'cardapio', subTab: 'categorias' } },
        ],
      },
      {
        id: 'estoque',
        label: 'Estoque & compras',
        plans: ['pro', 'premium'],
        icon: Package,
        target: { tab: 'estoque', subTab: 'insumos' },
        children: [
          { id: 'estoque_ingredientes', label: 'Estoque', target: { tab: 'estoque', subTab: 'insumos' } },
          { id: 'estoque_historico', label: 'Compras', target: { tab: 'estoque', subTab: 'historico' } },
          { id: 'estoque_inventario', label: 'Inventário', target: { tab: 'estoque', subTab: 'inventario' } },
          { id: 'estoque_fornecedores', label: 'Fornecedores', target: { tab: 'estoque', subTab: 'fornecedores' } },
        ],
      },
      {
        id: 'clientes',
        label: 'Clientes',
        icon: Users,
        target: { tab: 'clientes', subTab: 'clientes' },
      },
    ],
  },
  {
    category: 'Vendas online',
    items: [
      {
        id: 'cardapio_digital',
        label: 'Cardápio online',
        icon: Globe,
        target: { tab: 'cardapio_digital', subTab: 'cardapio_perfil' },
        capability: 'online-menu',
        children: [
          { id: 'online_perfil', label: 'Perfil', target: { tab: 'cardapio_digital', subTab: 'cardapio_perfil' } },
          { id: 'online_marca', label: 'Marca', target: { tab: 'cardapio_digital', subTab: 'cardapio_marca' } },
          { id: 'online_pedidos', label: 'Pedidos online', target: { tab: 'cardapio_digital', subTab: 'cardapio_pedidos' } },
          { id: 'online_bloqueios', label: 'Clientes bloqueados', target: { tab: 'cardapio_digital', subTab: 'cardapio_bloqueios' } },
          { id: 'online_entrega', label: 'Entrega', target: { tab: 'cardapio_digital', subTab: 'cardapio_entrega' } },
          { id: 'online_pagamentos', label: 'Pagamentos', target: { tab: 'cardapio_digital', subTab: 'cardapio_pagamentos' } },
          { id: 'online_divulgacao', label: 'Divulgação', target: { tab: 'cardapio_digital', subTab: 'cardapio_qr_links' } },
        ],
      },
    ],
  },
  {
    category: 'Gestão',
    items: [
      {
        id: 'relatorios',
        label: 'Relatórios',
        plans: ['pro', 'premium'],
        icon: TrendingUp,
        target: { tab: 'relatorios', subTab: 'visao_geral' },
        children: [
          { id: 'relatorios_visao_geral', label: 'Visão Geral', target: { tab: 'relatorios', subTab: 'visao_geral' } },
          { id: 'relatorios_financeiro', label: 'Financeiro', target: { tab: 'relatorios', subTab: 'financeiro' } },
          { id: 'relatorios_produtos', label: 'Produtos', target: { tab: 'relatorios', subTab: 'produtos' } },
          { id: 'relatorios_equipe', label: 'Equipe', target: { tab: 'relatorios', subTab: 'equipe' } },
        ],
      },
      {
        id: 'permissoes_cargos',
        label: 'Equipe',
        plans: ['pro', 'premium'],
        icon: ShieldCheck,
        target: { tab: 'permissoes_cargos', subTab: 'pessoas' },
        children: [
          { id: 'equipe_pessoas', label: 'Pessoas', target: { tab: 'permissoes_cargos', subTab: 'pessoas' } },
          { id: 'equipe_funcoes_acessos', label: 'Funções e acessos', target: { tab: 'permissoes_cargos', subTab: 'cargos_permissoes' } },
        ],
      },
    ],
  },
  {
    category: 'Sistema',
    items: [
      {
        id: 'impressao_salao',
        label: 'Configurações',
        icon: SlidersHorizontal,
        target: { tab: 'impressao_salao', subTab: 'aparencia' },
        children: [
          { id: 'config_aparencia', label: 'Aparência', target: { tab: 'impressao_salao', subTab: 'aparencia' } },
          { id: 'config_impressao', label: 'Impressão', plans: ['pro', 'premium'], target: { tab: 'impressao_salao', subTab: 'impressao' } },
          { id: 'config_mesas', label: 'Mesas', target: { tab: 'impressao_salao', subTab: 'mesas' } },
          { id: 'config_garcom', label: 'App do Garçom', plans: ['pro', 'premium'], target: { tab: 'impressao_salao', subTab: 'garcom' } },
          { id: 'config_taxa', label: 'Taxa de Serviço', target: { tab: 'impressao_salao', subTab: 'taxa' } },
          { id: 'config_implantacao', label: 'Implantação inicial', target: { tab: 'impressao_salao', subTab: 'implantacao' } },
          { id: 'config_integracoes', label: 'Integrações', target: { tab: 'impressao_salao', subTab: 'integracoes' } },
        ],
      },
      {
        id: 'assinatura_pix',
        label: 'Conta & assinatura',
        icon: CreditCard,
        target: { tab: 'assinatura_pix', subTab: 'meu_plano' },
        children: [
          { id: 'assinatura_meu_plano', label: 'Meu Plano', target: { tab: 'assinatura_pix', subTab: 'meu_plano' } },
          { id: 'assinatura_planos_upgrade', label: 'Planos & Upgrade', target: { tab: 'assinatura_pix', subTab: 'planos_upgrade' } },
          { id: 'assinatura_contrato_documentos', label: 'Contrato e documentos', target: { tab: 'assinatura_pix', subTab: 'contrato_documentos' } },
        ],
      },
    ],
  },
] as const;

function isNavigationEntryAvailable(
  plans: readonly SubscriptionPlanId[] | undefined,
  planId: SubscriptionPlanId,
): boolean {
  return !plans || plans.includes(planId);
}

export function getCashierSidebarGroupsForPlan(planId: SubscriptionPlanId): readonly CashierNavigationGroup[] {
  return CASHIER_SIDEBAR_GROUPS
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => isNavigationEntryAvailable(item.plans, planId))
        .map((item) => {
          if (!item.children?.length) return item;

          const children = item.children
            .filter((child) => isNavigationEntryAvailable(child.plans, planId))
            .map((child) =>
              child.id === 'cardapio_preparo' && planId === 'pocket'
                ? { ...child, label: 'Preparo' }
                : child,
            );

          return { ...item, children };
        }),
    }))
    .filter((group) => group.items.length > 0);
}

const CASHIER_PARENT_ITEMS = CASHIER_SIDEBAR_GROUPS.flatMap((group) => group.items);
const CASHIER_CHILD_ITEMS = CASHIER_PARENT_ITEMS.flatMap((parent) =>
  (parent.children ?? []).map((child) => ({ parentId: parent.id, child })),
);

const TAB_ALIASES: Readonly<Record<string, CashierTab>> = {
  config_cardapio: 'cardapio_digital',
  configuracoes_cardapio: 'cardapio_digital',
  dashboard: 'relatorios',
  indicadores: 'relatorios',
  robo_ia: 'operacao',
  assistente_koma: 'operacao',
  chat_copiloto: 'operacao',
};

const SUBTAB_ALIASES: Readonly<Partial<Record<CashierTab, Readonly<Record<string, string>>>>> = {
  operacao: {
    fila_pedidos: 'pedidos',
    terminal_balcao: 'balcao',
    pdv: 'balcao',
    layout_salao: 'mesas',
    salon: 'mesas',
    cozinha: 'kds',
    retirada: 'retiradas',
    retiradas: 'retiradas',
    pickup: 'retiradas',
    entregas: 'entregadores',
    chat_copiloto: 'pedidos',
    chat: 'pedidos',
    robo_ia: 'pedidos',
    prompt: 'pedidos',
    prompt_atendente: 'pedidos',
    configuracao: 'pedidos',
    simulador: 'pedidos',
    simulador_chat: 'pedidos',
  },
  financeiro: {
    fluxo: 'turno_atual',
    ajustes: 'movimentacoes',
    ajustes_caixa: 'movimentacoes',
    suprimento: 'movimentacoes',
    sangria: 'movimentacoes',
    conferencia: 'fechamento',
    conferencia_cega: 'fechamento',
    fiscal: 'turno_atual',
    notas_fiscais: 'turno_atual',
  },
  cardapio: {
    disponibilidade: 'produtos',
    adicionais: 'complementos',
    modificadores: 'complementos',
  },
  estoque: {
    estoque_insumos: 'insumos',
    xml: 'historico',
    notas: 'historico',
    notas_entrada: 'historico',
    entradas: 'historico',
    movimentacoes: 'historico',
    contagem: 'inventario',
    distribuidores: 'fornecedores',
  },
  clientes: {
    crm: 'clientes',
    banco_clientes: 'clientes',
    programa_fidelidade: 'fidelidade',
    cupom: 'cupons',
    promocoes: 'cupons',
    descontos: 'cupons',
    cupons_desconto: 'cupons',
    recuperador: 'clientes',
    carrinhos_abandonados: 'clientes',
  },
  relatorios: {
    metas: 'visao_geral',
    vendas: 'visao_geral',
    indicadores: 'visao_geral',
    dashboard: 'visao_geral',
    relatorio_geral: 'visao_geral',
    faturamento_garcom: 'visao_geral',
    dre: 'financeiro',
    demonstrativo_dre: 'financeiro',
    fluxo_caixa: 'financeiro',
    produtos_mais_vendidos: 'produtos',
    top10: 'produtos',
    mais_vendidos: 'produtos',
    desempenho_equipe: 'equipe',
    desempenho: 'equipe',
    relatorio_garcons: 'equipe',
    'relatorio_garçons': 'equipe',
  },
  permissoes_cargos: {
    equipe: 'pessoas',
    convites: 'pessoas',
    cargos: 'cargos_permissoes',
    permissoes: 'cargos_permissoes',
  },
  cardapio_digital: {
    cardapio_digital: 'cardapio_perfil',
  },
  impressao_salao: {
    impressoras: 'impressao',
    salao_impressao: 'impressao',
    salao_e_impressao: 'impressao',
  },
  assinatura_pix: {
    planos: 'meu_plano',
    plano: 'meu_plano',
    upgrade: 'planos_upgrade',
    contrato: 'contrato_documentos',
    documentos: 'contrato_documentos',
  },
};

const VALID_TABS = new Set<CashierTab>(CASHIER_PARENT_ITEMS.map((item) => item.target.tab));

const CHILD_DETAIL_SUBTABS: Readonly<Record<string, readonly string[]>> = {
  relatorios_visao_geral: ['visao_geral', 'metas', 'vendas', 'indicadores', 'relatorio_geral', 'consolidado_vendas'],
  relatorios_financeiro: ['financeiro', 'dre', 'demonstrativo_dre', 'fluxo_caixa'],
  relatorios_produtos: ['produtos', 'produtos_mais_vendidos', 'top10', 'mais_vendidos'],
  relatorios_equipe: ['equipe', 'desempenho_equipe', 'desempenho', 'relatorio_garcons', 'relatorio_garçons'],
  equipe_pessoas: ['pessoas', 'equipe', 'convites'],
  equipe_funcoes_acessos: ['cargos_permissoes', 'cargos', 'permissoes'],
  assinatura_meu_plano: ['meu_plano', 'planos', 'plano'],
  assinatura_planos_upgrade: ['planos_upgrade', 'upgrade'],
  assinatura_contrato_documentos: ['contrato_documentos', 'contrato', 'documentos'],
  online_perfil: ['cardapio_perfil'],
  online_marca: ['cardapio_marca'],
  online_pedidos: ['cardapio_pedidos'],
  online_bloqueios: ['cardapio_bloqueios'],
  online_entrega: ['cardapio_entrega'],
  online_pagamentos: ['cardapio_pagamentos'],
  online_divulgacao: ['cardapio_qr_links'],
};

function childOwnsSubTab(child: CashierNavigationChild, subTab: string): boolean {
  return (CHILD_DETAIL_SUBTABS[child.id] ?? [child.target.subTab]).includes(subTab);
}

function normalizeLegacySettingsTab(savedSubTab: string): CashierTab {
  if (['equipe', 'pessoas', 'convites', 'cargos', 'cargos_permissoes', 'permissoes'].includes(savedSubTab)) {
    return 'permissoes_cargos';
  }
  if (savedSubTab === 'planos') return 'assinatura_pix';
  return 'impressao_salao';
}

/**
 * Converts persisted legacy routes into a coherent pair owned by the current
 * navigation tree. A parent with visible children always resolves to exactly
 * one of those children, preventing stale sessionStorage pairs from opening a
 * blank view with no active shortcut.
 */
export function normalizeCashierNavigationState(
  savedTab?: string | null,
  savedSubTab?: string | null,
): CashierNavigationTarget {
  const rawTab = (savedTab || 'operacao').trim();
  const rawSubTab = (savedSubTab || '').trim();
  const tab = rawTab === 'configuracoes'
    ? normalizeLegacySettingsTab(rawSubTab)
    : TAB_ALIASES[rawTab] ?? (VALID_TABS.has(rawTab as CashierTab) ? rawTab as CashierTab : 'operacao');
  const parent = CASHIER_PARENT_ITEMS.find((item) => item.target.tab === tab);
  const defaultSubTab = parent?.target.subTab ?? 'pedidos';
  const normalizedSubTab = SUBTAB_ALIASES[tab]?.[rawSubTab] ?? (rawSubTab || defaultSubTab);

  if (parent?.children?.length) {
    const matchingChild = parent.children.find((child) => childOwnsSubTab(child, normalizedSubTab));
    return matchingChild ? { tab, subTab: normalizedSubTab } : parent.target;
  }

  return { tab, subTab: normalizedSubTab };
}

export function isCashierNavigationActive(
  navigationId: string,
  activeTab: string,
  activeSubTab: string,
): boolean {
  const state = normalizeCashierNavigationState(activeTab, activeSubTab);
  const parentId = getCashierNavigationParentId(navigationId);
  const target = getCashierNavigationTarget(navigationId);
  if (!target) return false;
  if (parentId) {
    const child = getCashierNavigationChild(navigationId);
    return Boolean(child && state.tab === target.tab && childOwnsSubTab(child, state.subTab));
  }
  return state.tab === target.tab;
}

export function getCashierNavigationItem(id: string): CashierNavigationItem | undefined {
  return CASHIER_PARENT_ITEMS.find((item) => item.id === id);
}

export function getCashierNavigationChild(id: string): CashierNavigationChild | undefined {
  return CASHIER_CHILD_ITEMS.find((entry) => entry.child.id === id)?.child;
}

export function getCashierNavigationParentId(id: string): string | undefined {
  return CASHIER_CHILD_ITEMS.find((entry) => entry.child.id === id)?.parentId;
}

export function getCashierNavigationTarget(id: string): CashierNavigationTarget | undefined {
  return getCashierNavigationItem(id)?.target ?? getCashierNavigationChild(id)?.target;
}

export function getCashierNavigationAction(id: string): CashierNavigationAction | undefined {
  return getCashierNavigationChild(id)?.action;
}