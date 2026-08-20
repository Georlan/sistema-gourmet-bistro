import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  History,
  Loader2,
  LockKeyhole,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Table2,
} from 'lucide-react';
import { KomaLogo } from '../components/KomaLogo';
import { API_BASE_URL, WS_BASE_URL } from '../config/api';
import SmartPosOrderingFlow from './SmartPosOrderingFlow';
import SmartPosPaymentFlow from './SmartPosPaymentFlow';
import SmartPosHistory from './SmartPosHistory';
import {
  clearSmartPosSession,
  getSmartPosSession,
  saveSmartPosSession,
  type SmartPosRole,
  type SmartPosSession,
} from './smartPosSession';

const SMARTPOS_ROLES = new Set<SmartPosRole>(['garcom', 'caixa', 'gerente']);

type SmartPosContext = {
  smartpos_enabled: boolean;
  turno_aberto: boolean;
  turno_id: number | null;
  mesas_disponiveis: boolean;
  pedidos_disponiveis: boolean;
  venda_rapida_disponivel: boolean;
  provider_integrado_disponivel: boolean;
  terminal_mode: 'disabled' | 'simulator';
  restaurante?: {
    id: number;
    nome: string;
  };
  operador: {
    id: string;
    nome: string;
    role: SmartPosRole;
    restaurante_id: number;
  };
};

type Mesa = {
  id: number;
  capacidade: number;
  nome?: string | null;
};

type Item = {
  id: string;
  preco_unit: number;
  cliente_nome?: string | null;
  status?: string | null;
  pago?: boolean;
  produto?: { nome?: string | null } | null;
};

type Comanda = {
  id: string;
  mesa_id: number | null;
  numero_pedido: number;
  identificador?: string | null;
  valor_pago: number;
  criado_em: string;
  criada_por?: { nome?: string | null } | null;
  itens: Item[];
};

type Screen = 'home' | 'mesas' | 'mesa' | 'pedido' | 'receber' | 'venda-rapida' | 'historico';

function roleLabel(role: SmartPosRole) {
  if (role === 'garcom') return 'Garçom';
  if (role === 'caixa') return 'Caixa';
  return 'Gerente';
}

function money(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number.isFinite(value) ? value : 0);
}

function activeItems(comanda: Comanda) {
  return (comanda.itens || []).filter((item) => item.status !== 'cancelado');
}

function comandaTotal(comanda: Comanda) {
  return activeItems(comanda).reduce((total, item) => total + Number(item.preco_unit || 0), 0);
}

function comandaBalance(comanda: Comanda) {
  return Math.max(0, comandaTotal(comanda) - Number(comanda.valor_pago || 0));
}

