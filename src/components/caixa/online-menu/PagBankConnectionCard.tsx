import { PaymentConnectionCard, type ReceiverCoordinationProps } from './PaymentConnectionCard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch, authRequestErrorMessage } from '../../../utils/authRequest';
import { forgetPagBankState, matchesPagBankState, rememberPagBankState } from '../../../utils/pagbankOAuthState';

interface Props extends ReceiverCoordinationProps {
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

export function PagBankConnectionCard({ apiBaseUrl, authHeaders, connectBlockedReason, refreshKey, onStatusChange, onBusyChange, onConnectionChange }: Props) {
  const [account, setAccount] = useState<PaymentAccountStatus>(disconnectedStatus);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const completionStarted = useRef(false);
  const setConnecting = useCallback((value: boolean) => {
    setIsConnecting(value);
    onBusyChange?.(value);
  }, [onBusyChange]);

  const loadStatus = useCallback(async () => {
    setIsLoading(true);
    onStatusChange?.(null);
    try {
      const response = await authFetch(`${apiBaseUrl}/payments/pagbank/status`, {
        headers: authHeaders,
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(response.status === 404 ? 'A conexão PagBank está temporariamente indisponível. Tente atualizar mais tarde.' : 'Não foi possível consultar o PagBank. Tente novamente.');
      }
      if (typeof payload.connected !== 'boolean'
        || (payload.receiver_provider != null && typeof payload.receiver_provider !== 'string')
        || (payload.connection_blocked !== undefined && typeof payload.connection_blocked !== 'boolean')) {
        throw new Error('Não foi possível consultar o PagBank. Tente novamente.');
      }
      setFeedback(current => current?.text === 'A conexão PagBank está temporariamente indisponível. Tente atualizar mais tarde.' || current?.text === 'Não foi possível consultar o PagBank. Tente novamente.' ? null : current);
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
      onStatusChange?.({ connected: payload.connected === true, receiverProvider: typeof payload.receiver_provider === 'string' ? payload.receiver_provider : payload.connected === true ? 'pagbank' : null, connectionBlocked: payload.connection_blocked === true });
    } catch (error) {
      setAccount(current => ({ ...current, configured: false, connected: false }));
      setFeedback({
        type: 'error',
        text: authRequestErrorMessage(error, 'Não foi possível consultar o PagBank.'),
      });
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, authHeaders, onStatusChange]);

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
      if (!code || !state || !matchesPagBankState(state)) {
        setFeedback({ type: 'error', text: 'Autorização inválida. Inicie a conexão novamente neste navegador.' });
        void loadStatus();
        return;
      }
      setConnecting(true);
      void (async () => {
        let changed = false;
        try {
          const response = await authFetch(`${apiBaseUrl}/payments/pagbank/complete`, {
            method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ code, state }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.detail || 'Não foi possível concluir a conexão PagBank.');
          changed = payload.status === 'connected';
          if (payload.status === 'sandbox_evidence_captured') {
            setFeedback({ type: 'success', text: 'OAuth Sandbox validado e evidência registrada. Nenhuma conta foi conectada para receber Pix.' });
          } else {
            setFeedback({ type: 'success', text: payload.environment === 'sandbox'
              ? 'PagBank conectado em ambiente de testes. Pix de teste habilitado no cardápio online.'
              : 'PagBank conectado. Pix habilitado no cardápio online.' });
          }
        } catch (error) {
          setFeedback({ type: 'error', text: authRequestErrorMessage(error, 'Não foi possível concluir a conexão PagBank.') });
        } finally {
          forgetPagBankState(state);
          setConnecting(false);
          await loadStatus();
          if (changed) onConnectionChange?.();
        }
      })();
      return;
    }
    if (oauthResult === 'cancelled') {
      forgetPagBankState();
      setFeedback({ type: 'info', text: 'Conexão com PagBank cancelada. Nenhuma conta foi alterada.' });
    }
    void loadStatus();
  }, [loadStatus, apiBaseUrl, authHeaders, setConnecting, onConnectionChange, refreshKey]);


  const connect = async () => {
    if (connectBlockedReason) return;
    setConnecting(true);
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
      rememberPagBankState(oauthState);
      window.location.assign(authorizationUrl.toString());
    } catch (error) {
      setFeedback({
        type: 'error',
        text: authRequestErrorMessage(error, 'Não foi possível conectar o PagBank.'),
      });
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    setConnecting(true);
    try {
      const response = await authFetch(`${apiBaseUrl}/payments/pagbank/disconnect`, { method: 'POST', headers: authHeaders });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'Não foi possível desconectar o PagBank.');
      setFeedback({ type: 'info', text: 'PagBank desconectado. Novos Pix não serão gerados nessa conta.' });
      await loadStatus();
      onConnectionChange?.();
    } catch (error) {
      setFeedback({ type: 'error', text: authRequestErrorMessage(error, 'Não foi possível desconectar o PagBank.') });
    } finally {
      setConnecting(false);
    }
  };

  return <PaymentConnectionCard name="PagBank" headingId="pagbank-heading" connected={account.connected}
    loading={isLoading} busy={isConnecting} available={account.configured === true}
    connectBlockedReason={connectBlockedReason}
    onConnect={() => void connect()} onRefresh={() => void loadStatus()} onDisconnect={() => void disconnect()} feedback={feedback}>
    {!isLoading && !account.configured && <p className="mt-3 text-xs text-koma-muted">A conexão estará disponível em breve.</p>}
    {!isLoading && account.configured && account.environment === 'sandbox' && <p className="mt-3 text-xs text-amber-600 dark:text-amber-300">Ambiente de testes: esta conexão não recebe dinheiro real.</p>}
  </PaymentConnectionCard>;
}
