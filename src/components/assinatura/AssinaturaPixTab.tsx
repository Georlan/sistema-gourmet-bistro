import React, { useState, useEffect, useRef } from 'react';
import clsx from 'clsx';
import { motion } from 'motion/react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { TimelineContent } from '@/components/ui/timeline-animation';
import {
  CreditCard,
  QrCode,
  CheckCircle2,
  Sparkles,
  Zap,
  Bot,
  MessageSquare,
  ArrowUpRight,
  ShieldCheck,
  Check,
  CheckCheck,
  X,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronUp,
  Layers,
  Briefcase,
  Database,
  Server
} from 'lucide-react';
import {
  SUBSCRIPTION_PLANS,
  ONLINE_MENU_ADDON,
  PLAN_COMPARISON_MATRIX,
  SubscriptionPlanId,
  getSubscriptionPlan,
  FeatureComparisonRow,
  ANNUAL_DISCOUNT_RATE,
  formatCurrency,
  getSubscriptionPricing
} from '../../config/subscriptionPlans';
import { KOMA_LANDING_CONFIG } from '../../landing/config/landingConfig';

interface AssinaturaPixTabProps {
  currentPlanId: SubscriptionPlanId;
  hasPrinting: boolean;
  hasOnlineMenu: boolean;
  payPixActive: boolean;
  setPayPixActive: (v: boolean) => void;
  payCardActive: boolean;
  setPayCardActive: (v: boolean) => void;
  isTestPlan?: boolean;
  bannerNotice?: string | null;
}

