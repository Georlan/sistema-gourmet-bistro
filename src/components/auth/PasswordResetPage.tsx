import React from 'react';
import { API_BASE_URL } from '../../config/api';
import { authFetch, authRequestErrorMessage } from '../../utils/authRequest';
import { takeRecoveryToken } from './passwordRecoveryToken';

export default function PasswordResetPage() {
  const [recoveryToken, setRecoveryToken] = React.useState(() => takeRecoveryToken());
  const [password, setPassword] = React.useState('');
  const [confirmation, setConfirmation] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [message, setMessage] = React.useState('');

  React.useEffect(() => {
    const captureToken = () => {
      const token = takeRecoveryToken();
      if (!token) return;
      setRecoveryToken(token);
      setPassword('');
      setConfirmation('');
      setDone(false);
      setMessage('');
    };
    window.addEventListener('hashchange', captureToken);
    return () => window.removeEventListener('hashchange', captureToken);
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmation) { setMessage('As senhas precisam ser iguais.'); return; }
    if (new TextEncoder().encode(password).length > 72) { setMessage('A senha é longa demais. Use até 72 bytes.'); return; }
    setBusy(true); setMessage('');
    try {
      const response = await authFetch(`${API_BASE_URL}/auth/password-recovery/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: recoveryToken, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 400) setRecoveryToken('');
        throw new Error(typeof data.detail === 'string' ? data.detail : 'Não foi possível alterar a senha.');
      }
      setDone(true);
      setRecoveryToken('');
      setPassword('');
      setConfirmation('');
      setMessage(data.message);
    } catch (error) { setMessage(authRequestErrorMessage(error, 'Não foi possível alterar a senha.')); }
    finally { setBusy(false); }
  };

  return <main className="flex min-h-dvh items-center justify-center bg-koma-page p-4 text-koma-foreground">
    <section className="w-full max-w-sm space-y-4 rounded-2xl border border-koma-border bg-koma-card p-6">
      <h1 className="text-xl font-bold">Criar nova senha</h1>
      {done ? null : !recoveryToken ? <p>Abra o link enviado ao seu e-mail. Se expirou, solicite outro na tela em que você faz login.</p> : <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm">Nova senha
          <input type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} className="mt-2 block w-full rounded-lg border border-koma-border bg-koma-panel p-3" />
        </label>
        <label className="block text-sm">Confirme a nova senha
          <input type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} className="mt-2 block w-full rounded-lg border border-koma-border bg-koma-panel p-3" />
        </label>
        <button type="submit" disabled={busy} className="w-full rounded-xl bg-emerald-500 p-3 font-bold text-black disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar nova senha'}</button>
      </form>}
      {message && <p role="status" className="text-sm">{message}</p>}
      {done && <p className="text-sm">Volte ao cardápio ou à tela de acesso que você estava usando e entre com a nova senha.</p>}
    </section>
  </main>;
}
