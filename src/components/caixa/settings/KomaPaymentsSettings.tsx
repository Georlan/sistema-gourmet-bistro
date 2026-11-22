import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Wallet } from 'lucide-react';
import { PagBankConnectionCard } from '../online-menu/PagBankConnectionCard';
import { MercadoPagoConnectionCard } from '../online-menu/MercadoPagoConnectionCard';
import { DirectPixSetup } from './DirectPixSetup';
import { FinancialPendingCenter } from '../payments/FinancialPendingCenter';
import { fetchPendingReview, type FinancialPendingSummary } from '../payments/paymentPendingClient';
import { formatCurrency } from '../cashierPresentation';
import type { PaymentProvider, ReceiverConnectionStatus } from '../online-menu/PaymentConnectionCard';

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}

function activeReceiverLabel(summary: FinancialPendingSummary | null): string {
  switch (summary?.active_receiver) {
    case 'pagbank':
      return 'PagBank — confirmação automática';
    case 'mercado_pago':
      return 'Mercado Pago — confirmação automática';
    case 'direct_pix':
      return 'Pix com chave própria — confirmação manual pelo estabelecimento';
    case 'multiple':
      return 'Mais de um recebedor ativo — regularize para manter apenas um método';
    default:
      return 'Nenhum recebedor Pix ativo para novos pedidos';
  }
}

