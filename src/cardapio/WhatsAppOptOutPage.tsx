import React, { useEffect, useState } from 'react';
import { API_BASE_URL } from '../config/api';
import { whatsappOptOutToken } from './whatsappOptOutToken';

export default function WhatsAppOptOutPage() {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restaurant, setRestaurant] = useState('');
  const [marketingOnly, setMarketingOnly] = useState(false);
  const [error, setError] = useState('');
  const token = whatsappOptOutToken();
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void fetch(`${API_BASE_URL}/api/cardapio/whatsapp/opt-out/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }), signal: controller.signal, cache: 'no-store',
      referrerPolicy: 'no-referrer',
    }).then(async response => {
      if (!response.ok) throw new Error('Link inválido ou expirado. Use o link de uma mensagem recente.');
      const data = await response.json();
      if (!controller.signal.aborted) {
        setRestaurant(data.restaurant_name);
        setMarketingOnly(data.marketing_only === true);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setError('Não foi possível conferir este link. Verifique sua conexão e use o link de uma mensagem recente.');
    });
    return () => controller.abort();
  }, [token]);
  async function unsubscribe() {
    if (busy || !token || !restaurant) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/cardapio/whatsapp/opt-out`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }), cache: 'no-store', referrerPolicy: 'no-referrer',
      });
      if (!response.ok) throw new Error('Não foi possível desativar os avisos. Confira se o link ainda é válido e tente novamente.');
      setDone(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha de conexão. Tente novamente.'); }
    finally { setBusy(false); }
  }
  return <main className="min-h-dvh bg-koma-bg p-4 text-koma-foreground flex items-center justify-center">
    <section className="w-full max-w-md space-y-4 rounded-2xl border border-koma-border bg-koma-card p-6">
      <p className="text-sm font-semibold text-koma-muted">KÔMA | {marketingOnly ? 'Promoções' : 'Avisos de pedidos'}</p>
      <h1 className="text-xl font-bold">{marketingOnly ? (done ? 'Promoções desativadas' : 'Parar promoções pelo WhatsApp') : (done ? 'Avisos desativados' : 'Parar avisos pelo WhatsApp')}</h1>
      {restaurant && <p className="text-lg font-bold break-words">{restaurant}</p>}
      <p>{marketingOnly ? (done ? `Você não receberá novas promoções de ${restaurant} neste número. Os avisos dos seus pedidos continuam disponíveis.` : 'Confirme para parar somente as promoções deste restaurante. Os avisos de pedidos e as escolhas para outros restaurantes são preservados.') : (done ? `Você não receberá novos avisos de ${restaurant} neste número.` : 'Confirme para parar os avisos deste restaurante neste número. Os avisos de outros restaurantes e o acompanhamento pelo Cardápio Online continuam disponíveis.')}</p>
      {!done && (token ? <button type="button" disabled={busy || !restaurant} onClick={() => void unsubscribe()}
        className="w-full rounded-xl bg-emerald-600 p-3 font-bold text-white disabled:opacity-50">
        {busy ? 'Desativando…' : restaurant ? `Parar ${marketingOnly ? 'promoções' : 'avisos'} de ${restaurant}` : error ? 'Link indisponível' : 'Conferindo link…'}
      </button> : <p role="alert">Abra o link de descadastro recebido na mensagem.</p>)}
      {error && <p role="alert">{error}</p>}
    </section>
  </main>;
}
