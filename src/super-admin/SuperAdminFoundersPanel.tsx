import React, { useEffect, useState } from "react";
import { Award, ShieldCheck, AlertTriangle } from "lucide-react";
import type { Tenant } from "./superAdminTypes";
import { formatCurrency } from "../config/subscriptionPlans";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";

export interface FounderGrant {
  id: string;
  restaurantId: number;
  restaurantName: string;
  cohortCode: string;
  fixedMonthlyPrice: number;
  freeAddonLicenses: boolean;
  active: boolean;
  grantedBy: string;
  reason: string;
  grantedAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revocationReason: string | null;
}

export interface FoundersStatusResponse {
  cohortCode: string;
  maxBeneficiaries: number;
  activeCount: number;
  totalHistoricalBeneficiaries: number;
  remainingSlots: number;
  monthlyPrice: number;
  grants: FounderGrant[];
}

export function SuperAdminFoundersPanel({ tenants = [] }: { tenants?: Tenant[] }) {
  const [status, setStatus] = useState<FoundersStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<FounderGrant | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    superAdminFetch("/api/super-admin/founders", { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.detail || "Não foi possível carregar o programa Founders.");
        if (!controller.signal.aborted) {
          setStatus(body);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(superAdminErrorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh]);

  const activeIds = new Set((status?.grants || []).filter((g) => g.active).map((g) => String(g.restaurantId)));
  const eligibleTenants = tenants.filter((t) => !activeIds.has(String(t.id)));

  async function handleGrant(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedTenantId || reason.trim().length < 3 || busy) return;
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const res = await superAdminFetch(`/api/super-admin/founders/${encodeURIComponent(selectedTenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || "Falha ao conceder benefício Founders.");
      setSelectedTenantId("");
      setReason("");
      setFeedback("Benefício Founders concedido com trilha de auditoria.");
      setRefresh((v) => v + 1);
    } catch (err) {
      setError(superAdminErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(event: React.FormEvent) {
    event.preventDefault();
    if (!revokeTarget || revokeReason.trim().length < 10 || busy) return;
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const res = await superAdminFetch(
        `/api/super-admin/founders/${encodeURIComponent(String(revokeTarget.restaurantId))}/revoke`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: revokeReason.trim(),
            confirm_exceptional_revocation: true,
          }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || "Falha ao revogar benefício Founders.");
      setRevokeTarget(null);
      setRevokeReason("");
      setFeedback("Benefício Founders revogado excepcionalmente. A vaga histórica permanece consumida.");
      setRefresh((v) => v + 1);
    } catch (err) {
      setError(superAdminErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-koma-border bg-koma-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Award className="h-5 w-5 text-koma-accent" />
          <div>
            <h2 className="text-lg font-bold">Programa Founders (5 primeiros clientes)</h2>
            <p className="text-xs text-koma-muted">
              Mensalidade protegida de {formatCurrency(status?.monthlyPrice ?? 79.9)} e módulos homologados gratuitos. Vagas históricas não são reutilizáveis.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => setRefresh((v) => v + 1)}
          className="min-h-11 rounded border border-koma-border px-3 text-xs"
        >
          Atualizar Founders
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-rose-400">
          {error}
        </p>
      )}
      {feedback && (
        <p role="status" className="text-sm text-emerald-400">
          {feedback}
        </p>
      )}
      {loading && !status && <p role="status" className="text-sm text-koma-muted">Carregando programa Founders…</p>}

      {status && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-koma-border bg-koma-page p-4">
              <p className="text-xs text-koma-muted">Beneficiários ativos</p>
              <strong className="mt-1 block text-xl">
                {status.activeCount} / {status.maxBeneficiaries}
              </strong>
            </div>
            <div className="rounded-lg border border-koma-border bg-koma-page p-4">
              <p className="text-xs text-koma-muted">Vagas restantes</p>
              <strong className="mt-1 block text-xl">{status.remainingSlots}</strong>
            </div>
            <div className="rounded-lg border border-koma-border bg-koma-page p-4">
              <p className="text-xs text-koma-muted">Histórico total utilizado</p>
              <strong className="mt-1 block text-xl">
                {status.totalHistoricalBeneficiaries} / {status.maxBeneficiaries}
              </strong>
            </div>
          </div>

          {status.remainingSlots > 0 && (
            <form onSubmit={handleGrant} className="grid gap-3 rounded-lg border border-koma-border bg-koma-page p-4 sm:grid-cols-3">
              <label className="text-sm">
                Restaurante elegível
                <select
                  aria-label="Restaurante elegível Founders"
                  value={selectedTenantId}
                  disabled={busy}
                  onChange={(e) => setSelectedTenantId(e.target.value)}
                  className="mt-1 block min-h-11 w-full rounded border border-koma-border bg-koma-card px-2"
                >
                  <option value="">Selecione um restaurante…</option>
                  {eligibleTenants.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      #{t.id} — {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Motivo da concessão
                <input
                  aria-label="Motivo da concessão Founders"
                  minLength={3}
                  maxLength={500}
                  required
                  value={reason}
                  disabled={busy}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ex.: Cliente fundador aprovado comercialmente"
                  className="mt-1 block min-h-11 w-full rounded border border-koma-border bg-koma-card px-3"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={busy || !selectedTenantId || reason.trim().length < 3}
                  className="min-h-11 w-full rounded bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-50"
                >
                  {busy ? "Processando…" : "Conceder benefício Founders"}
                </button>
              </div>
            </form>
          )}

          {status.grants.length > 0 ? (
            <div className="overflow-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-koma-border text-xs text-koma-muted">
                    <th className="py-2">Restaurante</th>
                    <th>Mensalidade</th>
                    <th>Módulos</th>
                    <th>Status</th>
                    <th>Motivo / Auditoria</th>
                    <th className="text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {status.grants.map((grant) => (
                    <tr key={grant.id} className="border-b border-koma-border/60">
                      <td className="py-2 font-medium">
                        #{grant.restaurantId} — {grant.restaurantName}
                      </td>
                      <td>{formatCurrency(grant.fixedMonthlyPrice)}</td>
                      <td>{grant.freeAddonLicenses ? "Inclusos" : "Padrão"}</td>
                      <td>
                        {grant.active ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <ShieldCheck className="h-4 w-4" /> Ativo
                          </span>
                        ) : (
                          <span className="text-koma-muted">Revogado</span>
                        )}
                      </td>
                      <td className="text-xs text-koma-muted">
                        <div>{grant.reason}</div>
                        <div>Por {grant.grantedBy}</div>
                      </td>
                      <td className="text-right">
                        {grant.active && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setRevokeTarget(grant);
                              setRevokeReason("");
                            }}
                            className="min-h-9 rounded border border-rose-500/40 px-2.5 text-xs text-rose-400"
                          >
                            Revogar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-koma-muted">Nenhum benefício Founders concedido até o momento.</p>
          )}

          {revokeTarget && (
            <form onSubmit={handleRevoke} className="space-y-3 rounded-lg border border-rose-500/40 bg-koma-page p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-rose-400">
                <AlertTriangle className="h-4 w-4" />
                <span>Revogação excepcional: #{revokeTarget.restaurantId} — {revokeTarget.restaurantName}</span>
              </div>
              <p className="text-xs text-koma-muted">
                A revogação não libera a vaga histórica (o limite de 5 beneficiários permanece consumido). Informe um motivo detalhado com no mínimo 10 caracteres.
              </p>
              <input
                aria-label="Motivo da revogação Founders"
                minLength={10}
                maxLength={500}
                required
                value={revokeReason}
                disabled={busy}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="Motivo formal da revogação excepcional…"
                className="block min-h-11 w-full rounded border border-koma-border bg-koma-card px-3 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy || revokeReason.trim().length < 10}
                  className="min-h-11 rounded bg-rose-700 px-4 text-sm font-bold text-white disabled:opacity-50"
                >
                  Confirmar revogação
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRevokeTarget(null)}
                  className="min-h-11 rounded border border-koma-border px-4 text-sm"
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
