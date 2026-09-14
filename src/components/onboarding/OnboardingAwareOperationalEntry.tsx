import React, { useEffect, useState } from 'react';
import { getOperatorSession } from '../../utils/authSession';
import { KomaLoading } from '../app/KomaLoading';
import { OnboardingOperationalBoundary } from './OnboardingOperationalBoundary';

const OperationalApp = React.lazy(() => import('../../App'));

export default function OnboardingAwareOperationalEntry() {
  const [sessionToken, setSessionToken] = useState(() => getOperatorSession('caixa')?.token || '');

  useEffect(() => {
    const timer = window.setInterval(() => {
      const nextToken = getOperatorSession('caixa')?.token || '';
      setSessionToken((current) => current === nextToken ? current : nextToken);
    }, 250);
    return () => window.clearInterval(timer);
  }, []);

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
