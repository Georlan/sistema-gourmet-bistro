import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../../config/api';

type GateState = 'idle' | 'loading' | 'ready' | 'unauthenticated' | 'error';
const ONBOARDING_GATE_TIMEOUT_MS = 10_000;

type GateResult = { token: string; state: GateState; requiredComplete: boolean };

export function useOnboardingAccessGate({
  enabled,
  accessToken,
}: {
  enabled: boolean;
  accessToken: string;
}) {
  const [result, setResult] = useState<GateResult>({ token: '', state: 'idle', requiredComplete: false });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !accessToken) {
      setResult({ token: '', state: 'idle', requiredComplete: false });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    const timeoutId = window.setTimeout(() => controller.abort(), ONBOARDING_GATE_TIMEOUT_MS);
    setResult({ token: accessToken, state: 'loading', requiredComplete: false });

    void fetch(`${API_BASE_URL}/api/onboarding/status`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (cancelled) return;
        // Este endpoint valida usuário, autorização e tenant no backend.
        // Uma sessão rejeitada não é uma implantação pendente.
        if ([401, 403, 404].includes(response.status)) {
          setResult({ token: accessToken, state: 'unauthenticated', requiredComplete: false });
          return;
        }
        if (!response.ok) throw new Error('Não foi possível validar a implantação inicial.');
        const payload = await response.json();
        const releaseState = payload?.onboarding?.releaseState;
        if (!['configuring', 'awaiting_koma', 'released'].includes(releaseState)) {
          throw new Error('Resposta de implantação incompleta.');
        }
        if (cancelled) return;
        // A projeção canônica já combina configuração e liberação da conta.
        setResult({ token: accessToken, state: 'ready', requiredComplete: releaseState === 'released' });
      })
      .catch(() => {
        if (cancelled) return;
        setResult({ token: accessToken, state: 'error', requiredComplete: false });
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [accessToken, enabled, attempt]);

  // Nunca reutilize uma decisão do token anterior enquanto o efeito reinicia.
  const state: GateState = !enabled || !accessToken ? 'idle'
    : result.token !== accessToken ? 'loading' : result.state;
  return {
    state,
    requiredComplete: state === 'ready' && result.requiredComplete,
    isChecking: enabled && state === 'loading',
    retry: () => setAttempt(current => current + 1),
  };
}
