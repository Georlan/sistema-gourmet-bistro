import React, { Component, lazy, Suspense, useEffect, useMemo, useState } from 'react';

type BoundaryProps = { label: string; children: React.ReactNode };

class SectionErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="rounded-xl border border-koma-border bg-koma-panel p-5 text-koma-foreground">
        <p>Não foi possível abrir {this.props.label}. As outras áreas continuam disponíveis.</p>
        <p className="mt-2">Verifique a conexão. Salve ou conclua seus rascunhos antes de recarregar a página.</p>
        <button
          type="button"
          onClick={() => {
            // Failed ES module imports can be cached until document reload. Never
            // refresh automatically: payment attempts and drafts may still be live.
            if (
              window.confirm(
                'Recarregar a página? Rascunhos não salvos serão perdidos. Conclua pagamentos em andamento antes de continuar.',
              )
            ) {
              window.location.reload();
            }
          }}
          className="mt-3 rounded-lg border border-koma-border px-4 py-2"
        >
          Recarregar página
        </button>
      </div>
    );
  }
}

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
      <SectionErrorBoundary label={label}>
        <Suspense
          fallback={
            <div role="status" className="p-5 text-koma-muted">
              Carregando {label}…
            </div>
          }
        >
          <Section {...sectionProps} />
        </Suspense>
      </SectionErrorBoundary>
    </div>
  );
}
