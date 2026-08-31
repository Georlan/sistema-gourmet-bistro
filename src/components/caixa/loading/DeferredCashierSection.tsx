import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { FeatureErrorBoundary } from '../../shared/FeatureErrorBoundary';

interface Props<P extends object> {
  active: boolean;
  label: string;
  load: () => Promise<{ default: React.ComponentType<P> }>;
  sectionProps: P;
}

/** Downloads on first use, retains drafts on navigation, isolates loading/errors
 * from the operational shell. Inactive owners must pause their own subscriptions.
 * Tenant/session changes are handled by the authenticated parent lifecycle.
 */
export function DeferredCashierSection<P extends object>({ active, label, load, sectionProps }: Props<P>) {
  const [visited, setVisited] = useState(active);
  const Section = useMemo(() => lazy(load), [load]);

  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);
  if (!active && !visited) return null;

  return (
    <div hidden={!active} className={active ? 'contents' : undefined} data-cashier-section={label}>
      <FeatureErrorBoundary label={label}>
        <Suspense
          fallback={
            <div role="status" className="p-5 text-koma-muted">
              Carregando {label}…
            </div>
          }
        >
          <Section {...sectionProps} />
        </Suspense>
      </FeatureErrorBoundary>
    </div>
  );
}
