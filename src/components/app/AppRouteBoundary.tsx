import { Suspense, type ReactNode } from 'react';
import { FeatureErrorBoundary } from '../shared/FeatureErrorBoundary';
import { KomaSnapshotLoading } from '../shared/KomaSnapshotLoading';

/** Route loading cannot mutate authentication or automatically discard a session. */
export function AppRouteBoundary({ label, children }: { label: string; children: ReactNode }) {
  return (
    <FeatureErrorBoundary label={label}>
      <Suspense
        fallback={(
          <KomaSnapshotLoading
            mode="page"
            title={`Preparando ${label}`}
            description="Carregando os recursos necessários antes de liberar esta área."
          />
        )}
      >
        {children}
      </Suspense>
    </FeatureErrorBoundary>
  );
}
