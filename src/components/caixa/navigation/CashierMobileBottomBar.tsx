import React from 'react';
import clsx from 'clsx';
import { ChefHat, DollarSign, Menu, PlusCircle, ShoppingBag } from 'lucide-react';
import type { CashierTab } from '../cashierContracts';

interface CashierMobileBottomBarProps {
  activeTab: CashierTab;
  activeSubTab: string;
  onNavigate: (tab: CashierTab, subTab: string) => void;
  onOpenMenu: () => void;
  orderCount?: number;
  kitchenCount?: number;
  shiftOpen?: boolean;
}

export const CashierMobileBottomBar: React.FC<CashierMobileBottomBarProps> = ({
  activeTab,
  activeSubTab,
  onNavigate,
  onOpenMenu,
  orderCount = 0,
  kitchenCount = 0,
  shiftOpen = false,
}) => {
  const isPedidosActive = activeTab === 'operacao' && (activeSubTab === 'pedidos' || activeSubTab === 'mesas');
  const isPdvActive = activeTab === 'operacao' && activeSubTab === 'balcao';
  const isCozinhaActive = activeTab === 'operacao' && activeSubTab === 'kds';
  const isCaixaActive = activeTab === 'financeiro';

  return (
    <nav
      aria-label="Navegação móvel principal"
      className="cashier-mobile-bottom-bar lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-koma-panel/95 backdrop-blur-lg border-t border-koma-border safe-area-pb shadow-lg"
    >
      <div className="grid grid-cols-5 h-14 items-center max-w-md mx-auto px-1">
        {/* 1. Vendas / Pedidos */}
        <button
          type="button"
          onClick={() => onNavigate('operacao', 'pedidos')}
          className={clsx(
            'flex flex-col items-center justify-center py-1 relative transition-all min-h-[44px]',
            isPedidosActive ? 'text-emerald-500 font-bold' : 'text-koma-muted hover:text-koma-foreground'
          )}
          aria-current={isPedidosActive ? 'page' : undefined}
        >
          <div className="relative">
            <ShoppingBag size={18} />
            {orderCount > 0 && (
              <span className="absolute -top-1.5 -right-2 bg-emerald-500 text-[#101411] text-[9px] font-black rounded-full px-1 min-w-[14px] h-3.5 flex items-center justify-center leading-none">
                {orderCount}
              </span>
            )}
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight">Pedidos</span>
        </button>

        {/* 2. Novo Pedido (PDV Balcão) */}
        <button
          type="button"
          onClick={() => onNavigate('operacao', 'balcao')}
          className={clsx(
            'flex flex-col items-center justify-center py-1 relative transition-all min-h-[44px]',
            isPdvActive ? 'text-emerald-500 font-bold' : 'text-koma-muted hover:text-koma-foreground'
          )}
          aria-current={isPdvActive ? 'page' : undefined}
        >
          <PlusCircle size={18} />
          <span className="text-[10px] mt-0.5 tracking-tight">+ Pedido</span>
        </button>

        {/* 3. Cozinha (Fila na Tela) */}
        <button
          type="button"
          onClick={() => onNavigate('operacao', 'kds')}
          className={clsx(
            'flex flex-col items-center justify-center py-1 relative transition-all min-h-[44px]',
            isCozinhaActive ? 'text-emerald-500 font-bold' : 'text-koma-muted hover:text-koma-foreground'
          )}
          aria-current={isCozinhaActive ? 'page' : undefined}
        >
          <div className="relative">
            <ChefHat size={18} />
            {kitchenCount > 0 && (
              <span className="absolute -top-1.5 -right-2 bg-amber-500 text-[#101411] text-[9px] font-black rounded-full px-1 min-w-[14px] h-3.5 flex items-center justify-center leading-none">
                {kitchenCount}
              </span>
            )}
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight">Cozinha</span>
        </button>

        {/* 4. Caixa / Turno */}
        <button
          type="button"
          onClick={() => onNavigate('financeiro', 'turno_atual')}
          className={clsx(
            'flex flex-col items-center justify-center py-1 relative transition-all min-h-[44px]',
            isCaixaActive ? 'text-emerald-500 font-bold' : 'text-koma-muted hover:text-koma-foreground'
          )}
          aria-current={isCaixaActive ? 'page' : undefined}
        >
          <div className="relative">
            <DollarSign size={18} />
            <span
              className={clsx(
                'absolute -top-0.5 -right-1 w-2 h-2 rounded-full ring-2 ring-koma-panel',
                shiftOpen ? 'bg-emerald-500' : 'bg-amber-500'
              )}
            />
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight">Caixa</span>
        </button>

        {/* 5. Menu Completo (Sidebar) */}
        <button
          type="button"
          onClick={onOpenMenu}
          className="flex flex-col items-center justify-center py-1 relative text-koma-muted hover:text-koma-foreground transition-all min-h-[44px]"
          aria-label="Abrir menu completo"
        >
          <Menu size={18} />
          <span className="text-[10px] mt-0.5 tracking-tight">Mais</span>
        </button>
      </div>
    </nav>
  );
};
