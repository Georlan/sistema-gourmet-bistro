import React, { useEffect, useState } from 'react';
import { API_BASE_URL } from '../../config/api';
import { getOperatorAccessToken } from '../../utils/authSession';
type Subscription = { status: string; paidUntil: string | null; trialEndsAt: string | null; canCancel: boolean };
export function SubscriptionControl({ accessToken }: { accessToken?: string }) {
  const token = accessToken || getOperatorAccessToken();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/api/subscription`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async response => { if (response.ok) setSubscription((await response.json()).subscription); })
      .catch(() => { /* Other account controls remain available. */ });
    return () => controller.abort();
  }, [token]);
  const cancel = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/subscription/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Não foi possível cancelar. Tente novamente.');
      setSubscription(previous => previous ? { ...previous, status: 'canceled', canCancel: false } : null);
      setConfirm(false); setNotice(data.message);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível cancelar.'); }
    finally { setBusy(false); }
  };
  if (!subscription) return null;
  return <section className="my-5 rounded-xl border border-koma-border p-4 text-sm"><h2 className="font-bold">Sua assinatura</h2>
    <p className="my-2">{subscription.status === 'canceled' ? 'Renovação cancelada.' : subscription.canCancel ? 'Cobrança recorrente no cartão.' : 'Sem renovação automática.'} {subscription.paidUntil && `Período vigente até ${new Date(subscription.paidUntil).toLocaleDateString('pt-BR')}.`}</p>
    {subscription.canCancel && (!confirm ? <button className="underline" onClick={() => setConfirm(true)}>Cancelar renovação</button> : <div><p>Confirme para interromper as próximas cobranças. O acesso permanece até o fim do período vigente. Isso não solicita reembolso de cobranças anteriores.</p><button className="mt-2 rounded border border-koma-border px-3 py-2" disabled={busy} onClick={() => void cancel()}>{busy ? 'Cancelando…' : 'Confirmar cancelamento'}</button><button className="ml-3" disabled={busy} onClick={() => setConfirm(false)}>Manter assinatura</button></div>)}
    {notice && <p role="status" className="mt-2">{notice}</p>}
  </section>;
}
