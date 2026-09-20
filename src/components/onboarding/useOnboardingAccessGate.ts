import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../../config/api';

type GateState = 'idle' | 'loading' | 'ready' | 'error';

type OnboardingProgressPayload = {
  operation?: {
    started?: boolean;
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
  const [operationStarted, setOperationStarted] = useState(false);

  useEffect(() => {
    if (!enabled || !accessToken) {
      setState('idle');
      setOperationStarted(false);
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
        setOperationStarted(Boolean(payload.operation?.started));
        setState('ready');
      })
      .catch((error) => {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        setOperationStarted(false);
        setState('error');
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [accessToken, enabled]);

  return {
    state,
    operationStarted,
    isChecking: enabled && state === 'loading',
  };
}
