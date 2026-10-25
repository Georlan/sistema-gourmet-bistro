import React from 'react';
import { authFetch, authRequestErrorMessage } from '../../utils/authRequest';
import './authPresentation.css';

/** Same endpoint, kind and tenant scope in every password login. */
export function PasswordRecoveryHelp({ customer = false, restaurantId, initialEmail = '', disabled = false, allowGuest = true }: {
  customer?: boolean; restaurantId?: string | number; initialEmail?: string; disabled?: boolean; allowGuest?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const pending = React.useRef(false);
  const requestRef = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => requestRef.current?.abort(), []);
  const inputId = React.useId();
  const requestRecovery = async () => {
    if (pending.current || disabled) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setMessage('Informe o e-mail cadastrado na sua conta.'); return; }
    pending.current = true;
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true); setMessage('');
    try {
      const { API_BASE_URL } = await import('../../config/api');
      if (controller.signal.aborted) return;
      const response = await authFetch(`${API_BASE_URL}/auth/password-recovery/request`, {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), kind: customer ? 'customer' : 'staff', ...(restaurantId ? { restaurante_id: Number(restaurantId) } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Não foi possível solicitar a recuperação.');
      setMessage(data.message || 'Se houver uma conta, você receberá um link por e-mail.');
    } catch (error) {
      if (!controller.signal.aborted) setMessage(authRequestErrorMessage(error, 'Não foi possível solicitar a recuperação.'));
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return <div className="k-auth-recovery">
    <button type="button" disabled={disabled || busy} className="k-auth-recovery-toggle" aria-expanded={open} aria-controls={`${inputId}-panel`}
      onClick={() => { if (!open) { setEmail(initialEmail || email); setMessage(''); } setOpen(value => !value); }}>
      Esqueci minha senha
    </button>
    {open && <div id={`${inputId}-panel`} className="k-auth-recovery-panel">
      <label htmlFor={inputId} className="k-auth-label">E-mail da conta</label>
      <input id={inputId} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
        autoFocus value={email} disabled={busy || disabled} onChange={event => setEmail(event.target.value)} className="k-auth-input"
        onKeyDown={event => {
          if (event.key !== 'Enter') return;
          event.preventDefault(); event.stopPropagation(); void requestRecovery();
        }} />
      <button type="button" disabled={busy || disabled} onClick={() => void requestRecovery()} className="k-auth-action">
        {busy ? 'Solicitando…' : 'Enviar link de recuperação'}
      </button>
      {message && <p role="status" className="k-auth-hint">{message}</p>}
      {customer && allowGuest && <p className="k-auth-hint">Você também pode continuar seu pedido como visitante.</p>}
    </div>}
  </div>;
}
