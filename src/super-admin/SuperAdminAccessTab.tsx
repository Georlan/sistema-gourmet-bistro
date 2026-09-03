import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Clock3,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Store,
  UserCheck,
  UsersRound,
  UserX,
  X,
} from "lucide-react";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";

type Severity = "critical" | "warning" | "info";

type AccessDiagnostic = {
  severity: Severity;
  code: string;
  message: string;
  action: string;
};

type AccessTenant = {
  restaurantId: string;
  restaurantName: string;
  slug?: string | null;
  plan?: string | null;
  saasStatus: string;
  onlinePaymentStatus: "connected" | "disconnected";
  totalUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  pendingUsers: number;
  activeAdmins: number;
  diagnostics: AccessDiagnostic[];
};

type AccessUser = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  role: string;
  status: "ativo" | "inativo" | "pendente_ativacao";
  createdAt?: string | null;
};

type AccessTenantDetail = AccessTenant & { users: AccessUser[] };

type EditorState = {
  user: AccessUser;
  status: AccessUser["status"];
  role: string;
  reason: string;
  force: boolean;
};

const roleLabels: Record<string, string> = {
  admin: "Administrador",
  gerente: "Gerente",
  caixa: "Caixa",
  garcom: "Garçom",
  motoboy: "Motoboy",
  superadmin: "Superadmin legado",
};

const roleOptions = ["admin", "gerente", "caixa", "garcom", "motoboy"] as const;

