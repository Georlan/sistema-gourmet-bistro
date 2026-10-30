import { PagBankConnectionCard } from '../online-menu/PagBankConnectionCard';
import { MercadoPagoConnectionCard } from '../online-menu/MercadoPagoConnectionCard';
import { useCallback, useState } from 'react';
import type { PaymentProvider, ReceiverConnectionStatus } from '../online-menu/PaymentConnectionCard';

interface Props { apiBaseUrl: string; authHeaders: Record<string, string>; }
export function KomaPaymentsSettings({ apiBaseUrl, authHeaders }: Props) {
  const [statuses, setStatuses] = useState<Record<PaymentProvider, ReceiverConnectionStatus | null>>({ pagbank: null, mercado_pago: null });
  const [busy, setBusy] = useState<Record<PaymentProvider, boolean>>({ pagbank: false, mercado_pago: false });
  const [refreshKeys, setRefreshKeys] = useState({ pagbank: 0, mercado_pago: 0 });
  const pagbankStatus = useCallback((status: ReceiverConnectionStatus | null) => setStatuses(current => ({ ...current, pagbank: status })), []);
  const mercadoPagoStatus = useCallback((status: ReceiverConnectionStatus | null) => setStatuses(current => ({ ...current, mercado_pago: status })), []);
  const pagbankBusy = useCallback((value: boolean) => setBusy(current => ({ ...current, pagbank: value })), []);
  const mercadoPagoBusy = useCallback((value: boolean) => setBusy(current => ({ ...current, mercado_pago: value })), []);
  const pagbankChanged = useCallback(() => setRefreshKeys(current => ({ ...current, mercado_pago: current.mercado_pago + 1 })), []);
  const mercadoPagoChanged = useCallback(() => setRefreshKeys(current => ({ ...current, pagbank: current.pagbank + 1 })), []);
  const blockedReason = (provider: PaymentProvider) => {
    const other = provider === 'pagbank' ? 'mercado_pago' : 'pagbank';
    if (!statuses.pagbank || !statuses.mercado_pago) return 'Aguarde a consulta dos dois bancos. Se houver falha, atualize o status antes de conectar.';
    if (busy[other]) return 'Aguarde a conclusão da operação no outro banco.';
    if (statuses[provider].connectionBlocked || statuses[other].connected || Object.values(statuses).some(status => status?.receiverProvider && status.receiverProvider !== provider)) {
      return 'Desconecte o recebedor atual antes de conectar outro banco.';
    }
    return null;
  };
  return <section aria-labelledby="koma-payments-heading" className="space-y-4">
    <header>
      <h3 id="koma-payments-heading" className="text-lg font-bold text-koma-foreground">Pagamentos online</h3>
      <p className="mt-1 text-sm text-koma-muted">Conecte um banco recebedor por vez. Após a conexão, o Pix é habilitado automaticamente no cardápio online.</p>
    </header>
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <PagBankConnectionCard apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} connectBlockedReason={blockedReason('pagbank')} refreshKey={refreshKeys.pagbank} onStatusChange={pagbankStatus} onBusyChange={pagbankBusy} onConnectionChange={pagbankChanged}/>
      <MercadoPagoConnectionCard apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} connectBlockedReason={blockedReason('mercado_pago')} refreshKey={refreshKeys.mercado_pago} onStatusChange={mercadoPagoStatus} onBusyChange={mercadoPagoBusy} onConnectionChange={mercadoPagoChanged}/>
    </div>
    <p className="text-xs text-koma-muted">O KÔMA não cobra taxa sobre suas vendas. Consulte as tarifas do banco conectado.</p>
  </section>;
}
