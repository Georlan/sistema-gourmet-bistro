import React, { useState } from 'react';
import clsx from 'clsx';
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
  X,
  AlertTriangle,
  Info
} from 'lucide-react';
import {
  SUBSCRIPTION_PLANS,
  ONLINE_MENU_ADDON,
  PLAN_COMPARISON_MATRIX,
  SubscriptionPlanId,
  getSubscriptionPlan
} from '../../config/subscriptionPlans';

interface AssinaturaPixTabProps {
  currentPlanId: SubscriptionPlanId;
  hasPrinting: boolean;
  hasOnlineMenu: boolean;
  payPixActive: boolean;
  setPayPixActive: (v: boolean) => void;
  payCardActive: boolean;
  setPayCardActive: (v: boolean) => void;
  onSelectPlan: (planId: SubscriptionPlanId) => void;
  bannerNotice?: string | null;
}

export const AssinaturaPixTab: React.FC<AssinaturaPixTabProps> = ({
  currentPlanId,
  hasPrinting,
  hasOnlineMenu,
  payPixActive,
  setPayPixActive,
  payCardActive,
  setPayCardActive,
  onSelectPlan,
  bannerNotice
}) => {
  const [selectedPlanId, setSelectedPlanId] = useState<SubscriptionPlanId>(currentPlanId);
  const currentPlan = getSubscriptionPlan(currentPlanId);

  // Mock de uso de cotas do mês (pode vir de API /estatisticas no futuro)
  const [usageData] = useState({
    iaRespostasUsadas: 410,
    whatsappUsados: 440
  });

  const iaQuota = currentPlan.quotas.iaChefRespostas;
  const waQuota = currentPlan.quotas.whatsappDisparos;

  const iaPct = Math.min(100, Math.round((usageData.iaRespostasUsadas / iaQuota) * 100));
  const waPct = Math.min(100, Math.round((usageData.whatsappUsados / waQuota) * 100));

  const isHighUsage = iaPct >= 80 || waPct >= 80;

  return (
    <div className="space-y-6 text-left animate-fade-in pb-12">
      {/* 1. TOP BANNER FIXO PARA AVISOS DE DESBLOQUEIO (BUG FIX: NÃO SOBREPOE NADA) */}
      {bannerNotice && (
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
            Ver Opções de Upgrade
          </button>
        </div>
      )}

      {/* 2. HEADER DA TELA & STATUS DA ASSINATURA */}
      <div className="bg-[#121214]/80 border border-[#27272A] p-5 rounded-3xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-serif text-base font-bold text-white">Assinatura & Recebimento Pix</h3>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] font-bold uppercase tracking-wider flex items-center gap-1">
              <CheckCircle2 size={11} />
              <span>{currentPlan.name} Ativo</span>
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Gerencie seu plano de assinatura, limite de cotas e taxas de recebimento online.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={clsx(
            'px-3 py-1 rounded-xl border text-[10px] font-bold font-mono',
            hasPrinting
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : 'bg-zinc-800 border-zinc-700 text-zinc-400'
          )}>
            {hasPrinting ? '✓ Impressão Automática' : '✕ Sem Impressão'}
          </span>
          <span className={clsx(
            'px-3 py-1 rounded-xl border text-[10px] font-bold font-mono',
            hasOnlineMenu
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : 'bg-amber-500/10 border-amber-500/20 text-amber-300'
          )}>
            {hasOnlineMenu ? '✓ Cardápio Online Ativo' : '⚡ Cardápio Online Opcional'}
          </span>
        </div>
      </div>

      {/* 3. BLOCO: CONSUMO DO MÊS (IA & WHATSAPP) */}
      <div className="bg-[#121214]/60 border border-[#27272A] p-5 rounded-3xl space-y-4">
        <div className="flex items-center justify-between border-b border-[#27272A] pb-3">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-emerald-400" />
            <h4 className="font-serif font-bold text-sm text-white">Consumo do Mês (Cotas do Plano Atual)</h4>
          </div>
          <span className="text-[9px] text-gray-400 font-mono">Renovação Mensal</span>
        </div>

        {isHighUsage && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-between gap-3 text-amber-300 text-xs">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0 text-amber-400 animate-pulse" />
              <span>Você atingiu mais de 80% do limite de cotas do seu plano no mês.</span>
            </div>
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('koma-plans-grid');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
              }}
              className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-[9px] uppercase tracking-wider rounded-lg shrink-0 cursor-pointer"
            >
              Fazer Upgrade
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Cota IA */}
          <div className="bg-[#1C1C1F]/60 border border-[#27272A] p-4 rounded-2xl space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-gray-300 flex items-center gap-1.5">
                <Bot size={15} className="text-emerald-400" />
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
              {iaPct}% consumido neste período
            </span>
          </div>

          {/* Cota WhatsApp */}
          <div className="bg-[#1C1C1F]/60 border border-[#27272A] p-4 rounded-2xl space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-gray-300 flex items-center gap-1.5">
                <MessageSquare size={15} className="text-sky-400" />
                <span>Notificações Automáticas WhatsApp</span>
              </span>
              <span className="font-mono text-gray-400 text-[10px]">
                <strong className="text-white">{usageData.whatsappUsados}</strong> / {waQuota} disparos
              </span>
            </div>
            <div className="w-full h-2.5 bg-[#09090B] border border-[#27272A] rounded-full overflow-hidden p-0.5">
              <div
                className={`h-full rounded-full transition-all duration-500 ${waPct >= 80 ? 'bg-amber-500' : 'bg-sky-500'}`}
                style={{ width: `${waPct}%` }}
              />
            </div>
            <span className="text-[9px] text-gray-500 block">
              {waPct}% consumido neste período
            </span>
          </div>
        </div>
      </div>

      {/* 4. INTEGRAÇÕES DE PAGAMENTO ONLINE COM TAXAS ASAAS */}
      <div className="bg-[#121214]/60 border border-[#27272A] p-5 rounded-3xl space-y-4">
        <div className="border-b border-[#27272A] pb-3">
          <h4 className="font-serif font-bold text-sm text-white">Integrações de Pagamento Online In-App</h4>
          <p className="text-[10px] text-gray-400 mt-0.5">
            Pagamentos integrados via gateway Asaas com liquidação direta.
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

      {/* 5. SEÇÃO DE PLANOS & ANCORAGEM VISUAL NO PRO (REQUIREMENTS 3, 4, 8) */}
      <div id="koma-plans-grid" className="space-y-4">
        <div className="border-b border-[#27272A] pb-3 text-left">
          <h4 className="font-serif font-bold text-base text-white">Planos Kôma</h4>
          <p className="text-xs text-gray-400 mt-0.5">
            Escolha o plano ideal para a escala da sua operação. Preços e limites ajustáveis sem fidelidade.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">
          {SUBSCRIPTION_PLANS.map((plan) => {
            const isCurrent = currentPlanId === plan.id;
            const isSelected = selectedPlanId === plan.id;
            const isRecommended = plan.recommended;

            return (
              <div
                key={plan.id}
                onClick={() => setSelectedPlanId(plan.id)}
                className={clsx(
                  'relative rounded-3xl p-5 border transition-all cursor-pointer flex flex-col justify-between space-y-4',
                  isRecommended
                    ? 'bg-gradient-to-b from-[#1C1C1F] to-[#121214] border-emerald-500/80 shadow-xl shadow-emerald-950/30 md:scale-[1.03] z-10'
                    : isSelected
                    ? 'bg-[#1C1C1F] border-emerald-500/40 shadow-md'
                    : 'bg-[#121214]/80 border-[#27272A] hover:border-gray-600'
                )}
              >
                {/* Ribbon Recomendado */}
                {isRecommended && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-emerald-500 text-zinc-950 text-[9px] font-extrabold uppercase tracking-widest shadow-md flex items-center gap-1">
                    <Sparkles size={11} />
                    <span>Mais Popular</span>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="border-b border-[#27272A] pb-3">
                    <div className="flex justify-between items-start gap-2">
                      <h5 className="font-bold text-sm text-white">{plan.name}</h5>
                      <span className="font-mono font-bold text-emerald-400 text-base">
                        R$ {plan.price}<span className="text-[10px] text-gray-400">/mês</span>
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 leading-snug">{plan.tagline}</p>
                  </div>

                  <div className="space-y-2 text-[10px]">
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Incluso no plano:</span>
                    <ul className="space-y-1.5 text-gray-300">
                      {plan.features.map((feat, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <Check size={13} className="text-emerald-400 shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>

                    {plan.limitations.length > 0 && (
                      <ul className="space-y-1 text-[9px] text-amber-300/80 pt-1">
                        {plan.limitations.map((lim, idx) => (
                          <li key={idx} className="flex items-start gap-1.5">
                            <Info size={11} className="text-amber-400 shrink-0 mt-0.5" />
                            <span>{lim}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {/* CTA de Ação Explícito */}
                <div className="pt-2">
                  {isCurrent ? (
                    <div className="w-full py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold rounded-xl text-[10px] uppercase tracking-wider text-center flex items-center justify-center gap-1.5">
                      <ShieldCheck size={14} />
                      <span>Plano Atual</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectPlan(plan.id);
                      }}
                      className={clsx(
                        'w-full py-2.5 rounded-xl font-bold text-[10px] uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow',
                        isRecommended
                          ? 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950 shadow-emerald-950/50'
                          : 'bg-zinc-800 hover:bg-zinc-700 text-white border border-[#27272A]'
                      )}
                    >
                      <span>Fazer Upgrade para {plan.name}</span>
                      <ArrowUpRight size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 6. CARD DO ADDON "CARDÁPIO ONLINE KÔMA" (REQUIREMENT 5) */}
      <div className="p-5 bg-gradient-to-r from-amber-500/10 via-[#121214] to-[#121214] border border-amber-500/30 rounded-3xl text-left space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#27272A] pb-3">
          <div>
            <div className="flex items-center gap-2">
              <strong className="text-amber-300 font-serif text-sm block">{ONLINE_MENU_ADDON.name}</strong>
              {currentPlanId === 'premium' ? (
                <span className="px-2.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[8px] font-bold uppercase rounded-full">
                  ✓ Incluso no seu plano Premium
                </span>
              ) : (
                <span className="px-2.5 py-0.5 bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[8px] font-bold uppercase rounded-full">
                  ⚡ Adicional Pago (+ R$ {ONLINE_MENU_ADDON.price}/mês)
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1">{ONLINE_MENU_ADDON.description}</p>
          </div>

          <div className="shrink-0 font-mono font-bold text-amber-300 text-sm">
            + R$ {ONLINE_MENU_ADDON.price}<span className="text-[10px] text-gray-400">/mês</span>
          </div>
        </div>

        <p className="text-[10px] text-gray-400 leading-relaxed">
          Permite que seus clientes escaneiem o QR Code na mesa ou acessem o link do seu restaurante para fazer pedidos autônomos. Os pedidos caem direto no Kanban com gaveta de aceite.
        </p>
      </div>

      {/* 7. TABELA COMPARATIVA FEATURE X PLANO (REQUIREMENTS 2 & 8) */}
      <div className="bg-[#121214]/60 border border-[#27272A] rounded-3xl p-5 space-y-4">
        <div className="border-b border-[#27272A] pb-3 flex items-center justify-between">
          <h4 className="font-serif font-bold text-sm text-white">Comparativo Detalhado de Recursos</h4>
          <span className="text-[9px] text-gray-400 font-mono">Tabela Completa</span>
        </div>

        <div className="overflow-x-auto min-w-full border border-[#27272A]/40 rounded-2xl">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="bg-[#1C1C1F] border-b border-[#27272A] text-gray-400 uppercase text-[9px] tracking-wider">
                <th className="p-3.5 font-sans">Funcionalidade</th>
                <th className="p-3.5 text-center font-mono">Kôma Pocket (R$ 79)</th>
                <th className="p-3.5 text-center font-mono bg-emerald-500/10 text-emerald-300">Kôma Pro (R$ 149)</th>
                <th className="p-3.5 text-center font-mono">Kôma Premium (R$ 249)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#27272A]/40 text-gray-200">
              {PLAN_COMPARISON_MATRIX.map((row, idx) => (
                <tr key={idx} className="hover:bg-[#1C1C1F]/40 transition-colors text-[10px]">
                  <td className="p-3.5 font-sans font-medium text-white">
                    <span className="text-[8px] text-gray-500 block uppercase font-mono">{row.category}</span>
                    {row.feature}
                  </td>

                  {/* Pocket */}
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

                  {/* Pro */}
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

                  {/* Premium */}
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
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
