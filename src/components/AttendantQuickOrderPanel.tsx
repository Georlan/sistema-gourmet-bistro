import { LogOut } from 'lucide-react';
import { useState } from 'react';
import type { CatalogCategory } from '../catalog/catalog';
import type { Product } from '../types';
import CashierPdvView from './caixa/pdv/CashierPdvView';
import { useCashierPdv } from './caixa/pdv/useCashierPdv';
import { KomaLogo } from './KomaLogo';

const ATTENDANT_ORDER_TYPES = ['pickup', 'delivery'] as const;

interface AttendantQuickOrderPanelProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  activeWaiterNome: string;
  liveProdutos: Product[];
  liveCategorias: CatalogCategory[];
  catalogReady: boolean;
  onRefreshOrders: () => Promise<void>;
  onOptimisticAddOrder?: (newOrder: any) => void;
  onLogout: () => void;
}

export function AttendantQuickOrderPanel({
  apiBaseUrl,
  authHeaders,
  activeWaiterNome,
  liveProdutos,
  liveCategorias,
  catalogReady,
  onRefreshOrders,
  onOptimisticAddOrder,
  onLogout,
}: AttendantQuickOrderPanelProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [toastData, setToastData] = useState<{
    msg: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastData({ msg, type });
    window.setTimeout(() => setToastData(null), 3000);
  };

  const pdv = useCashierPdv({
    apiBaseUrl,
    authHeaders,
    activeTab: 'operacao',
    activeSubTab: 'balcao',
    setActiveTab: () => {},
    setActiveSubTab: () => {},
    showToast,
    setIsLoading,
    onRefreshOrders,
    onOptimisticAddOrder,
    activeWaiterNome,
    fetchDeliveryOrders: async () => {},
    apiCategorias: liveCategorias,
    dynamicMenu: liveProdutos,
    pdvTableOptions: [],
    allowedOrderTypes: ATTENDANT_ORDER_TYPES,
  });

  return (
    <div className="attendant-shell min-h-dvh w-full bg-koma-page text-koma-foreground flex flex-col font-sans">
      {toastData && (
        <div
          className={
            `fixed bottom-6 right-6 z-[9999] rounded-2xl border px-5 py-3 text-sm font-bold shadow-2xl backdrop-blur-md ${
              toastData.type === 'error'
                ? 'bg-rose-900/90 border-rose-700/50 text-rose-100'
                : toastData.type === 'info'
                  ? 'bg-amber-900/90 border-amber-700/50 text-amber-100'
                  : 'bg-emerald-500 border-emerald-500 text-zinc-950'
            }`
          }
        >
          {toastData.msg}
        </div>
      )}

      <header className="h-14 shrink-0 border-b border-koma-border bg-koma-panel px-4 sm:px-6 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <KomaLogo size="md" />
          <div className="min-w-0">
            <strong className="block truncate text-sm font-bold">Atendimento rápido</strong>
            <span className="block truncate text-[10px] text-koma-muted">{activeWaiterNome}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="inline-flex items-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3 py-2 text-xs font-bold text-koma-secondary hover:bg-koma-card hover:text-koma-foreground"
        >
          <LogOut size={14} />
          Sair
        </button>
      </header>

      <main className="min-h-0 flex-1 p-3 sm:p-5 lg:p-6">
        <CashierPdvView
          activeSubTab="balcao"
          catalogReady={catalogReady}
          isLoading={isLoading}
          pdvTableOptions={[]}
          pdv={pdv}
        />
      </main>
    </div>
  );
}
