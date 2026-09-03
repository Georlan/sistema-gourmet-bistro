import React, { useState } from "react";
import {
  CreditCard,
  CheckCircle2,
  Zap,
  ShieldCheck,
  Check,
  Layers,
} from "lucide-react";
import type { FailedWebhook } from "./superAdminTypes";
import {
  SUBSCRIPTION_PLANS,
  formatPercentage,
} from "../config/subscriptionPlans";

interface SuperAdminPaymentsTabProps {
  failedWebhooks: FailedWebhook[];
  webhooksAvailable: boolean;
  onForceConfirmWebhook: (id: string) => Promise<boolean>;
  onAddLog: (
    text: string,
    level?: "INFO" | "WARNING" | "ERROR" | "CRITICAL" | "info" | "warning" | "error" | "critical" | "success",
    source?: string
  ) => void;
  onTriggerTelegramAlert: (text: string) => void;
}

export function SuperAdminPaymentsTab({
  failedWebhooks,
  webhooksAvailable,
  onForceConfirmWebhook,
  onAddLog,
  onTriggerTelegramAlert,
}: SuperAdminPaymentsTabProps) {
  const [filter, setFilter] = useState<"ALL" | "FAILED" | "RESOLVED">("ALL");
  const [isConfirming, setIsConfirming] = useState<string | null>(null);

  const filteredWebhooks = failedWebhooks.filter(w => {
    if (filter === "FAILED") return !w.resolved;
    if (filter === "RESOLVED") return w.resolved;
    return true;
  });

  const handleConfirm = async (id: string) => {
    setIsConfirming(id);
    try {
      const ok = await onForceConfirmWebhook(id);
      if (ok) {
        onAddLog(`Webhook #${id} confirmado manualmente via console de pagamentos.`, "INFO", "PAYMENTS");
        onTriggerTelegramAlert(`Webhook #${id} foi conciliado manualmente pelo SuperAdmin.`);
      }
    } finally {
      setIsConfirming(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Overview */}
      <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-koma-foreground flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-[#00b894]" />
              Pagamentos Online & Split Automático
            </h2>
            <p className="text-xs text-koma-muted mt-0.5">
              Monitoramento central da aplicação Mercado Pago (KomaADMIN), conciliação e webhooks
            </p>
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-800/40 text-emerald-300 text-xs font-semibold">
            <CheckCircle2 className="w-4 h-4 text-[#00b894]" />
            Mercado Pago Integrado
          </div>
        </div>

        {/* Integration Architecture Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-zinc-800/60 text-xs">
          <div className="bg-koma-page p-4 rounded-xl border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-koma-muted font-medium">Aplicação Central</span>
              <span className="font-mono text-[10px] text-[#00b894] bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/30">
                PRODUÇÃO
              </span>
            </div>
            <p className="font-bold text-koma-foreground text-sm">KomaADMIN (2722128383126106)</p>
            <p className="text-koma-muted text-[11px]">
              OAuth 2.0 com split nativo de comissões por transação Pix
            </p>
          </div>

          <div className="bg-koma-page p-4 rounded-xl border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-koma-muted font-medium">Split de Taxas KÔMA</span>
              <span className="font-mono text-[10px] text-purple-300 bg-purple-950/80 px-2 py-0.5 rounded border border-purple-800/30">
                HABILITADO
              </span>
            </div>
            <p className="font-bold text-koma-foreground text-sm">Regra Dinâmica por Plano</p>
            <p className="text-koma-muted text-[11px]">
              {SUBSCRIPTION_PLANS.map(p => `${p.name} ${formatPercentage(p.splitFeeRate)}`).join(" • ")}
            </p>
          </div>

          <div className="bg-koma-page p-4 rounded-xl border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-koma-muted font-medium">Segurança do Webhook</span>
              <span className="font-mono text-[10px] text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/30">
                HMAC SHA-256
              </span>
            </div>
            <p className="font-bold text-koma-foreground text-sm">Assinatura Secreta Ativa</p>
            <p className="text-koma-muted text-[11px]">
              Validação estrita de manifest (`id`, `ts`, `request-id`)
            </p>
          </div>
        </div>
      </div>

      {/* Accounts & Webhook Monitoring Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Webhooks Conciliation Table (2 cols) */}
        <div className="lg:col-span-2 bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800/60">
            <div>
              <h3 className="text-base font-bold text-koma-foreground flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                Eventos & Webhooks Recebidos
              </h3>
              <p className="text-xs text-koma-muted mt-0.5">
                Histórico de notificações dos gateways de pagamento
              </p>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={filter}
                onChange={e => setFilter(e.target.value as "ALL" | "FAILED" | "RESOLVED")}
                className="bg-koma-page border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-koma-foreground focus:outline-none focus:border-[#00b894]"
              >
                <option value="ALL">Todos os Eventos</option>
                <option value="FAILED">Pendentes / Falhas</option>
                <option value="RESOLVED">Resolvidos / Confirmados</option>
              </select>
            </div>
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
                  <th className="py-2.5 px-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {!webhooksAvailable ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-koma-muted">
                      <ShieldCheck className="w-7 h-7 text-[#00b894] mx-auto opacity-70 mb-1" />
                      Nenhuma pendência crítica de webhook registrada.
                    </td>
                  </tr>
                ) : filteredWebhooks.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-koma-muted">
                      Nenhum evento registrado com o filtro selecionado.
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
                            <Check className="w-3 h-3" /> Confirmado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-rose-300 bg-rose-950/40 px-2 py-0.5 rounded border border-rose-800/40 font-medium">
                            Pendente
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-3 text-right">
                        {!wh.resolved && (
                          <button
                            type="button"
                            onClick={() => handleConfirm(wh.id)}
                            disabled={isConfirming === wh.id}
                            className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            {isConfirming === wh.id ? "Confirmando..." : "Confirmar"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Tenant Payment Accounts Status (1 col) */}
        <div className="bg-koma-card border border-[#1e293b] rounded-xl p-5 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-koma-foreground flex items-center gap-2 pb-2 border-b border-zinc-800/60">
            <Layers className="w-4 h-4 text-[#00b894]" />
            Contas de Pagamento Vinculadas
          </h3>

          <div className="space-y-3 text-xs">
            <div className="p-4 bg-koma-page rounded-lg border border-zinc-800 space-y-2 text-koma-muted">
              <p className="font-semibold text-koma-foreground text-xs">
                Auditoria de Contas de Pagamento
              </p>
              <p className="text-[11px] leading-relaxed">
                A visualização de contas de pagamento vinculadas de todos os estabelecimentos será alimentada via endpoint cross-tenant dedicado (Fase 2).
              </p>
              <p className="text-[11px] leading-relaxed text-koma-subtle">
                Cada restaurante gerencia sua própria conexão OAuth com Mercado Pago de forma isolada em seu respectivo painel de administração.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SuperAdminPaymentsTab;
