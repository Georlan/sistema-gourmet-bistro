import { PaymentConnectionCard, type ReceiverCoordinationProps } from './PaymentConnectionCard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch, authRequestErrorMessage } from '../../../utils/authRequest';

interface Props extends ReceiverCoordinationProps {
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

export function MercadoPagoConnectionCard({ apiBaseUrl, authHeaders, connectBlockedReason, refreshKey, onStatusChange, onBusyChange, onConnectionChange }: Props) {
  const [account, setAccount] = useState<PaymentAccountStatus>(disconnectedStatus);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const statusError = useRef<string | null>(null);
  const setConnecting = useCallback((value: boolean) => {
    setIsConnecting(value);
    onBusyChange?.(value);
  }, [onBusyChange]);

  const loadStatus = useCallback(async () => {
    setIsLoading(true);
    onStatusChange?.(null);
    try {
      const response = await authFetch(`${apiBaseUrl}/payments/mercado-pago/status`, {
        headers: authHeaders,
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || 'Não foi possível consultar o Mercado Pago.');
      }
      if (typeof payload.connected !== 'boolean'
        || (payload.receiver_provider != null && typeof payload.receiver_provider !== 'string')
        || (payload.connection_blocked !== undefined && typeof payload.connection_blocked !== 'boolean')) {
        throw new Error('Não foi possível consultar o Mercado Pago.');
      }
      const previousStatusError = statusError.current;
      setFeedback(current => current?.text === previousStatusError ? null : current);
      statusError.current = null;
      setAccount({
        provider: 'mercado_pago',
        connected: payload.connected === true,
        status: String(payload.status || 'disconnected'),
        provider_user_id:
          typeof payload.provider_user_id === 'string' ? payload.provider_user_id : null,
        token_expires_at:
          typeof payload.token_expires_at === 'string' ? payload.token_expires_at : null,
      });
      onStatusChange?.({ connected: payload.connected === true, receiverProvider: typeof payload.receiver_provider === 'string' ? payload.receiver_provider : payload.connected === true ? 'mercado_pago' : null, connectionBlocked: payload.connection_blocked === true });
      return payload.connected === true;
    } catch (error) {
      setAccount(disconnectedStatus);
      statusError.current = authRequestErrorMessage(error, 'Não foi possível consultar o Mercado Pago.');
      setFeedback({
        type: 'error',
        text: statusError.current,
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, authHeaders, onStatusChange]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthResult = params.get('mercado_pago');

    if (oauthResult === 'cancelled') {
      setFeedback({ type: 'info', text: 'Conexão com Mercado Pago cancelada. Nenhuma conta foi alterada.' });
    } else if (oauthResult === 'invalid_seller') {
      setFeedback({
        type: 'error',
        text: 'Essa é a conta proprietária da aplicação KÔMA. Conecte a conta Mercado Pago própria do restaurante para receber seus pagamentos.',
      });
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

    if (oauthResult === 'connected') {
      void loadStatus().then(connected => {
        if (connected) {
          setFeedback({ type: 'success', text: 'Mercado Pago conectado. Pix habilitado no cardápio online.' });
          onConnectionChange?.();
        } else {
          setFeedback({ type: 'error', text: 'Não foi possível confirmar a conexão do Mercado Pago. Atualize o status antes de continuar.' });
        }
      });
    } else {
      void loadStatus();
    }
  }, [loadStatus, onConnectionChange, refreshKey]);

  const connect = async () => {
    if (connectBlockedReason) return;
    setConnecting(true);
    setFeedback(null);
    try {
      const response = await authFetch(`${apiBaseUrl}/payments/mercado-pago/connect`, {
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
        text: authRequestErrorMessage(error, 'Não foi possível conectar o Mercado Pago.'),
      });
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    setConnecting(true);
    try {
      const response = await authFetch(`${apiBaseUrl}/payments/mercado-pago/disconnect`, { method: 'POST', headers: authHeaders });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || 'Não foi possível desconectar o Mercado Pago.');
      setFeedback({ type: 'info', text: 'Mercado Pago desconectado. Novos Pix não serão gerados nessa conta.' });
      await loadStatus();
      onConnectionChange?.();
    } catch (error) {
      setFeedback({ type: 'error', text: authRequestErrorMessage(error, 'Não foi possível desconectar o Mercado Pago.') });
    } finally {
      setConnecting(false);
    }
  };

  return <PaymentConnectionCard name="Mercado Pago" headingId="mercado-pago-heading" connected={account.connected}
    loading={isLoading} busy={isConnecting} connectBlockedReason={connectBlockedReason} onConnect={() => void connect()} onRefresh={() => void loadStatus()} onDisconnect={() => void disconnect()} feedback={feedback}>
    {account.status === 'error' && <p className="mt-3 text-xs text-rose-600 dark:text-rose-300">Conecte a conta própria do restaurante.</p>}
  </PaymentConnectionCard>;
}
