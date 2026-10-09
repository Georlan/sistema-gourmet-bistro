import { getCashierNavigationChild } from '../components/caixa/navigation/cashierNavigation';
import type { SupportNavigationTarget } from './SuperAdminSupportModal';

const cockpitDestinations: Record<string, string> = {
  profile: 'online_perfil',
  hours: 'online_pedidos',
  catalog: 'cardapio_produtos',
  'dine-in': 'config_mesas',
  delivery: 'online_entrega',
  payment: 'online_pagamentos',
  printing: 'config_impressao',
};

export function supportTargetForCockpit(key: string): SupportNavigationTarget | null {
  const item = getCashierNavigationChild(cockpitDestinations[key]);
  return item ? { ...item.target, label: item.label } : null;
}
