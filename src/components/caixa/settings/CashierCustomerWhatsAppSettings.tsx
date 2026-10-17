import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch, authRequestErrorMessage } from '../../../utils/authRequest';

type CustomerNoticeStatus = {
  customer_notices_available: boolean;
  customer_notices_enabled: boolean;
  customer_notices_requested: boolean;
};

/** Separate tenant permission; no operator number is required for customer updates. */
export function CashierCustomerWhatsAppSettings({ apiBaseUrl, authHeaders }: {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}) {
  const scopeKey = JSON.stringify(Object.entries(authHeaders).sort(([a], [b]) => a.localeCompare(b)));
  const headers = useMemo(() => ({ ...authHeaders }), [scopeKey]);
  const [status, setStatus] = useState<CustomerNoticeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await authFetch(`${apiBaseUrl}/caixa/configuracoes/whatsapp`, {
      headers, cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || 'Não foi possível consultar a autorização.');
    setStatus({
      customer_notices_available: data.customer_notices_available === true,
      customer_notices_enabled: data.customer_notices_enabled === true,
      customer_notices_requested: data.customer_notices_requested === true,
    });
  }, [apiBaseUrl, headers]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void refresh().catch((err) => {
      if (!cancelled) setFeedback(authRequestErrorMessage(err, 'Falha ao consultar avisos.'));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [refresh]);

  async function setPermission(enabled: boolean) {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await authFetch(`${apiBaseUrl}/caixa/configuracoes/whatsapp/customer-notices`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Não foi possível alterar os avisos.');
      await refresh();
      setFeedback(enabled
        ? 'Autorização salva. O cliente poderá escolher receber avisos no checkout.'
        : 'Avisos desativados. Mensagens pendentes desse restaurante foram canceladas.');
    } catch (err) {
      setFeedback(authRequestErrorMessage(err, 'Não foi possível atualizar os avisos.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5" aria-label="Avisos pelo WhatsApp aos clientes">
      <h3 className="text-sm font-black text-koma-foreground">Avisos para clientes pelo KÔMA Business</h3>
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-koma-muted">
        Permita que seus clientes escolham receber atualizações do pedido por WhatsApp.
        O remetente é a conta do KÔMA, não o telefone do restaurante.
        Não exige cadastrar o número que recebe comandas.
      </p>
      <p className="mt-3 text-xs text-koma-foreground" role="status">
        Estado: <strong>{loading ? 'Verificando...' : !status ? 'Indisponível para consulta'
          : status.customer_notices_enabled ? 'Ativo para este restaurante'
          : status.customer_notices_requested ? 'Autorizado — aguardando liberação da plataforma'
          : 'Desativado'}</strong>
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {status?.customer_notices_requested ? (
          <button type="button" disabled={busy || loading} onClick={() => void setPermission(false)}
            className="min-h-11 rounded-xl border border-koma-border bg-koma-raised px-4 py-2 text-xs font-bold text-koma-foreground disabled:opacity-50">
            Desativar avisos aos clientes
          </button>
        ) : (
          <button type="button" disabled={busy || loading || !status?.customer_notices_available}
            onClick={() => void setPermission(true)}
            className="min-h-11 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50">
            Autorizar avisos aos clientes
          </button>
        )}
        {status && !status.customer_notices_available && (
          <span className="text-xs text-koma-muted">Aguardando liberação do KÔMA para este restaurante.</span>
        )}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-koma-muted">
        A opção no checkout fica desmarcada por padrão. Somente pedidos com consentimento
        do cliente recebem avisos de status, sem promoções. O cliente pode parar os avisos a qualquer momento.
      </p>
      {feedback && <p className="mt-3 text-xs text-koma-foreground" role="alert">{feedback}</p>}
    </section>
  );
}
