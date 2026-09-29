import { SubscriptionControl } from '../assinatura/SubscriptionControl';
import { CatalogAssistanceUpload, type CatalogAssistanceSnapshot } from './CatalogAssistanceUpload';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Circle,
  CreditCard,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  Store,
  UtensilsCrossed,
} from 'lucide-react';

import { API_BASE_URL } from '../../config/api';
import { getSubscriptionPlan, type SubscriptionPlanId } from '../../config/subscriptionPlans';

export const ONBOARDING_SETUP_MODE_KEY = 'koma_onboarding_setup_mode';
const ONBOARDING_TEST_ORDER_KEY = 'koma_onboarding_test_order';

type OrderType = 'consumo_local' | 'retirada' | 'delivery';

type Props = {
  accessToken: string;
  user: Record<string, unknown>;
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
  trialCanStart: boolean;
  readyForRelease: boolean;
  onboarding?: {
    mode: 'commercial' | 'administrative';
    releaseState: 'configuring' | 'awaiting_koma' | 'released';
    operationReleased?: boolean;
    requiresKomaRelease: boolean;
  };
  payments: {
    mercadoPagoConnected: boolean;
    pixOnlineAvailable: boolean;
  };
  counts: {
    products: number;
    activeProducts: number;
    orders: number;
    tables: number;
  };
  operations: {
    configured: boolean;
    ready: boolean;
    legacyPolicy: boolean;
    orderTypes: OrderType[];
    tableMapEnabled: boolean;
    serviceChargeEnabled: boolean;
    serviceChargePercent: number;
    blockers: string[];
  };
  catalogAssistance: CatalogAssistanceSnapshot;
  steps: {
    profile: boolean;
    hours: boolean;
    catalog: boolean;
    operations: boolean;
    mercadoPago: boolean;
    firstOrder: boolean;
  };
  progress: {
    completed: number;
    total: number;
    percent: number;
  };
  readiness: {
    configurationComplete: boolean;
    trialStarted: boolean;
    operationReleased?: boolean;
    readyToOperate: boolean;
    blockers: string[];
  };
};

type LoadState = 'loading' | 'ready' | 'error';

type SetupStep = {
  id: string;
  title: string;
  description: string;
  done: boolean;
  optional?: boolean;
  actionLabel: string;
  tab: string;
  subTab: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
};

const ONBOARDING_LOAD_TIMEOUT_MS = 10_000;
const ORDER_TYPE_OPTIONS: Array<{ value: OrderType; label: string; description: string }> = [
  { value: 'retirada', label: 'Retirada', description: 'Pedidos retirados no balcão.' },
  { value: 'consumo_local', label: 'Consumo no local', description: 'Pode operar com ou sem mapa de mesas.' },
  { value: 'delivery', label: 'Delivery', description: 'Usa a configuração de entrega já existente.' },
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
  return 'Trial ativo';
};

const responseDetail = async (response: Response, fallback: string) => {
  const payload = await response.json().catch(() => null) as { detail?: string } | null;
  return payload?.detail || fallback;
};

const blockerLabel = (blocker: string) => {
  if (blocker === 'order_types') return 'Escolha ao menos uma modalidade de pedido.';
  if (blocker === 'dine_in_tables') return 'O mapa de mesas está ligado. Cadastre ao menos uma mesa ou desligue o mapa nas configurações.';
  if (blocker === 'delivery_configuration') return 'Delivery foi escolhido. Finalize a taxa e a cobertura de entrega nas configurações.';
  if (blocker === 'service_charge') return 'A taxa de serviço ativa precisa de um percentual válido.';
  return blocker;
};

