import React from 'react';
import { useOperatorSessionToken } from '../auth/useOperatorSessionToken';
import { KomaLoading } from '../app/KomaLoading';
import { OnboardingOperationalBoundary } from './OnboardingOperationalBoundary';

const OperationalApp = React.lazy(() => import('../../App'));

export default function OnboardingAwareOperationalEntry() {
  const sessionToken = useOperatorSessionToken('caixa');

  const app = (
    <React.Suspense fallback={<KomaLoading label="Preparando operação…" />}>
      <OperationalApp initialPortal="caixa" />
    </React.Suspense>
  );

  if (!sessionToken) return app;

  return (
    <OnboardingOperationalBoundary portal="caixa">
      {app}
    </OnboardingOperationalBoundary>
  );
}
