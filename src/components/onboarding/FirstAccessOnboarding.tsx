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

type Props = {
  accessToken: string;
  user: Record<string, unknown>;
};

type Snapshot = {
  tenantId: string;
  restaurantName: string;
  plan: string;
  trialDays: number;
  profileConfigured: boolean;
  hoursConfigured: boolean;
  catalogConfigured: boolean;
  mercadoPagoConnected: boolean;
  firstOrderDetected: boolean;
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

const parseStructured = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const isNonEmptyArray = (value: unknown) => {
  const parsed = parseStructured(value);
  return Array.isArray(parsed) && parsed.length > 0;
};

const hasProfileData = (config: Record<string, unknown> | null) => Boolean(
  config?.endereco
  || config?.subtitulo
  || config?.sobre_nos
  || config?.logo_url
  || config?.banner_url,
);

const safeArrayLength = (value: unknown) => Array.isArray(value) ? value.length : 0;

const planLabel = (plan: string) => {
  if (plan === 'pocket' || plan === 'pro' || plan === 'premium') {
    return getSubscriptionPlan(plan as SubscriptionPlanId).name;
  }
  return plan || 'KÔMA';
};

export function FirstAccessOnboarding({ accessToken, user }: Props) {
  const [state, setState] = useState<LoadState>('loading');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const headers = useMemo(() => ({
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  }), [accessToken]);

  const requestJson = useCallback(async (path: string) => {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers,
      cache: 'no-store',
    });
    if (response.status === 401) {
      throw new Error('Sua sessão expirou. Entre novamente para continuar.');
    }
    if (!response.ok) return null;
    return response.json().catch(() => null);
  }, [headers]);

  const loadSnapshot = useCallback(async () => {
    setState('loading');
    setErrorMessage('');
    try {
      const [contract, config, catalog, mercadoPago, orders] = await Promise.all([
        requestJson('/api/contracts/current'),
        requestJson('/caixa/configuracoes'),
        requestJson('/produtos/catalogo'),
        requestJson('/payments/mercado-pago/status'),
        requestJson('/comandas/detalhes/todos'),
      ]);

      const receipt = contract?.receipt ?? null;
      const commercial = receipt?.commercial ?? null;
      const restaurantName = String(
        receipt?.contractingParty?.restaurantName
        || config?.nome
        || user?.nome
        || 'Seu restaurante',
      );
      const plan = String(commercial?.plan || config?.plano_efetivo || config?.plano || '');
      const trialDaysRaw = Number(commercial?.trialDays);

      setSnapshot({
        tenantId: String(contract?.tenantId || config?.restaurante_id || user?.restaurante_id || ''),
        restaurantName,
        plan,
        trialDays: Number.isFinite(trialDaysRaw) && trialDaysRaw > 0 ? trialDaysRaw : 7,
        profileConfigured: hasProfileData(config),
        hoursConfigured: isNonEmptyArray(config?.horarios_funcionamento),
        catalogConfigured: safeArrayLength(catalog?.produtos) > 0,
        mercadoPagoConnected: mercadoPago?.connected === true,
        firstOrderDetected: safeArrayLength(orders) > 0,
      });
      setState('ready');
    } catch (error) {
      setState('error');
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível carregar o checklist inicial.');
    }
  }, [requestJson, user]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const openCashierAt = (tab: string, subTab: string) => {
    sessionStorage.setItem('koma_active_tab', tab);
    sessionStorage.setItem('koma_active_subtab', subTab);
    window.location.href = '/?view=caixa';
  };

  const steps: SetupStep[] = snapshot ? [
    {
      id: 'profile',
      title: 'Complete os dados do restaurante',
      description: 'Endereço, apresentação, identidade visual e informações que aparecem para seus clientes.',
      done: snapshot.profileConfigured,
      actionLabel: snapshot.profileConfigured ? 'Revisar dados' : 'Configurar dados',
      tab: 'cardapio_digital',
      subTab: 'cardapio_perfil',
      icon: Store,
    },
    {
      id: 'hours',
      title: 'Defina os horários de funcionamento',
      description: 'O cardápio online usa os horários para saber quando o restaurante pode receber pedidos.',
      done: snapshot.hoursConfigured,
      actionLabel: snapshot.hoursConfigured ? 'Revisar horários' : 'Configurar horários',
      tab: 'cardapio_digital',
      subTab: 'cardapio_pedidos',
      icon: CalendarClock,
    },
    {
      id: 'catalog',
      title: 'Monte o primeiro cardápio',
      description: 'Crie categorias e produtos. Você pode começar pequeno e completar o restante depois.',
      done: snapshot.catalogConfigured,
      actionLabel: snapshot.catalogConfigured ? 'Abrir cardápio' : 'Criar cardápio',
      tab: 'cardapio',
      subTab: 'produtos',
      icon: UtensilsCrossed,
    },
    {
      id: 'payments',
      title: 'Conecte o Mercado Pago',
      description: 'Necessário apenas para receber Pix online pelo cardápio. Dinheiro e operação local continuam disponíveis sem isso.',
      done: snapshot.mercadoPagoConnected,
      optional: true,
      actionLabel: snapshot.mercadoPagoConnected ? 'Revisar conexão' : 'Conectar Mercado Pago',
      tab: 'cardapio_digital',
      subTab: 'cardapio_pagamentos',
      icon: CreditCard,
    },
    {
      id: 'first-order',
      title: 'Faça um primeiro pedido de teste',
      description: 'Passe pelo fluxo de balcão para conferir produto, preparo, pagamento e operação antes de abrir para clientes.',
      done: snapshot.firstOrderDetected,
      optional: true,
      actionLabel: snapshot.firstOrderDetected ? 'Ir para pedidos' : 'Criar pedido de teste',
      tab: 'operacao',
      subTab: 'balcao',
      icon: ShoppingBag,
    },
  ] : [];

  const completed = steps.filter((step) => step.done).length;
  const progress = steps.length ? Math.round((completed / steps.length) * 100) : 0;

  if (state === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-koma-page px-6 text-koma-foreground">
        <div className="text-center">
          <RefreshCw size={22} className="mx-auto animate-spin text-emerald-400" />
          <p className="mt-3 text-xs font-bold uppercase tracking-[0.16em] text-koma-muted">Preparando seu primeiro acesso…</p>
        </div>
      </main>
    );
  }

  if (state === 'error' || !snapshot) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-koma-page px-6 text-koma-foreground">
        <section className="w-full max-w-lg rounded-3xl border border-koma-border bg-koma-card p-7 text-center shadow-2xl">
          <h1 className="text-xl font-black">Sua conta foi ativada</h1>
          <p className="mt-2 text-sm text-koma-muted">{errorMessage || 'O checklist não pôde ser carregado agora.'}</p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button type="button" onClick={() => void loadSnapshot()} className="rounded-xl border border-koma-border px-4 py-3 text-xs font-black text-koma-foreground hover:border-emerald-500/40">
              Tentar novamente
            </button>
            <button type="button" onClick={() => openCashierAt('operacao', 'pedidos')} className="rounded-xl bg-emerald-500 px-4 py-3 text-xs font-black text-zinc-950 hover:bg-emerald-400">
              Ir para o Caixa
            </button>
          </div>
        </section>
      </main>
    );
  }

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
                <h1 className="mt-4 text-2xl font-black sm:text-3xl">Bem-vindo ao KÔMA, {snapshot.restaurantName}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-koma-muted">
                  Seu restaurante já pode entrar no sistema. Este checklist só organiza a implantação — nenhuma etapa abaixo bloqueia o uso do Caixa.
                </p>
              </div>
              <div className="grid min-w-[220px] grid-cols-2 gap-2">
                <div className="rounded-2xl border border-koma-border bg-koma-page p-3">
                  <p className="text-[9px] font-black uppercase tracking-wider text-koma-subtle">Plano</p>
                  <p className="mt-1 text-sm font-black">{planLabel(snapshot.plan)}</p>
                </div>
                <div className="rounded-2xl border border-koma-border bg-koma-page p-3">
                  <p className="text-[9px] font-black uppercase tracking-wider text-koma-subtle">Trial incluído</p>
                  <p className="mt-1 text-sm font-black">{snapshot.trialDays} dias</p>
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 sm:p-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-black">
                  <Sparkles size={16} className="text-emerald-400" /> Implantação inicial
                </div>
                <p className="mt-1 text-xs text-koma-muted">{completed} de {steps.length} passos detectados como concluídos</p>
              </div>
              <button type="button" onClick={() => void loadSnapshot()} className="inline-flex items-center gap-2 self-start rounded-xl border border-koma-border px-3 py-2 text-[10px] font-black text-koma-muted transition hover:border-emerald-500/35 hover:text-emerald-400">
                <RefreshCw size={12} /> Atualizar progresso
              </button>
            </div>

            <div className="mt-4 h-2 overflow-hidden rounded-full bg-koma-raised">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
            </div>

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
                          {step.optional && <span className="rounded-full border border-koma-border px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-koma-subtle">Opcional agora</span>}
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-koma-muted">{step.description}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 pl-[52px] sm:pl-0">
                      {step.done ? <CheckCircle2 size={18} className="text-emerald-400" /> : <Circle size={18} className="text-koma-subtle" />}
                      <button type="button" onClick={() => openCashierAt(step.tab, step.subTab)} className="inline-flex items-center gap-1.5 rounded-xl border border-koma-border bg-koma-raised px-3 py-2 text-[10px] font-black transition hover:border-emerald-500/35 hover:text-emerald-400">
                        {step.actionLabel} <ArrowRight size={12} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-koma-border bg-koma-raised/40 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-black">Quer começar a operar agora?</p>
                <p className="mt-1 text-[10px] text-koma-muted">Você pode voltar às configurações pelo menu do sistema a qualquer momento.</p>
              </div>
              <button type="button" onClick={() => openCashierAt('operacao', 'pedidos')} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-xs font-black text-zinc-950 transition hover:bg-emerald-400">
                Ir para o Caixa <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default FirstAccessOnboarding;
