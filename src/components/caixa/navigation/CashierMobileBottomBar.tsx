import React from 'react';
import { ChefHat, CirclePlus, Menu, ReceiptText, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CashierTab } from '../cashierContracts';

interface CashierMobileBottomBarProps {
  activeTab: CashierTab;
  activeSubTab: string;
  onNavigate: (navigationId: string) => void;
  onOpenMenu: () => void;
  dedicatedKds?: boolean;
  orderCount?: number;
  kitchenCount?: number;
  shiftOpen?: boolean;
}

interface DockActionProps {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  onClick: () => void;
  count?: number;
  countTone?: 'orders' | 'kitchen';
  shiftOpen?: boolean;
  ariaLabel?: string;
}

const DockAction: React.FC<DockActionProps> = ({
  label,
  icon: Icon,
  active = false,
  onClick,
  count = 0,
  countTone = 'orders',
  shiftOpen,
  ariaLabel,
}) => (
  <button
    type="button"
    className="cashier-mobile-bottom-bar__action"
    onClick={onClick}
    aria-current={active ? 'page' : undefined}
    aria-label={ariaLabel ?? label}
    aria-describedby={shiftOpen === undefined ? undefined : 'cashier-mobile-shift-status'}
  >
    <span className="cashier-mobile-bottom-bar__icon" aria-hidden="true">
      <Icon size={22} strokeWidth={2} />
      {count > 0 && (
        <span
          className={`cashier-mobile-bottom-bar__count cashier-mobile-bottom-bar__count--${countTone}`}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
      {shiftOpen !== undefined && (
        <span
          className={`cashier-mobile-bottom-bar__shift ${shiftOpen ? 'is-open' : 'is-closed'}`}
        />
      )}
    </span>
    <span className="cashier-mobile-bottom-bar__label">{label}</span>
    {shiftOpen !== undefined && (
      <span id="cashier-mobile-shift-status" className="sr-only">
        {shiftOpen ? 'Turno aberto' : 'Turno fechado'}
      </span>
    )}
  </button>
);

/**
 * Main mobile shortcuts. Keep the five destinations and their permission-aware
 * navigation callbacks independent from the presentation of the dock.
 */
export const CashierMobileBottomBar: React.FC<CashierMobileBottomBarProps> = ({
  activeTab,
  activeSubTab,
  onNavigate,
  onOpenMenu,
  dedicatedKds = true,
  orderCount = 0,
  kitchenCount = 0,
  shiftOpen = false,
}) => {
  const isPedidosActive = activeTab === 'operacao' && (activeSubTab === 'pedidos' || activeSubTab === 'mesas');
  const isPdvActive = activeTab === 'operacao' && activeSubTab === 'balcao';
  const isCozinhaActive = activeTab === 'operacao' && (activeSubTab === 'kds' || activeSubTab === 'preparo');
  const isCaixaActive = activeTab === 'financeiro';

  return (
    <nav aria-label="Navegação móvel principal" className="cashier-mobile-bottom-bar lg:hidden">
      <div className="cashier-mobile-bottom-bar__items">
        <DockAction
          icon={ReceiptText}
          label="Pedidos"
          active={isPedidosActive}
          onClick={() => onNavigate('vendas_pedidos')}
          count={orderCount}
        />
        <DockAction
          icon={CirclePlus}
          label="+ Pedido"
          active={isPdvActive}
          onClick={() => onNavigate('vendas_novo_pedido')}
        />
        <DockAction
          icon={ChefHat}
          label={dedicatedKds ? 'Cozinha' : 'Preparo'}
          active={isCozinhaActive}
          onClick={() => onNavigate('vendas_cozinha')}
          count={kitchenCount}
          countTone="kitchen"
        />
        <DockAction
          icon={Wallet}
          label="Caixa"
          active={isCaixaActive}
          onClick={() => onNavigate('caixa_turno_atual')}
          shiftOpen={shiftOpen}
        />
        <DockAction
          icon={Menu}
          label="Mais"
          ariaLabel="Abrir menu completo"
          onClick={onOpenMenu}
        />
      </div>
    </nav>
  );
};
