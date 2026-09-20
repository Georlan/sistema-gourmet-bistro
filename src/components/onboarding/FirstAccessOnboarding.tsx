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

type Props = {
  accessToken: string;
  user: Record<string, unknown>;
};

type OrderType = 'consumo_local' | 'retirada' | 'delivery';

type CapabilityState = {
  enabled: boolean;
  ready: boolean;
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
  payments: {
    mercadoPagoConnected: boolean;
  };
  counts: {
    products: number;
    activeProducts: number;
    orders: number;
    completedPaidOrders: number;
    tables: number;
  };
  operations: {
    configured: boolean;
    ready: boolean;
    orderTypes: OrderType[];
    tableMapEnabled: boolean;
    serviceChargeEnabled: boolean;
    serviceChargePercent: number;
    capabilities: {
      dineIn: CapabilityState;
      pickup: CapabilityState;
      delivery: CapabilityState;
      serviceCharge: CapabilityState;
      onlinePayment: CapabilityState;
    };
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
    readyToOperate: boolean;
    state: 'configuration' | 'ready';
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

const planLabel = (plan: string) => {
  if (plan === 'pocket' || plan === 'pro' || plan === 'premium') {
    return getSubscriptionPlan(plan as SubscriptionPlanId).name;
  }
  return plan || 'KÔMA';
};

const trialLabel = (trial: OnboardingStatus['trial']) => {
  if (trial.status === 'setup') return 'Ainda não iniciado';
  if (trial.status === 'unavailable') return 'Sem trial pendente';
  if (trial.status === 'expired' || trial.status === 'ended') return 'Trial encerrado';
  if (trial.status === 'converted' || trial.status === 'active') return 'Plano ativo';
  if (typeof trial.daysRemaining === 'number') {
    return trial.daysRemaining === 1 ? '1 dia restante' : `${trial.daysRemaining} dias restantes`;
  }
  return 'Trial ativo';
};

const blockerLabel = (code: string) => {
  const labels: Record<string, string> = {
    order_types: 'Escolha ao menos um tipo de pedido.',
    dine_in_tables: 'Crie ao menos uma mesa ou desative o mapa de mesas.',
    delivery_configuration: 'Revise a configuração e a taxa do delivery.',
    service_charge: 'Informe um percentual válido de taxa de serviço.',
    mercado_pago: 'Conecte o Mercado Pago para manter pagamento online ativo.',
  };
  return labels[code] || code;
};

async function responseDetail(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
  if (typeof payload?.detail === 'string') return payload.detail;
  return fallback;
}

export function FirstAccessOnboarding({ accessToken, user }: Props) {
  const [state, setState] = useState<LoadState>('loading');
  const [snapshot, setSnapshot] = useState<OnboardingStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [operationError, setOperationError] = useState('');
  const [savingOperations, setSavingOperations] = useState(false);
  const [startingTrial, setStartingTrial] = useState(false);
  const [orderTypes, setOrderTypes] = useState<OrderType[]>([]);
  const [tableMapEnabled, setTableMapEnabled] = useState(true);
  const [serviceChargeEnabled, setServiceChargeEnabled] = useState(false);
  const [serviceChargePercent, setServiceChargePercent] = useState(10);

  const headers = useMemo(() => ({
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  }), [accessToken]);

  const loadSnapshot = useCallback(async () => {
    setState('loading');
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
        throw new Error(await responseDetail(response, 'Não foi possível carregar o onboarding.'));
      }
      setSnapshot(await response.json() as OnboardingStatus);
      setState('ready');
    } catch (error) {
      setState('error');
      setErrorMessage(
        error instanceof DOMException && error.name === 'AbortError'
          ? 'O onboarding demorou para responder. Tente novamente.'
          : error instanceof Error
            ? error.message
            : 'Não foi possível carregar o onboarding.',
      );
    } finally {
      window.clearTimeout(timeoutId);
    }
  }, [headers]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    if (!snapshot) return;
    setOrderTypes(snapshot.operations.orderTypes);
    setTableMapEnabled(snapshot.operations.tableMapEnabled);
    setServiceChargeEnabled(snapshot.operations.serviceChargeEnabled);
    setServiceChargePercent(snapshot.operations.serviceChargePercent || 10);
  }, [snapshot]);

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

  const toggleOrderType = (type: OrderType) => {
    setOrderTypes((current) => (
      current.includes(type)
        ? current.filter((value) => value !== type)
        : [...current, type]
    ));
  };

  const saveOperations = async () => {
    if (orderTypes.length === 0) {
      setOperationError('Escolha ao menos um tipo de pedido para continuar.');
      return;
    }
    if (serviceChargeEnabled && !(serviceChargePercent > 0 && serviceChargePercent <= 100)) {
      setOperationError('A taxa de serviço deve ficar entre 0,01% e 100%.');
      return;
    }

    setSavingOperations(true);
    setOperationError('');
    try {
      const response = await fetch(`${API_BASE_URL}/caixa/configuracoes`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipos_pedido_ativos: orderTypes,
          delivery_ativo: orderTypes.includes('delivery'),
          mapa_mesas_ativo: orderTypes.includes('consumo_local') ? tableMapEnabled : false,
          taxa_servico_ativa: serviceChargeEnabled,
          taxa_servico_padrao: serviceChargeEnabled ? serviceChargePercent : 10,
        }),
      });
      if (!response.ok) {
        throw new Error(await responseDetail(response, 'Não foi possível salvar como o restaurante vai operar.'));
      }
      await loadSnapshot();
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : 'Não foi possível salvar a operação.');
    } finally {
      setSavingOperations(false);
    }
  };

  const startTrial = async () => {
    setStartingTrial(true);
    setErrorMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/onboarding/start-trial`, {
        method: 'POST',
        headers,
      });
      if (!response.ok) {
        throw new Error(await responseDetail(response, 'Não foi possível iniciar o período grátis.'));
      }
      setSnapshot(await response.json() as OnboardingStatus);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível iniciar o período grátis.');
    } finally {
      setStartingTrial(false);
    }
  };

  const steps: SetupStep[] = snapshot ? [
    {
      id: 'profile',
      title: 'Complete os dados do restaurante',
      description: 'Endereço, apresentação e informações básicas usadas na operação e no cardápio.',
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
      description: 'O cadastro só conta como concluído quando existir ao menos um produto ativo.',
      done: snapshot.steps.catalog,
      actionLabel: snapshot.steps.catalog ? 'Abrir cardápio' : 'Criar produto',
      tab: 'cardapio',
      subTab: 'produtos',
      icon: UtensilsCrossed,
    },
    {
      id: 'payments',
      title: 'Conecte o Mercado Pago',
      description: snapshot.operations.capabilities.onlinePayment.enabled
        ? 'Pagamento online está ativado; conecte o Mercado Pago para concluir essa capability.'
        : 'Só é necessário quando você decidir receber pagamentos online pelo cardápio.',
      done: snapshot.steps.mercadoPago,
      optional: !snapshot.operations.capabilities.onlinePayment.enabled,
      actionLabel: snapshot.steps.mercadoPago ? 'Revisar conexão' : 'Conectar Mercado Pago',
      tab: 'cardapio_digital',
      subTab: 'cardapio_pagamentos',
      icon: CreditCard,
    },
    {
      id: 'first-order',
      title: 'Valide com um pedido de teste',
      description: 'Abra o Caixa e complete o ciclo pedido → preparo → pagamento → conclusão. Só então o KÔMA marca o restaurante como pronto para operar.',
      done: snapshot.steps.firstOrder,
      actionLabel: snapshot.steps.firstOrder ? 'Ver pedidos' : 'Fazer pedido de teste',
      tab: 'operacao',
      subTab: 'balcao',
      icon: ShoppingBag,
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
          <p className="mt-2 text-sm text-koma-muted">{errorMessage || 'O onboarding não pôde ser carregado agora.'}</p>
          <button type="button" onClick={() => void loadSnapshot()} className="mt-6 rounded-xl border border-koma-border px-4 py-3 text-xs font-black text-koma-foreground hover:border-emerald-500/40">
            Tentar novamente
          </button>
        </section>
      </main>
    );
  }

  const restaurantName = snapshot.restaurant.name || String(user?.nome || 'Seu restaurante');
  const configurationComplete = snapshot.readiness.configurationComplete;
  const readyToOperate = snapshot.readiness.readyToOperate;

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
                  Primeiro conclua a configuração do restaurante. Depois faça um pedido de teste completo. Seu período grátis só começa quando você decidir iniciar a operação.
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

          <div className="p-6 sm:p-8">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className={`rounded-2xl border p-4 ${configurationComplete ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-koma-border bg-koma-page'}`}>
                <p className="text-[9px] font-black uppercase tracking-wider text-koma-subtle">Estado 1</p>
                <p className="mt-1 text-sm font-black">{configurationComplete ? 'Configuração concluída' : 'Configuração em andamento'}</p>
                <p className="mt-1 text-[10px] text-koma-muted">{snapshot.progress.completed} de {snapshot.progress.total} itens essenciais</p>
              </div>
              <div className={`rounded-2xl border p-4 ${readyToOperate ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-koma-border bg-koma-page'}`}>
                <p className="text-[9px] font-black uppercase tracking-wider text-koma-subtle">Estado 2</p>
                <p className="mt-1 text-sm font-black">{readyToOperate ? 'Pronto para operar' : 'Prontidão ainda não validada'}</p>
                <p className="mt-1 text-[10px] text-koma-muted">
                  {readyToOperate ? 'Pedido, pagamento e conclusão já foram validados.' : 'Depois da configuração, finalize um pedido de teste.'}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-black">
                  <Sparkles size={16} className="text-emerald-400" /> Configuração inicial
                </div>
                <p className="mt-1 text-xs text-koma-muted">Sem checklist gigante: dados, horários, catálogo e modo de operação.</p>
              </div>
              <button type="button" onClick={() => void loadSnapshot()} className="inline-flex items-center gap-2 self-start rounded-xl border border-koma-border px-3 py-2 text-[10px] font-black text-koma-muted transition hover:border-emerald-500/35 hover:text-emerald-400">
                <RefreshCw size={12} /> Atualizar
              </button>
            </div>

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
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    {snapshot.steps.operations ? <CheckCircle2 size={18} className="text-emerald-400" /> : <Circle size={18} className="text-koma-subtle" />}
                    <h2 className="text-sm font-black">Defina como o restaurante vai operar</h2>
                  </div>
                  <p className="mt-1 text-[11px] text-koma-muted">Escolha os tipos de pedido e confirme se usa mesas e taxa de serviço. Delivery usa a configuração de entrega já existente.</p>
                </div>
                <button type="button" disabled={savingOperations} onClick={() => void saveOperations()} className="rounded-xl bg-emerald-500 px-4 py-2.5 text-[10px] font-black text-zinc-950 disabled:opacity-60">
                  {savingOperations ? 'Salvando…' : 'Salvar operação'}
                </button>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {([
                  ['consumo_local', 'Consumo local'],
                  ['retirada', 'Retirada / balcão'],
                  ['delivery', 'Delivery'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={orderTypes.includes(value)}
                    onClick={() => toggleOrderType(value)}
                    className={`rounded-xl border px-3 py-3 text-left text-xs font-bold transition ${orderTypes.includes(value) ? 'border-emerald-500/40 bg-emerald-500/10 text-koma-foreground' : 'border-koma-border bg-koma-raised text-koma-muted'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="flex items-center justify-between gap-3 rounded-xl border border-koma-border bg-koma-raised p-3">
                  <span>
                    <span className="block text-xs font-bold">Usar mapa de mesas</span>
                    <span className="block text-[9px] text-koma-muted">Só é exigida ao menos uma mesa quando esse modo está ligado.</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={tableMapEnabled}
                    disabled={!orderTypes.includes('consumo_local')}
                    onChange={(event) => setTableMapEnabled(event.target.checked)}
                  />
                </label>
                <label className="rounded-xl border border-koma-border bg-koma-raised p-3">
                  <span className="flex items-center justify-between gap-3">
                    <span>
                      <span className="block text-xs font-bold">Taxa de serviço</span>
                      <span className="block text-[9px] text-koma-muted">Ative se a operação usa percentual de garçom/serviço.</span>
                    </span>
                    <input type="checkbox" checked={serviceChargeEnabled} onChange={(event) => setServiceChargeEnabled(event.target.checked)} />
                  </span>
                  {serviceChargeEnabled && (
                    <input
                      type="number"
                      min="0.01"
                      max="100"
                      step="0.01"
                      value={serviceChargePercent}
                      onChange={(event) => setServiceChargePercent(Number(event.target.value))}
                      className="mt-2 w-full rounded-lg border border-koma-border bg-koma-input px-3 py-2 text-xs"
                      aria-label="Percentual da taxa de serviço"
                    />
                  )}
                </label>
              </div>

              {snapshot.operations.blockers.length > 0 && (
                <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
                  {snapshot.operations.blockers.map((blocker) => (
                    <p key={blocker} className="text-[10px] text-amber-700 dark:text-amber-300">• {blockerLabel(blocker)}</p>
                  ))}
                </div>
              )}
              {operationError && <p className="mt-3 text-[10px] font-bold text-rose-600">{operationError}</p>}
            </section>

            <div className="mt-5 space-y-3">
              {steps.map((step) => {
                const Icon = step.icon;
                const blockedUntilCore = step.id === 'first-order' && !configurationComplete;
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
                        disabled={blockedUntilCore}
                        onClick={() => openCashierAt(step.tab, step.subTab, step.id !== 'first-order')}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-koma-border bg-koma-raised px-3 py-2 text-[10px] font-black transition hover:border-emerald-500/35 hover:text-emerald-400 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {blockedUntilCore ? 'Disponível depois' : step.actionLabel} <ArrowRight size={12} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            {errorMessage && <p className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-[10px] font-bold text-rose-600">{errorMessage}</p>}

            <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-koma-border bg-koma-raised/40 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-black">
                  {!configurationComplete
                    ? 'Finalize a configuração'
                    : !readyToOperate
                      ? 'Configuração concluída — falta validar'
                      : 'Restaurante pronto para operar'}
                </p>
                <p className="mt-1 text-[10px] text-koma-muted">
                  {!configurationComplete
                    ? 'Conclua os quatro itens essenciais acima.'
                    : !readyToOperate
                      ? 'Faça um pedido de teste completo com pagamento e conclusão.'
                      : snapshot.trial.status === 'setup'
                        ? 'O teste passou. O trial ainda não começou; inicie quando decidir abrir a operação.'
                        : 'A prontidão operacional foi validada.'}
                </p>
              </div>

              {configurationComplete && !readyToOperate && (
                <button type="button" onClick={() => openCashierAt('operacao', 'balcao', false)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-koma-foreground px-5 py-3 text-xs font-black text-koma-page">
                  Fazer pedido de teste <ArrowRight size={14} />
                </button>
              )}

              {readyToOperate && snapshot.trialCanStart && (
                <button type="button" disabled={startingTrial} onClick={() => void startTrial()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-xs font-black text-zinc-950 disabled:opacity-60">
                  {startingTrial ? 'Iniciando…' : 'Iniciar operação e 7 dias grátis'} <ArrowRight size={14} />
                </button>
              )}

              {readyToOperate && !snapshot.trialCanStart && (
                <button type="button" onClick={() => openCashierAt('operacao', 'pedidos', false)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-xs font-black text-zinc-950">
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
