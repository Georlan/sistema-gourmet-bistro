import { Suspense, type ReactNode } from 'react';
import { FeatureErrorBoundary } from '../shared/FeatureErrorBoundary';
import { KomaLoading } from './KomaLoading';

/** Route loading cannot mutate authentication or automatically discard a session. */
export function AppRouteBoundary({ label, children }: { label: string; children: ReactNode }) {
  return (
    <FeatureErrorBoundary label={label}>
      <Suspense fallback={<KomaLoading label={`Preparando ${label}…`} />}>
        {children}
      </Suspense>
    </FeatureErrorBoundary>
  );
}
