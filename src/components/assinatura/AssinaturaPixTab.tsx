import React, { useState, useEffect, useRef } from 'react';
import clsx from 'clsx';
import { motion } from 'motion/react';
import { Card, CardContent, CardHeader } from '../ui/card';
import { TimelineContent } from '../ui/timeline-animation';
import {
  CheckCircle2,
  Sparkles,
  Zap,
  MessageSquare,
  ArrowUpRight,
  ShieldCheck,
  Check,
  CheckCheck,
  X,
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
  isTestPlan?: boolean;
  bannerNotice?: string | null;
}

const PricingSwitch = ({ isYearly, onSwitch }: { isYearly: boolean; onSwitch: (yearly: boolean) => void }) => {
  return (
    <div className="flex justify-center my-3">
      <div className="relative z-10 mx-auto flex w-fit rounded-full bg-koma-panel border border-koma-border p-1">
        <button
          type="button"
          onClick={() => onSwitch(false)}
          className={`relative z-10 w-fit sm:h-10 h-9 rounded-full sm:px-5 px-3 sm:py-1 py-0.5 text-xs font-bold transition-colors cursor-pointer ${
            !isYearly ? "text-zinc-950" : "text-koma-subtle hover:text-koma-foreground"
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
            isYearly ? "text-zinc-950" : "text-koma-subtle hover:text-koma-foreground"
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
              isYearly ? "bg-zinc-950/30 text-zinc-950" : "bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30"
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
  isTestPlan = false,
  bannerNotice
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'meu_plano' | 'planos_upgrade'>('meu_plano');
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
      <div className="flex items-center gap-2 border-b border-koma-border pb-3 overflow-x-auto scrollbar-none">
        <button
          type="button"
          onClick={() => setActiveSubTab('meu_plano')}
          className={clsx(
            'px-4 py-2.5 rounded-2xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer',
            activeSubTab === 'meu_plano'
              ? 'bg-emerald-500 text-zinc-950 shadow-lg shadow-emerald-950/40'
              : 'bg-koma-panel text-koma-subtle hover:text-koma-foreground border border-koma-border'
          )}
        >
          <ShieldCheck size={15} />
          <span>Meu Plano</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('planos_upgrade')}
          className={clsx(
            'px-4 py-2.5 rounded-2xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer',
            activeSubTab === 'planos_upgrade'
              ? 'bg-emerald-500 text-zinc-950 shadow-lg shadow-emerald-950/40'
              : 'bg-koma-panel text-koma-subtle hover:text-koma-foreground border border-koma-border'
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
          {/* RESUMO COMPACTO DO PLANO ATUAL */}
          <div className="bg-koma-panel border border-koma-border p-5 rounded-3xl space-y-4 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-koma-border pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-serif text-base font-bold text-koma-foreground">{currentPlan.name}</h4>
                  <span className="koma-badge-success px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider flex items-center gap-1">
                    <CheckCircle2 size={11} />
                    <span>Plano Ativo</span>
                  </span>
                </div>
                <p className="text-xs text-koma-muted mt-1">{currentPlan.tagline}</p>
              </div>

              <div className="font-mono text-right">
                <span className="text-emerald-700 dark:text-emerald-400 font-extrabold text-lg">{formatCurrency(currentPlan.price)}</span>
                <span className="text-koma-muted text-[10px]">/mês</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-[10px] font-mono">
              {isTestPlan && (
                <span className="px-3 py-1 rounded-xl border border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300 font-bold">
                  Modo de teste Premium — assinatura não alterada
                </span>
              )}
              <span className={clsx(
                'px-3 py-1 rounded-xl border font-bold',
                hasPrinting
                  ? 'koma-badge-success'
                  : 'bg-koma-raised border-koma-border text-koma-muted'
              )}>
                {hasPrinting ? '✓ Impressão Automática Incluída' : '✕ Sem Impressão Automática'}
              </span>
              <span className={clsx(
                'px-3 py-1 rounded-xl border font-bold',
                hasOnlineMenu
                  ? 'koma-badge-success'
                  : 'koma-badge-warning'
              )}>
                {hasOnlineMenu ? 'Cardápio Digital Ativo' : 'Cardápio Digital Opcional (+R$ 49/mês)'}
              </span>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setActiveSubTab('planos_upgrade')}
                className="w-full py-3 koma-btn-success rounded-2xl text-xs uppercase tracking-wider transition-all cursor-pointer shadow-sm flex items-center justify-center gap-2"
              >
                <span>Comparar planos</span>
                <ArrowUpRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. SUB-ABA 2: PLANOS & UPGRADE */}
      {activeSubTab === 'planos_upgrade' && (
        <div className="space-y-6 animate-fade-in" ref={pricingRef}>
          {/* TOPO COM ANIMAÇÃO TIMELINE */}
          <div id="koma-plans-grid" className="text-center max-w-2xl mx-auto space-y-2">
            <TimelineContent
              as="h3"
              animationNum={0}
              timelineRef={pricingRef}
              customVariants={revealVariants}
              className="text-2xl sm:text-3xl font-serif font-bold text-koma-foreground"
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
              className="text-xs text-koma-subtle"
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
              <p className="min-h-4 text-[10px] text-koma-muted">
                {isYearly ? '10% de desconto no pagamento anual' : 'Valores cobrados mensalmente'}
              </p>
            </TimelineContent>
          </div>

          {/* GRID RESPONSIVO DE PLANOS */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-5 items-stretch max-w-7xl mx-auto pt-4 pb-2">
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
                  className={clsx('flex flex-col', isPopular && 'mt-3 md:mt-0')}
                >
                  <Card
                    onClick={() => setSelectedPlanId(plan.id)}
                    className={clsx(
                      'relative h-full flex flex-col justify-between transition-all duration-200 cursor-pointer rounded-2xl sm:rounded-3xl border text-left overflow-visible',
                      isPopular
                        ? 'bg-koma-card border-emerald-500 shadow-lg ring-2 ring-emerald-500/20 md:-translate-y-1 z-10'
                        : isSelected
                        ? 'bg-koma-raised border-emerald-500/60 shadow-md'
                        : 'bg-koma-panel border-koma-border hover:border-koma-border-strong'
                    )}
                  >
                    {/* Badge Mais Popular */}
                    {isPopular && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 sm:px-3.5 sm:py-1 rounded-full bg-emerald-600 text-white text-[8px] sm:text-[9px] font-extrabold uppercase tracking-widest shadow-md flex items-center gap-1 z-20">
                        <Sparkles size={11} />
                        <span>Mais Popular</span>
                      </div>
                    )}

                    <CardHeader className="p-4 sm:p-5 pb-2 sm:pb-3">
                      <div className="flex justify-between items-start">
                        <h4 className="text-lg sm:text-xl font-bold text-koma-foreground mb-0.5 sm:mb-1 font-serif">
                          {plan.name}
                        </h4>
                      </div>
                      <p className="text-xs text-koma-subtle min-h-0 sm:min-h-[32px]">{plan.tagline}</p>

                      <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-koma-border min-w-0">
                        <div className="flex items-end gap-1 whitespace-nowrap">
                          <span className="text-2xl sm:text-3xl font-extrabold font-mono text-emerald-700 dark:text-emerald-400 tracking-tight">
                            {formatCurrency(displayPrice)}
                          </span>
                          <span className="text-koma-muted text-xs font-mono pb-0.5 sm:pb-1">/mês</span>
                        </div>
                        <p className="mt-0.5 sm:mt-1 min-h-4 text-[10px] leading-4 text-koma-muted font-medium">
                          {isYearly
                            ? `${formatCurrency(pricing.annualTotal)} cobrados anualmente`
                            : 'Cobrança mensal'}
                        </p>
                      </div>
                    </CardHeader>

                    <CardContent className="p-4 sm:p-5 pt-1 sm:pt-2 flex-grow flex flex-col justify-between space-y-3 sm:space-y-4">
                      {/* Botão de Ação do Card */}
                      <div className="pt-1">
                        {isCurrent ? (
                          <div className="w-full py-2.5 koma-badge-success font-bold rounded-xl text-[10px] uppercase tracking-wider text-center flex items-center justify-center gap-1.5 shadow-xs">
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
                              'w-full py-2.5 rounded-xl font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors shadow-xs',
                              isPopular
                                ? 'koma-btn-success'
                                : 'bg-koma-raised text-koma-foreground border border-koma-border hover:border-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-400'
                            )}
                          >
                            <MessageSquare size={13} />
                            <span>Falar sobre este plano</span>
                          </a>
                        )}
                      </div>

                      {/* Lista de Recursos com Ícone CheckCheck */}
                      <div className="space-y-2 sm:space-y-3 pt-1 sm:pt-2">
                        <span className="text-[9px] font-bold text-koma-muted uppercase tracking-wider block">
                          Recursos Inclusos:
                        </span>
                        <ul className="space-y-1.5 sm:space-y-2 font-medium text-xs">
                          {plan.features.map((feature, featureIndex) => (
                            <li key={featureIndex} className="flex items-start">
                              <span className="h-4 w-4 sm:h-5 sm:w-5 bg-emerald-500/15 border border-emerald-500/30 rounded-full grid place-content-center mt-0.5 mr-2 shrink-0">
                                <CheckCheck className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-emerald-700 dark:text-emerald-400" />
                              </span>
                              <span className="text-xs text-koma-foreground leading-snug">{feature}</span>
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
          <div className="p-5 bg-koma-panel border border-koma-border rounded-3xl text-left space-y-3 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-koma-border pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <strong className="text-koma-foreground font-serif text-sm block">{ONLINE_MENU_ADDON.name}</strong>
                </div>
                <p className="text-xs text-koma-muted mt-1">{ONLINE_MENU_ADDON.description}</p>
              </div>

              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
                <span className="px-2.5 py-1 bg-koma-raised text-koma-foreground border border-koma-border text-[9px] font-bold rounded-full whitespace-nowrap">
                  R$ {ONLINE_MENU_ADDON.price}/mês no Pocket e Pro
                </span>
                <span className="px-2.5 py-1 koma-badge-success text-[9px] font-bold uppercase rounded-full whitespace-nowrap">
                  Incluso no Premium
                </span>
              </div>
            </div>

            <p className="text-[10px] text-koma-muted leading-relaxed">
              Implantação e configuração inicial podem ser cobradas separadamente.
            </p>
          </div>

          {/* ACCORDION PARA TABELA COMPARATIVA DETALHADA */}
          <div className="bg-koma-panel border border-koma-border rounded-3xl overflow-hidden transition-all shadow-sm">
            <button
              type="button"
              onClick={() => setIsAccordionOpen(!isAccordionOpen)}
              className="w-full p-5 border border-transparent hover:bg-koma-raised flex items-center justify-between transition-colors cursor-pointer text-left"
            >
              <div className="flex items-center gap-2.5">
                <Layers size={18} className="text-emerald-700 dark:text-emerald-400" />
                <div>
                  <h4 className="font-serif font-bold text-sm text-koma-foreground">Ver Comparativo Completo de Recursos (Tabela Detalhada)</h4>
                  <span className="text-[10px] text-koma-muted block mt-0.5">
                    {isAccordionOpen ? 'Clique para recolher o detalhamento linha a linha' : 'Clique para expandir a comparação completa de funcionalidades'}
                  </span>
                </div>
              </div>
              <div className="p-2 bg-koma-raised border border-koma-border rounded-xl text-koma-foreground">
                {isAccordionOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
            </button>

            {isAccordionOpen && (
              <div className="p-5 border-t border-koma-border space-y-4 animate-fade-in">
                <div className="overflow-x-auto min-w-full border border-koma-border rounded-2xl">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="bg-koma-raised border-b border-koma-border text-koma-foreground uppercase text-[9px] font-extrabold tracking-wider">
                        <th className="p-3.5 font-sans">Funcionalidade</th>
                        {SUBSCRIPTION_PLANS.map((plan) => (
                          <th
                            key={plan.id}
                            className={clsx(
                              'p-3.5 text-center font-mono whitespace-nowrap',
                              plan.recommended ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 font-extrabold' : 'text-koma-foreground'
                            )}
                          >
                            {plan.name} ({formatCurrency(plan.price)})
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-koma-border text-koma-foreground">
                      {Object.entries(groupedMatrix).map(([category, rows]) => (
                        <React.Fragment key={category}>
                          <tr className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-300 font-extrabold text-[10px] uppercase tracking-wider border-y border-koma-border">
                            <td colSpan={4} className="p-2.5 pl-3.5 font-sans">
                              {category}
                            </td>
                          </tr>

                          {rows.map((row, idx) => (
                            <tr key={idx} className="hover:bg-koma-raised/60 transition-colors text-[10px]">
                              <td className="p-3.5 font-sans font-semibold text-koma-foreground pl-6">
                                {row.feature}
                              </td>

                              <td className="p-3.5 text-center">
                                {typeof row.pocket === 'boolean' ? (
                                  row.pocket ? (
                                    <Check size={16} className="text-emerald-700 dark:text-emerald-400 mx-auto stroke-[2.5]" />
                                  ) : (
                                    <X size={15} className="text-koma-muted mx-auto opacity-40" />
                                  )
                                ) : (
                                  <span className="text-koma-foreground font-medium">{row.pocket}</span>
                                )}
                              </td>

                              <td className="p-3.5 text-center bg-emerald-500/5">
                                {typeof row.pro === 'boolean' ? (
                                  row.pro ? (
                                    <Check size={16} className="text-emerald-700 dark:text-emerald-400 mx-auto stroke-[2.5]" />
                                  ) : (
                                    <X size={15} className="text-koma-muted mx-auto opacity-40" />
                                  )
                                ) : (
                                  <span className="font-bold text-emerald-800 dark:text-emerald-300">{row.pro}</span>
                                )}
                              </td>

                              <td className="p-3.5 text-center">
                                {typeof row.premium === 'boolean' ? (
                                  row.premium ? (
                                    <Check size={16} className="text-emerald-700 dark:text-emerald-400 mx-auto stroke-[2.5]" />
                                  ) : (
                                    <X size={15} className="text-koma-muted mx-auto opacity-40" />
                                  )
                                ) : (
                                  <span className="font-bold text-emerald-800 dark:text-emerald-300">{row.premium}</span>
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
