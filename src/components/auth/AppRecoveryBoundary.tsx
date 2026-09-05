import React from 'react';

/** Loaded with the entry bundle, so recovery does not depend on a missing chunk. */
export class AppRecoveryBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[app-recovery] Não foi possível abrir a aplicação.', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="flex min-h-dvh items-center justify-center bg-koma-page px-6 text-koma-foreground">
        <section role="alert" className="max-w-md space-y-4">
          <h1 className="text-xl font-semibold">Vamos reabrir o Kôma</h1>
          <p>Não foi possível carregar esta tela. Confira sua conexão e tente novamente.</p>
          <p className="text-sm">Pedidos já enviados continuam no sistema. Ao voltar, confira o pedido antes de enviá-lo outra vez.</p>
          <button type="button" className="rounded-lg bg-koma-accent px-5 py-3 font-semibold text-koma-page"
            onClick={() => window.location.reload()}>Reabrir Kôma</button>
        </section>
      </main>
    );
  }
}
