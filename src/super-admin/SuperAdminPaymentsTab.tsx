import React, { useState } from "react";
import {
  CreditCard,
  Zap,
  ShieldCheck,
  Check,
  Layers,
  HelpCircle,
} from "lucide-react";
import type { FailedWebhook } from "./superAdminTypes";
import {
  SUBSCRIPTION_PLANS,
  formatPercentage,
} from "../config/subscriptionPlans";

interface SuperAdminPaymentsTabProps {
  failedWebhooks: FailedWebhook[];
  webhooksAvailable: boolean;
}

export function SuperAdminPaymentsTab({
  failedWebhooks,
  webhooksAvailable,
}: SuperAdminPaymentsTabProps) {
  const [filter, setFilter] = useState<"ALL" | "FAILED" | "RESOLVED">("ALL");

  const filteredWebhooks = failedWebhooks.filter(w => {
    if (filter === "FAILED") return !w.resolved;
    if (filter === "RESOLVED") return w.resolved;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-koma-foreground flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-[#00b894]" />
              Pagamentos Online
            </h2>
            <p className="text-xs text-koma-muted mt-0.5">
              Configuração comercial e preparação para diagnóstico cross-tenant do Mercado Pago
            </p>
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-koma-muted text-xs font-semibold">
            <HelpCircle className="w-4 h-4" />
            Saúde operacional não consolidada
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-zinc-800/60 text-xs">
          <div className="bg-koma-page p-4 rounded-xl border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-koma-muted font-medium">Provedor</span>
              <span className="font-mono text-[10px] text-koma-muted bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                CONFIGURAÇÃO
              </span>
            </div>
            <p className="font-bold text-koma-foreground text-sm">Mercado Pago</p>
            <p className="text-koma-muted text-[11px]">
              OAuth por restaurante e split processado pelo backend
            </p>
          </div>

          <div className="bg-koma-page p-4 rounded-xl border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-koma-muted font-medium">Regra comercial de split</span>
              <span className="font-mono text-[10px] text-purple-300 bg-purple-950/50 px-2 py-0.5 rounded border border-purple-800/30">
                CATÁLOGO
              </span>
            </div>
            <p className="font-bold text-koma-foreground text-sm">Por plano contratado</p>
            <p className="text-koma-muted text-[11px]">
              {SUBSCRIPTION_PLANS.map(p => `${p.name} ${formatPercentage(p.splitFeeRate)}`).join(" • ")}
            </p>
          </div>

          <div className="bg-koma-page p-4 rounded-xl border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-koma-muted font-medium">Webhook</span>
              <span className="font-mono text-[10px] text-koma-muted bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                IMPLEMENTAÇÃO
              </span>
            </div>
            <p className="font-bold text-koma-foreground text-sm">Validação HMAC SHA-256</p>
            <p className="text-koma-muted text-[11px]">
              O estado de saúde e o histórico agregado serão lidos de fonte real na Fase 3
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800/60">
            <div>
              <h3 className="text-base font-bold text-koma-foreground flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                Eventos & Webhooks
              </h3>
              <p className="text-xs text-koma-muted mt-0.5">
                Somente eventos provenientes de uma fonte agregada e auditável serão exibidos aqui
              </p>
            </div>

            <select
              value={filter}
              onChange={e => setFilter(e.target.value as "ALL" | "FAILED" | "RESOLVED")}
              disabled={!webhooksAvailable}
              className="bg-koma-page border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-koma-foreground focus:outline-none focus:border-[#00b894] disabled:opacity-50"
            >
              <option value="ALL">Todos os Eventos</option>
              <option value="FAILED">Pendentes / Falhas</option>
              <option value="RESOLVED">Resolvidos / Confirmados</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-koma-muted font-medium">
                  <th className="py-2.5 px-3">Evento / Gateway</th>
                  <th className="py-2.5 px-3">Restaurante</th>
                  <th className="py-2.5 px-3">Pedido</th>
                  <th className="py-2.5 px-3">Valor</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {!webhooksAvailable ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-koma-muted">
                      <ShieldCheck className="w-7 h-7 text-zinc-500 mx-auto mb-1" />
                      Histórico agregado de webhooks ainda não disponível.
                    </td>
                  </tr>
                ) : filteredWebhooks.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-koma-muted">
                      Nenhum evento retornado pelo filtro selecionado.
                    </td>
                  </tr>
                ) : (
                  filteredWebhooks.map(wh => (
                    <tr key={wh.id} className="hover:bg-koma-page/40 transition-colors">
                      <td className="py-3 px-3">
                        <span className="font-semibold text-koma-foreground">{wh.event}</span>
                        <div className="text-[10px] text-koma-muted font-mono">{wh.createdAt}</div>
                      </td>
                      <td className="py-3 px-3 text-koma-secondary">{wh.tenantName}</td>
                      <td className="py-3 px-3 font-mono text-koma-secondary">#{wh.orderId}</td>
                      <td className="py-3 px-3 font-semibold text-koma-foreground">
                        R$ {wh.amount.toFixed(2)}
                      </td>
                      <td className="py-3 px-3">
                        {wh.resolved ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/30 font-medium">
                            <Check className="w-3 h-3" /> Processado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-rose-300 bg-rose-950/40 px-2 py-0.5 rounded border border-rose-800/40 font-medium">
                            Falha / pendência
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-koma-foreground flex items-center gap-2 pb-2 border-b border-zinc-800/60">
            <Layers className="w-4 h-4 text-[#00b894]" />
            Contas de Pagamento
          </h3>

          <div className="p-4 bg-koma-page rounded-lg border border-zinc-800 space-y-2 text-koma-muted">
            <p className="font-semibold text-koma-foreground text-xs">
              Status por restaurante
            </p>
            <p className="text-[11px] leading-relaxed">
              A listagem geral já recebe o estado real de conexão Mercado Pago por tenant. O extrato detalhado de contas, intents e webhooks entra na Fase 3.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SuperAdminPaymentsTab;
