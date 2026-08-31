import { Suspense, type ReactNode } from 'react';
import { FeatureErrorBoundary } from '../shared/FeatureErrorBoundary';

/** Route loading cannot mutate authentication or automatically discard a session. */
export function AppRouteBoundary({ label, children }: { label: string; children: ReactNode }) {
  return (
    <FeatureErrorBoundary label={label}>
      <Suspense
        fallback={
          <main
            role="status"
            className="flex min-h-dvh items-center justify-center bg-koma-page px-6 text-koma-foreground"
          >
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-koma-accent">
              Preparando {label}…
            </p>
          </main>
        }
      >
        {children}
      </Suspense>
    </FeatureErrorBoundary>
  );
}
