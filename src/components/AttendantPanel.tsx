import { LogOut } from 'lucide-react';
import React, { useCallback, useState } from 'react';
import { KomaLogo } from './KomaLogo';
import type { CaixaPanelProps, CashierTab } from './caixa/cashierContracts';
import { useCashierCatalog } from './caixa/catalog/useCashierCatalog';
import CashierPdvView from './caixa/pdv/CashierPdvView';
import { useCashierPdv } from './caixa/pdv/useCashierPdv';
import { useCashierSalonProjection } from './caixa/salao/useCashierSalonProjection';

type AttendantPanelProps = Pick<
  CaixaPanelProps,
  | 'orders'
  | 'onRefreshOrders'
  | 'apiBaseUrl'
  | 'authHeaders'
  | 'activeWaiterNome'
  | 'salonTables'
  | 'liveProdutos'
  | 'liveCategorias'
  | 'catalogReady'
  | 'onRefreshCategorias'
  | 'onOptimisticAddOrder'
> & {
  onLogout: () => void;
};

export function AttendantPanel({
  orders,
  onRefreshOrders,
  apiBaseUrl,
  authHeaders,
  activeWaiterNome,
  salonTables,
  liveProdutos = [],
  liveCategorias = [],
  catalogReady = false,
  onRefreshCategorias,
  onOptimisticAddOrder,
  onLogout,
}: AttendantPanelProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [toastData, setToastData] = useState<{
    msg: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  const showToast = useCallback(
    (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
      setToastData({ msg, type });
      window.setTimeout(() => setToastData(null), 3000);
    },
    [],
  );

  const { apiCategorias, dynamicMenu } = useCashierCatalog({
    liveProdutos,
    liveCategorias,
    onRefreshCategorias,
  });

  const { pdvTableOptions } = useCashierSalonProjection({
    salonTables,
    orders,
    pagamentosPendentes: [],
    nowTimestamp: Date.now(),
  });

  const keepQuickOrderTab = useCallback((_tab: CashierTab) => undefined, []);
  const keepQuickOrderSubTab = useCallback((_subTab: string) => undefined, []);
  const refreshDeliveryOrders = useCallback(async () => undefined, []);

  const pdv = useCashierPdv({
    apiBaseUrl,
    authHeaders,
    activeTab: 'operacao',
    activeSubTab: 'balcao',
    setActiveTab: keepQuickOrderTab,
    setActiveSubTab: keepQuickOrderSubTab,
    showToast,
    setIsLoading,
    onRefreshOrders,
    onOptimisticAddOrder,
    activeWaiterNome,
    fetchDeliveryOrders: refreshDeliveryOrders,
    apiCategorias,
    dynamicMenu,
    pdvTableOptions,
  });

  return (
    <div className="min-h-screen bg-koma-page text-koma-foreground">
      <header className="sticky top-0 z-30 border-b border-koma-border-subtle bg-koma-page/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1680px] items-center justify-between gap-3 px-3 py-3.5 sm:px-6 lg:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <KomaLogo size="lg" />
            <div className="min-w-0">
              <h1 className="truncate font-serif text-base font-black tracking-[-0.03em] sm:text-lg">
                Atendimento rápido
              </h1>
              <p className="mt-0.5 truncate text-[9px] font-medium text-koma-muted">
                {activeWaiterNome || 'Atendente'} · balcão, retirada e pedidos rápidos
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-koma-border bg-koma-panel px-3 py-2 text-xs font-bold text-koma-secondary transition-colors hover:bg-koma-raised hover:text-koma-foreground"
          >
            <LogOut size={15} />
            <span className="hidden sm:inline">Sair</span>
          </button>
        </div>
      </header>

      {toastData && (
        <div
          role="status"
          className="fixed right-4 top-20 z-50 max-w-sm rounded-xl border border-koma-border bg-koma-panel px-4 py-3 text-xs font-bold text-koma-foreground shadow-xl"
        >
          {toastData.msg}
        </div>
      )}

      <main className="mx-auto w-full max-w-[1680px] px-3 py-4 sm:px-6 sm:py-6 lg:px-10">
        <CashierPdvView
          activeSubTab="balcao"
          catalogReady={catalogReady}
          isLoading={isLoading}
          pdvTableOptions={pdvTableOptions}
          pdv={pdv}
        />
      </main>
    </div>
  );
}
