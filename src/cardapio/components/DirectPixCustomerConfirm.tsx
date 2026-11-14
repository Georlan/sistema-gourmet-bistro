import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, Loader2 } from "lucide-react";
import { API_BASE_URL } from "../../config/api";
import {
  type OrderPaymentStatus,
  type StoredOrder,
  reportDirectPixCustomerPayment,
} from "../orderTracking";

interface DirectPixCustomerConfirmProps {
  order: Pick<
    StoredOrder,
    "id" | "numero_pedido" | "idempotency_key" | "tracking_token" | "tracking_url" | "pagamento"
  >;
  apiBaseUrl?: string;
  onReported?: (pagamento: OrderPaymentStatus) => void;
}

const SETTLED_OR_CLOSED_STATUSES = new Set([
  "approved",
  "paid",
  "cancelled",
  "canceled",
  "expired",
  "rejected",
  "refunded",
]);

export function DirectPixCustomerConfirm({
  order,
  apiBaseUrl = API_BASE_URL,
  onReported,
}: DirectPixCustomerConfirmProps) {
  const pagamento = order.pagamento;
  const serverReported = Boolean(pagamento?.cliente_informou_pagamento);
  const [localReported, setLocalReported] = useState(serverReported);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copyFeedback, setCopyFeedback] = useState("");

  useEffect(() => {
    setLocalReported(Boolean(pagamento?.cliente_informou_pagamento));
    setError("");
  }, [order.id, pagamento?.cliente_informou_pagamento]);

  const rawStatus = String(pagamento?.status || "").toLowerCase();
  if (!pagamento?.confirmacao_manual || SETTLED_OR_CLOSED_STATUSES.has(rawStatus)) {
    return null;
  }

  const canAuthenticateReport = Boolean(
    order.tracking_token?.trim()
    || order.tracking_url?.trim()
    || order.idempotency_key?.trim(),
  );

  const reported = serverReported || localReported;

  const handleConfirm = async () => {
    if (busy || reported) return;
    setBusy(true);
    setError("");
    try {
      const nextPayment = await reportDirectPixCustomerPayment(order, apiBaseUrl);
      setLocalReported(true);
      onReported?.(nextPayment);
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim()
          ? err.message
          : "Não foi possível informar o pagamento agora. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-2 text-left" data-testid="direct-pix-customer-confirm">
      <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-center">
        <p className="text-[11px] text-koma-muted">Código curto para localizar seu pedido</p>
        <p className="my-1 text-xl font-black tracking-wide text-emerald-300">Pedido #{order.numero_pedido}</p>
        <button type="button" className="min-h-10 rounded-lg border border-emerald-500/50 px-3 text-xs font-semibold text-koma-foreground" onClick={() => {
          void navigator.clipboard.writeText('Pedido #' + order.numero_pedido)
            .then(() => setCopyFeedback('Número do pedido copiado.'))
            .catch(() => setCopyFeedback('Copie o número exibido acima.'));
        }}>Copiar número do pedido</button>
        {copyFeedback && <p role="status" className="mt-1 text-[11px] text-koma-muted">{copyFeedback}</p>}
        <p className="mt-2 text-xs leading-relaxed text-koma-muted">Você pode pagar e fechar esta página. O restaurante já consegue localizar o pedido e conferir o Pix, mesmo sem tocar em “Já fiz o Pix”.</p>
      </div>

      {reported ? (
        <div
          role="status"
          data-testid="direct-pix-customer-reported-banner"
          className="flex items-start gap-2.5 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2.5 text-emerald-200"
        >
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs font-bold leading-snug text-emerald-300">
              Pagamento informado. Aguardando confirmação do restaurante.
            </p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-koma-muted">
              O restaurante conferirá o recebimento na conta bancária para liberar o preparo.
            </p>
          </div>
        </div>
      ) : (
        canAuthenticateReport && (
          <button
            type="button"
            disabled={busy}
            data-testid="direct-pix-customer-report-btn"
            onClick={() => void handleConfirm()}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-black uppercase tracking-wide text-white shadow transition hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Avisando restaurante…
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Já fiz o Pix
              </>
            )}
          </button>
        )
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] font-semibold text-rose-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}
