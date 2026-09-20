import React, { useCallback, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  Circle,
  CreditCard,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  Store,
  Users,
  UtensilsCrossed,
} from 'lucide-react';

import { API_BASE_URL } from '../../config/api';
import { getSubscriptionPlan, type SubscriptionPlanId } from '../../config/subscriptionPlans';
import { SubscriptionControl } from '../assinatura/SubscriptionControl';
import { CatalogAssistanceUpload, type CatalogAssistanceSnapshot } from './CatalogAssistanceUpload';

export const ONBOARDING_SETUP_MODE_KEY = 'koma_onboarding_setup_mode';

type Props = {
  accessToken: string;
  user: Record<string, unknown>;
};

type OperationMode = 'dine_in' | 'pickup' | 'delivery';

type Capabilities = {
  order_modes: OperationMode[];
  online_menu: boolean;
  service_tax: boolean;
};

type ReadinessCheck = {
  id: string;
  label: string;
  ok: boolean;
  required?: boolean;
  message?: string | null;
};

type OnboardingStatus = {
  restaurant: {
    id: string;
    name: string;
    slug: string;
    plan: string;
  };
  trial: {
    status: string;
    startsAt: string | null;
    endsAt: string | null;
    daysRemaining: number | null;
  };
  payments: {
    mercadoPagoConnected: boolean;
  };
  counts: {
    products: number;
    activeProducts: number;
    tables: number;
  };
  catalogAssistance: CatalogAssistanceSnapshot;
  steps: {
    profile: boolean;
    hours: boolean;
    catalog: boolean;
    mercadoPago: boolean;
    firstOrder: boolean;
  };
  progress: {
    completed: number;
    total: number;
    percent: number;
  };
  capabilities: Capabilities | null;
  configuration: {
    complete: boolean;
    checks: ReadinessCheck[];
  };
  operation: {
    started: boolean;
    startedAt: string | null;
  };
  readiness: {
    ready: boolean;
    testOrderComplete: boolean;
    checks: ReadinessCheck[];
  };
};

type LoadState = 'loading' | 'ready' | 'error';

const EMPTY_CAPABILITIES: Capabilities = {
  order_modes: [],
  online_menu: false,
  service_tax: false,
};

const MODE_OPTIONS: Array<{ id: OperationMode; title: string; description: string }> = [
  { id: 'dine_in', title: 'Salão', description: 'Mesas e consumo no local.' },
  { id: 'pickup', title: 'Retirada / balcão', description: 'Pedidos para retirada sem entrega.' },
  { id: 'delivery', title: 'Delivery', description: 'Entrega com endereço e regra de frete.' },
];

const planLabel = (plan: string) => {
  if (plan === 'pocket' || plan === 'pro' || plan === 'premium') {
    return getSubscriptionPlan(plan as SubscriptionPlanId).name;
  }
  return plan || 'KÔMA';
};

const trialLabel = (trial: OnboardingStatus['trial']) => {
  if (trial.status === 'setup') return 'Ainda não iniciado';
  if (trial.status === 'expired' || trial.status === 'ended') return 'Trial encerrado';
  if (trial.status === 'converted') return 'Plano ativo';
  if (typeof trial.daysRemaining === 'number') {
    return trial.daysRemaining === 1 ? '1 dia restante' : `${trial.daysRemaining} dias restantes`;
  }
  return trial.status === 'unavailable' ? 'Sem trial pendente' : 'Trial ativo';
};

