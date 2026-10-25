import React from 'react';
import { API_BASE_URL } from '../../config/api';
import { authFetch, authRequestErrorMessage } from '../../utils/authRequest';
import { takeRecoveryToken } from './passwordRecoveryToken';
import { AuthPage } from './AuthPage';
import { PasswordInput } from './PasswordInput';

export default function PasswordResetPage() {
  const [recoveryToken, setRecoveryToken] = React.useState(() => takeRecoveryToken());
  const [password, setPassword] = React.useState('');
  const [confirmation, setConfirmation] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const pending = React.useRef(false);
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
    if (pending.current) return;
    if (password !== confirmation) { setMessage('As senhas precisam ser iguais.'); return; }
    if (new TextEncoder().encode(password).length > 72) { setMessage('A senha é longa demais. Use até 72 bytes.'); return; }
    pending.current = true;
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
    finally { pending.current = false; setBusy(false); }
  };

  return <AuthPage>
    <h1 className="k-auth-heading">{done ? 'Senha alterada' : 'Criar nova senha'}</h1>
    {done ? <div className="k-auth-success">
      <p>Volte ao acesso e entre com sua nova senha.</p>
    </div> : !recoveryToken ? <p className="k-auth-intro">Abra o link enviado ao seu e-mail. Se expirou, solicite outro na tela em que você faz login.</p> : <>
      <p className="k-auth-intro">Use pelo menos 8 caracteres.</p>
      <form onSubmit={submit} className="k-auth-form" aria-busy={busy}>
        <div className="k-auth-field">
          <label htmlFor="reset-password" className="k-auth-label">Nova senha</label>
          <PasswordInput id="reset-password" name="new-password" autoComplete="new-password" required minLength={8} maxLength={72}
            value={password} disabled={busy} onChange={event => setPassword(event.target.value)} />
        </div>
        <div className="k-auth-field">
          <label htmlFor="reset-confirmation" className="k-auth-label">Confirme a nova senha</label>
          <PasswordInput id="reset-confirmation" name="confirmation" autoComplete="new-password" required minLength={8} maxLength={72}
            value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} />
        </div>
        <button type="submit" disabled={busy} className="k-auth-action">{busy ? 'Salvando…' : 'Salvar nova senha'}</button>
      </form>
    </>}
    {message && <p role="status" className={`k-auth-feedback ${done ? 'k-auth-feedback--info' : ''}`} style={{ marginTop: 20 }}>{message}</p>}
  </AuthPage>;
}
