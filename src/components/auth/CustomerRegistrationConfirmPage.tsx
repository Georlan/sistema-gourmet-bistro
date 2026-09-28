import React from 'react';
import { API_BASE_URL } from '../../config/api';
import { authFetch, authRequestErrorMessage } from '../../utils/authRequest';
import { mapCustomerProfile, saveCustomerSession } from '../../cardapio/customerSession';
import { takeCustomerRegistrationToken } from './customerRegistrationToken';

type Phase = 'confirming' | 'phone_required' | 'phone_code' | 'done' | 'error';

type RegistrationSessionPayload = {
  access_token?: string;
  restaurante_id?: number;
  cliente?: Parameters<typeof mapCustomerProfile>[0];
};

export default function CustomerRegistrationConfirmPage() {
  const [registrationToken, setRegistrationToken] = React.useState(
    () => takeCustomerRegistrationToken(),
  );
  const [phase, setPhase] = React.useState<Phase>(
    registrationToken ? 'confirming' : 'error',
  );
  const [message, setMessage] = React.useState(
    registrationToken
      ? 'Confirmando seu e-mail…'
      : 'Abra o link enviado ao seu e-mail para confirmar o cadastro.',
  );
  const [phoneCode, setPhoneCode] = React.useState('');
  const [restaurantId, setRestaurantId] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);

  const finishSession = React.useCallback((data: RegistrationSessionPayload) => {
    const rid = Number(data.restaurante_id);
    if (
      !Number.isInteger(rid)
      || rid <= 0
      || !data.access_token
      || !data.cliente
    ) {
      throw new Error(
        'A confirmação foi concluída sem uma sessão válida. Faça login pelo cardápio.',
      );
    }
    const profile = mapCustomerProfile(data.cliente);
    saveCustomerSession(rid, {
      token: String(data.access_token),
      profile,
    });
    setRestaurantId(rid);
    setRegistrationToken('');
    setPhase('done');
    setMessage('Conta confirmada. Sua sessão já está pronta para usar o cardápio.');
  }, []);

  const confirmEmail = React.useCallback(async (token: string) => {
    setPhase('confirming');
    setMessage('Confirmando seu e-mail…');
    try {
      const response = await authFetch(
        `${API_BASE_URL}/cardapio/clientes/cadastro/confirmar`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        },
      );
      const data = await response.json().catch(() => null);
      if (
        response.status === 409
        && data?.code === 'phone_verification_required'
      ) {
        setPhase('phone_required');
        setMessage(
          String(
            data.detail
              || 'Confirme também seu telefone para proteger seu histórico.',
          ),
        );
        return;
      }
      if (!response.ok) {
        if (response.status === 400) setRegistrationToken('');
        throw new Error(
          data?.detail || 'Não foi possível confirmar o cadastro.',
        );
      }
      finishSession(data || {});
    } catch (error) {
      setPhase('error');
      setMessage(
        authRequestErrorMessage(error, 'Não foi possível confirmar o cadastro.'),
      );
    }
  }, [finishSession]);

  React.useEffect(() => {
    if (registrationToken) void confirmEmail(registrationToken);
  }, [confirmEmail, registrationToken]);

  React.useEffect(() => {
    const captureToken = () => {
      const token = takeCustomerRegistrationToken();
      if (!token) return;
      setPhoneCode('');
      setRestaurantId(null);
      setRegistrationToken(token);
    };
    window.addEventListener('hashchange', captureToken);
    return () => window.removeEventListener('hashchange', captureToken);
  }, []);

  const requestPhoneCode = async () => {
    if (!registrationToken) return;
    setBusy(true);
    try {
      const response = await authFetch(
        `${API_BASE_URL}/cardapio/clientes/cadastro/telefone/solicitar`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: registrationToken }),
        },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          data?.detail || 'Não foi possível enviar o código ao telefone.',
        );
      }
      setPhase('phone_code');
      setMessage(
        'Enviamos um código de 6 dígitos para o WhatsApp do telefone já cadastrado.',
      );
    } catch (error) {
      setMessage(
        authRequestErrorMessage(
          error,
          'Não foi possível enviar o código ao telefone.',
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmPhone = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!registrationToken || !/^\d{6}$/.test(phoneCode)) {
      setMessage('Informe o código de 6 dígitos enviado ao seu WhatsApp.');
      return;
    }
    setBusy(true);
    try {
      const response = await authFetch(
        `${API_BASE_URL}/cardapio/clientes/cadastro/telefone/confirmar`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: registrationToken,
            codigo: phoneCode,
          }),
        },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          data?.detail || 'Não foi possível confirmar o telefone.',
        );
      }
      finishSession(data || {});
    } catch (error) {
      setMessage(
        authRequestErrorMessage(error, 'Não foi possível confirmar o telefone.'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-koma-page p-4 text-koma-foreground">
      <section className="w-full max-w-sm space-y-4 rounded-2xl border border-koma-border bg-koma-card p-6">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-koma-accent">
          Clube de Vantagens
        </p>
        <h1 className="text-xl font-bold">Confirmar cadastro</h1>

        {phase === 'phone_required' && (
          <button
            type="button"
            disabled={busy}
            onClick={requestPhoneCode}
            className="w-full rounded-xl bg-emerald-500 p-3 font-bold text-black disabled:opacity-50"
          >
            {busy ? 'Enviando…' : 'Verificar meu celular pelo WhatsApp'}
          </button>
        )}

        {phase === 'phone_code' && (
          <form onSubmit={confirmPhone} className="space-y-4">
            <label className="block text-sm">
              Código do WhatsApp
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={6}
                value={phoneCode}
                disabled={busy}
                onChange={(event) => setPhoneCode(
                  event.target.value.replace(/\D/g, '').slice(0, 6),
                )}
                className="mt-2 block w-full rounded-lg border border-koma-border bg-koma-panel p-3 text-center font-mono text-xl tracking-[0.35em]"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-emerald-500 p-3 font-bold text-black disabled:opacity-50"
            >
              {busy ? 'Confirmando…' : 'Confirmar telefone e concluir'}
            </button>
          </form>
        )}

        {phase === 'done' && restaurantId && (
          <a
            href={`/cardapio?restaurante_id=${restaurantId}`}
            className="block w-full rounded-xl bg-emerald-500 p-3 text-center font-bold text-black"
          >
            Ir para o cardápio
          </a>
        )}

        <p role="status" className="text-sm text-koma-muted-foreground">
          {message}
        </p>
      </section>
    </main>
  );
}