function errorDetail(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object') {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

export function FirstAccessOnboarding({ accessToken, user }: Props) {
  const [state, setState] = useState<LoadState>('loading');
  const [snapshot, setSnapshot] = useState<OnboardingStatus | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities>(EMPTY_CAPABILITIES);
  const [errorMessage, setErrorMessage] = useState('');
  const [savingCapabilities, setSavingCapabilities] = useState(false);
  const [startingOperation, setStartingOperation] = useState(false);

  const headers = useMemo(() => ({
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  }), [accessToken]);

  const applySnapshot = useCallback((payload: OnboardingStatus) => {
    setSnapshot(payload);
    setCapabilities(payload.capabilities || EMPTY_CAPABILITIES);
    setState('ready');
  }, []);

  const loadSnapshot = useCallback(async () => {
    setState('loading');
    setErrorMessage('');
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`${API_BASE_URL}/api/onboarding/status`, {
        method: 'GET',
        headers,
        cache: 'no-store',
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorDetail(payload, 'Não foi possível carregar a configuração inicial.'));
      applySnapshot(payload as OnboardingStatus);
    } catch (error) {
      setState('error');
      setErrorMessage(
        error instanceof DOMException && error.name === 'AbortError'
          ? 'A configuração demorou para responder. Tente novamente.'
          : error instanceof Error
            ? error.message
            : 'Não foi possível carregar a configuração inicial.',
      );
    } finally {
      window.clearTimeout(timeoutId);
    }
  }, [applySnapshot, headers]);

  React.useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const openCashierAt = (tab: string, subTab: string, setupMode = true) => {
    try {
      sessionStorage.setItem('koma_active_tab', tab);
      sessionStorage.setItem('koma_active_subtab', subTab);
      if (setupMode) sessionStorage.setItem(ONBOARDING_SETUP_MODE_KEY, '1');
      else sessionStorage.removeItem(ONBOARDING_SETUP_MODE_KEY);
    } catch {
      // Storage can be unavailable in private/restricted browser contexts.
    }
    window.location.href = '/?view=caixa';
  };

  const toggleMode = (mode: OperationMode) => {
    setCapabilities((current) => ({
      ...current,
      order_modes: current.order_modes.includes(mode)
        ? current.order_modes.filter((item) => item !== mode)
        : [...current.order_modes, mode],
    }));
  };

  const saveCapabilities = async () => {
    if (capabilities.order_modes.length === 0) {
      setErrorMessage('Escolha ao menos um tipo de pedido.');
      return;
    }
    setSavingCapabilities(true);
    setErrorMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/onboarding/capabilities`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(capabilities),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorDetail(payload, 'Não foi possível salvar como o restaurante vai operar.'));
      applySnapshot(payload as OnboardingStatus);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível salvar a configuração.');
    } finally {
      setSavingCapabilities(false);
    }
  };

  const startOperation = async () => {
    if (!snapshot?.configuration.complete || startingOperation) return;
    setStartingOperation(true);
    setErrorMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/onboarding/start-operation`, {
        method: 'POST',
        headers,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorDetail(payload, 'Não foi possível iniciar a operação.'));
      applySnapshot(payload as OnboardingStatus);
      openCashierAt('operacao', 'pedidos', false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível iniciar a operação.');
    } finally {
      setStartingOperation(false);
    }
  };

  if (state === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-koma-page px-6 text-koma-foreground">
        <div className="text-center">
          <RefreshCw size={22} className="mx-auto animate-spin text-emerald-400" />
          <p className="mt-3 text-xs font-bold uppercase tracking-[0.16em] text-koma-muted">Preparando sua configuração…</p>
        </div>
      </main>
    );
  }

  if (state === 'error' || !snapshot) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-koma-page px-6 text-koma-foreground">
        <section className="w-full max-w-lg rounded-3xl border border-koma-border bg-koma-card p-7 text-center shadow-2xl">
          <h1 className="text-xl font-black">Sua conta está ativa</h1>
          <p className="mt-2 text-sm text-koma-muted">{errorMessage || 'A configuração não pôde ser carregada agora.'}</p>
          <button type="button" onClick={() => void loadSnapshot()} className="mt-6 rounded-xl border border-koma-border px-4 py-3 text-xs font-black text-koma-foreground">
            Tentar novamente
          </button>
        </section>
      </main>
    );
  }

  const restaurantName = snapshot.restaurant.name || String(user?.nome || 'Seu restaurante');
  const requiredChecks = snapshot.configuration.checks.filter((check) => check.required !== false);
  const completedChecks = requiredChecks.filter((check) => check.ok).length;
  const progress = requiredChecks.length ? Math.round((completedChecks / requiredChecks.length) * 100) : 0;

  const coreSteps = [
    {
      id: 'profile',
      title: 'Complete os dados do restaurante',
      description: 'Informe ao menos um endereço ou WhatsApp de contato.',
      done: snapshot.steps.profile,
      actionLabel: 'Configurar dados',
      tab: 'cardapio_digital',
      subTab: 'cardapio_perfil',
      icon: Store,
    },
    {
      id: 'hours',
      title: 'Defina os horários de funcionamento',
      description: 'A agenda será usada pelo atendimento e pelo cardápio.',
      done: snapshot.steps.hours,
      actionLabel: 'Configurar horários',
      tab: 'cardapio_digital',
      subTab: 'cardapio_pedidos',
      icon: CalendarClock,
    },
    {
      id: 'catalog',
      title: 'Publique o primeiro produto',
      description: 'Produto inativo não conta como catálogo pronto.',
      done: snapshot.steps.catalog,
      actionLabel: 'Abrir cardápio',
      tab: 'cardapio',
      subTab: 'produtos',
      icon: UtensilsCrossed,
    },
  ];

  const configurationComplete = snapshot.configuration.complete;
  const operationStarted = snapshot.operation.started;
  const ready = snapshot.readiness.ready;

  return (
    <main className="min-h-screen bg-koma-page px-4 py-6 text-koma-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <section className="overflow-hidden rounded-3xl border border-emerald-500/20 bg-koma-card shadow-2xl">
          <div className="border-b border-koma-border bg-emerald-500/[0.06] p-6 sm:p-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.15em] text-emerald-400">
                  <CheckCircle2 size={13} /> Conta ativada
                </div>
                <h1 className="mt-4 text-2xl font-black sm:text-3xl">Bem-vindo ao KÔMA, {restaurantName}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-koma-muted">
                  Primeiro conclua a configuração. Quando você decidir começar, o KÔMA inicia o trial e libera a operação para fazer um pedido de teste completo.
                </p>
              </div>
              <div className="grid min-w-[250px] grid-cols-2 gap-2">
                <div className="rounded-2xl border border-koma-border bg-koma-page p-3">
                  <p className="text-[9px] font-black uppercase tracking-wider text-koma-subtle">Plano</p>
                  <p className="mt-1 text-sm font-black">{planLabel(snapshot.restaurant.plan)}</p>
                </div>
                <div className="rounded-2xl border border-koma-border bg-koma-page p-3">
                  <p className="text-[9px] font-black uppercase tracking-wider text-koma-subtle">Trial</p>
                  <p className="mt-1 text-sm font-black">{trialLabel(snapshot.trial)}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6 p-6 sm:p-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-black">
                  <Sparkles size={16} className="text-emerald-400" /> Configuração inicial
                </div>
                <p className="mt-1 text-xs text-koma-muted">
                  {completedChecks} de {requiredChecks.length} verificações necessárias concluídas
                </p>
              </div>
              <button type="button" onClick={() => void loadSnapshot()} className="inline-flex items-center gap-2 self-start rounded-xl border border-koma-border px-3 py-2 text-[10px] font-black text-koma-muted">
                <RefreshCw size={12} /> Atualizar
              </button>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-koma-raised">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              {coreSteps.map((step) => {
                const Icon = step.icon;
                return (
                  <article key={step.id} className="rounded-2xl border border-koma-border bg-koma-page p-4">
                    <div className="flex gap-3">
                      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${step.done ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-koma-border bg-koma-raised text-koma-muted'}`}>
                        <Icon size={17} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-sm font-black">{step.title}</h2>
                          {step.done ? <CheckCircle2 size={15} className="text-emerald-400" /> : <Circle size={15} className="text-koma-subtle" />}
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-koma-muted">{step.description}</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => openCashierAt(step.tab, step.subTab)} className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-koma-border px-3 py-2 text-[10px] font-black">
                      {step.done ? 'Revisar' : step.actionLabel} <ArrowRight size={12} />
                    </button>
                  </article>
                );
              })}
            </div>

            <section className="rounded-2xl border border-koma-border bg-koma-page p-5">
              <div>
                <p className="text-sm font-black">Como este restaurante vai operar?</p>
                <p className="mt-1 text-[11px] text-koma-muted">
                  Escolha só o que faz parte da operação agora. O readiness cobra apenas as capacidades selecionadas.
                </p>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {MODE_OPTIONS.map((mode) => {
                  const selected = capabilities.order_modes.includes(mode.id);
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => toggleMode(mode.id)}
                      className={`rounded-2xl border p-3 text-left transition ${selected ? 'border-emerald-500 bg-emerald-500/10' : 'border-koma-border bg-koma-raised/40'}`}
                      aria-pressed={selected}
                    >
                      <span className="flex items-center justify-between gap-2 text-xs font-black">
                        {mode.title} {selected && <Check size={14} className="text-emerald-400" />}
                      </span>
                      <span className="mt-1 block text-[10px] text-koma-muted">{mode.description}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-koma-border bg-koma-raised/40 p-3">
                  <input
                    type="checkbox"
                    checked={capabilities.online_menu}
                    onChange={(event) => setCapabilities((current) => ({ ...current, online_menu: event.target.checked }))}
                    className="mt-0.5"
                  />
                  <span>
                    <strong className="block text-xs">Cardápio online</strong>
                    <span className="mt-1 block text-[10px] text-koma-muted">Exige Mercado Pago conectado para receber pedidos online.</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-koma-border bg-koma-raised/40 p-3">
                  <input
                    type="checkbox"
                    checked={capabilities.service_tax}
                    onChange={(event) => setCapabilities((current) => ({ ...current, service_tax: event.target.checked }))}
                    className="mt-0.5"
                  />
                  <span>
                    <strong className="block text-xs">Taxa de serviço do garçom</strong>
                    <span className="mt-1 block text-[10px] text-koma-muted">Quando ativa, o percentual precisa estar configurado.</span>
                  </span>
                </label>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" disabled={savingCapabilities} onClick={() => void saveCapabilities()} className="rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-black text-zinc-950 disabled:opacity-60">
                  {savingCapabilities ? 'Salvando…' : 'Salvar como vou operar'}
                </button>
                {capabilities.order_modes.includes('dine_in') && (
                  <button type="button" onClick={() => openCashierAt('impressao_salao', 'mesas')} className="rounded-xl border border-koma-border px-3 py-2.5 text-[10px] font-black">
                    Configurar mesas
                  </button>
                )}
                {capabilities.order_modes.includes('delivery') && (
                  <button type="button" onClick={() => openCashierAt('cardapio_digital', 'cardapio_entrega')} className="rounded-xl border border-koma-border px-3 py-2.5 text-[10px] font-black">
                    Configurar delivery
                  </button>
                )}
                {capabilities.service_tax && (
                  <button type="button" onClick={() => openCashierAt('impressao_salao', 'taxa')} className="rounded-xl border border-koma-border px-3 py-2.5 text-[10px] font-black">
                    Configurar taxa
                  </button>
                )}
                {capabilities.online_menu && (
                  <button type="button" onClick={() => openCashierAt('cardapio_digital', 'cardapio_pagamentos')} className="rounded-xl border border-koma-border px-3 py-2.5 text-[10px] font-black">
                    <CreditCard size={12} className="mr-1 inline" /> Mercado Pago
                  </button>
                )}
              </div>
            </section>

            {!configurationComplete && (
              <section className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
                <p className="text-xs font-black">O que ainda falta</p>
                <div className="mt-2 space-y-1.5">
                  {snapshot.configuration.checks.filter((check) => check.required !== false && !check.ok).map((check) => (
                    <p key={check.id} className="text-[10px] text-koma-muted">• {check.message || check.label}</p>
                  ))}
                </div>
              </section>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <button type="button" onClick={() => openCashierAt('permissoes_cargos', 'pessoas')} className="flex items-center justify-between rounded-2xl border border-koma-border bg-koma-page p-4 text-left">
                <span>
                  <strong className="flex items-center gap-2 text-xs"><Users size={15} /> Equipe</strong>
                  <span className="mt-1 block text-[10px] text-koma-muted">Convide gerente, caixa, garçom ou motoboy agora ou depois.</span>
                </span>
                <ArrowRight size={14} />
              </button>
              <div className="rounded-2xl border border-koma-border bg-koma-page p-4">
                <SubscriptionControl accessToken={accessToken} />
              </div>
            </div>

            <CatalogAssistanceUpload
              accessToken={accessToken}
              assistance={snapshot.catalogAssistance}
              onSubmitted={() => void loadSnapshot()}
            />

            <section className={`rounded-2xl border p-5 ${ready ? 'border-emerald-500/30 bg-emerald-500/[0.07]' : 'border-koma-border bg-koma-raised/40'}`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-black">
                    {ready
                      ? 'Pronto para operar'
                      : operationStarted
                        ? 'Configuração concluída · valide com um pedido de teste'
                        : configurationComplete
                          ? 'Configuração concluída'
                          : 'Conclua a configuração'}
                  </p>
                  <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-koma-muted">
                    {ready
                      ? 'O restaurante já provou um ciclo com pedido, pagamento aprovado e conclusão.'
                      : operationStarted
                        ? 'Faça um pedido no tipo de operação escolhido, receba o pagamento e conclua a comanda.'
                        : configurationComplete
                          ? 'Nada inicia o trial automaticamente. Clique quando quiser liberar a operação e começar a contagem.'
                          : 'O trial continua parado enquanto você configura o restaurante.'}
                  </p>
                </div>

                {ready ? (
                  <button type="button" onClick={() => openCashierAt('operacao', 'pedidos', false)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-xs font-black text-zinc-950">
                    Entrar no KÔMA <ArrowRight size={14} />
                  </button>
                ) : operationStarted ? (
                  <button type="button" onClick={() => openCashierAt('operacao', 'balcao', false)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-xs font-black text-zinc-950">
                    <ShoppingBag size={14} /> Fazer pedido de teste
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!configurationComplete || startingOperation}
                    onClick={() => void startOperation()}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-xs font-black text-zinc-950 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {startingOperation ? 'Iniciando…' : 'Iniciar trial e testar operação'} <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </section>

            {errorMessage && (
              <p role="alert" className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
                {errorMessage}
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export default FirstAccessOnboarding;
