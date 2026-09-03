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
          { id: 'estoque_ingredientes', label: 'Estoque', target: { tab: 'estoque', subTab: 'insumos' } },
          { id: 'estoque_historico', label: 'Compras', target: { tab: 'estoque', subTab: 'historico' } },
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
          { id: 'online_loja', label: 'Loja', target: { tab: 'cardapio_digital', subTab: 'cardapio_perfil' } },
          { id: 'online_operacao', label: 'Operação', target: { tab: 'cardapio_digital', subTab: 'cardapio_pedidos' } },
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
        icon: TrendingUp,
        target: { tab: 'relatorios', subTab: 'visao_geral' },
      },
      {
        id: 'permissoes_cargos',
        label: 'Equipe',
        icon: ShieldCheck,
        target: { tab: 'permissoes_cargos', subTab: 'pessoas' },
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
        children: [
          { id: 'config_operacao', label: 'Salão e impressão', target: { tab: 'impressao_salao', subTab: 'impressoras' } },
          { id: 'config_integracoes', label: 'Integrações', target: { tab: 'impressao_salao', subTab: 'integracoes' } },
        ],
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