export default function SmartPosPage() {
  const [session, setSession] = useState<SmartPosSession | null>(() => getSmartPosSession());
  const [context, setContext] = useState<SmartPosContext | null>(null);
  const [isValidatingSession, setIsValidatingSession] = useState(() => Boolean(getSmartPosSession()));
  const [validationError, setValidationError] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [screen, setScreen] = useState<Screen>('home');
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [comandas, setComandas] = useState<Comanda[]>([]);
  const [selectedMesaId, setSelectedMesaId] = useState<number | null>(null);
  const [isLoadingMesas, setIsLoadingMesas] = useState(false);
  const [mesasError, setMesasError] = useState('');

  const authHeaders = useMemo(
    () => (session ? { Authorization: `Bearer ${session.token}` } : {}),
    [session?.token],
  );

  const refreshContext = async (signal?: AbortSignal) => {
    if (!session) return;
    const response = await fetch(`${API_BASE_URL}/auth/smartpos/contexto`, {
      headers: authHeaders,
      signal,
    });

    if (response.status === 401 || response.status === 403) {
      clearSmartPosSession();
      setSession(null);
      setContext(null);
      return;
    }
    if (!response.ok) {
      throw new Error('Não foi possível carregar o contexto da maquininha.');
    }
    const data = (await response.json()) as SmartPosContext;
    setContext(data);
  };

  useEffect(() => {
    if (!session) {
      setIsValidatingSession(false);
      setContext(null);
      return;
    }

    const controller = new AbortController();
    setIsValidatingSession(true);
    setValidationError('');

    refreshContext(controller.signal)
      .catch((error) => {
        if (controller.signal.aborted) return;
        setValidationError(
          error instanceof Error
            ? error.message
            : 'Não foi possível validar a sessão agora.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsValidatingSession(false);
      });

    return () => controller.abort();
  }, [session?.token]);

  useEffect(() => {
    if (!session) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let operationalSyncTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const reconcileContext = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/smartpos/contexto`, {
          headers: { Authorization: `Bearer ${session.token}` },
          cache: 'no-store',
        });
        if (response.status === 401 || response.status === 403) {
          clearSmartPosSession();
          setSession(null);
          setContext(null);
          return;
        }
        if (!response.ok) return;
        setContext((await response.json()) as SmartPosContext);
        setValidationError('');
      } catch {
        // O último contexto válido continua na tela enquanto o socket reconecta.
      }
    };

    const reconcileOperationalState = async () => {
      try {
        const headers = { Authorization: `Bearer ${session.token}` };
        const [mesasResponse, comandasResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/mesas/`, { headers, cache: 'no-store' }),
          fetch(`${API_BASE_URL}/comandas/detalhes/todos?fechada=false`, { headers, cache: 'no-store' }),
        ]);

        if ([mesasResponse.status, comandasResponse.status].some((status) => status === 401 || status === 403)) {
          clearSmartPosSession();
          setSession(null);
          setContext(null);
          setScreen('home');
          setMesas([]);
          setComandas([]);
          setSelectedMesaId(null);
          return;
        }
        if (!mesasResponse.ok || !comandasResponse.ok) return;

        const [nextMesas, nextComandas] = await Promise.all([
          mesasResponse.json() as Promise<Mesa[]>,
          comandasResponse.json() as Promise<Comanda[]>,
        ]);
        if (stopped) return;
        setMesas(nextMesas);
        setComandas(nextComandas);
        setMesasError('');
      } catch {
        // Mantém o último snapshot válido e reconcilia no próximo evento/reconexão.
      }
    };

    const scheduleOperationalReconcile = (delayMs = 60) => {
      if (operationalSyncTimer) clearTimeout(operationalSyncTimer);
      operationalSyncTimer = setTimeout(() => {
        operationalSyncTimer = null;
        void reconcileOperationalState();
      }, delayMs);
    };

    const connect = () => {
      if (stopped) return;
      const wsUrl = `${WS_BASE_URL}/ws/${encodeURIComponent(session.user.id)}?token=${encodeURIComponent(session.token)}`;
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        if (stopped) return;
        // Reconciliar ao reconectar cobre eventos perdidos durante uma queda de rede.
        void reconcileContext();
        scheduleOperationalReconcile(0);
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const eventName = message.event || message.type;

          if (
            eventName === 'tables_updated'
            || eventName === 'TABLE_UPDATED'
            || eventName === 'MESA_ATUALIZADA'
            || eventName === 'MESA_UPDATED'
            || eventName === 'NEW_ORDER'
            || eventName === 'ORDER_UPDATED'
            || eventName === 'order_updated'
            || eventName === 'order_status_updated'
          ) {
            const payload = message.data || message.detail || {};
            const mesaId = Number(payload.mesa_id);
            const status = String(payload.status || '').trim().toLowerCase();

            if (
              (eventName === 'MESA_ATUALIZADA' || eventName === 'MESA_UPDATED')
              && Number.isInteger(mesaId)
              && mesaId > 0
              && status === 'livre'
            ) {
              // Remove imediatamente o snapshot obsoleto; o fetch abaixo confirma o estado canônico.
              setComandas((current) => current.filter((comanda) => comanda.mesa_id !== mesaId));
              setSelectedMesaId((current) => (current === mesaId ? null : current));
            }

            // Cancelamento forçado publica MESA_ATUALIZADA + tables_updated em sequência.
            // O debounce transforma a rajada em uma única reconciliação de mesas/comandas.
            scheduleOperationalReconcile();
          }

          if (eventName === 'config_updated') {
            const payload = message.data || message.detail || {};
            const eventRestaurantId = Number(payload.id ?? payload.restaurante_id);
            if (
              Number.isInteger(eventRestaurantId)
              && eventRestaurantId > 0
              && eventRestaurantId !== session.user.restaurante_id
            ) {
              return;
            }

            const nextName = typeof payload.nome === 'string' ? payload.nome.trim() : '';
            if (nextName) {
              setContext((current) => current
                ? {
                    ...current,
                    restaurante: {
                      ...current.restaurante,
                      nome: nextName,
                    },
                  }
                : current);
            }
            void reconcileContext();
            return;
          }

          if (eventName === 'cash_updated') {
            void reconcileContext();
            scheduleOperationalReconcile();
          }
        } catch {
          // Eventos sem relação com a maquininha não alteram o contexto local.
        }
      };

      socket.onclose = () => {
        if (stopped) return;
        reconnectTimer = setTimeout(connect, 3000);
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (operationalSyncTimer) clearTimeout(operationalSyncTimer);
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
    };
  }, [session?.token, session?.user.id, session?.user.restaurante_id]);

  useEffect(() => {
    if (selectedMesaId !== null) return;
    if (screen === 'mesa' || screen === 'pedido' || screen === 'receber') {
      setScreen('mesas');
    }
  }, [screen, selectedMesaId]);

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
        throw new Error('Esta conta não possui um perfil operacional permitido na maquininha.');
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
        error instanceof Error ? error.message : 'Não foi possível entrar na maquininha.',
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    clearSmartPosSession();
    setSession(null);
    setContext(null);
    setScreen('home');
    setMesas([]);
    setComandas([]);
    setSelectedMesaId(null);
    setValidationError('');
    setLoginError('');
  };

  const loadMesas = async (targetScreen: 'mesas' | 'mesa' = 'mesas') => {
    if (!context?.mesas_disponiveis || !session) return;
    setIsLoadingMesas(true);
    setMesasError('');
    try {
      const [mesasResponse, comandasResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/mesas/`, { headers: authHeaders }),
        fetch(`${API_BASE_URL}/comandas/detalhes/todos?fechada=false`, { headers: authHeaders }),
      ]);

      if ([mesasResponse.status, comandasResponse.status].includes(401)) {
        handleLogout();
        return;
      }
      if (!mesasResponse.ok || !comandasResponse.ok) {
        throw new Error('Não foi possível carregar as mesas agora.');
      }

      setMesas((await mesasResponse.json()) as Mesa[]);
      setComandas((await comandasResponse.json()) as Comanda[]);
      setScreen(targetScreen);
    } catch (error) {
      setMesasError(error instanceof Error ? error.message : 'Falha ao carregar mesas.');
    } finally {
      setIsLoadingMesas(false);
    }
  };

  const selectedMesa = mesas.find((mesa) => mesa.id === selectedMesaId) || null;
  const selectedComandas = comandas.filter((comanda) => comanda.mesa_id === selectedMesaId);
  const selectedTotal = selectedComandas.reduce((sum, comanda) => sum + comandaTotal(comanda), 0);
  const selectedPaid = selectedComandas.reduce((sum, comanda) => sum + Number(comanda.valor_pago || 0), 0);
  const selectedBalance = selectedComandas.reduce((sum, comanda) => sum + comandaBalance(comanda), 0);

  const openMesa = (mesaId: number) => {
    const mesaHasOpenComandas = comandas.some((comanda) => comanda.mesa_id === mesaId);
    setSelectedMesaId(mesaId);
    setScreen(!mesaHasOpenComandas && context?.pedidos_disponiveis ? 'pedido' : 'mesa');
  };

  if (!session) {
    return (
      <main className="min-h-dvh bg-koma-page text-koma-foreground">
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-6 pt-4 sm:px-6">
          <header className="flex items-center justify-between gap-4 border-b border-koma-border pb-4">
            <KomaLogo withText size="lg" />
            <span className="rounded-full border border-koma-border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-koma-muted">
              Maquininha
            </span>
          </header>
          <section className="flex flex-1 flex-col justify-center py-8">
            <div className="mb-7">
              <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">Identificação do operador</p>
              <h1 className="text-3xl font-black tracking-[-0.04em] sm:text-4xl">Entrar na maquininha</h1>
              <p className="mt-3 text-sm leading-6 text-koma-muted">Mesma conta do Kôma.</p>
            </div>
            <form onSubmit={handleLogin} className="grid gap-4">
              <label className="grid gap-2">
                <span className="text-xs font-bold">E-mail ou telefone</span>
                <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required className="min-h-12 rounded-xl border border-koma-border bg-koma-surface px-4 text-sm outline-none focus:border-koma-accent" />
              </label>
              <label className="grid gap-2">
                <span className="text-xs font-bold">Senha</span>
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required className="min-h-12 rounded-xl border border-koma-border bg-koma-surface px-4 text-sm outline-none focus:border-koma-accent" />
              </label>
              {loginError && <p role="alert" className="rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">{loginError}</p>}
              <button type="submit" disabled={isLoggingIn} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-koma-accent px-4 text-sm font-black text-black disabled:cursor-wait disabled:opacity-60">
                {isLoggingIn && <Loader2 size={17} className="animate-spin" aria-hidden="true" />}
                {isLoggingIn ? 'Entrando…' : 'Entrar'}
              </button>
            </form>
          </section>
        </div>
      </main>
    );
  }

  const handleHeaderBack = () => {
    if (screen === 'mesa') {
      setScreen('mesas');
      return;
    }
    if (screen === 'pedido') {
      setScreen(selectedComandas.length > 0 ? 'mesa' : 'mesas');
      return;
    }
    if (screen === 'receber') {
      setScreen('mesa');
      return;
    }
    setScreen('home');
  };

  const Header = () => (
    <header className="flex items-center justify-between gap-3 border-b border-koma-border pb-4">
      <KomaLogo withText size="lg" />
      <div className="flex items-center gap-2">
        {screen !== 'home' && (
          <button type="button" onClick={handleHeaderBack} className="flex size-10 items-center justify-center rounded-xl border border-koma-border text-koma-muted" aria-label="Voltar">
            <ArrowLeft size={17} />
          </button>
        )}
        <button type="button" onClick={handleLogout} className="flex size-10 items-center justify-center rounded-xl border border-koma-border text-koma-muted" aria-label="Sair">
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );

  if (isValidatingSession && !context) {
    return (
      <main className="min-h-dvh bg-koma-page text-koma-foreground">
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-6 pt-4 sm:px-6">
          <Header />
          <div className="flex flex-1 items-center justify-center gap-3 text-sm text-koma-muted"><Loader2 className="animate-spin text-koma-accent" size={20} /> Preparando maquininha…</div>
        </div>
      </main>
    );
  }

  if (context && !context.smartpos_enabled) {
    return (
      <main className="min-h-dvh bg-koma-page text-koma-foreground">
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-6 pt-4 sm:px-6">
          <Header />
          <section className="flex flex-1 flex-col justify-center py-8">
            <div className="rounded-3xl border border-koma-border bg-koma-surface p-6">
              <LockKeyhole className="mb-5 text-koma-accent" size={28} />
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">Acesso necessário</p>
              <h1 className="mt-2 text-2xl font-black tracking-[-0.03em]">Maquininha não habilitada</h1>
              <p className="mt-3 text-sm leading-6 text-koma-muted">Solicite a ativação para este restaurante.</p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (screen === 'venda-rapida') {
    return (
      <main className="min-h-dvh bg-koma-page text-koma-foreground">
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-6 pt-4 sm:px-6">
          <Header />
          <section className="pt-7">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">Sem mesa</p>
            <h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">Venda rápida</h1>
            <div className="mt-6 rounded-2xl border border-koma-border bg-koma-surface p-5">
              <ShoppingBag className="text-koma-accent" size={24} />
              <p className="mt-4 text-sm font-black">Recebimento sem mesa</p>
              <p className="mt-2 text-xs leading-5 text-koma-muted">Em preparação.</p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (screen === 'pedido' && selectedMesa) {
    return (
      <main className="min-h-dvh bg-koma-page text-koma-foreground">
        <div className="mx-auto min-h-dvh w-full max-w-md px-4 pb-8 pt-4 sm:px-6">
          <Header />
          <SmartPosOrderingFlow
            session={session}
            mesa={selectedMesa}
            comandas={selectedComandas}
            onCancel={() => setScreen(selectedComandas.length > 0 ? 'mesa' : 'mesas')}
            cancelLabel={selectedComandas.length > 0 ? 'Voltar para a mesa' : 'Voltar para as mesas'}
            onSessionInvalid={handleLogout}
            onOrderCreated={async () => {
              await loadMesas('mesa');
            }}
          />
        </div>
      </main>
    );
  }

  if (screen === 'receber' && selectedMesa) {
    return (
      <main className="min-h-dvh bg-koma-page text-koma-foreground">
        <div className="mx-auto min-h-dvh w-full max-w-md px-4 pb-8 pt-4 sm:px-6">
          <Header />
          <SmartPosPaymentFlow
            session={session}
            mesa={selectedMesa}
            comandas={selectedComandas}
            onBack={() => void loadMesas('mesa')}
            onSessionInvalid={handleLogout}
            integratedProviderAvailable={Boolean(context?.provider_integrado_disponivel)}
          />
        </div>
      </main>
    );
  }

  if (screen === 'mesa' && selectedMesa) {
    return (
      <main className="min-h-dvh bg-koma-page text-koma-foreground">
        <div className="mx-auto min-h-dvh w-full max-w-md px-4 pb-8 pt-4 sm:px-6">
          <Header />
          <section className="pt-6">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">Atendimento da mesa</p>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div><h1 className="text-3xl font-black tracking-[-0.04em]">{selectedMesa.nome || `Mesa ${selectedMesa.id}`}</h1><p className="mt-1 text-xs text-koma-muted">{selectedComandas.length} comanda(s) aberta(s)</p></div>
              <span className="rounded-full border border-koma-border px-2.5 py-1 text-[10px] font-bold uppercase text-koma-accent">Atendimento</span>
            </div>

            <button type="button" onClick={() => setScreen('pedido')} disabled={!context?.pedidos_disponiveis} className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-koma-accent px-4 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-50"><Plus size={18} /> Adicionar itens</button>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-koma-border bg-koma-surface p-3"><p className="text-[10px] uppercase text-koma-muted">Consumo</p><p className="mt-1 text-sm font-black">{money(selectedTotal)}</p></div>
              <div className="rounded-xl border border-koma-border bg-koma-surface p-3"><p className="text-[10px] uppercase text-koma-muted">Pago</p><p className="mt-1 text-sm font-black">{money(selectedPaid)}</p></div>
              <div className="rounded-xl border border-koma-border bg-koma-surface p-3"><p className="text-[10px] uppercase text-koma-muted">Em aberto</p><p className="mt-1 text-sm font-black text-koma-accent">{money(selectedBalance)}</p></div>
            </div>

            <div className="mt-5 grid gap-3">
              {selectedComandas.length === 0 && <div className="rounded-2xl border border-koma-border bg-koma-surface p-5 text-sm text-koma-muted">Mesa sem consumo aberto.</div>}
              {selectedComandas.map((comanda) => (
                <div key={comanda.id} className="rounded-2xl border border-koma-border bg-koma-surface p-4">
                  <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black">Pedido #{comanda.numero_pedido}</p><p className="mt-1 text-[11px] text-koma-muted">{comanda.criada_por?.nome || 'Operador'}{comanda.identificador ? ` · ${comanda.identificador}` : ''}</p></div><p className="text-sm font-black">{money(comandaBalance(comanda))}</p></div>
                  <div className="mt-4 grid gap-2 border-t border-koma-border pt-3">
                    {activeItems(comanda).map((item) => (
                      <div key={item.id} className="flex items-start justify-between gap-3 text-xs"><div className="min-w-0"><p className="truncate font-bold">{item.produto?.nome || 'Item'}</p><p className="mt-0.5 text-[10px] text-koma-muted">{item.cliente_nome || 'Consumo geral'} · {item.status || 'sem status'}</p></div><span className="shrink-0 font-bold">{money(Number(item.preco_unit || 0))}</span></div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <button type="button" onClick={() => setScreen('receber')} disabled={!context?.turno_aberto || selectedBalance <= 0} className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border border-koma-accent bg-koma-surface px-4 text-sm font-black text-koma-accent disabled:cursor-not-allowed disabled:border-koma-border disabled:text-koma-muted disabled:opacity-60">Receber</button>
          </section>
        </div>
      </main>
    );
  }

  if (screen === 'mesas') {
    return (
      <main className="min-h-dvh bg-koma-page text-koma-foreground">
        <div className="mx-auto min-h-dvh w-full max-w-md px-4 pb-8 pt-4 sm:px-6">
          <Header />
          <section className="pt-6">
            <div className="flex items-end justify-between gap-3"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">Salão</p><h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">Mesas</h1></div><button type="button" onClick={() => void loadMesas('mesas')} className="flex size-10 items-center justify-center rounded-xl border border-koma-border text-koma-muted" aria-label="Atualizar"><RefreshCw size={16} /></button></div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {mesas.map((mesa) => {
                const mesaComandas = comandas.filter((comanda) => comanda.mesa_id === mesa.id);
                const balance = mesaComandas.reduce((sum, comanda) => sum + comandaBalance(comanda), 0);
                const occupied = mesaComandas.length > 0;
                const ready = mesaComandas.some((comanda) => activeItems(comanda).some((item) => item.status === 'pronto'));
                return (
                  <button key={mesa.id} type="button" onClick={() => openMesa(mesa.id)} className="min-h-28 rounded-2xl border border-koma-border bg-koma-surface p-4 text-left">
                    <div className="flex items-start justify-between gap-2"><Table2 size={19} className={ready ? 'text-yellow-400' : occupied ? 'text-red-400' : 'text-koma-accent'} /><ChevronRight size={16} className="text-koma-muted" /></div>
                    <p className="mt-3 text-base font-black">{mesa.nome || `Mesa ${mesa.id}`}</p>
                    <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-koma-muted">{ready ? 'Pedido pronto' : occupied ? money(balance) : 'Livre'}</p>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (screen === 'historico') {
    return (
      <main className="min-h-dvh bg-koma-page text-koma-foreground">
        <div className="mx-auto min-h-dvh w-full max-w-md px-4 pb-8 pt-4 sm:px-6">
          <Header />
          <SmartPosHistory
            session={session}
            restauranteNome={context?.restaurante?.nome || 'Restaurante'}
            onSessionInvalid={handleLogout}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-koma-page text-koma-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-6 pt-4 sm:px-6">
        <Header />
        <section className="flex flex-1 flex-col pt-6">
          <div className="mb-5 rounded-2xl border border-koma-border bg-koma-surface px-3 py-3">
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-koma-border bg-koma-page text-koma-accent">{validationError ? <RefreshCw size={16} /> : <ShieldCheck size={16} />}</span>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-black">{session.user.nome}</p><p className="mt-0.5 truncate text-[11px] text-koma-muted">{roleLabel(session.user.role)} · {context?.restaurante?.nome || 'Restaurante'}</p></div>
              <span className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-bold uppercase ${context?.turno_aberto && !validationError ? 'border-koma-accent/40 text-koma-accent' : 'border-yellow-700/50 text-yellow-300'}`}>{context?.turno_aberto && !validationError && <CheckCircle2 size={11} />}{validationError ? 'Sem conexão' : context?.turno_aberto ? 'Caixa aberto' : 'Caixa fechado'}</span>
            </div>
          </div>

          <div className="mb-5"><p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">Novo atendimento</p><h1 className="text-3xl font-black tracking-[-0.04em]">Onde será o pedido?</h1></div>

          {validationError && <p role="alert" className="mb-3 rounded-xl border border-yellow-800/50 bg-yellow-950/20 px-3 py-2 text-xs text-yellow-200">{validationError}</p>}
          {mesasError && <p role="alert" className="mb-3 rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">{mesasError}</p>}

          <div className="grid gap-3">
            <button type="button" onClick={() => void loadMesas('mesas')} disabled={!context?.mesas_disponiveis || isLoadingMesas} className="flex min-h-20 items-center gap-4 rounded-2xl border border-koma-accent bg-koma-accent px-4 py-3 text-left text-black shadow-lg shadow-koma-accent/10 disabled:cursor-not-allowed disabled:border-koma-border disabled:bg-koma-surface disabled:text-koma-muted disabled:shadow-none"><span className="flex size-11 items-center justify-center rounded-xl bg-black/10">{isLoadingMesas ? <Loader2 size={22} className="animate-spin" /> : context?.mesas_disponiveis ? <Table2 size={22} /> : <LockKeyhole size={21} />}</span><span className="min-w-0 flex-1"><span className="block text-base font-black">Mesas</span><span className="mt-0.5 block text-xs text-black/70">{context?.mesas_disponiveis ? 'Abrir ou continuar atendimento' : 'Caixa fechado'}</span></span>{context?.mesas_disponiveis && <ChevronRight size={18} />}</button>

            <button type="button" onClick={() => setScreen('venda-rapida')} disabled={!context?.venda_rapida_disponivel} className="flex min-h-18 items-center gap-4 rounded-2xl border border-koma-border bg-koma-surface px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-50"><span className="flex size-11 items-center justify-center rounded-xl border border-koma-border bg-koma-page text-koma-accent"><ShoppingBag size={21} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-extrabold">Venda rápida</span><span className="mt-0.5 block text-xs text-koma-muted">Pedido sem mesa</span></span><ChevronRight size={18} className="text-koma-muted" /></button>

            <button type="button" onClick={() => setScreen('historico')} className="flex min-h-18 items-center gap-4 rounded-2xl border border-koma-border bg-koma-surface px-4 py-3 text-left"><span className="flex size-11 items-center justify-center rounded-xl border border-koma-border bg-koma-page text-koma-accent"><History size={21} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-extrabold">Últimas operações</span><span className="mt-0.5 block text-xs text-koma-muted">Consultar e compartilhar comprovante</span></span><ChevronRight size={18} className="text-koma-muted" /></button>
          </div>

          <div className="mt-4 flex items-start gap-3 rounded-xl border border-koma-border bg-koma-surface px-3 py-3 text-xs text-koma-muted">
            <Smartphone size={17} className="mt-0.5 shrink-0 text-koma-accent" />
            {context?.provider_integrado_disponivel ? (
              <p><strong className="text-koma-foreground">Modo de homologação.</strong> O simulador integrado está ativo somente para validar o fluxo técnico.</p>
            ) : (
              <p><strong className="text-koma-foreground">Modo celular ativo.</strong> Dinheiro e cobranças feitas em outra maquininha já podem ser registradas. A captura integrada permanece bloqueada até a homologação do terminal.</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
