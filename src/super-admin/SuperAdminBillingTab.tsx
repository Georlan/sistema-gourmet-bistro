import React from "react";
import {
  ReceiptText,
  TrendingUp,
  Percent,
  CheckCircle2,
  Layers,
  Store,
  ArrowUpRight,
  Shield,
  CreditCard,
} from "lucide-react";
import type { Tenant } from "./superAdminTypes";

interface SuperAdminBillingTabProps {
  tenants: Tenant[];
}

export function SuperAdminBillingTab({ tenants }: SuperAdminBillingTabProps) {
  const planDetails = [
    {
      name: "Pocket",
      price: 97,
      splitFee: "1,79%",
      description: "Ideal para pequenos estabelecimentos e cafeterias",
      features: [
        "1 Caixa / PDV",
        "Cardápio Digital com Pix",
        "Taxa de split Pix: 1,79%",
        "Gestão de mesas e comandas",
        "Suporte padrão",
      ],
      count: tenants.filter(t => t.plan === "Pocket").length,
    },
    {
      name: "Pro",
      price: 197,
      splitFee: "0,89%",
      description: "Para restaurantes com alto fluxo e múltiplos garçons",
      features: [
        "Caixas e Garçons ilimitados",
        "Cardápio Digital com Pix",
        "Taxa de split Pix: 0,89%",
        "Módulo de Delivery & Motoboys",
        "KDS Produção e Cozinha",
        "SmartPOS Stone & PagBank",
      ],
      count: tenants.filter(t => t.plan === "Pro" || t.plan === "Delivery" || t.plan === "Bistro").length,
      highlight: true,
    },
    {
      name: "Premium",
      price: 347,
      splitFee: "0,39%",
      description: "Operações consolidadas que exigem as menores taxas e prioridade",
      features: [
        "Todos os recursos do Plano Pro",
        "Menor taxa de split Pix: 0,39%",
        "Atendimento e SLA prioritário",
        "Multi-impressão térmica avançada",
        "Relatórios executivos e DRE",
        "Onboarding assistido",
      ],
      count: tenants.filter(t => t.plan === "Premium").length,
    },
  ];

  const totalMRR = tenants
    .filter(t => t.status === "ACTIVE")
    .reduce((acc, t) => {
      if (t.plan === "Pocket") return acc + 97;
      if (t.plan === "Premium") return acc + 347;
      return acc + 197;
    }, 0);

  const estimatedVariableRevenue = 142.50; // Estimated monthly split commissions

  return (
    <div className="space-y-6">
      {/* Financial Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-koma-muted">MRR Assinaturas Fixas</span>
            <div className="p-2 rounded-lg bg-emerald-950/60 text-[#00b894] border border-emerald-800/30">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-koma-foreground tracking-tight">
            R$ {totalMRR.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
          </div>
          <p className="text-[11px] text-koma-subtle">
            Recorrência base gerada pelos {tenants.filter(t => t.status === "ACTIVE").length} restaurantes ativos
          </p>
        </div>

        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-koma-muted">Receita Variável Split (Mês)</span>
            <div className="p-2 rounded-lg bg-purple-950/60 text-purple-300 border border-purple-800/30">
              <Percent className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-koma-foreground tracking-tight">
            R$ {estimatedVariableRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
          </div>
          <p className="text-[11px] text-koma-subtle">
            Comissões automáticas Mercado Pago sobre vendas online
          </p>
        </div>

        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-koma-muted">Faturamento Total Estimado</span>
            <div className="p-2 rounded-lg bg-blue-950/60 text-blue-300 border border-blue-800/30">
              <ReceiptText className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-emerald-400 tracking-tight">
            R$ {(totalMRR + estimatedVariableRevenue).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
          </div>
          <p className="text-[11px] text-koma-subtle">
            Receita total da plataforma KÔMA
          </p>
        </div>
      </div>

      {/* Commercial Plans Matrix */}
      <div className="bg-koma-card border border-[#1e293b] rounded-xl p-6 shadow-sm space-y-6">
        <div>
          <h3 className="text-base font-bold text-koma-foreground flex items-center gap-2">
            <ReceiptText className="w-5 h-5 text-[#00b894]" />
            Catálogo Comercial de Planos KÔMA
          </h3>
          <p className="text-xs text-koma-muted mt-0.5">
            Estrutura de precificação e split de pagamentos online vigentes
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {planDetails.map(plan => (
            <div
              key={plan.name}
              className={`rounded-xl p-5 flex flex-col justify-between space-y-4 border ${
                plan.highlight
                  ? "bg-koma-page border-[#00b894] shadow-[0_0_15px_rgba(0,184,148,0.1)]"
                  : "bg-koma-page/70 border-zinc-800"
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-koma-foreground">{plan.name}</span>
                  <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-zinc-800 text-koma-secondary">
                    {plan.count} cliente(s)
                  </span>
                </div>

                <div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-extrabold text-koma-foreground">
                      R$ {plan.price}
                    </span>
                    <span className="text-xs text-koma-muted">/mês</span>
                  </div>
                  <div className="text-xs text-[#00b894] font-semibold mt-0.5">
                    + {plan.splitFee} taxa split Pix
                  </div>
                </div>

                <p className="text-xs text-koma-muted">{plan.description}</p>

                <div className="pt-2 border-t border-zinc-800/60 space-y-2">
                  {plan.features.map(f => (
                    <div key={f} className="flex items-start gap-2 text-xs text-koma-secondary">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#00b894] shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default SuperAdminBillingTab;