export function KomaPaymentsSettings({ apiBaseUrl, authHeaders }: Props) {
  const [statuses, setStatuses] = useState<Record<PaymentProvider, ReceiverConnectionStatus | null>>({
    pagbank: null,
    mercado_pago: null,
  });
  const [busy, setBusy] = useState<Record<PaymentProvider, boolean>>({ pagbank: false, mercado_pago: false });
  const [refreshKeys, setRefreshKeys] = useState({ pagbank: 0, mercado_pago: 0 });
  const [pendingSummary, setPendingSummary] = useState<FinancialPendingSummary | null>(null);
  const [pendingCenterOpen, setPendingCenterOpen] = useState(false);

  const authorization = authHeaders.Authorization || authHeaders.authorization || '';

  const loadPendingSummary = useCallback(
    async (signal?: AbortSignal) => {
      if (!authorization) return;
      try {
        const res = await fetchPendingReview(apiBaseUrl, authHeaders, {
          includeResolved: false,
          signal,
        });
        if (!signal?.aborted) setPendingSummary(res.summary);
      } catch {
        // Non-fatal here: provider cards remain independently operable.
      }
    },
    [apiBaseUrl, authorization],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPendingSummary(controller.signal);
    return () => controller.abort();
  }, [loadPendingSummary, refreshKeys]);

  const pagbankStatus = useCallback(
    (status: ReceiverConnectionStatus | null) => setStatuses(current => ({ ...current, pagbank: status })),
    [],
  );
  const mercadoPagoStatus = useCallback(
    (status: ReceiverConnectionStatus | null) => setStatuses(current => ({ ...current, mercado_pago: status })),
    [],
  );
  const pagbankBusy = useCallback((value: boolean) => setBusy(current => ({ ...current, pagbank: value })), []);
  const mercadoPagoBusy = useCallback(
    (value: boolean) => setBusy(current => ({ ...current, mercado_pago: value })),
    [],
  );
  const pagbankChanged = useCallback(
    () => setRefreshKeys(current => ({ pagbank: current.pagbank, mercado_pago: current.mercado_pago + 1 })),
    [],
  );
  const mercadoPagoChanged = useCallback(
    () => setRefreshKeys(current => ({ pagbank: current.pagbank + 1, mercado_pago: current.mercado_pago })),
    [],
  );
  const refreshAll = useCallback(
    () => setRefreshKeys(current => ({ pagbank: current.pagbank + 1, mercado_pago: current.mercado_pago + 1 })),
    [],
  );

  const blockedReason = (provider: PaymentProvider) => {
    const other = provider === 'pagbank' ? 'mercado_pago' : 'pagbank';
    if (!statuses.pagbank || !statuses.mercado_pago) {
      return 'Aguarde a consulta dos dois bancos. Se houver falha, atualize o status antes de conectar.';
    }
    if (busy[other]) return 'Aguarde a conclusão da operação no outro banco.';
    if (
      statuses[provider].connectionBlocked
      || statuses[other].connected
      || Object.values(statuses).some(status => status?.receiverProvider && status.receiverProvider !== provider)
    ) {
      return 'Desconecte o recebedor atual antes de conectar outro banco.';
    }
    return null;
  };

  const blockingCount = pendingSummary?.blocking_count ?? 0;

  return (
    <section aria-labelledby="koma-payments-heading" className="space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 id="koma-payments-heading" className="text-lg font-bold text-koma-foreground">
              Pagamentos online
            </h3>
            <p className="mt-1 text-sm text-koma-muted">
              Apenas um método fica ativo para novos pedidos: PagBank (automático), Mercado Pago (automático) ou Pix com chave própria (confirmação manual).
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPendingCenterOpen(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-koma-border bg-koma-panel px-3.5 text-sm font-semibold text-koma-foreground hover:bg-koma-raised"
          >
            <Wallet className="h-4 w-4 text-koma-accent" aria-hidden="true" />
            Central de pendências{blockingCount > 0 ? ` (${blockingCount})` : ''}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-koma-border bg-koma-panel px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-koma-accent" aria-hidden="true" />
            <span className="font-semibold text-koma-foreground">Método ativo agora:</span>
            <span className="text-koma-secondary">{activeReceiverLabel(pendingSummary)}</span>
          </div>
          <span className="text-xs text-koma-muted">
            Cobranças antigas mantêm o provedor original para conciliação.
          </span>
        </div>

        {blockingCount > 0 && pendingSummary && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-koma-warning-border bg-koma-warning-bg px-4 py-3">
            <div className="flex items-start gap-2.5 text-sm text-koma-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-koma-warning-text" aria-hidden="true" />
              <div>
                <p className="font-bold">
                  {blockingCount} {blockingCount === 1 ? 'cobrança Pix pendente bloqueia' : 'cobranças Pix pendentes bloqueiam'} desconexão ou troca de método
                </p>
                <p className="mt-0.5 text-xs text-koma-secondary">
                  Total em revisão: {formatCurrency(Number(pendingSummary.blocking_total_amount))} ({pendingSummary.by_situation.creation_failed} falha(s) de criação · {pendingSummary.by_situation.awaiting_payment} aguardando · {pendingSummary.by_situation.uncertain + pendingSummary.by_situation.provider_query_failed} incerta(s)/erro).
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPendingCenterOpen(true)}
              className="min-h-11 rounded-xl border border-koma-border bg-koma-card px-4 text-sm font-bold text-koma-foreground hover:bg-koma-raised"
            >
              Revisar pendências
            </button>
          </div>
        )}
      </header>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <PagBankConnectionCard
          apiBaseUrl={apiBaseUrl}
          authHeaders={authHeaders}
          connectBlockedReason={blockedReason('pagbank')}
          refreshKey={refreshKeys.pagbank}
          onStatusChange={pagbankStatus}
          onBusyChange={pagbankBusy}
          onConnectionChange={pagbankChanged}
          onOpenPendingReview={() => setPendingCenterOpen(true)}
        />
        <MercadoPagoConnectionCard
          apiBaseUrl={apiBaseUrl}
          authHeaders={authHeaders}
          connectBlockedReason={blockedReason('mercado_pago')}
          refreshKey={refreshKeys.mercado_pago}
          onStatusChange={mercadoPagoStatus}
          onBusyChange={mercadoPagoBusy}
          onConnectionChange={mercadoPagoChanged}
          onOpenPendingReview={() => setPendingCenterOpen(true)}
        />
      </div>

      <DirectPixSetup
        apiBaseUrl={apiBaseUrl}
        authHeaders={authHeaders}
        onChanged={refreshAll}
        activeReceiver={pendingSummary?.active_receiver ?? null}
        blockingCount={blockingCount}
        blockingTotalAmount={pendingSummary?.blocking_total_amount}
        onOpenPendingReview={() => setPendingCenterOpen(true)}
      />

      <p className="text-xs text-koma-muted">
        O KÔMA não cobra taxa sobre suas vendas. Consulte as tarifas do banco conectado.
      </p>

      <FinancialPendingCenter
        apiBaseUrl={apiBaseUrl}
        authHeaders={authHeaders}
        open={pendingCenterOpen}
        onClose={() => setPendingCenterOpen(false)}
        onResolved={refreshAll}
      />
    </section>
  );
}
