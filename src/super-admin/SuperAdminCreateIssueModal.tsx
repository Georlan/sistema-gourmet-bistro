import React, { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Layers,
  Loader2,
  ShieldAlert,
  X,
} from "lucide-react";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";
import type { Tenant } from "./superAdminTypes";

interface SuperAdminCreateIssueModalProps {
  tenant: Tenant;
  onClose: () => void;
  onCreated: (issue: {
    id: string;
    identifier: string;
    title: string;
    url: string;
    status?: string;
  }) => void;
}

const issueTypes = [
  { value: "Bug", label: "Bug / Falha" },
  { value: "Feature", label: "Nova Funcionalidade" },
  { value: "Improvement", label: "Melhoria Operacional" },
  { value: "Tech Debt", label: "Débito Técnico" },
  { value: "Ops", label: "Operação / Suporte" },
];

const productAreas = [
  "Caixa",
  "Cardápio",
  "Pagamentos",
  "Delivery",
  "Impressão",
  "Fiscal",
  "Fidelidade",
  "SuperAdmin",
  "Infra",
];

const priorityOptions = [
  { value: 1, label: "Urgente (P1)" },
  { value: 2, label: "Alta (P2)" },
  { value: 3, label: "Média (P3)" },
  { value: 4, label: "Baixa (P4)" },
  { value: 0, label: "Sem prioridade" },
];

export function SuperAdminCreateIssueModal({
  tenant,
  onClose,
  onCreated,
}: SuperAdminCreateIssueModalProps) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("Bug");
  const [area, setArea] = useState("Caixa");
  const [priority, setPriority] = useState(2);
  const [description, setDescription] = useState("");
  const [posthogUrl, setPosthogUrl] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdIssue, setCreatedIssue] = useState<{
    id: string;
    identifier: string;
    title: string;
    url: string;
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setErrorMessage("Título e descrição são obrigatórios.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await superAdminFetch(
        `/api/super-admin/restaurantes/${tenant.id}/issues`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim(),
            type,
            area,
            priority,
            posthog_evidence_url: posthogUrl.trim() || null,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Falha ao despachar issue para o Linear (HTTP ${response.status})`);
      }

      const data = await response.json();
      if (data.success && data.issue) {
        setCreatedIssue(data.issue);
        onCreated(data.issue);
      } else {
        throw new Error("Resposta do servidor não confirmou a criação da issue.");
      }
    } catch (err) {
      setErrorMessage(superAdminErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-xl rounded-2xl border border-zinc-800 bg-[#0f172a] p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1 text-koma-muted hover:bg-zinc-800 hover:text-koma-foreground"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#00b894]/40 bg-[#00b894]/10 text-[#00b894]">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-koma-foreground">Criar Issue no Linear</h2>
            <p className="text-xs text-koma-muted">
              Vincular demanda operacional ao Control Plane de Engenharia
            </p>
          </div>
        </div>

        {createdIssue ? (
          <div className="mt-6 space-y-4 rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-5 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
            <h3 className="text-base font-bold text-emerald-300">Issue criada com sucesso!</h3>
            <p className="text-xs text-koma-secondary">
              A tarefa <strong className="text-emerald-300 font-mono">{createdIssue.identifier}</strong> foi registrada no Linear e associada a este restaurante.
            </p>
            <div className="pt-2">
              <a
                href={createdIssue.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-[#00b894] px-4 py-2 text-xs font-black text-black hover:bg-[#00a383]"
              >
                <ExternalLink className="h-4 w-4" />
                Abrir {createdIssue.identifier} no Linear
              </a>
            </div>
            <div className="pt-3">
              <button
                type="button"
                onClick={onClose}
                className="text-xs font-bold text-koma-muted hover:text-koma-foreground"
              >
                Fechar janela
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4 text-xs">
            {/* Aviso de Tenant e Sanitização */}
            <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-3 text-[11px] text-amber-300/90 flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 flex-shrink-0 text-amber-400 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-200">
                  Tenant: #{tenant.id} — {tenant.name}
                </p>
                <p className="mt-0.5 text-amber-300/80">
                  Sanitização ativa: dados pessoais de clientes (nomes, CPFs, telefones, cartões) são proibidos e serão redigidos automaticamente pelo servidor.
                </p>
              </div>
            </div>

            {errorMessage && (
              <div className="rounded-lg border border-rose-800/50 bg-rose-950/30 p-3 text-[11px] text-rose-300 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div>
              <label className="block font-bold text-koma-foreground">Título da issue *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Falha ao sincronizar mesas com smartpos"
                required
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-koma-page px-3 py-2 text-xs text-koma-foreground placeholder-zinc-500 focus:border-[#00b894] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block font-bold text-koma-foreground">Tipo</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-koma-page px-2 py-2 text-xs text-koma-foreground focus:border-[#00b894] focus:outline-none"
                >
                  {issueTypes.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-koma-foreground">Área</label>
                <select
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-koma-page px-2 py-2 text-xs text-koma-foreground focus:border-[#00b894] focus:outline-none"
                >
                  {productAreas.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-koma-foreground">Prioridade</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-koma-page px-2 py-2 text-xs text-koma-foreground focus:border-[#00b894] focus:outline-none"
                >
                  {priorityOptions.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block font-bold text-koma-foreground">Descrição do problema / cenário *</label>
              <textarea
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descreva o comportamento observado, passos para reprodução e contexto operacional..."
                required
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-koma-page px-3 py-2 text-xs text-koma-foreground placeholder-zinc-500 focus:border-[#00b894] focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-koma-foreground">
                Link de evidência / PostHog <span className="text-koma-muted font-normal">(opcional)</span>
              </label>
              <input
                type="url"
                value={posthogUrl}
                onChange={(e) => setPosthogUrl(e.target.value)}
                placeholder="https://us.posthog.com/project/648305/events/..."
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-koma-page px-3 py-2 text-xs text-koma-foreground placeholder-zinc-500 focus:border-[#00b894] focus:outline-none"
              />
            </div>

            <div className="mt-5 flex justify-end gap-3 pt-3 border-t border-zinc-800">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="rounded-lg border border-zinc-700 px-4 py-2 font-bold text-koma-secondary hover:bg-zinc-800 hover:text-koma-foreground"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 rounded-lg bg-[#00b894] px-4 py-2 font-black text-black hover:bg-[#00a383] disabled:opacity-50"
              >
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Criar issue no Linear
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default SuperAdminCreateIssueModal;
