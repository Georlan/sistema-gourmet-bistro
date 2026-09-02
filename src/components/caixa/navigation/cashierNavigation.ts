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

export type CashierNavigationItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  target: CashierNavigationTarget;
  capability?: 'online-menu';
};

export type CashierNavigationGroup = {
  category: 'Operação' | 'Cadastros' | 'Vendas online' | 'Gestão' | 'Sistema';
  items: readonly CashierNavigationItem[];
};

/**
 * Navigation Tree v2.
 *
 * This catalog owns information architecture and default destinations. Desktop,
 * mobile and future command-palette/breadcrumb presentations must consume the
 * same tree instead of rebuilding route decisions locally.
 *
 * Keep these IDs compatible with the existing CashierTab contract while the
 * internal views migrate independently. A menu reorganization must not rename
 * persisted routes or create a second screen owner.
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
      },
      {
        id: 'financeiro',
        label: 'Caixa',
        icon: DollarSign,
        target: { tab: 'financeiro', subTab: 'turno_atual' },
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
      },
      {
        id: 'estoque',
        label: 'Estoque & compras',
        icon: Package,
        target: { tab: 'estoque', subTab: 'insumos' },
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

const CASHIER_NAVIGATION_ITEMS = CASHIER_SIDEBAR_GROUPS.flatMap((group) => group.items);

export function getCashierNavigationItem(id: string): CashierNavigationItem | undefined {
  return CASHIER_NAVIGATION_ITEMS.find((item) => item.id === id);
}

export function getCashierNavigationTarget(id: string): CashierNavigationTarget | undefined {
  return getCashierNavigationItem(id)?.target;
}
