import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../../config/api';

type GateState = 'idle' | 'loading' | 'ready' | 'error';

type OnboardingProgressPayload = {
  progress?: {
    completed?: number;
    total?: number;
  };
  trial?: {
    status?: string;
  };
};

export function useOnboardingAccessGate({
  enabled,
  accessToken,
}: {
  enabled: boolean;
  accessToken: string;
}) {
  const [state, setState] = useState<GateState>('idle');
  const [requiredComplete, setRequiredComplete] = useState(false);

  useEffect(() => {
    if (!enabled || !accessToken) {
      setState('idle');
      setRequiredComplete(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setState('loading');

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
        if (!response.ok) throw new Error('Não foi possível validar a implantação inicial.');
        return response.json() as Promise<OnboardingProgressPayload>;
      })
      .then((payload) => {
        if (cancelled) return;
        const completed = Number(payload.progress?.completed || 0);
        const total = Number(payload.progress?.total || 0);
        const configurationComplete = total > 0 && completed >= total;
        const trialPending = String(payload.trial?.status || '').toLowerCase() === 'setup';
        // Configuração pode ser concluída sem consumir trial, mas a operação normal
        // só é liberada depois da decisão explícita de iniciar o período grátis.
        setRequiredComplete(configurationComplete && !trialPending);
        setState('ready');
      })
      .catch((error) => {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        setRequiredComplete(false);
        setState('error');
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [accessToken, enabled]);

  return {
    state,
    requiredComplete,
    isChecking: enabled && state === 'loading',
  };
}
