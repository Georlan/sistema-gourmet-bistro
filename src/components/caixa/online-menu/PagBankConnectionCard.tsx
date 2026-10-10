import { CheckCircle2, CreditCard, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch, authRequestErrorMessage } from '../../../utils/authRequest';

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}

type PaymentAccountStatus = {
  provider: 'pagbank';
  configured?: boolean;
  environment?: string;
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
  provider: 'pagbank',
  connected: false,
  status: 'disconnected',
  provider_user_id: null,
  token_expires_at: null,
};

export function PagBankConnectionCard({ apiBaseUrl, authHeaders }: Props) {
  const [account, setAccount] = useState<PaymentAccountStatus>(disconnectedStatus);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const completionStarted = useRef(false);

  const loadStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await authFetch(`${apiBaseUrl}/payments/pagbank/status`, {
        headers: authHeaders,
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || 'Não foi possível consultar o PagBank.');
      }
      setAccount({
        provider: 'pagbank',
        configured: payload.configured === true,
        environment: String(payload.environment || 'sandbox'),
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
        text: authRequestErrorMessage(error, 'Não foi possível consultar o PagBank.'),
      });
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, authHeaders]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthResult = params.get('pagbank');

    const code = params.get('code');
    const state = params.get('state');
    if (oauthResult) {
      params.delete('pagbank');
      params.delete('tab');
      params.delete('code');
      params.delete('state');
      const query = params.toString();
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    }
    if (oauthResult === 'authorized' && !completionStarted.current) {
      completionStarted.current = true;
      const expected = sessionStorage.getItem('koma_pagbank_oauth_state');
      sessionStorage.removeItem('koma_pagbank_oauth_state');
      if (!code || !state || expected !== state) {
        setFeedback({ type: 'error', text: 'Autorização inválida. Inicie a conexão novamente neste navegador.' });
        void loadStatus();
        return;
      }
      setIsConnecting(true);
      void (async () => {
        try {
          const response = await authFetch(`${apiBaseUrl}/payments/pagbank/complete`, {
            method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ code, state }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.detail || 'Não foi possível concluir a conexão PagBank.');
          setFeedback({ type: 'success', text: 'PagBank conectado. A conta do restaurante receberá os novos Pix.' });
        } catch (error) {
          setFeedback({ type: 'error', text: authRequestErrorMessage(error, 'Não foi possível concluir a conexão PagBank.') });
        } finally {
          setIsConnecting(false);
          await loadStatus();
        }
      })();
      return;
    }
    if (oauthResult === 'cancelled') {
      sessionStorage.removeItem('koma_pagbank_oauth_state');
      setFeedback({ type: 'info', text: 'Conexão com PagBank cancelada. Nenhuma conta foi alterada.' });
    }
    void loadStatus();
  }, [loadStatus, apiBaseUrl, authHeaders]);


  const connect = async () => {
    setIsConnecting(true);
    setFeedback(null);
    try {
      const response = await authFetch(`${apiBaseUrl}/payments/pagbank/connect`, {
        headers: authHeaders,
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || 'Não foi possível iniciar a conexão com PagBank.');
      }
      if (typeof payload.authorization_url !== 'string' || !payload.authorization_url) {
        throw new Error('O backend não retornou a autorização do PagBank.');
      }

      const authorizationUrl = new URL(payload.authorization_url);
      if (authorizationUrl.protocol !== 'https:' || !['connect.pagbank.com.br', 'connect.sandbox.pagbank.com.br'].includes(authorizationUrl.hostname)) {
        throw new Error('URL de autorização do PagBank inválida.');
      }
      const oauthState = authorizationUrl.searchParams.get('state');
      if (!oauthState) throw new Error('Estado de autorização PagBank ausente.');
      sessionStorage.setItem('koma_pagbank_oauth_state', oauthState);
      window.location.assign(authorizationUrl.toString());
    } catch (error) {
      setFeedback({
        type: 'error',
        text: authRequestErrorMessage(error, 'Não foi possível conectar o PagBank.'),
      });
      setIsConnecting(false);
    }
  };

  const disconnect = async () => {
    setIsConnecting(true);
    try {
      const response = await authFetch(`${apiBaseUrl}/payments/pagbank/disconnect`, { method: 'POST', headers: authHeaders });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'Não foi possível desconectar o PagBank.');
      setFeedback({ type: 'info', text: 'PagBank desconectado. Novos Pix não serão gerados nessa conta.' });
      await loadStatus();
    } catch (error) {
      setFeedback({ type: 'error', text: authRequestErrorMessage(error, 'Não foi possível desconectar o PagBank.') });
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5" aria-labelledby="pagbank-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-sky-500/20 bg-sky-500/10 text-sky-500">
            <CreditCard size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="pagbank-heading" className="text-sm font-black text-koma-foreground">PagBank</h3>
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
                  {account.status === 'error' ? 'Conta incompatível' : 'Não conectado'}
                </span>
              )}
            </div>
            <p className="mt-1.5 max-w-2xl text-[10px] leading-relaxed text-koma-muted">
              Receba diretamente na conta PagBank do restaurante, com confirmação automática. O KÔMA não cobra taxa por venda; podem existir tarifas do PagBank. Sua conta deve ter uma chave Pix ativa.
            </p>
            {account.connected && account.provider_user_id && (
              <p className="mt-2 text-[9px] text-koma-subtle">
                Conta PagBank vinculada · ID {account.provider_user_id}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {account.connected && <button type="button" onClick={() => void disconnect()} disabled={isConnecting || isLoading} className="h-10 rounded-xl border border-koma-border px-3 text-xs text-koma-foreground disabled:opacity-50">Desconectar</button>}
          <button
            type="button"
            onClick={() => void loadStatus()}
            disabled={isLoading || isConnecting}
            className="grid h-10 w-10 place-items-center rounded-xl border border-koma-border bg-koma-raised text-koma-muted transition hover:border-emerald-500/35 hover:text-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Atualizar status do PagBank"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={isLoading || isConnecting || !account.configured}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-sky-500 px-4 text-[10px] font-black text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {isConnecting ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
            {account.connected ? 'Reconectar' : account.configured ? 'Conectar PagBank' : 'Conexão em preparação'}
          </button>
        </div>
      </div>

      {!isLoading && <p className="mt-3 text-xs text-koma-muted">{!account.configured ? 'A KÔMA precisa concluir o cadastro da aplicação no PagBank para liberar esta conexão.' : account.environment === 'sandbox' ? 'Ambiente de testes: esta conexão não recebe dinheiro real.' : 'Ambiente de produção.'}</p>}
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
