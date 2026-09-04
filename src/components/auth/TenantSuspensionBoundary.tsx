import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LockKeyhole, LogOut, RefreshCw } from 'lucide-react';
import { API_BASE_URL } from '../../config/api';
import { KomaLogo } from '../KomaLogo';
import { clearOperatorSession } from '../../utils/authSession';

type TenantAccessState = 'idle' | 'checking' | 'active' | 'suspended';

interface TenantSuspensionBoundaryProps {
  children: React.ReactNode;
  disabled?: boolean;
}

const STATUS_PROBE_INTERVAL_MS = 5_000;
const TOKEN_DISCOVERY_INTERVAL_MS = 500;

function readSmartPosToken(): string {
  try {
    const raw = localStorage.getItem('koma_smartpos_session');
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { token?: unknown } | null;
    return typeof parsed?.token === 'string' ? parsed.token.trim() : '';
  } catch {
    return '';
  }
}

function readOperationalToken(): string {
  for (const key of ['koma_caixa_token', 'koma_waiter_token', 'token', 'koma_token']) {
    const value = localStorage.getItem(key)?.trim();
    if (value) return value;
  }
  return readSmartPosToken();
}

async function responseSignalsSuspension(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;

  const payload = await response.clone().json().catch(() => null) as any;
  const detail = payload?.detail;
  const message = typeof detail === 'string'
    ? detail
    : typeof detail?.message === 'string'
      ? detail.message
      : '';

  const normalized = message.toLocaleLowerCase('pt-BR');
  return normalized.includes('restaurante') && normalized.includes('suspens');
}

function clearOperationalAuthentication() {
  clearOperatorSession();
  for (const key of [
    'koma_waiter_token',
    'koma_waiter_id',
    'koma_waiter_name',
    'koma_user_role',
    'koma_token',
    'koma_user_id',
    'koma_user_name',
    'koma_smartpos_session',
  ]) {
    localStorage.removeItem(key);
  }
}

function SuspensionScreen({ checking, onRetry, onLogout }: {
  checking: boolean;
  onRetry: () => void;
  onLogout: () => void;
}) {
  return (
    <main className="min-h-dvh bg-koma-page px-5 text-koma-foreground flex items-center justify-center">
      <section className="w-full max-w-lg rounded-2xl border border-rose-900/50 bg-koma-card p-6 sm:p-8 shadow-2xl">
        <div className="flex justify-center mb-6">
          <KomaLogo withText size="xl" />
        </div>

        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full border border-rose-800/60 bg-rose-950/40 text-rose-300">
          <LockKeyhole className="h-6 w-6" />
        </div>

        <div className="text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-rose-300">Acesso suspenso</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight">Estabelecimento temporariamente suspenso</h1>
          <p className="mt-3 text-sm leading-relaxed text-koma-muted">
            A operação deste restaurante foi bloqueada pela administração da plataforma KÔMA.
          </p>
        </div>

        <div className="mt-6 rounded-xl border border-koma-border bg-koma-page p-4 text-xs leading-relaxed text-koma-secondary">
          Enquanto a suspensão estiver ativa, Caixa, vendas, cardápio interno, estoque, clientes,
          configurações e demais áreas operacionais ficam indisponíveis. Nenhuma tela operacional
          permanece acessível somente por estar carregada no navegador.
        </div>

        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onRetry}
            disabled={checking}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-4 py-3 text-xs font-bold text-koma-foreground hover:border-emerald-700/50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Verificando...' : 'Verificar acesso'}
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 py-3 text-xs font-bold text-white hover:bg-rose-600"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </div>

        <p className="mt-5 text-center text-[10px] leading-relaxed text-koma-subtle">
          Se o estabelecimento já foi reativado pelo Super Admin, use “Verificar acesso”.
        </p>
      </section>
    </main>
  );
}

function AccessCheckingScreen() {
  return (
    <main className="min-h-dvh bg-koma-page px-6 text-koma-foreground flex items-center justify-center">
      <div className="text-center">
        <RefreshCw className="mx-auto h-5 w-5 animate-spin text-koma-accent" />
        <p className="mt-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-koma-accent">
          Verificando acesso do estabelecimento…
        </p>
      </div>
    </main>
  );
}

export function TenantSuspensionBoundary({ children, disabled = false }: TenantSuspensionBoundaryProps) {
  const [accessState, setAccessState] = useState<TenantAccessState>('idle');
  const [checking, setChecking] = useState(false);
  const nativeFetchRef = useRef<typeof window.fetch | null>(null);
  const lastTokenRef = useRef('');
  const probeInFlightRef = useRef(false);

  const probeToken = useCallback(async (token: string) => {
    if (!token || probeInFlightRef.current) return;
    const fetcher = nativeFetchRef.current || window.fetch.bind(window);
    probeInFlightRef.current = true;
    setChecking(true);

    try {
      const response = await fetcher(`${API_BASE_URL}/produtos/categorias`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });

      if (await responseSignalsSuspension(response)) {
        setAccessState('suspended');
        return;
      }

      if (response.ok) {
        setAccessState('active');
        return;
      }

      setAccessState(current => current === 'checking' ? 'active' : current);
    } catch {
      setAccessState(current => current === 'checking' ? 'active' : current);
    } finally {
      probeInFlightRef.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (disabled) return;

    const originalFetch = window.fetch.bind(window);
    nativeFetchRef.current = originalFetch;

    const wrappedFetch: typeof window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      if (response.status === 403) {
        void responseSignalsSuspension(response).then((isSuspended) => {
          if (isSuspended) setAccessState('suspended');
        });
      }
      return response;
    };

    window.fetch = wrappedFetch;
    return () => {
      if (window.fetch === wrappedFetch) window.fetch = originalFetch;
      nativeFetchRef.current = null;
    };
  }, [disabled]);

  useEffect(() => {
    if (disabled) {
      setAccessState('idle');
      lastTokenRef.current = '';
      return;
    }

    const discoverToken = () => {
      const token = readOperationalToken();
      if (!token) {
        lastTokenRef.current = '';
        setAccessState('idle');
        return;
      }

      if (token !== lastTokenRef.current) {
        lastTokenRef.current = token;
        setAccessState('checking');
        void probeToken(token);
      }
    };

    discoverToken();
    const tokenTimer = window.setInterval(discoverToken, TOKEN_DISCOVERY_INTERVAL_MS);
    return () => window.clearInterval(tokenTimer);
  }, [disabled, probeToken]);

  useEffect(() => {
    if (disabled) return;

    const probeCurrentToken = () => {
      const token = readOperationalToken();
      if (token) void probeToken(token);
    };

    const onVisibilityChange = () => {
      if (!document.hidden) probeCurrentToken();
    };

    const statusTimer = window.setInterval(probeCurrentToken, STATUS_PROBE_INTERVAL_MS);
    window.addEventListener('focus', probeCurrentToken);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(statusTimer);
      window.removeEventListener('focus', probeCurrentToken);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [disabled, probeToken]);

  const retry = () => {
    const token = readOperationalToken();
    if (token) void probeToken(token);
  };

  const logout = () => {
    clearOperationalAuthentication();
    lastTokenRef.current = '';
    setAccessState('idle');
    window.location.reload();
  };

  if (disabled) return <>{children}</>;
  if (accessState === 'suspended') {
    return <SuspensionScreen checking={checking} onRetry={retry} onLogout={logout} />;
  }
  if (accessState === 'checking') return <AccessCheckingScreen />;
  return <>{children}</>;
}

export default TenantSuspensionBoundary;
