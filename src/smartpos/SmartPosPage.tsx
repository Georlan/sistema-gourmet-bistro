import React, { useEffect, useState } from 'react';
import {
  Clock3,
  CreditCard,
  Loader2,
  LogOut,
  ReceiptText,
  ShieldCheck,
  Table2,
} from 'lucide-react';
import { KomaLogo } from '../components/KomaLogo';
import { API_BASE_URL } from '../config/api';
import {
  clearSmartPosSession,
  getSmartPosSession,
  saveSmartPosSession,
  type SmartPosRole,
  type SmartPosSession,
} from './smartPosSession';

const SMARTPOS_ACTIONS = [
  {
    id: 'receber',
    label: 'Receber',
    description: 'Pagamentos serão habilitados em uma etapa posterior.',
    icon: CreditCard,
  },
  {
    id: 'mesas',
    label: 'Mesas',
    description: 'O mapa de mesas será conectado sem alterar o fluxo atual.',
    icon: Table2,
  },
  {
    id: 'historico',
    label: 'Histórico',
    description: 'O histórico do operador será integrado depois.',
    icon: ReceiptText,
  },
] as const;

const SMARTPOS_ROLES = new Set<SmartPosRole>(['garcom', 'caixa', 'gerente']);

function roleLabel(role: SmartPosRole) {
  if (role === 'garcom') return 'Garçom';
  if (role === 'caixa') return 'Caixa';
  return 'Gerente';
}

