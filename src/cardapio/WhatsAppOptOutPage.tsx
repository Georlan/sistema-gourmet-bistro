import React, { useState } from 'react';
import { API_BASE_URL } from '../config/api';
import { whatsappOptOutToken } from './whatsappOptOutToken';

export default function WhatsAppOptOutPage() {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const token = whatsappOptOutToken();
  async function unsubscribe() {
    if (busy || !token) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/cardapio/whatsapp/opt-out`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) throw new Error('Não foi possível desativar os avisos. Confira se o link ainda é válido e tente novamente.');
      setDone(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha de conexão. Tente novamente.'); }
    finally { setBusy(false); }
  }
  return <main className="min-h-dvh bg-koma-bg p-6 text-koma-foreground flex items-center justify-center">
    <section className="w-full max-w-md space-y-4 rounded-2xl border border-koma-border bg-koma-card p-6">
      <h1 className="text-xl font-bold">{done ? 'Avisos desativados' : 'Parar avisos pelo WhatsApp'}</h1>
      <p>{done ? 'Você não receberá novas atualizações de pedidos deste restaurante pelo WhatsApp.' : 'Confirme para parar as atualizações de pedidos deste restaurante neste número. O acompanhamento pelo Cardápio Online continua disponível.'}</p>
      {!done && (token ? <button type="button" disabled={busy} onClick={() => void unsubscribe()}
        className="w-full rounded-xl bg-emerald-600 p-3 font-bold text-white disabled:opacity-50">
        {busy ? 'Desativando…' : 'Parar avisos deste restaurante'}
      </button> : <p role="alert">Abra o link de descadastro recebido na mensagem.</p>)}
      {error && <p role="alert">{error}</p>}
    </section>
  </main>;
}
