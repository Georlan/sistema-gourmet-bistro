import React, { Component } from 'react';

type BoundaryProps = { label: string; children: React.ReactNode };

export class FeatureErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className="rounded-xl border border-koma-border bg-koma-panel p-5 text-koma-foreground"
      >
        <p>Não foi possível abrir {this.props.label}. As outras áreas continuam disponíveis.</p>
        <p className="mt-2">
          Verifique a conexão. Salve ou conclua seus rascunhos antes de recarregar a página.
        </p>
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
