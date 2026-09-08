import React from 'react';
import { authFetch, authRequestErrorMessage } from '../../utils/authRequest';

/** Same recovery endpoint and feedback in every password login. */
export function PasswordRecoveryHelp({ customer = false, restaurantId }: { customer?: boolean; restaurantId?: string | number }) {
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const requestRecovery = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setMessage('Informe o e-mail cadastrado na sua conta.'); return; }
    setBusy(true); setMessage('');
    try {
      const { API_BASE_URL } = await import("../../config/api");
      const response = await authFetch(`${API_BASE_URL}/auth/password-recovery/request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), kind: customer ? 'customer' : 'staff', ...(restaurantId ? { restaurante_id: Number(restaurantId) } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Não foi possível solicitar a recuperação.');
      setMessage(data.message);
    } catch (error) { setMessage(authRequestErrorMessage(error, 'Não foi possível solicitar a recuperação.')); }
    finally { setBusy(false); }
  };
  return <div className="space-y-2 text-xs">
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className="underline underline-offset-2 text-koma-secondary">Esqueci minha senha</button>
    {open && <div className="space-y-2 rounded-xl border border-koma-border bg-koma-panel p-3">
      <label className="block text-koma-foreground">E-mail da conta
        <input type="email" autoComplete="email" value={email} disabled={busy} onChange={event => setEmail(event.target.value)} className="mt-2 block w-full rounded-lg border border-koma-border bg-koma-card p-2 text-koma-foreground" />
      </label>
      <button type="button" disabled={busy} onClick={() => void requestRecovery()} className="font-bold text-emerald-500 disabled:opacity-50">{busy ? 'Solicitando…' : 'Enviar link de recuperação'}</button>
      {message && <p role="status" className="text-koma-secondary leading-relaxed">{message}</p>}
      {customer && <p className="text-koma-secondary">Você também pode continuar seu pedido como visitante.</p>}
    </div>}
  </div>;
}