function severityWeight(severity: Severity): number {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function diagnosticClass(severity: Severity): string {
  if (severity === "critical") return "border-rose-900/70 bg-rose-950/40 text-rose-200";
  if (severity === "warning") return "border-amber-900/70 bg-amber-950/30 text-amber-200";
  return "border-zinc-800 bg-zinc-900/70 text-koma-secondary";
}

function statusLabel(status: AccessUser["status"]): string {
  if (status === "ativo") return "Ativo";
  if (status === "inativo") return "Bloqueado";
  return "Pendente";
}

export function SuperAdminAccessTab({ globalSearch }: { globalSearch: string }) {
  const [tenants, setTenants] = useState<AccessTenant[]>([]);
  const [selected, setSelected] = useState<AccessTenantDetail | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadTenants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await superAdminFetch("/api/super-admin/access");
      const body = await response.json();
      setTenants(Array.isArray(body) ? body : []);
    } catch (err) {
      setTenants([]);
      setError(superAdminErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (tenantId: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const response = await superAdminFetch(
        `/api/super-admin/access/restaurantes/${encodeURIComponent(tenantId)}`,
      );
      const body = await response.json() as AccessTenantDetail;
      setSelected(body);
    } catch (err) {
      setError(superAdminErrorMessage(err));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  const filteredTenants = useMemo(() => {
    const needle = globalSearch.trim().toLowerCase();
    const items = needle
      ? tenants.filter((tenant) => [
          tenant.restaurantId,
          tenant.restaurantName,
          tenant.slug || "",
        ].some((value) => value.toLowerCase().includes(needle)))
      : tenants;

    return [...items].sort((a, b) => {
      const aWeight = Math.max(0, ...a.diagnostics.map((item) => severityWeight(item.severity)));
      const bWeight = Math.max(0, ...b.diagnostics.map((item) => severityWeight(item.severity)));
      return bWeight - aWeight || a.restaurantName.localeCompare(b.restaurantName);
    });
  }, [globalSearch, tenants]);

  const totals = useMemo(() => ({
    restaurants: tenants.length,
    critical: tenants.filter((tenant) => tenant.diagnostics.some((item) => item.severity === "critical")).length,
    activeUsers: tenants.reduce((sum, tenant) => sum + tenant.activeUsers, 0),
    blockedOrPending: tenants.reduce((sum, tenant) => sum + tenant.inactiveUsers + tenant.pendingUsers, 0),
  }), [tenants]);

  const openEditor = (user: AccessUser) => {
    setEditor({
      user,
      status: user.status,
      role: user.role,
      reason: "",
      force: false,
    });
    setNotice(null);
  };

  const saveAccess = async () => {
    if (!selected || !editor) return;
    const reason = editor.reason.trim();
    if (reason.length < 3) {
      setError("Informe um motivo administrativo com pelo menos 3 caracteres.");
      return;
    }

    const payload: Record<string, unknown> = {
      reason,
      force: editor.force,
    };
    if (editor.status !== editor.user.status) {
      if (editor.status === "pendente_ativacao") {
        setError("O Super Admin não recria um convite pendente por este controle.");
        return;
      }
      payload.status = editor.status;
    }
    if (editor.role !== editor.user.role) {
      if (editor.role === "superadmin") {
        setError("O cargo superadmin não pode ser atribuído a usuários de tenant.");
        return;
      }
      payload.role = editor.role;
    }
    if (!("status" in payload) && !("role" in payload)) {
      setError("Altere o status ou o cargo antes de confirmar.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await superAdminFetch(
        `/api/super-admin/access/restaurantes/${encodeURIComponent(selected.restaurantId)}/usuarios/${encodeURIComponent(editor.user.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = await response.json() as { forced?: boolean; message?: string };
      setNotice(body.forced
        ? "Override administrativo aplicado e registrado na auditoria."
        : (body.message || "Acesso atualizado."));
      setEditor(null);
      await Promise.all([loadTenants(), loadDetail(selected.restaurantId)]);
    } catch (err) {
      setError(superAdminErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const revokeSessions = async () => {
    if (!selected || !editor) return;
    const reason = editor.reason.trim();
    if (reason.length < 3) {
      setError("Informe um motivo administrativo com pelo menos 3 caracteres.");
      return;
    }
    if (editor.user.status === "pendente_ativacao") {
      setError("Usuário pendente ainda não possui sessão operacional ativa para encerrar.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await superAdminFetch(
        `/api/super-admin/access/restaurantes/${encodeURIComponent(selected.restaurantId)}/usuarios/${encodeURIComponent(editor.user.id)}/revogar-sessoes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
      );
      const body = await response.json() as { message?: string };
      setNotice(body.message || "Sessões do usuário encerradas com sucesso.");
      setEditor(null);
      await Promise.all([loadTenants(), loadDetail(selected.restaurantId)]);
    } catch (err) {
      setError(superAdminErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5" data-testid="superadmin-access-center">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#00b894]" />
            <h2 className="text-lg font-bold text-koma-foreground">Acessos e equipe</h2>
          </div>
          <p className="mt-1 max-w-3xl text-xs text-koma-muted">
            Central cross-tenant para identificar restaurantes sem administrador, usuários bloqueados ou pendentes e controlar acessos sem abrir cada conta separadamente.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadTenants()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-koma-card px-3 py-2 text-xs font-bold text-koma-secondary hover:border-[#00b894]/60 hover:text-koma-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Atualizar diagnóstico
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Restaurantes monitorados", value: totals.restaurants, icon: Store },
          { label: "Com problema crítico", value: totals.critical, icon: ShieldAlert },
          { label: "Usuários ativos", value: totals.activeUsers, icon: UserCheck },
          { label: "Bloqueados ou pendentes", value: totals.blockedOrPending, icon: UserX },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-xl border border-zinc-800 bg-koma-card p-4">
              <div className="flex items-center justify-between text-xs text-koma-muted">
                <span>{card.label}</span><Icon className="h-4 w-4" />
              </div>
              <div className="mt-2 text-2xl font-black text-koma-foreground">{loading ? "—" : card.value}</div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-900/60 bg-rose-950/30 px-4 py-3 text-xs text-rose-200" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-4 py-3 text-xs text-emerald-200" role="status">
          {notice}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-koma-card">
        <div className="border-b border-zinc-800 px-4 py-3">
          <h3 className="text-sm font-bold text-koma-foreground">Diagnóstico por restaurante</h3>
          <p className="mt-1 text-[11px] text-koma-muted">Problemas mais graves aparecem primeiro. Nenhum estado é simulado.</p>
        </div>
        {loading ? (
          <div className="p-8 text-center text-xs text-koma-muted">Consolidando acessos reais...</div>
        ) : filteredTenants.length === 0 ? (
          <div className="p-8 text-center text-xs text-koma-muted">Nenhum restaurante encontrado.</div>
        ) : (
          <div className="divide-y divide-zinc-800/80">
            {filteredTenants.map((tenant) => (
              <div key={tenant.restaurantId} className="grid gap-4 p-4 lg:grid-cols-[1.3fr_1fr_1.8fr_auto] lg:items-center">
                <div>
                  <div className="font-bold text-sm text-koma-foreground">{tenant.restaurantName}</div>
                  <div className="mt-1 text-[11px] text-koma-muted">#{tenant.restaurantId} · {tenant.slug || "slug não disponível"} · {tenant.plan || "plano não disponível"}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                    <span className={`rounded-full border px-2 py-0.5 ${tenant.saasStatus === "ACTIVE" ? "border-emerald-900/60 text-emerald-300" : "border-amber-900/60 text-amber-300"}`}>{tenant.saasStatus}</span>
                    <span className={`rounded-full border px-2 py-0.5 ${tenant.onlinePaymentStatus === "connected" ? "border-emerald-900/60 text-emerald-300" : "border-zinc-700 text-koma-muted"}`}>MP {tenant.onlinePaymentStatus === "connected" ? "conectado" : "desconectado"}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div><span className="text-koma-muted">Ativos</span><div className="font-bold text-koma-foreground">{tenant.activeUsers}</div></div>
                  <div><span className="text-koma-muted">Admins</span><div className="font-bold text-koma-foreground">{tenant.activeAdmins}</div></div>
                  <div><span className="text-koma-muted">Bloqueados</span><div className="font-bold text-koma-foreground">{tenant.inactiveUsers}</div></div>
                  <div><span className="text-koma-muted">Pendentes</span><div className="font-bold text-koma-foreground">{tenant.pendingUsers}</div></div>
                </div>

                <div className="space-y-1.5">
                  {tenant.diagnostics.length === 0 ? (
                    <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 px-3 py-2 text-[11px] text-emerald-300">Nenhum problema de acesso identificado.</div>
                  ) : tenant.diagnostics.slice(0, 3).map((diagnostic) => (
                    <div key={diagnostic.code} className={`rounded-lg border px-3 py-2 text-[11px] ${diagnosticClass(diagnostic.severity)}`}>
                      <div className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><div><strong>{diagnostic.message}</strong><div className="mt-0.5 opacity-80">{diagnostic.action}</div></div></div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => void loadDetail(tenant.restaurantId)}
                  className="rounded-lg bg-[#00b894] px-3 py-2 text-xs font-black text-black hover:bg-[#00c9a3]"
                >
                  Gerenciar acessos
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="rounded-xl border border-zinc-800 bg-koma-card">
          <div className="flex items-start justify-between gap-4 border-b border-zinc-800 p-4">
            <div>
              <div className="flex items-center gap-2"><UsersRound className="h-4 w-4 text-[#00b894]" /><h3 className="text-sm font-bold text-koma-foreground">Equipe · {selected.restaurantName}</h3></div>
              <p className="mt-1 text-[11px] text-koma-muted">Bloquear acesso revoga as sessões já emitidas. Reativar o usuário não restaura tokens antigos; um novo login é necessário.</p>
            </div>
            <button type="button" onClick={() => setSelected(null)} className="rounded p-1 text-koma-muted hover:text-koma-foreground" aria-label="Fechar equipe"><X className="h-4 w-4" /></button>
          </div>
          {detailLoading ? (
            <div className="p-6 text-xs text-koma-muted">Carregando equipe...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="border-b border-zinc-800 text-[10px] uppercase tracking-wide text-koma-muted"><tr><th className="px-4 py-3">Usuário</th><th className="px-4 py-3">Cargo</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Criado</th><th className="px-4 py-3 text-right">Controle</th></tr></thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {selected.users.map((user) => (
                    <tr key={user.id}>
                      <td className="px-4 py-3"><div className="font-semibold text-koma-foreground">{user.name}</div><div className="mt-0.5 text-[10px] text-koma-muted">{user.email || user.phone || user.id}</div></td>
                      <td className="px-4 py-3 text-koma-secondary">{roleLabels[user.role] || user.role}</td>
                      <td className="px-4 py-3"><span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${user.status === "ativo" ? "border-emerald-900/60 text-emerald-300" : user.status === "inativo" ? "border-rose-900/60 text-rose-300" : "border-amber-900/60 text-amber-300"}`}>{statusLabel(user.status)}</span></td>
                      <td className="px-4 py-3 text-koma-muted">{user.createdAt ? new Date(user.createdAt).toLocaleDateString("pt-BR") : "Não disponível"}</td>
                      <td className="px-4 py-3 text-right"><button type="button" onClick={() => openEditor(user)} className="rounded-lg border border-zinc-700 px-3 py-1.5 font-bold text-koma-secondary hover:border-[#00b894]/60 hover:text-koma-foreground">Controlar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {editor && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Alterar acesso de usuário">
          <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-koma-card shadow-2xl">
            <div className="flex items-start justify-between border-b border-zinc-800 p-4">
              <div><h3 className="text-sm font-bold text-koma-foreground">Controle administrativo de acesso</h3><p className="mt-1 text-[11px] text-koma-muted">{editor.user.name} · {selected.restaurantName}</p></div>
              <button type="button" onClick={() => setEditor(null)} className="text-koma-muted hover:text-koma-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs text-koma-muted">Status
                  <select value={editor.status} onChange={(event) => setEditor((current) => current ? { ...current, status: event.target.value as AccessUser["status"] } : current)} className="w-full rounded-lg border border-zinc-800 bg-koma-page px-3 py-2 text-koma-foreground">
                    {editor.user.status === "pendente_ativacao" && <option value="pendente_ativacao">Pendente (preservar)</option>}
                    {editor.user.status !== "pendente_ativacao" && <option value="ativo">Ativo</option>}
                    <option value="inativo">Bloqueado</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs text-koma-muted">Cargo
                  <select value={editor.role} onChange={(event) => setEditor((current) => current ? { ...current, role: event.target.value } : current)} className="w-full rounded-lg border border-zinc-800 bg-koma-page px-3 py-2 text-koma-foreground">
                    {editor.user.role === "superadmin" && <option value="superadmin" disabled>Superadmin legado</option>}
                    {roleOptions.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
                  </select>
                </label>
              </div>

              <label className="block space-y-1 text-xs text-koma-muted">Motivo obrigatório
                <textarea value={editor.reason} onChange={(event) => setEditor((current) => current ? { ...current, reason: event.target.value } : current)} rows={3} placeholder="Ex.: bloqueio solicitado pelo responsável do restaurante" className="w-full resize-none rounded-lg border border-zinc-800 bg-koma-page px-3 py-2 text-koma-foreground placeholder:text-koma-subtle" />
              </label>

              <label className="flex items-start gap-3 rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-100">
                <input type="checkbox" checked={editor.force} onChange={(event) => setEditor((current) => current ? { ...current, force: event.target.checked } : current)} className="mt-0.5" />
                <span><strong>Forçar override administrativo</strong><span className="mt-1 block text-[11px] text-amber-200/80">Use quando a decisão for intencional mesmo que deixe o tenant sem administrador ativo. O override fica explícito na auditoria.</span></span>
              </label>

              <div className="space-y-2 rounded-lg border border-zinc-800 bg-koma-page/60 p-3 text-[11px] text-koma-muted">
                <div className="flex gap-2"><Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>Este controle não lê, redefine ou revela senha, token de convite, token Mercado Pago ou credencial de sessão.</span></div>
                <div>Encerrar sessões invalida os tokens operacionais já emitidos sem alterar senha, cargo, status ou dados do usuário.</div>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-800 p-4">
              <button type="button" onClick={() => setEditor(null)} disabled={saving} className="rounded-lg border border-zinc-700 px-4 py-2 text-xs font-bold text-koma-secondary">Cancelar</button>
              <button type="button" onClick={() => void revokeSessions()} disabled={saving || editor.user.status === "pendente_ativacao"} className="rounded-lg border border-rose-800 px-4 py-2 text-xs font-black text-rose-200 hover:bg-rose-950/30 disabled:opacity-50">{saving ? "Aplicando..." : "Encerrar sessões"}</button>
              <button type="button" onClick={() => void saveAccess()} disabled={saving} className="rounded-lg bg-[#00b894] px-4 py-2 text-xs font-black text-black disabled:opacity-50">{saving ? "Aplicando..." : "Aplicar controle"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}