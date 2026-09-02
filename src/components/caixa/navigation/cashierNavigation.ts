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
};

export type CashierNavigationItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  target: CashierNavigationTarget;
  capability?: 'online-menu';
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
        icon: Package,
        target: { tab: 'estoque', subTab: 'insumos' },
        children: [
          { id: 'estoque_ingredientes', label: 'Ingredientes', target: { tab: 'estoque', subTab: 'insumos' } },
          { id: 'estoque_historico', label: 'Histórico', target: { tab: 'estoque', subTab: 'historico' } },
          { id: 'estoque_inventario', label: 'Inventário', target: { tab: 'estoque', subTab: 'inventario' } },
          { id: 'estoque_fornecedores', label: 'Fornecedores', target: { tab: 'estoque', subTab: 'fornecedores' } },
        ],
      },
      {
        id: 'clientes',
        label: 'Clientes',
        icon: Users,
        target: { tab: 'clientes', subTab: 'clientes' },
        children: [
          { id: 'clientes_cadastro', label: 'Clientes', target: { tab: 'clientes', subTab: 'clientes' } },
          { id: 'clientes_fidelidade', label: 'Fidelidade', target: { tab: 'clientes', subTab: 'fidelidade' } },
          { id: 'clientes_cupons', label: 'Cupons & promoções', target: { tab: 'clientes', subTab: 'cupons' } },
        ],
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
        target: { tab: 'cardapio_digital', subTab: 'cardapio_digital' },
        capability: 'online-menu',
      },
    ],
  },
  {
    category: 'Gestão',
    items: [
      {
        id: 'relatorios',
        label: 'Relatórios',
        icon: TrendingUp,
        target: { tab: 'relatorios', subTab: 'visao_geral' },
        children: [
          { id: 'relatorios_visao_geral', label: 'Visão geral', target: { tab: 'relatorios', subTab: 'visao_geral' } },
          { id: 'relatorios_financeiro', label: 'Financeiro', target: { tab: 'relatorios', subTab: 'financeiro' } },
          { id: 'relatorios_produtos', label: 'Produtos', target: { tab: 'relatorios', subTab: 'produtos' } },
          { id: 'relatorios_equipe', label: 'Equipe', target: { tab: 'relatorios', subTab: 'equipe' } },
        ],
      },
      {
        id: 'permissoes_cargos',
        label: 'Equipe',
        icon: ShieldCheck,
        target: { tab: 'permissoes_cargos', subTab: 'pessoas' },
        children: [
          { id: 'equipe_pessoas', label: 'Pessoas', target: { tab: 'permissoes_cargos', subTab: 'pessoas' } },
          {
            id: 'equipe_funcoes_acessos',
            label: 'Funções e acessos',
            target: { tab: 'permissoes_cargos', subTab: 'cargos_permissoes' },
          },
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
        target: { tab: 'impressao_salao', subTab: 'impressoras' },
      },
      {
        id: 'assinatura_pix',
        label: 'Conta & assinatura',
        icon: CreditCard,
        target: { tab: 'assinatura_pix', subTab: 'planos' },
      },
    ],
  },
] as const;

const CASHIER_PARENT_ITEMS = CASHIER_SIDEBAR_GROUPS.flatMap((group) => group.items);
const CASHIER_CHILD_ITEMS = CASHIER_PARENT_ITEMS.flatMap((parent) =>
  (parent.children ?? []).map((child) => ({ parentId: parent.id, child })),
);

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
