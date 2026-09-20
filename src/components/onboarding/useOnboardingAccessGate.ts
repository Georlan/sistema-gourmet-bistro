import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../../config/api';

type GateState = 'idle' | 'loading' | 'ready' | 'error';

type OnboardingGatePayload = {
  setupPending?: boolean;
  progress?: {
    completed?: number;
    total?: number;
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
  const [operationReleased, setOperationReleased] = useState(false);

  useEffect(() => {
    if (!enabled || !accessToken) {
      setState('idle');
      setRequiredComplete(false);
      setOperationReleased(false);
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
        return response.json() as Promise<OnboardingGatePayload>;
      })
      .then((payload) => {
        if (cancelled) return;
        const completed = Number(payload.progress?.completed || 0);
        const total = Number(payload.progress?.total || 0);
        setRequiredComplete(total > 0 && completed >= total);
        setOperationReleased(payload.setupPending === false);
        setState('ready');
      })
      .catch((error) => {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        setRequiredComplete(false);
        setOperationReleased(false);
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
    operationReleased,
    isChecking: enabled && state === 'loading',
  };
}
