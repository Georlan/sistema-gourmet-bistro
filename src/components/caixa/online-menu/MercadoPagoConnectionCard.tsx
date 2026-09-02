import { CheckCircle2, CreditCard, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}

type PaymentAccountStatus = {
  provider: 'mercado_pago';
  connected: boolean;
  status: 'active' | 'disconnected' | 'error' | string;
  provider_user_id: string | null;
  token_expires_at: string | null;
};

type Feedback = {
  type: 'success' | 'error' | 'info';
  text: string;
};

const disconnectedStatus: PaymentAccountStatus = {
  provider: 'mercado_pago',
  connected: false,
  status: 'disconnected',
  provider_user_id: null,
  token_expires_at: null,
};

export function MercadoPagoConnectionCard({ apiBaseUrl, authHeaders }: Props) {
  const [account, setAccount] = useState<PaymentAccountStatus>(disconnectedStatus);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const loadStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/payments/mercado-pago/status`, {
        headers: authHeaders,
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || 'Não foi possível consultar o Mercado Pago.');
      }
      setAccount({
        provider: 'mercado_pago',
        connected: payload.connected === true,
        status: String(payload.status || 'disconnected'),
        provider_user_id:
          typeof payload.provider_user_id === 'string' ? payload.provider_user_id : null,
        token_expires_at:
          typeof payload.token_expires_at === 'string' ? payload.token_expires_at : null,
      });
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'Falha ao consultar Mercado Pago.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, authHeaders]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthResult = params.get('mercado_pago');

    if (oauthResult === 'connected') {
      setFeedback({ type: 'success', text: 'Mercado Pago conectado. O Pix online já pode ser homologado.' });
    } else if (oauthResult === 'cancelled') {
      setFeedback({ type: 'info', text: 'Conexão com Mercado Pago cancelada. Nenhuma conta foi alterada.' });
    }

    if (oauthResult) {
      params.delete('mercado_pago');
      params.delete('tab');
      const query = params.toString();
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
      );
    }

    void loadStatus();
  }, [loadStatus]);

  const connect = async () => {
    setIsConnecting(true);
    setFeedback(null);
    try {
      const response = await fetch(`${apiBaseUrl}/payments/mercado-pago/connect`, {
        headers: authHeaders,
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || 'Não foi possível iniciar a conexão com Mercado Pago.');
      }
      if (typeof payload.authorization_url !== 'string' || !payload.authorization_url) {
        throw new Error('O backend não retornou a autorização do Mercado Pago.');
      }

      const authorizationUrl = new URL(payload.authorization_url);
      if (authorizationUrl.protocol !== 'https:' || authorizationUrl.hostname !== 'auth.mercadopago.com') {
        throw new Error('URL de autorização do Mercado Pago inválida.');
      }
      window.location.assign(authorizationUrl.toString());
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'Falha ao conectar Mercado Pago.',
      });
      setIsConnecting(false);
    }
  };

  return (
    <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5" aria-labelledby="mercado-pago-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-sky-500/20 bg-sky-500/10 text-sky-500">
            <CreditCard size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="mercado-pago-heading" className="text-sm font-black text-koma-foreground">Mercado Pago</h3>
              {isLoading ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-koma-border px-2 py-1 text-[9px] font-bold text-koma-muted">
                  <Loader2 size={10} className="animate-spin" /> Consultando
                </span>
              ) : account.connected ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[9px] font-black text-emerald-600 dark:text-emerald-300">
                  <CheckCircle2 size={10} /> Conectado
                </span>
              ) : (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[9px] font-black text-amber-700 dark:text-amber-300">
                  Não conectado
                </span>
              )}
            </div>
            <p className="mt-1.5 max-w-2xl text-[10px] leading-relaxed text-koma-muted">
              Conecte a conta que receberá os pedidos. O cliente paga por Pix no cardápio e o KÔMA só libera o pedido após a confirmação financeira do Mercado Pago.
            </p>
            {account.connected && account.provider_user_id && (
              <p className="mt-2 text-[9px] text-koma-subtle">
                Conta Mercado Pago vinculada · ID {account.provider_user_id}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => void loadStatus()}
            disabled={isLoading || isConnecting}
            className="grid h-10 w-10 place-items-center rounded-xl border border-koma-border bg-koma-raised text-koma-muted transition hover:border-emerald-500/35 hover:text-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Atualizar status do Mercado Pago"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={isLoading || isConnecting}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-sky-500 px-4 text-[10px] font-black text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {isConnecting ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
            {account.connected ? 'Reconectar' : 'Conectar Mercado Pago'}
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`mt-4 rounded-xl border px-3 py-2.5 text-[10px] leading-relaxed ${
            feedback.type === 'success'
              ? 'border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-300'
              : feedback.type === 'error'
                ? 'border-rose-500/25 bg-rose-500/[0.08] text-rose-700 dark:text-rose-300'
                : 'border-sky-500/25 bg-sky-500/[0.08] text-sky-700 dark:text-sky-300'
          }`}
          role="status"
        >
          {feedback.text}
        </div>
      )}
    </section>
  );
}
