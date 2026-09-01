import {
  Activity,
  ShoppingCart,
  ClipboardList,
  Briefcase,
  BarChart3,
  DollarSign,
  Package,
  Users,
  ShieldCheck,
  SlidersHorizontal,
  Globe,
  CreditCard,
} from 'lucide-react';

/**
 * Five top-level destinations for the main sidebar.
 *
 * Mapping from previous structure:
 * - Operação.Vendas  → Vender
 * - Cadastros.Cardápio  → Cardápio
 * - Operação.Caixa + Cadastros.Estoque + Cadastros.Clientes + Gestão.Equipe → Gestão
 * - Gestão.Relatórios  → Resultados
 * - (NEW) Agora  → Dashboard operacional
 *
 * The `id` values are preserved for backward-compatible tab routing.
 * CaixaPanel and useCashierNavigation consume these ids unchanged.
 */
export const CASHIER_SIDEBAR_GROUPS = [
  {
    category: '',
    items: [
      { id: 'agora', label: 'Agora', icon: Activity },
      { id: 'operacao', label: 'Vender', icon: ShoppingCart },
      { id: 'cardapio', label: 'Cardápio', icon: ClipboardList },
      { id: 'gestao_hub', label: 'Gestão', icon: Briefcase },
      { id: 'relatorios', label: 'Resultados', icon: BarChart3 },
    ],
  },
] as const;

/**
 * Sub-items shown inside the "Gestão" hub.
 * Each maps to an existing CashierTab id so content rendering stays intact.
 */
export const GESTAO_HUB_ITEMS = [
  { id: 'financeiro', label: 'Caixa', icon: DollarSign },
  { id: 'estoque', label: 'Estoque', icon: Package },
  { id: 'clientes', label: 'Clientes', icon: Users },
  { id: 'permissoes_cargos', label: 'Equipe', icon: ShieldCheck },
] as const;

/**
 * Secondary footer items — config and subscriptions.
 * Kept in the sidebar footer to reduce top-level noise.
 */
export const CASHIER_SIDEBAR_SECONDARY_ITEMS = [
  { id: 'impressao_salao', label: 'Configurações', icon: SlidersHorizontal },
  { id: 'cardapio_digital', label: 'Cardápio online', icon: Globe },
  { id: 'assinatura_pix', label: 'Assinatura e planos', icon: CreditCard },
] as const;
