import React from 'react';
import { Bell } from 'lucide-react';

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  onOpenOrders: () => void;
}

type State = 'checking' | 'unavailable' | 'ready' | 'enabled' | 'busy' | 'denied' | 'error';

export function StaffPushNotifications({ apiBaseUrl, authHeaders, onOpenOrders }: Props) {
  const [state, setState] = React.useState<State>('checking');
  const [publicKey, setPublicKey] = React.useState('');
  const [message, setMessage] = React.useState('');
  const root = `${apiBaseUrl}/caixa/notificacoes`;
  const authorization = authHeaders.Authorization;

  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('koma-open') === 'orders') {
      url.searchParams.delete('koma-open');
      window.history.replaceState(window.history.state, '', url);
      onOpenOrders();
    }
  }, [onOpenOrders]);

  React.useEffect(() => {
    let cancelled = false;
    const inspect = async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (!cancelled) setState('unavailable');
        return;
      }
      try {
        const response = await fetch(`${root}/config`, { headers: { Authorization: authorization }, cache: 'no-store' });
        if (!response.ok) throw new Error();
        const config = await response.json();
        if (!config.enabled || !config.publicKey) {
          if (!cancelled) setState('unavailable');
          return;
        }
        const registration = await navigator.serviceWorker.getRegistration('/');
        const subscription = await registration?.pushManager.getSubscription();
        let enabled = false;
        if (subscription) {
          const status = await fetch(`${root}/status`, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) });
          if (!status.ok) throw new Error();
          enabled = (await status.json()).enabled === true;
        }
        if (!cancelled) {
          setPublicKey(config.publicKey);
          setState(enabled ? 'enabled' : Notification.permission === 'denied' ? 'denied' : 'ready');
        }
      } catch {
        // Configuration failures must not interrupt the running operation.
        if (!cancelled) setState('unavailable');
      }
    };
    void inspect();
    return () => { cancelled = true; };
  }, [root, authorization]);

  const change = async () => {
    const disabling = state === 'enabled';
    setState('busy');
    setMessage('');
    try {
      // Permission must be requested directly from the operator's gesture.
      if (!disabling && await Notification.requestPermission() !== 'granted') {
        setState('denied');
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration('/');
      if (!registration?.active) throw new Error('Recarregue o KÔMA e tente ativar novamente.');
      let subscription = await registration.pushManager.getSubscription();
      if (!disabling && !subscription) {
        const raw = window.atob(publicKey.replace(/-/g, '+').replace(/_/g, '/'));
        const applicationServerKey = Uint8Array.from(raw, c => c.charCodeAt(0));
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      }
      if (!subscription) throw new Error('A assinatura deste aparelho não está disponível.');
      const body = disabling ? { endpoint: subscription.endpoint } : subscription.toJSON();
      const response = await fetch(`${root}/subscription`, {
        method: disabling ? 'DELETE' : 'PUT', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || 'Não foi possível salvar os avisos. Tente novamente.');
      }
      // Keep the browser subscription: customer tracking may use the same SW.
      setState(disabling ? 'ready' : 'enabled');
      setMessage(disabling ? 'Avisos da equipe desativados neste aparelho.' : 'Avisos ativados. Faça um pedido de teste para conferir o recebimento neste aparelho.');
    } catch (error) {
      setState(disabling ? 'enabled' : 'error');
      setMessage(error instanceof Error ? error.message : 'Não foi possível ativar os avisos.');
    }
  };

  if (state === 'checking' || state === 'unavailable') return null;
  return <section aria-label="Avisos fora do KÔMA" className="mx-3 my-2 rounded-xl border border-koma-border bg-koma-panel p-3">
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0"><p className="flex items-center gap-2 text-sm font-bold"><Bell size={16} />Avisos de pedido novo</p>
        <p className="mt-1 text-xs text-koma-muted">{state === 'enabled' ? 'Ativados neste aparelho. Dependem da internet e das permissões do Android.' : state === 'denied' ? 'Libere as notificações deste site nas configurações do navegador.' : 'Receba avisos mesmo fora da tela do KÔMA. Cada pessoa ativa no próprio celular.'}</p></div>
      <button type="button" disabled={state === 'busy' || state === 'denied'} onClick={() => void change()} className="min-h-11 shrink-0 rounded-lg border border-koma-border px-3 text-sm font-bold disabled:opacity-50">{state === 'busy' ? 'Salvando…' : state === 'enabled' ? 'Desativar' : 'Ativar'}</button>
    </div>
    {message && <p role="status" className="mt-2 text-xs text-koma-muted">{message}</p>}
  </section>;
}
