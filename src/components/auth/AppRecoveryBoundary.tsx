import React from 'react';

const CHUNK_RELOAD_KEY = 'koma_chunk_reload_attempt';
const AUTO_RELOAD_INTERVAL_MS = 15000;

function reloadFreshAppEntry() {
  const url = new URL(window.location.href);
  url.searchParams.set('__koma_refresh', Date.now().toString());
  window.location.replace(url.toString());
}

function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return (
    message.includes('dynamically imported module')
    || message.includes('loading chunk')
    || message.includes('chunkloaderror')
    || message.includes('importing a module script failed')
  );
}

function tryAutoRecoverChunkSkew(error: unknown): boolean {
  if (typeof window === 'undefined' || !isChunkLoadError(error)) return false;

  const now = Date.now();
  let lastAttempt = 0;
  try {
    lastAttempt = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
  } catch {
    lastAttempt = 0;
  }
  if (now - lastAttempt < AUTO_RELOAD_INTERVAL_MS) return false;

  try {
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    // Recovery must still work when storage is unavailable.
  }
  reloadFreshAppEntry();
  return true;
}

/** Loaded with the entry bundle, so recovery does not depend on a missing lazy chunk. */
export class AppRecoveryBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[app-recovery] Não foi possível abrir a aplicação.', error);
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
            style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0, color: '#ffffff' }}
          >
            Vamos reabrir o Kôma
          </h1>
          <p style={{ margin: 0, opacity: 0.9, lineHeight: 1.5 }}>
            Não foi possível carregar esta tela. Confira sua conexão e tente novamente.
          </p>
          <p
            className="text-sm"
            style={{ fontSize: '0.875rem', margin: 0, opacity: 0.75, lineHeight: 1.4 }}
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
