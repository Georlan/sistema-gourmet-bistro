import {
  ShoppingCart,
  DollarSign,
  ClipboardList,
  Package,
  Users,
  TrendingUp,
  ShieldCheck,
  SlidersHorizontal,
  Globe,
  CreditCard,
} from 'lucide-react';

/** One navigation catalog shared by both responsive presentations. */
export const CASHIER_SIDEBAR_GROUPS = [
  {
    category: 'Operação',
    items: [
      { id: 'operacao', label: 'Vendas', icon: ShoppingCart },
      { id: 'financeiro', label: 'Caixa', icon: DollarSign },
    ],
  },
  {
    category: 'Cadastros',
    items: [
      { id: 'cardapio', label: 'Cardápio', icon: ClipboardList },
      { id: 'estoque', label: 'Estoque', icon: Package },
      { id: 'clientes', label: 'Clientes', icon: Users },
    ],
  },
  {
    category: 'Gestão',
    items: [
      { id: 'relatorios', label: 'Relatórios', icon: TrendingUp },
      { id: 'permissoes_cargos', label: 'Equipe', icon: ShieldCheck },
    ],
  },
  {
    category: 'Sistema',
    items: [{ id: 'impressao_salao', label: 'Configurações', icon: SlidersHorizontal }],
  },
] as const;
export const CASHIER_SIDEBAR_SECONDARY_ITEMS = [
  { id: 'cardapio_digital', label: 'Cardápio online', icon: Globe },
  { id: 'assinatura_pix', label: 'Assinatura e planos', icon: CreditCard },
] as const;