export default function SmartPosPage() {
  const [session, setSession] = useState<SmartPosSession | null>(() => getSmartPosSession());
  const [isValidatingSession, setIsValidatingSession] = useState(() => Boolean(getSmartPosSession()));
  const [validationError, setValidationError] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    if (!session) {
      setIsValidatingSession(false);
      return;
    }

    const controller = new AbortController();
    setIsValidatingSession(true);
    setValidationError('');

    const validateSession = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/caixa/configuracoes`, {
          headers: {
            Authorization: `Bearer ${session.token}`,
          },
          signal: controller.signal,
        });

        if (response.status === 401 || response.status === 403) {
          clearSmartPosSession();
          setSession(null);
          return;
        }

        if (!response.ok) {
          throw new Error('Não foi possível validar a sessão agora.');
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setValidationError(
          error instanceof Error
            ? error.message
            : 'Não foi possível validar a sessão agora.',
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsValidatingSession(false);
        }
      }
    };

    void validateSession();
    return () => controller.abort();
  }, [session?.token]);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError('');
    setIsLoggingIn(true);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim().toLowerCase(),
          password,
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.detail || 'Usuário ou senha incorretos.');
      }

      const rawRole = String(data?.usuario?.role || '').trim().toLowerCase();
      if (!SMARTPOS_ROLES.has(rawRole as SmartPosRole)) {
        throw new Error('Esta conta não possui um perfil operacional permitido no SmartPOS.');
      }

      const restauranteId = Number(data?.usuario?.restaurante_id);
      if (
        !data?.access_token
        || !data?.usuario?.id
        || !data?.usuario?.nome
        || !Number.isInteger(restauranteId)
        || restauranteId <= 0
      ) {
        throw new Error('A resposta de autenticação está incompleta.');
      }

      const nextSession = saveSmartPosSession(data.access_token, {
        id: String(data.usuario.id),
        nome: String(data.usuario.nome),
        role: rawRole as SmartPosRole,
        restaurante_id: restauranteId,
      });

      setSession(nextSession);
      setUsername('');
      setPassword('');
      setValidationError('');
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : 'Não foi possível entrar no SmartPOS.',
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    clearSmartPosSession();
    setSession(null);
    setValidationError('');
    setLoginError('');
  };

  if (!session) {
    return (
      <main className="min-h-dvh bg-koma-page text-koma-foreground">
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-6 pt-4 sm:px-6">
          <header className="flex items-center justify-between gap-4 border-b border-koma-border pb-4">
            <KomaLogo withText size="lg" />
            <span className="rounded-full border border-koma-border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-koma-muted">
              SmartPOS
            </span>
          </header>

          <section className="flex flex-1 flex-col justify-center py-8">
            <div className="mb-7">
              <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">
                Identificação do operador
              </p>
              <h1 className="text-3xl font-black tracking-[-0.04em] sm:text-4xl">
                Entrar no SmartPOS
              </h1>
              <p className="mt-3 text-sm leading-6 text-koma-muted">
                Use a mesma conta do Kôma. A sessão desta maquininha é independente do celular e do Caixa.
              </p>
            </div>

            <form onSubmit={handleLogin} className="grid gap-4">
              <label className="grid gap-2">
                <span className="text-xs font-bold">E-mail ou telefone</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  inputMode="email"
                  required
                  className="min-h-12 rounded-xl border border-koma-border bg-koma-surface px-4 text-sm outline-none focus:border-koma-accent"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-xs font-bold">Senha</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                  className="min-h-12 rounded-xl border border-koma-border bg-koma-surface px-4 text-sm outline-none focus:border-koma-accent"
                />
              </label>

              {loginError && (
                <p role="alert" className="rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                  {loginError}
                </p>
              )}

              <button
                type="submit"
                disabled={isLoggingIn}
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-koma-accent px-4 text-sm font-black text-black disabled:cursor-wait disabled:opacity-60"
              >
                {isLoggingIn && <Loader2 size={17} className="animate-spin" aria-hidden="true" />}
                {isLoggingIn ? 'Entrando…' : 'Entrar'}
              </button>
            </form>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-koma-page text-koma-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-6 pt-4 sm:px-6">
        <header className="flex items-center justify-between gap-4 border-b border-koma-border pb-4">
          <KomaLogo withText size="lg" />
          <button
            type="button"
            onClick={handleLogout}
            className="flex min-h-10 items-center gap-2 rounded-xl border border-koma-border px-3 text-xs font-bold text-koma-muted"
          >
            <LogOut size={16} aria-hidden="true" />
            Sair
          </button>
        </header>

        <section className="flex flex-1 flex-col pt-6">
          <div className="mb-6 rounded-2xl border border-koma-border bg-koma-surface px-4 py-4">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-koma-border bg-koma-page text-koma-accent">
                {isValidatingSession ? (
                  <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck size={18} aria-hidden="true" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black">{session.user.nome}</p>
                <p className="mt-1 text-xs text-koma-muted">
                  {roleLabel(session.user.role)} · Restaurante #{session.user.restaurante_id}
                </p>
                <p className="mt-2 text-[11px] font-medium text-koma-accent">
                  {isValidatingSession ? 'Validando sessão…' : validationError || 'Sessão validada'}
                </p>
              </div>
            </div>
          </div>

          <div className="mb-7">
            <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">
              Canal de atendimento
            </p>
            <h1 className="max-w-sm text-3xl font-black tracking-[-0.04em] sm:text-4xl">
              Kôma SmartPOS
            </h1>
            <p className="mt-3 max-w-sm text-sm leading-6 text-koma-muted">
              Operador identificado. As funções operacionais continuam bloqueadas até as próximas etapas.
            </p>
          </div>

          <div className="grid gap-3">
            {SMARTPOS_ACTIONS.map(({ id, label, description, icon: Icon }) => (
              <button
                key={id}
                type="button"
                disabled
                aria-disabled="true"
                className="flex min-h-24 w-full cursor-not-allowed items-center gap-4 rounded-2xl border border-koma-border bg-koma-surface px-4 py-4 text-left opacity-80"
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-koma-border bg-koma-page text-koma-accent">
                  <Icon size={22} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-extrabold">{label}</span>
                  <span className="mt-1 block text-xs leading-5 text-koma-muted">{description}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="mt-auto pt-8">
            <div className="flex items-start gap-3 rounded-2xl border border-koma-border bg-koma-surface px-4 py-3">
              <Clock3 className="mt-0.5 shrink-0 text-koma-accent" size={18} aria-hidden="true" />
              <div>
                <p className="text-xs font-bold">Etapa 2 — autenticação e contexto</p>
                <p className="mt-1 text-xs leading-5 text-koma-muted">
                  A sessão é exclusiva deste canal. Capabilities, leitura de caixa e pagamentos permanecem fora deste escopo.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
