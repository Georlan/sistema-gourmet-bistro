import React from 'react';
import { captureAnalyticsException } from '../../analytics';
import { isChunkLoadError, reloadFreshAppEntry, tryAutoRecoverChunkSkew } from '../../utils/chunkRecovery';

/** Loaded with the entry bundle, so recovery does not depend on a missing lazy chunk. */
export class AppRecoveryBoundary extends React.Component<React.PropsWithChildren, { failed: boolean; chunkFailure: boolean }> {
  state = { failed: false, chunkFailure: false };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, chunkFailure: isChunkLoadError(error) };
  }

  componentDidCatch(error: unknown) {
    console.error('[app-recovery] Não foi possível abrir a aplicação.', error);
    captureAnalyticsException(error, { source: 'AppRecoveryBoundary' });
    tryAutoRecoverChunkSkew(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main
        className="flex min-h-dvh items-center justify-center bg-koma-page px-6 text-koma-foreground"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#090a0f',
          color: '#f3f4f6',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          padding: '1.5rem',
        }}
      >
        <section
          role="alert"
          className="max-w-md space-y-4"
          style={{
            maxWidth: '28rem',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <h1
            className="text-xl font-semibold"
            style={{ fontSize: 'calc(1.25rem * var(--koma-text-scale, 1))', fontWeight: 600, margin: 0, color: '#ffffff' }}
          >
            Vamos reabrir o Kôma
          </h1>
          <p style={{ margin: 0, opacity: 0.9, lineHeight: 1.5 }}>
            {this.state.chunkFailure
              ? 'Esta versão do Kôma não conseguiu carregar uma parte da tela após uma atualização. Reabra para usar a versão atual.'
              : 'Não foi possível carregar esta tela. Confira sua conexão e tente novamente.'}
          </p>
          <p
            className="text-sm"
            style={{ fontSize: 'calc(0.875rem * var(--koma-text-scale, 1))', margin: 0, opacity: 0.75, lineHeight: 1.4 }}
          >
            Pedidos já enviados continuam no sistema. Ao voltar, confira o pedido antes de enviá-lo outra vez.
          </p>
          <button
            type="button"
            className="rounded-lg bg-koma-accent px-5 py-3 font-semibold text-koma-page"
            style={{
              padding: '0.75rem 1.25rem',
              backgroundColor: '#08caa3',
              color: '#090a0f',
              fontWeight: 600,
              borderRadius: '0.5rem',
              border: 'none',
              cursor: 'pointer',
              alignSelf: 'flex-start',
            }}
            onClick={reloadFreshAppEntry}
          >
            Reabrir Kôma
          </button>
        </section>
      </main>
    );
  }
}