const PricingSwitch = ({ isYearly, onSwitch }: { isYearly: boolean; onSwitch: (yearly: boolean) => void }) => {
  return (
    <div className="flex justify-center my-3">
      <div className="relative z-10 mx-auto flex w-fit rounded-full bg-[#121214] border border-[#27272A] p-1">
        <button
          type="button"
          onClick={() => onSwitch(false)}
          className={`relative z-10 w-fit sm:h-10 h-9 rounded-full sm:px-5 px-3 sm:py-1 py-0.5 text-xs font-bold transition-colors cursor-pointer ${
            !isYearly ? "text-zinc-950" : "text-gray-400 hover:text-white"
          }`}
        >
          {!isYearly && (
            <motion.span
              layoutId="switch_koma"
              className="absolute top-0 left-0 sm:h-10 h-9 w-full rounded-full bg-emerald-500 shadow-md shadow-emerald-950/50"
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          )}
          <span className="relative">Mensal</span>
        </button>

        <button
          type="button"
          onClick={() => onSwitch(true)}
          className={`relative z-10 w-fit sm:h-10 h-9 flex-shrink-0 rounded-full sm:px-5 px-3 sm:py-1 py-0.5 text-xs font-bold transition-colors cursor-pointer ${
            isYearly ? "text-zinc-950" : "text-gray-400 hover:text-white"
          }`}
        >
          {isYearly && (
            <motion.span
              layoutId="switch_koma"
              className="absolute top-0 left-0 sm:h-10 h-9 w-full rounded-full bg-emerald-500 shadow-md shadow-emerald-950/50"
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          )}
          <span className="relative flex items-center gap-1.5">
            Anual
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold transition-colors ${
              isYearly ? "bg-zinc-950/30 text-zinc-950" : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
            }`}>
              Economize {ANNUAL_DISCOUNT_RATE * 100}%
            </span>
          </span>
        </button>
      </div>
    </div>
  );
};

export const AssinaturaPixTab: React.FC<AssinaturaPixTabProps> = ({
  currentPlanId,
  hasPrinting,
  hasOnlineMenu,
  payPixActive,
  setPayPixActive,
  payCardActive,
  setPayCardActive,
  isTestPlan = false,
  bannerNotice
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'meu_plano' | 'pagamentos' | 'planos_upgrade'>('meu_plano');
  const [selectedPlanId, setSelectedPlanId] = useState<SubscriptionPlanId>(currentPlanId);
  const [isAccordionOpen, setIsAccordionOpen] = useState(false);
  const [isYearly, setIsYearly] = useState(false);

  const pricingRef = useRef<HTMLDivElement>(null);
  const currentPlan = getSubscriptionPlan(currentPlanId);

  useEffect(() => {
    if (bannerNotice) {
      setActiveSubTab('planos_upgrade');
    }
  }, [bannerNotice]);

  const [usageData] = useState({
    iaRespostasUsadas: 410,
    whatsappUsados: 440
  });

  const iaQuota = currentPlan.quotas.iaChefRespostas;
  const waQuota = currentPlan.quotas.whatsappDisparos;

  const iaPct = Math.min(100, Math.round((usageData.iaRespostasUsadas / iaQuota) * 100));
  const waPct = Math.min(100, Math.round((usageData.whatsappUsados / waQuota) * 100));

  const isHighUsage = iaPct >= 80 || waPct >= 80;

  const groupedMatrix = PLAN_COMPARISON_MATRIX.reduce((acc, row) => {
    if (!acc[row.category]) acc[row.category] = [];
    acc[row.category].push(row);
    return acc;
  }, {} as Record<string, FeatureComparisonRow[]>);

  const revealVariants = {
    visible: (i: number) => ({
      y: 0,
      opacity: 1,
      filter: "blur(0px)",
      transition: {
        delay: i * 0.15,
        duration: 0.4,
      },
    }),
    hidden: {
      filter: "blur(6px)",
      y: -15,
      opacity: 0,
    },
  };

  const getPlanContactUrl = (planName: string) => {
    const message = `Olá! Quero falar sobre o ${planName} para o meu restaurante.`;
    return `https://wa.me/${KOMA_LANDING_CONFIG.whatsappNumber}?text=${encodeURIComponent(message)}`;
  };

  return (
    <div className="space-y-6 text-left animate-fade-in pb-12">
      {/* 1. NAVEGAÇÃO SUPERIOR POR SUB-ABAS (PILLS) */}
      <div className="flex items-center gap-2 border-b border-[#27272A] pb-3 overflow-x-auto scrollbar-none">
        <button
          type="button"
          onClick={() => setActiveSubTab('meu_plano')}
          className={clsx(
            'px-4 py-2.5 rounded-2xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer',
            activeSubTab === 'meu_plano'
              ? 'bg-emerald-500 text-zinc-950 shadow-lg shadow-emerald-950/40'
              : 'bg-[#121214] text-gray-400 hover:text-white border border-[#27272A]'
          )}
        >
          <ShieldCheck size={15} />
          <span>Meu Plano & Consumo</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('pagamentos')}
          className={clsx(
            'px-4 py-2.5 rounded-2xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer',
            activeSubTab === 'pagamentos'
              ? 'bg-emerald-500 text-zinc-950 shadow-lg shadow-emerald-950/40'
              : 'bg-[#121214] text-gray-400 hover:text-white border border-[#27272A]'
          )}
        >
          <CreditCard size={15} />
          <span>Pagamentos Online</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('planos_upgrade')}
          className={clsx(
            'px-4 py-2.5 rounded-2xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer',
            activeSubTab === 'planos_upgrade'
              ? 'bg-emerald-500 text-zinc-950 shadow-lg shadow-emerald-950/40'
              : 'bg-[#121214] text-gray-400 hover:text-white border border-[#27272A]'
          )}
        >
          <Zap size={15} />
          <span>Planos & Upgrade</span>
        </button>
      </div>

      {/* BANNER FIXO PARA AVISO DE REDIRECIONAMENTO */}
      {bannerNotice && activeSubTab === 'planos_upgrade' && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-3xl flex items-center justify-between gap-3 text-amber-200 text-xs shadow-lg">
          <div className="flex items-center gap-2.5">
            <Info size={20} className="shrink-0 text-amber-400" />
            <span>{bannerNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById('koma-plans-grid');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
            className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold rounded-xl text-[10px] uppercase tracking-wider transition-all shrink-0 cursor-pointer shadow"
          >
            Ver Planos Disponíveis
          </button>
        </div>
      )}

      {/* 2. SUB-ABA 1: MEU PLANO & CONSUMO DO MÊS */}
      {activeSubTab === 'meu_plano' && (
        <div className="space-y-6 animate-fade-in">
          {/* BLOCO DE CONSUMO DO MÊS */}
          <div className="bg-[#121214]/80 border border-[#27272A] p-5 rounded-3xl space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#27272A] pb-3">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-emerald-400" />
                <h4 className="font-serif font-bold text-sm text-white">Consumo do Mês (Cotas Ativas)</h4>
              </div>
              <span className="text-[9px] text-gray-400 font-mono">Renovação Mensal</span>
            </div>

            {isHighUsage && (
              <div className="p-3.5 bg-amber-500/10 border border-amber-500/25 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-300 text-xs">
                <div className="flex items-center gap-2.5">
                  <AlertTriangle size={18} className="shrink-0 text-amber-400 animate-pulse" />
                  <span>Você atingiu mais de 80% das cotas do seu plano neste mês.</span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSubTab('planos_upgrade')}
                  className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-[10px] uppercase tracking-wider rounded-xl shrink-0 cursor-pointer shadow"
                >
                  Liberar Mais Cotas
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Cota IA */}
              <div className="bg-[#1C1C1F]/60 border border-[#27272A] p-4 rounded-2xl space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-gray-300 flex items-center gap-1.5">
                    <Bot size={16} className="text-emerald-400" />
                    <span>Chef Virtual / Copiloto IA</span>
                  </span>
                  <span className="font-mono text-gray-400 text-[10px]">
                    <strong className="text-white">{usageData.iaRespostasUsadas}</strong> / {iaQuota} msgs
                  </span>
                </div>
                <div className="w-full h-2.5 bg-[#09090B] border border-[#27272A] rounded-full overflow-hidden p-0.5">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${iaPct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${iaPct}%` }}
                  />
                </div>
                <span className="text-[9px] text-gray-500 block">
                  {iaPct}% das respostas utilizadas neste período
                </span>
              </div>

              {/* Cota WhatsApp */}
              <div className="bg-[#1C1C1F]/60 border border-[#27272A] p-4 rounded-2xl space-y-2 opacity-75">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-gray-300 flex items-center gap-1.5">
                    <MessageSquare size={16} className="text-gray-400" />
                    <span>Notificações Automáticas WhatsApp</span>
                  </span>
                  <span className="font-mono text-amber-400 text-[10px] bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                    Manual via wa.me (Automação em breve)
                  </span>
                </div>
                <span className="text-[9px] text-gray-400 block pt-1">
                  Neste plano, o envio de notificações e contatos é realizado via links diretos sem custos adicionais.
                </span>
              </div>
            </div>
          </div>

          {/* RESUMO COMPACTO DO PLANO ATUAL */}
          <div className="bg-[#121214]/60 border border-[#27272A] p-5 rounded-3xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#27272A] pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-serif text-base font-bold text-white">{currentPlan.name}</h4>
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] font-bold uppercase tracking-wider flex items-center gap-1">
                    <CheckCircle2 size={11} />
                    <span>Plano Ativo</span>
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1">{currentPlan.tagline}</p>
              </div>

              <div className="font-mono text-right">
                <span className="text-emerald-400 font-bold text-lg">{formatCurrency(currentPlan.price)}</span>
                <span className="text-gray-500 text-[10px]">/mês</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-[10px] font-mono">
              {isTestPlan && (
                <span className="px-3 py-1 rounded-xl border border-sky-500/30 bg-sky-500/10 text-sky-300 font-bold">
                  Modo de teste Premium — assinatura não alterada
                </span>
              )}
              <span className={clsx(
                'px-3 py-1 rounded-xl border font-bold',
                hasPrinting
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-400'
              )}>
                {hasPrinting ? '✓ Impressão Automática Incluída' : '✕ Sem Impressão Automática'}
              </span>
              <span className={clsx(
                'px-3 py-1 rounded-xl border font-bold',
                hasOnlineMenu
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                  : 'bg-amber-500/10 border-amber-500/20 text-amber-300'
              )}>
                {hasOnlineMenu ? '✓ Cardápio Digital Ativo' : '⚡ Cardápio Digital Opcional (+R$ 49/mês)'}
              </span>
              <span className="px-3 py-1 rounded-xl border border-zinc-700 bg-zinc-800 text-gray-300">
                Taxa Pix In-App: <strong className="text-emerald-400">{currentPlan.rates.pixInApp}</strong>
              </span>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setActiveSubTab('planos_upgrade')}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold rounded-2xl text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg shadow-emerald-950/40 flex items-center justify-center gap-2"
              >
                <span>Comparar planos</span>
                <ArrowUpRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. SUB-ABA 2: PAGAMENTOS ONLINE */}
      {activeSubTab === 'pagamentos' && (
        <div className="bg-[#121214]/60 border border-[#27272A] p-5 rounded-3xl space-y-4 animate-fade-in">
          <div className="border-b border-[#27272A] pb-3">
            <h4 className="font-serif font-bold text-sm text-white">Integrações de Pagamento Online In-App</h4>
            <p className="text-[10px] text-gray-400 mt-0.5">
              Recebimentos automáticos via gateway Asaas com liquidação direta no seu caixa.
            </p>
          </div>

          <div className="space-y-4">
            {/* Toggle Pix */}
            <div className="p-4 bg-[#1C1C1F]/40 border border-[#27272A] rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <QrCode size={16} className="text-emerald-400" />
                  <strong className="text-white text-xs font-semibold">Pix Automático In-App</strong>
                  <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[8px] font-mono font-bold rounded">
                    Taxa Atual: {currentPlan.rates.pixInApp} por venda
                  </span>
                </div>
                <p className="text-[10px] text-gray-400 leading-relaxed">
                  Gera um QR Code Pix dinâmico na mesa. Libera a comanda e o caixa de forma autônoma.
                </p>
                <span className="text-[9px] text-gray-500 block font-mono">
                  💡 No Kôma Pro a taxa reduz para <strong className="text-emerald-300">0,79%</strong> e no Premium para <strong className="text-emerald-300">0,49%</strong>.
                </span>
              </div>

              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={payPixActive}
                  onChange={(e) => setPayPixActive(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-[#27272A] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>

            {/* Toggle Cartão */}
            <div className="p-4 bg-[#1C1C1F]/40 border border-[#27272A] rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <CreditCard size={16} className="text-sky-400" />
                  <strong className="text-white text-xs font-semibold">Cartão de Crédito Online</strong>
                  <span className="px-2 py-0.5 bg-sky-500/10 text-sky-400 border border-sky-500/20 text-[8px] font-mono font-bold rounded">
                    Taxa Atual: {currentPlan.rates.creditCard} por venda
                  </span>
                </div>
                <p className="text-[10px] text-gray-400 leading-relaxed">
                  Permite pagamento com cartão direto no celular do cliente pela comanda digital.
                </p>
                <span className="text-[9px] text-gray-500 block font-mono">
                  💡 No Kôma Pro a taxa reduz para <strong className="text-sky-300">1,99% + R$0,29</strong> e no Premium para <strong className="text-sky-300">1,49% + R$0,19</strong>.
                </span>
              </div>

              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={payCardActive}
                  onChange={(e) => setPayCardActive(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-[#27272A] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* 4. SUB-ABA 3: PLANOS & UPGRADE (NOVO LAYOUT ANIMADO COM NUMBERFLOW E SHADCN) */}
      {activeSubTab === 'planos_upgrade' && (
        <div className="space-y-6 animate-fade-in" ref={pricingRef}>
          {/* TOPO COM ANIMAÇÃO TIMELINE */}
          <div id="koma-plans-grid" className="text-center max-w-2xl mx-auto space-y-2">
            <TimelineContent
              as="h3"
              animationNum={0}
              timelineRef={pricingRef}
              customVariants={revealVariants}
              className="text-2xl sm:text-3xl font-serif font-bold text-white"
            >
              Planos que escalam com o seu{" "}
              <TimelineContent
                as="span"
                animationNum={1}
                timelineRef={pricingRef}
                customVariants={revealVariants}
                className="border border-dashed border-emerald-500 px-2 py-0.5 rounded-xl bg-emerald-500/10 text-emerald-400 inline-block"
              >
                restaurante
              </TimelineContent>
            </TimelineContent>

            <TimelineContent
              as="p"
              animationNum={2}
              timelineRef={pricingRef}
              customVariants={revealVariants}
              className="text-xs text-gray-400"
            >
              Escolha o plano ideal para o momento da sua operação.
            </TimelineContent>

            {/* CHAVEADOR ANIMADO DE PERÍODO (MENSAL / ANUAL) */}
            <TimelineContent
              as="div"
              animationNum={3}
              timelineRef={pricingRef}
              customVariants={revealVariants}
            >
              <PricingSwitch isYearly={isYearly} onSwitch={setIsYearly} />
              <p className="min-h-4 text-[10px] text-gray-500">
                {isYearly ? '10% de desconto no pagamento anual' : 'Valores cobrados mensalmente'}
              </p>
            </TimelineContent>
          </div>

          {/* GRID RESPONSIVO DE PLANOS */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch max-w-7xl mx-auto py-2">
            {SUBSCRIPTION_PLANS.map((plan, index) => {
              const isCurrent = currentPlanId === plan.id;
              const isSelected = selectedPlanId === plan.id;
              const isPopular = plan.recommended;

              const pricing = getSubscriptionPricing(plan.price);
              const displayPrice = isYearly ? pricing.annualMonthlyEquivalent : pricing.monthly;

              return (
                <TimelineContent
                  key={plan.id}
                  as="div"
                  animationNum={4 + index}
                  timelineRef={pricingRef}
                  customVariants={revealVariants}
                  className="flex flex-col"
                >
                  <Card
                    onClick={() => setSelectedPlanId(plan.id)}
                    className={clsx(
                      'relative h-full flex flex-col justify-between transition-all duration-200 cursor-pointer rounded-3xl border text-left overflow-visible',
                      isPopular
                        ? 'bg-[#171719] border-emerald-500/70 shadow-lg shadow-black/30 ring-1 ring-emerald-500/20 md:-translate-y-1 z-10'
                        : isSelected
                        ? 'bg-[#1C1C1F] border-emerald-500/40 shadow-md'
                        : 'bg-[#121214]/90 border-[#27272A] hover:border-gray-600'
                    )}
                  >
                    {/* Badge Mais Popular */}
                    {isPopular && (
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-emerald-500 text-zinc-950 text-[9px] font-extrabold uppercase tracking-widest shadow-md flex items-center gap-1">
                        <Sparkles size={11} />
                        <span>Mais Popular</span>
                      </div>
                    )}

                    <CardHeader className="p-5 pb-3">
                      <div className="flex justify-between items-start">
                        <h4 className="text-xl font-bold text-white mb-1 font-serif">
                          {plan.name}
                        </h4>
                      </div>
                      <p className="text-xs text-gray-400 min-h-[32px]">{plan.tagline}</p>

                      <div className="mt-4 pt-4 border-t border-[#27272A] min-w-0">
                        <div className="flex items-end gap-1 whitespace-nowrap">
                          <span className="text-3xl font-bold font-mono text-emerald-400 tracking-tight">
                            {formatCurrency(displayPrice)}
                          </span>
                          <span className="text-gray-400 text-xs font-mono pb-1">/mês</span>
                        </div>
                        <p className="mt-1 min-h-4 text-[10px] leading-4 text-gray-500">
                          {isYearly
                            ? `${formatCurrency(pricing.annualTotal)} cobrados anualmente`
                            : 'Cobrança mensal'}
                        </p>
                      </div>
                    </CardHeader>

                    <CardContent className="p-5 pt-2 flex-grow flex flex-col justify-between space-y-4">
                      {/* Botão de Ação do Card */}
                      <div className="pt-1">
                        {isCurrent ? (
                          <div className="w-full py-2.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold rounded-xl text-[10px] uppercase tracking-wider text-center flex items-center justify-center gap-1.5 shadow">
                            <ShieldCheck size={14} />
                            <span>Plano Atual</span>
                          </div>
                        ) : (
                          <a
                            href={getPlanContactUrl(plan.name)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Falar sobre o ${plan.name} no WhatsApp`}
                            className={clsx(
                              'w-full py-2.5 rounded-xl font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors',
                              isPopular
                                ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400'
                                : 'bg-[#1C1C1F] text-gray-200 border border-[#343438] hover:border-emerald-500/50 hover:text-white'
                            )}
                          >
                            <MessageSquare size={13} />
                            <span>Falar sobre este plano</span>
                          </a>
                        )}
                      </div>

                      {/* Lista de Recursos com Ícone CheckCheck */}
                      <div className="space-y-3 pt-2">
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">
                          Recursos Inclusos:
                        </span>
                        <ul className="space-y-2 font-medium text-xs">
                          {plan.features.map((feature, featureIndex) => (
                            <li key={featureIndex} className="flex items-start">
                              <span className="h-5 w-5 bg-emerald-500/10 border border-emerald-500/30 rounded-full grid place-content-center mt-0.5 mr-2.5 shrink-0">
                                <CheckCheck className="h-3 w-3 text-emerald-400" />
                              </span>
                              <span className="text-xs text-gray-300 leading-snug">{feature}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                </TimelineContent>
              );
            })}
          </div>

          {/* CARD DO ADDON "CARDÁPIO ONLINE KÔMA" */}
          <div className="p-5 bg-[#121214]/80 border border-[#303034] rounded-3xl text-left space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#27272A] pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <strong className="text-white font-serif text-sm block">{ONLINE_MENU_ADDON.name}</strong>
                </div>
                <p className="text-xs text-gray-400 mt-1">{ONLINE_MENU_ADDON.description}</p>
              </div>

              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
                <span className="px-2.5 py-1 bg-zinc-800 text-gray-200 border border-zinc-700 text-[9px] font-bold rounded-full whitespace-nowrap">
                  R$ {ONLINE_MENU_ADDON.price}/mês no Pocket e Pro
                </span>
                <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] font-bold uppercase rounded-full whitespace-nowrap">
                  Incluso no Premium
                </span>
              </div>
            </div>

            <p className="text-[10px] text-gray-500 leading-relaxed">
              Implantação e configuração inicial podem ser cobradas separadamente.
            </p>
          </div>

          {/* ACCORDION PARA TABELA COMPARATIVA DETALHADA */}
          <div className="bg-[#121214]/60 border border-[#27272A] rounded-3xl overflow-hidden transition-all">
            <button
              type="button"
              onClick={() => setIsAccordionOpen(!isAccordionOpen)}
              className="w-full p-5 border border-transparent hover:bg-[#1C1C1F]/40 flex items-center justify-between transition-colors cursor-pointer text-left"
            >
              <div className="flex items-center gap-2.5">
                <Layers size={18} className="text-emerald-400" />
                <div>
                  <h4 className="font-serif font-bold text-sm text-white">Ver Comparativo Completo de Recursos (Tabela Detalhada)</h4>
                  <span className="text-[10px] text-gray-400 block mt-0.5">
                    {isAccordionOpen ? 'Clique para recolher o detalhamento linha a linha' : 'Clique para expandir a comparação completa de funcionalidades'}
                  </span>
                </div>
              </div>
              <div className="p-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-gray-300">
                {isAccordionOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
            </button>

            {isAccordionOpen && (
              <div className="p-5 border-t border-[#27272A] space-y-4 animate-fade-in">
                <div className="overflow-x-auto min-w-full border border-[#27272A]/40 rounded-2xl">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="bg-[#1C1C1F] border-b border-[#27272A] text-gray-400 uppercase text-[9px] tracking-wider">
                        <th className="p-3.5 font-sans">Funcionalidade</th>
                        {SUBSCRIPTION_PLANS.map((plan) => (
                          <th
                            key={plan.id}
                            className={clsx(
                              'p-3.5 text-center font-mono whitespace-nowrap',
                              plan.recommended && 'bg-emerald-500/10 text-emerald-300'
                            )}
                          >
                            {plan.name} ({formatCurrency(plan.price)})
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#27272A]/40 text-gray-200">
                      {Object.entries(groupedMatrix).map(([category, rows]) => (
                        <React.Fragment key={category}>
                          <tr className="bg-[#1C1C1F]/90 text-emerald-400 font-bold text-[9px] uppercase tracking-wider border-y border-[#27272A]">
                            <td colSpan={4} className="p-2.5 pl-3.5 font-sans">
                              {category}
                            </td>
                          </tr>

                          {rows.map((row, idx) => (
                            <tr key={idx} className="hover:bg-[#1C1C1F]/40 transition-colors text-[10px]">
                              <td className="p-3.5 font-sans font-medium text-white pl-6">
                                {row.feature}
                              </td>

                              <td className="p-3.5 text-center">
                                {typeof row.pocket === 'boolean' ? (
                                  row.pocket ? (
                                    <Check size={16} className="text-emerald-400 mx-auto" />
                                  ) : (
                                    <X size={16} className="text-zinc-600 mx-auto" />
                                  )
                                ) : (
                                  <span className="text-gray-300">{row.pocket}</span>
                                )}
                              </td>

                              <td className="p-3.5 text-center bg-emerald-500/5">
                                {typeof row.pro === 'boolean' ? (
                                  row.pro ? (
                                    <Check size={16} className="text-emerald-400 mx-auto" />
                                  ) : (
                                    <X size={16} className="text-zinc-600 mx-auto" />
                                  )
                                ) : (
                                  <span className="font-bold text-emerald-300">{row.pro}</span>
                                )}
                              </td>

                              <td className="p-3.5 text-center">
                                {typeof row.premium === 'boolean' ? (
                                  row.premium ? (
                                    <Check size={16} className="text-emerald-400 mx-auto" />
                                  ) : (
                                    <X size={16} className="text-zinc-600 mx-auto" />
                                  )
                                ) : (
                                  <span className="font-bold text-emerald-400">{row.premium}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
