import React from 'react';
import { API_BASE_URL } from '../../config/api';
import { authFetch, authRequestErrorMessage } from '../../utils/authRequest';
import { mapCustomerProfile, saveCustomerSession } from '../../cardapio/customerSession';
import { takeCustomerRegistrationToken } from './customerRegistrationToken';

type ConfirmationState = 'confirming' | 'phone_required' | 'done' | 'error';

interface SessionPayload {
  access_token?: string;
  restaurante_id?: number;
  cliente?: Parameters<typeof mapCustomerProfile>[0];
  status?: string;
  detail?: string;
}

export default function CustomerRegistrationConfirmPage() {
  const [registrationToken, setRegistrationToken] = React.useState(() => takeCustomerRegistrationToken());
  const [state, setState] = React.useState<ConfirmationState>('confirming');
  const [message, setMessage] = React.useState('');
  const [codeSent, setCodeSent] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [restaurantId, setRestaurantId] = React.useState<number | null>(null);

  const finishSession = React.useCallback((payload: SessionPayload) => {
    if (!payload.access_token || !payload.cliente || !payload.restaurante_id) {
      throw new Error('A confirmação foi concluída sem uma sessão válida.');
    }
    const profile = mapCustomerProfile(payload.cliente);
    saveCustomerSession(payload.restaurante_id, {
      token: payload.access_token,
      profile,
    });
    setRestaurantId(payload.restaurante_id);
    setState('done');
    setMessage('Conta confirmada. Você já pode continuar no cardápio.');
  }, []);

  const confirmEmail = React.useCallback(async (token: string) => {
    if (!token) {
      setState('error');
      setMessage('Abra o link de confirmação enviado ao seu e-mail.');
      return;
    }
    setState('confirming');
    setMessage('');
    try {
      const response = await authFetch(`${API_BASE_URL}/cardapio/clientes/cadastro/confirmar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await response.json().catch(() => ({})) as SessionPayload;
      if (!response.ok) {
        if (response.status === 400) setRegistrationToken('');
        throw new Error(data.detail || 'Não foi possível confirmar seu cadastro.');
      }
      if (data.status === 'phone_verification_required') {
        setRestaurantId(data.restaurante_id || null);
        setState('phone_required');
        setMessage(data.detail || 'Confirme também seu telefone para proteger o histórico existente.');
        return;
      }
      finishSession(data);
    } catch (error) {
      setState('error');
      setMessage(authRequestErrorMessage(error, 'Não foi possível confirmar seu cadastro.'));
    }
  }, [finishSession]);

  React.useEffect(() => {
    void confirmEmail(registrationToken);
  }, [confirmEmail, registrationToken]);

  React.useEffect(() => {
    const captureToken = () => {
      const token = takeCustomerRegistrationToken();
      if (!token) return;
      setRegistrationToken(token);
      setCode('');
      setCodeSent(false);
      setState('confirming');
      setMessage('');
    };
    window.addEventListener('hashchange', captureToken);
    return () => window.removeEventListener('hashchange', captureToken);
  }, []);

  const requestPhoneCode = async () => {
    setBusy(true);
    setMessage('');
    try {
      const response = await authFetch(`${API_BASE_URL}/cardapio/clientes/cadastro/telefone/solicitar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: registrationToken }),
      });
      const data = await response.json().catch(() => ({})) as { detail?: string };
      if (!response.ok) throw new Error(data.detail || 'Não foi possível enviar o código.');
      setCodeSent(true);
      setMessage(data.detail || 'Código enviado ao WhatsApp informado no cadastro.');
    } catch (error) {
      setMessage(authRequestErrorMessage(error, 'Não foi possível enviar o código agora.'));
    } finally {
      setBusy(false);
    }
  };

  const confirmPhone = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setMessage('Informe o código de 6 dígitos enviado ao telefone.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const response = await authFetch(`${API_BASE_URL}/cardapio/clientes/cadastro/telefone/confirmar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: registrationToken, codigo: code }),
      });
      const data = await response.json().catch(() => ({})) as SessionPayload;
      if (!response.ok) throw new Error(data.detail || 'Não foi possível confirmar o telefone.');
      finishSession(data);
      setRegistrationToken('');
    } catch (error) {
      setMessage(authRequestErrorMessage(error, 'Não foi possível concluir a vinculação.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#090d12] px-4 py-8 text-white">
      <section className="w-full max-w-md rounded-[28px] border border-white/10 bg-[#0e1217] p-6 shadow-2xl">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-400">Clube de Vantagens</p>
        <h1 className="mt-2 text-2xl font-black tracking-tight">Confirmar cadastro</h1>

        {state === 'confirming' && (
          <p className="mt-4 text-sm leading-relaxed text-gray-300" role="status">
            Validando seu link com segurança…
          </p>
        )}

        {state === 'phone_required' && (
          <div className="mt-4 space-y-4">
            <p className="text-sm leading-relaxed text-gray-300" role="status">{message}</p>
            {!codeSent ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void requestPhoneCode()}
                className="flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-500 px-4 text-sm font-bold text-white disabled:opacity-60"
              >
                {busy ? 'Enviando…' : 'Confirmar meu telefone'}
              </button>
            ) : (
              <form onSubmit={confirmPhone} className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-gray-300">Código recebido</span>
                  <input
                    aria-label="Código recebido"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="h-12 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-center font-mono text-xl tracking-[0.35em] text-white outline-none focus:border-emerald-500"
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-500 px-4 text-sm font-bold text-white disabled:opacity-60"
                >
                  {busy ? 'Confirmando…' : 'Concluir cadastro'}
                </button>
              </form>
            )}
          </div>
        )}

        {state === 'done' && (
          <div className="mt-4 space-y-4">
            <p className="text-sm leading-relaxed text-emerald-300" role="status">{message}</p>
            <button
              type="button"
              onClick={() => window.location.assign(`/cardapio?restaurante_id=${restaurantId}`)}
              className="flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-500 px-4 text-sm font-bold text-white"
            >
              Voltar ao cardápio
            </button>
          </div>
        )}

        {state === 'error' && (
          <div className="mt-4 space-y-3">
            <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300" role="alert">
              {message}
            </p>
            <p className="text-xs leading-relaxed text-gray-400">
              Se o link expirou, volte ao cardápio e solicite um novo e-mail de confirmação.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
