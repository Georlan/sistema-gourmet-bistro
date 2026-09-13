import React, { useEffect, useState } from 'react';
import { getOperatorSession } from '../../utils/authSession';
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
    <React.Suspense
      fallback={(
        <main className="flex min-h-dvh items-center justify-center bg-koma-page px-6 text-koma-foreground">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-koma-accent">
            Preparando operação…
          </p>
        </main>
      )}
    >
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