export function FirstAccessOnboarding({ accessToken, user }: Props) {
  const [state, setState] = useState<LoadState>('loading');
  const [snapshot, setSnapshot] = useState<OnboardingStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [orderTypes, setOrderTypes] = useState<OrderType[]>([]);
  const [savingOperations, setSavingOperations] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [operationNotice, setOperationNotice] = useState('');

  const headers = useMemo(() => ({
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  }), [accessToken]);

  const applySnapshot = useCallback((next: OnboardingStatus) => {
    setSnapshot(next);
    if (next.operations.orderTypes.length > 0) {
      setOrderTypes(next.operations.orderTypes);
    }
    setState('ready');
  }, []);

  const loadSnapshot = useCallback(async () => {
    setState((current) => current === 'ready' ? 'ready' : 'loading');
    setErrorMessage('');
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), ONBOARDING_LOAD_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_BASE_URL}/api/onboarding/status`, {
        method: 'GET',
        headers,
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(await responseDetail(response, 'Não foi possível carregar a implantação inicial.'));
      }
      applySnapshot(await response.json() as OnboardingStatus);
    } catch (error) {
      setState((current) => current === 'ready' ? 'ready' : 'error');
      setErrorMessage(
        error instanceof DOMException && error.name === 'AbortError'
          ? 'A implantação demorou para responder. Tente novamente.'
          : error instanceof Error
            ? error.message
            : 'Não foi possível carregar a implantação inicial.',
      );
    } finally {
      window.clearTimeout(timeoutId);
    }
  }, [applySnapshot, headers]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    const shouldWatchRelease = snapshot?.onboarding
      ? snapshot.onboarding.mode === 'commercial' && snapshot.onboarding.releaseState === 'awaiting_koma'
      : Boolean(snapshot?.readyForRelease);
    if (!shouldWatchRelease) return;

    const timer = window.setInterval(() => {
      if (!document.hidden) void loadSnapshot();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [
    loadSnapshot,
    snapshot?.onboarding?.mode,
    snapshot?.onboarding?.releaseState,
    snapshot?.readyForRelease,
  ]);

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

  const toggleOrderType = (value: OrderType) => {
    setOperationNotice('');
    setOrderTypes((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  };

  const saveOperations = async () => {
    if (orderTypes.length === 0) {
      setOperationError('Escolha ao menos uma modalidade de pedido.');
      return;
    }
    setSavingOperations(true);
    setOperationError('');
    setOperationNotice('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/onboarding/operations`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_types: orderTypes }),
      });
      if (!response.ok) {
        throw new Error(await responseDetail(response, 'Não foi possível salvar as modalidades.'));
      }
      const next = await response.json() as OnboardingStatus;
      applySnapshot(next);
      const selectedLabels = next.operations.orderTypes
        .map((value) => ORDER_TYPE_OPTIONS.find((option) => option.value === value)?.label || value)
        .join(', ');
      setOperationNotice(`Modalidades salvas ✓${selectedLabels ? `: ${selectedLabels}` : ''}`);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : 'Não foi possível salvar as modalidades.');
    } finally {
      setSavingOperations(false);
    }
  };

  const steps: SetupStep[] = snapshot ? [
    {
      id: 'profile',
      title: 'Complete os dados do restaurante',
      description: 'Preencha as informações básicas usadas na operação e no cardápio.',
      done: snapshot.steps.profile,
      actionLabel: snapshot.steps.profile ? 'Revisar dados' : 'Configurar dados',
      tab: 'cardapio_digital',
      subTab: 'cardapio_perfil',
      icon: Store,
    },
    {
      id: 'hours',
      title: 'Defina os horários de funcionamento',
      description: 'A agenda controla quando o restaurante aparece como aberto e orienta pedidos online.',
      done: snapshot.steps.hours,
      actionLabel: snapshot.steps.hours ? 'Revisar horários' : 'Configurar horários',
      tab: 'cardapio_digital',
      subTab: 'cardapio_pedidos',
      icon: CalendarClock,
    },
    {
      id: 'catalog',
      title: 'Publique o primeiro produto',
      description: 'A implantação só considera o catálogo pronto quando houver ao menos um produto ativo.',
      done: snapshot.steps.catalog,
      actionLabel: snapshot.steps.catalog ? 'Abrir cardápio' : 'Criar produto',
      tab: 'cardapio',
      subTab: 'produtos',
      icon: UtensilsCrossed,
    },
  ] : [];

  if (state === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-koma-page px-6 text-koma-foreground">
        <div className="text-center">
          <RefreshCw size={22} className="mx-auto animate-spin text-emerald-400" />
          <p className="mt-3 text-xs font-bold uppercase tracking-[0.16em] text-koma-muted">Preparando sua implantação…</p>
        </div>
      </main>
    );
  }

  if (state === 'error' || !snapshot) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-koma-page px-6 text-koma-foreground">
        <section className="w-full max-w-lg rounded-3xl border border-koma-border bg-koma-card p-7 text-center shadow-2xl">
          <h1 className="text-xl font-black">Sua conta está ativa</h1>
          <p className="mt-2 text-sm text-koma-muted">{errorMessage || 'A implantação não pôde ser carregada agora.'}</p>
          <button type="button" onClick={() => void loadSnapshot()} className="mt-6 rounded-xl border border-koma-border px-4 py-3 text-xs font-black text-koma-foreground hover:border-emerald-500/40">
            Tentar novamente
          </button>
        </section>
      </main>
    );
  }

  const restaurantName = snapshot.restaurant.name || String(user?.nome || 'Seu restaurante');
  const configurationComplete = snapshot.readiness.configurationComplete;
  const inferredCommercial = snapshot.trial.status === 'setup' || snapshot.readyForRelease;
  const onboardingMode = snapshot.onboarding?.mode || (inferredCommercial ? 'commercial' : 'administrative');
  const operationReleased = snapshot.onboarding?.operationReleased
    ?? snapshot.readiness.operationReleased
    ?? snapshot.readiness.trialStarted;
  const releaseState = snapshot.onboarding?.releaseState
    || (!configurationComplete
      ? 'configuring'
      : snapshot.readyForRelease
        ? 'awaiting_koma'
        : operationReleased
          ? 'released'
          : 'configuring');
  const isCommercial = onboardingMode === 'commercial';
  const isAdministrative = onboardingMode === 'administrative';
  const isAwaitingKoma = releaseState === 'awaiting_koma';

  return (
    <main className="min-h-screen bg-koma-page px-4 py-6 text-koma-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <section className="overflow-hidden rounded-3xl border border-emerald-500/20 bg-koma-card shadow-2xl">
          <div className="border-b border-koma-border bg-emerald-500/[0.06] p-6 sm:p-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.15em] text-emerald-400">
                  <CheckCircle2 size={13} />
                  {isAdministrative
                    ? 'Ambiente de homologação'
                    : operationReleased
                      ? 'Operação liberada'
                      : 'Implantação em andamento'}
                </div>
                <h1 className="mt-4 text-2xl font-black sm:text-3xl">Bem-vindo ao KÔMA, {restaurantName}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-koma-muted">
                  {isAdministrative
                    ? 'Use este ambiente para homologar a operação. A janela administrativa já está em andamento e não representa o trial comercial de um cliente.'
                    : isAwaitingKoma
                      ? 'Sua configuração essencial está pronta. A equipe KÔMA está revisando e liberando sua operação; você não precisa fazer mais nada agora.'
                      : operationReleased
                        ? 'Tudo pronto. Sua operação foi liberada e o período grátis comercial já está em andamento.'
                        : 'Vamos deixar seu restaurante pronto. Complete os quatro itens essenciais; depois a equipe KÔMA faz a liberação e inicia seus 7 dias grátis.'}
                </p>
              </div>
              <div className="grid min-w-[250px] grid-cols-2 gap-2">
                <div className="rounded-2xl border border-koma-border bg-koma-page p-3">
                  <p className="text-[9px] font-black uppercase tracking-wider text-koma-subtle">Plano</p>
                  <p className="mt-1 text-sm font-black">{planLabel(snapshot.restaurant.plan)}</p>
                </div>
                <div className="rounded-2xl border border-koma-border bg-koma-page p-3">
                  <p className="text-[9px] font-black uppercase tracking-wider text-koma-subtle">
                    {isAdministrative ? 'Homologação' : 'Trial'}
                  </p>
                  <p className="mt-1 text-sm font-black">{trialLabel(snapshot.trial)}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 sm:p-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-black">
                  <Sparkles size={16} className="text-emerald-400" /> Configuração inicial
                </div>
                <p className="mt-1 text-xs text-koma-muted">
                  {configurationComplete
                    ? '4 de 4 itens essenciais concluídos'
                    : `Falta pouco — ${snapshot.progress.completed} de ${snapshot.progress.total} concluídos`}
                </p>
              </div>
              <button type="button" onClick={() => void loadSnapshot()} className="inline-flex items-center gap-2 self-start rounded-xl border border-koma-border px-3 py-2 text-[10px] font-black text-koma-muted transition hover:border-emerald-500/35 hover:text-emerald-400">
                <RefreshCw size={12} /> Atualizar
              </button>
            </div>

            {isCommercial && (
              <div className="mt-5 grid gap-2 sm:grid-cols-3" aria-label="Etapas da liberação">
                {[
                  { id: 'setup', label: 'Configuração', done: configurationComplete, active: !configurationComplete },
                  { id: 'review', label: 'Revisão KÔMA', done: operationReleased, active: configurationComplete && !operationReleased },
                  { id: 'released', label: 'Liberado', done: operationReleased, active: operationReleased },
                ].map((item, index) => (
                  <div
                    key={item.id}
                    className={`rounded-xl border p-3 ${
                      item.done
                        ? 'border-emerald-500/30 bg-emerald-500/10'
                        : item.active
                          ? 'border-amber-500/30 bg-amber-500/10'
                          : 'border-koma-border bg-koma-page'
                    }`}
                  >
                    <p className="text-[9px] font-black uppercase tracking-wider text-koma-subtle">
                      Etapa {index + 1}
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-xs font-black">
                      {item.done ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Circle size={14} className={item.active ? 'text-amber-400' : 'text-koma-subtle'} />}
                      {item.label}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <SubscriptionControl accessToken={accessToken} />
            <CatalogAssistanceUpload
              accessToken={accessToken}
              assistance={snapshot.catalogAssistance}
              onSubmitted={() => void loadSnapshot()}
            />

            <div className="mt-4 h-2 overflow-hidden rounded-full bg-koma-raised">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${snapshot.progress.percent}%` }} />
            </div>

            <section className="mt-5 rounded-2xl border border-koma-border bg-koma-page p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    {snapshot.steps.operations ? <CheckCircle2 size={18} className="text-emerald-400" /> : <Circle size={18} className="text-koma-subtle" />}
                    <h2 className="text-sm font-black">Como o restaurante recebe pedidos?</h2>
                  </div>
                  <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-koma-muted">
                    Escolha as modalidades ativas. Isso não altera silenciosamente mapa de mesas, taxa de serviço ou regras de entrega.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={savingOperations}
                  onClick={() => void saveOperations()}
                  className="rounded-xl bg-emerald-500 px-4 py-2.5 text-[10px] font-black text-zinc-950 disabled:opacity-60"
                >
                  {savingOperations ? 'Salvando…' : operationNotice ? 'Salvo ✓' : 'Salvar modalidades'}
                </button>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {ORDER_TYPE_OPTIONS.map((option) => {
                  const selected = orderTypes.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleOrderType(option.value)}
                      className={`rounded-xl border px-3 py-3 text-left transition ${selected ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-koma-border bg-koma-raised'}`}
                    >
                      <span className="block text-xs font-black">{option.label}</span>
                      <span className="mt-1 block text-[9px] leading-relaxed text-koma-muted">{option.description}</span>
                    </button>
                  );
                })}
              </div>

              {snapshot.operations.blockers.length > 0 && (
                <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
                  {snapshot.operations.blockers.map((blocker) => (
                    <p key={blocker} className="text-[10px] text-amber-700 dark:text-amber-300">• {blockerLabel(blocker)}</p>
                  ))}
                </div>
              )}
              {operationNotice && (
                <p role="status" className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-[10px] font-bold text-emerald-300">
                  {operationNotice}
                </p>
              )}
              {operationError && <p role="alert" className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-[10px] font-bold text-rose-300">{operationError}</p>}
            </section>

            <div className="mt-5 space-y-3">
              {steps.map((step) => {
                const Icon = step.icon;
                return (
                  <article key={step.id} className="flex flex-col gap-4 rounded-2xl border border-koma-border bg-koma-page p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${step.done ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-koma-border bg-koma-raised text-koma-muted'}`}>
                        <Icon size={17} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-sm font-black">{step.title}</h2>
                          {step.optional && <span className="rounded-full border border-koma-border px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-koma-subtle">Opcional</span>}
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-koma-muted">{step.description}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 pl-[52px] sm:pl-0">
                      {step.done ? <CheckCircle2 size={18} className="text-emerald-400" /> : <Circle size={18} className="text-koma-subtle" />}
                      <button
                        type="button"
                        onClick={() => openCashierAt(step.tab, step.subTab, true)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-koma-border bg-koma-raised px-3 py-2 text-[10px] font-black transition hover:border-emerald-500/35 hover:text-emerald-400 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {step.actionLabel} <ArrowRight size={12} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <section className="mt-6 rounded-2xl border border-koma-border bg-koma-raised/20 p-4">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-page text-koma-muted">
                  <CreditCard size={17} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-black">Pode configurar depois</h2>
                    <span className="rounded-full border border-koma-border px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-koma-subtle">Opcional</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-koma-muted">
                    O restaurante pode operar e receber pagamentos no atendimento sem Mercado Pago. Conecte somente se quiser liberar Pix ou outros pagamentos online pelo KÔMA.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <span className={`text-[10px] font-bold ${snapshot.steps.mercadoPago ? 'text-emerald-400' : 'text-koma-subtle'}`}>
                      {snapshot.steps.mercadoPago ? 'Mercado Pago conectado ✓' : 'Mercado Pago não conectado — tudo bem por enquanto'}
                    </span>
                    <button
                      type="button"
                      onClick={() => openCashierAt('cardapio_digital', 'cardapio_pagamentos', true)}
                      className="rounded-xl border border-koma-border bg-koma-page px-3 py-2 text-[10px] font-black transition hover:border-emerald-500/35 hover:text-emerald-400"
                    >
                      {snapshot.steps.mercadoPago ? 'Revisar conexão' : 'Configurar quando quiser'} <ArrowRight size={12} className="inline" />
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {configurationComplete && operationReleased && (
              <section className="mt-4 rounded-2xl border border-koma-border bg-koma-raised/20 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-page text-koma-muted">
                      <ShoppingBag size={17} />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-black">Validação antes do primeiro turno</h2>
                        <span className="rounded-full border border-koma-border px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-koma-subtle">Opcional</span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-koma-muted">
                        Faça um pedido de teste para validar preparo, pagamento e fechamento. Isso não bloqueia o acesso à operação.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        sessionStorage.setItem(ONBOARDING_TEST_ORDER_KEY, '1');
                      } catch {
                        // Restricted storage only affects automatic marking.
                      }
                      openCashierAt('operacao', 'balcao', false);
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-page px-4 py-2.5 text-[10px] font-black transition hover:border-emerald-500/35 hover:text-emerald-400"
                  >
                    {snapshot.steps.firstOrder ? 'Pedido de teste validado ✓' : 'Fazer pedido de teste'} <ArrowRight size={12} />
                  </button>
                </div>
              </section>
            )}

            {errorMessage && <p className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-[10px] font-bold text-rose-600">{errorMessage}</p>}

            <div className={`mt-6 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
              isAwaitingKoma
                ? 'border-amber-500/30 bg-amber-500/10'
                : operationReleased
                  ? 'border-emerald-500/30 bg-emerald-500/10'
                  : 'border-koma-border bg-koma-raised/40'
            }`}>
              <div>
                <p className="text-xs font-black">
                  {!configurationComplete
                    ? `Falta pouco — ${snapshot.progress.completed} de ${snapshot.progress.total} concluídos`
                    : isAwaitingKoma
                      ? 'Sua parte está concluída ✓'
                      : isAdministrative
                        ? 'Homologação pronta para continuar'
                        : snapshot.readiness.readyToOperate
                          ? 'Prontidão operacional validada'
                          : 'Tudo pronto! Seu KÔMA está liberado.'}
                </p>
                <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-koma-muted">
                  {!configurationComplete
                    ? 'Dados do restaurante, horários, produto ativo e modalidades são os únicos itens obrigatórios para esta etapa.'
                    : isAwaitingKoma
                      ? 'A equipe KÔMA está revisando e liberando sua operação em paralelo. Você não precisa configurar Mercado Pago nem permanecer nesta tela; o status será atualizado automaticamente.'
                      : isAdministrative
                        ? 'Este tenant é de QA. A janela de homologação já começou no provisionamento e não representa o início de um trial comercial.'
                        : snapshot.readiness.readyToOperate
                          ? 'O pedido de teste também foi pago e fechado com sucesso.'
                          : 'A operação já pode começar. O pedido de teste continua disponível como validação opcional antes do primeiro turno.'}
                </p>
              </div>

              {isAwaitingKoma && (
                <div className="inline-flex items-center gap-2 self-start rounded-full border border-amber-500/30 bg-koma-page px-3 py-2 text-[10px] font-black text-amber-300">
                  <RefreshCw size={12} className="animate-spin" /> Aguardando KÔMA
                </div>
              )}

              {configurationComplete && operationReleased && (
                <button
                  type="button"
                  onClick={() => openCashierAt('operacao', 'balcao', false)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-koma-foreground px-5 py-3 text-xs font-black text-koma-page"
                >
                  Entrar no KÔMA <ArrowRight size={14} />
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default FirstAccessOnboarding;
