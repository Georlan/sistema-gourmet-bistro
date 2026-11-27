import React, { useEffect, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  FlaskConical,
  MessageCircle,
  Play,
  Power,
} from "lucide-react";
import { KOMA_OPERATIONAL_APP_URL } from "../domain/komaHost";
import { parseBackendTimestamp } from "../utils/dateTime";
import { superAdminErrorMessage, superAdminFetch } from "./superAdminApi";

export interface OperationalQaSnapshot {
  active: boolean;
  startedAt?: string | null;
  expiresAt?: string | null;
  hours?: number | null;
  hasToken?: boolean;
}

interface SuperAdminOnboardingQaCardProps {
  tenantId: string;
  tenantName: string;
  operationalQa?: OperationalQaSnapshot | null;
  operationReleased?: boolean;
  onUpdated: () => Promise<void> | void;
}

const HOUR_PRESETS = [4, 12, 24, 48, 72] as const;
const DEFAULT_QA_START_REASON = "Validar cardápio, pedidos, caixa e impressão antes do contrato.";
const DEFAULT_QA_END_REASON = "Homologação operacional concluída pelo administrador.";

function formatQaDate(value?: string | null): string {
  if (!value) return "—";
  const parsed = parseBackendTimestamp(value);
  return parsed ? parsed.toLocaleString("pt-BR") : "—";
}

function buildFullQaUrl(qaMenuPath: string): string {
  const base = KOMA_OPERATIONAL_APP_URL.replace(/\/$/, "");
  if (qaMenuPath.startsWith("http://") || qaMenuPath.startsWith("https://")) {
    return qaMenuPath;
  }
  const suffix = qaMenuPath.startsWith("/") ? qaMenuPath : `/${qaMenuPath}`;
  return `${base}${suffix}`;
}

export function SuperAdminOnboardingQaCard({
  tenantId,
  tenantName,
  operationalQa,
  operationReleased = false,
  onUpdated,
}: SuperAdminOnboardingQaCardProps) {
  const [startFormOpen, setStartFormOpen] = useState(false);
  const [endFormOpen, setEndFormOpen] = useState(false);
  const [hours, setHours] = useState<number>(12);
  const [reason, setReason] = useState<string>("");
  const [endReason, setEndReason] = useState<string>(DEFAULT_QA_END_REASON);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [qaLink, setQaLink] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<"link" | "whatsapp" | null>(null);

  useEffect(() => {
    setStartFormOpen(false);
    setEndFormOpen(false);
    setError(null);
    setNotice(null);
    setQaLink(null);
    setCopiedKey(null);
  }, [tenantId]);

  const copyText = async (text: string, key: "link" | "whatsapp") => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(current => (current === key ? null : current)), 2500);
    } catch {
      setError("Não foi possível copiar automaticamente; copie o link manualmente no campo abaixo.");
    }
  };

  const handleStartQa = async () => {
    const cleanReason = reason.trim();
    if (busy || cleanReason.length < 10 || !Number.isInteger(hours) || hours < 1 || hours > 72) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await superAdminFetch(
        `/api/super-admin/onboarding/restaurantes/${tenantId}/operational-qa`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start", hours, reason: cleanReason }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.qaActive !== true) {
        throw new Error(body?.detail || "Não foi possível liberar a homologação.");
      }

      const fullUrl = typeof body.qaMenuPath === "string" && body.qaMenuPath
        ? buildFullQaUrl(body.qaMenuPath)
        : null;
      setQaLink(fullUrl);
      setNotice(
        `Homologação liberada até ${formatQaDate(body.expiresAt)}. O trial comercial não foi iniciado.`,
      );
      setStartFormOpen(false);
      await onUpdated();
    } catch (err) {
      setError(superAdminErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleEndQa = async () => {
    const cleanReason = endReason.trim();
    if (busy || cleanReason.length < 3) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await superAdminFetch(
        `/api/super-admin/onboarding/restaurantes/${tenantId}/operational-qa`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "end", reason: cleanReason }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.qaActive !== false) {
        throw new Error(body?.detail || "Não foi possível encerrar a homologação.");
      }
      setQaLink(null);
      setEndFormOpen(false);
      setNotice("Homologação operacional encerrada. O cardápio voltou ao bloqueio provisório.");
      await onUpdated();
    } catch (err) {
      setError(superAdminErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const qaActive = Boolean(operationalQa?.active);

  return (
    <section
      className="rounded-xl border border-emerald-800/50 bg-koma-card p-4 sm:p-5 space-y-3"
      aria-label="Homologação operacional"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="flex items-center gap-2 text-sm font-bold text-koma-foreground">
              <FlaskConical className="h-4 w-4 text-[#00b894]" />
              Homologação operacional
            </h3>
            <span
              className={
                "rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide " +
                (qaActive || operationReleased
                  ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-300"
                  : "border-zinc-700 bg-koma-page text-koma-muted")
              }
            >
              {qaActive ? "Ativa" : operationReleased ? "Liberada" : "Inativa"}
            </span>
          </div>
          <p className="text-xs text-koma-muted">
            {operationReleased && !qaActive
              ? "Este restaurante administrativo já está com a janela de operação liberada."
              : "Liberação temporária (até 72h) para pedidos de teste em QA, sem iniciar o trial nem contaminar financeiro/estoque/fiscal."}
          </p>
        </div>

        {!qaActive && !operationReleased && !startFormOpen && (
          <button
            type="button"
            onClick={() => {
              setStartFormOpen(true);
              setError(null);
            }}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-emerald-700 bg-emerald-950/30 px-3.5 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-950/60"
          >
            <Play className="h-3.5 w-3.5" />
            Preparar liberação de teste
          </button>
        )}

        {qaActive && !endFormOpen && (
          <button
            type="button"
            onClick={() => {
              setEndFormOpen(true);
              setError(null);
            }}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-rose-800/60 bg-rose-950/25 px-3.5 py-2 text-xs font-bold text-rose-200 hover:bg-rose-950/50"
          >
            <Power className="h-3.5 w-3.5" />
            Encerrar homologação
          </button>
        )}
      </div>

      {qaActive && (
        <div className="rounded-lg border border-emerald-800/40 bg-koma-page p-3 text-xs space-y-1">
          <p className="text-koma-foreground font-semibold">
            Janela QA ativa até {formatQaDate(operationalQa?.expiresAt)}
          </p>
          <p className="text-koma-muted">
            Início: {formatQaDate(operationalQa?.startedAt)} · Duração: {operationalQa?.hours ?? "—"}h ·
            Visitantes sem o link QA permanecem bloqueados.
          </p>
          {!qaLink && (
            <p className="text-[11px] text-amber-300/90">
              Por segurança, o token QA é exibido apenas no momento da criação. Se precisar de um novo link para o celular, encerre e libere novamente.
            </p>
          )}
        </div>
      )}

      {notice && (
        <p role="status" className="rounded-lg border border-emerald-800/40 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-rose-800/50 bg-rose-950/25 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      )}

      {qaLink && (
        <div className="rounded-xl border border-[#00b894]/50 bg-emerald-950/20 p-3.5 space-y-2.5">
          <p className="text-xs font-bold text-emerald-300">
            Link exclusivo de homologação do cardápio (?qa_token=):
          </p>
          <input
            readOnly
            aria-label="Link de homologação QA"
            value={qaLink}
            onFocus={event => event.currentTarget.select()}
            className="w-full rounded-lg border border-zinc-700 bg-koma-page px-3 py-2 font-mono text-[11px] text-koma-foreground"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyText(qaLink, "link")}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#00b894] px-3 py-2 text-xs font-black text-black"
            >
              {copiedKey === "link" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedKey === "link" ? "Link copiado" : "Copiar link QA"}
            </button>
            <a
              href={qaLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-emerald-700 bg-koma-page px-3 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-950/40"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Abrir cardápio QA
            </a>
            <button
              type="button"
              onClick={() =>
                void copyText(
                  `Link de teste do cardápio (${tenantName}) — válido somente para homologação: ${qaLink}`,
                  "whatsapp",
                )
              }
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-zinc-700 bg-koma-page px-3 py-2 text-xs font-bold text-koma-secondary hover:text-koma-foreground"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              {copiedKey === "whatsapp" ? "Texto copiado" : "Copiar p/ WhatsApp"}
            </button>
          </div>
        </div>
      )}

      {!qaActive && startFormOpen && (
        <div className="rounded-xl border border-zinc-800 bg-koma-page p-4 space-y-3">
          <div className="space-y-1.5">
            <span className="block text-xs font-semibold text-koma-foreground">
              Duração da janela QA (1 a 72 horas)
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {HOUR_PRESETS.map(preset => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setHours(preset)}
                  className={
                    "min-h-[44px] rounded-lg border px-3 py-1.5 text-xs font-bold " +
                    (hours === preset
                      ? "border-[#00b894] bg-[#00b894] text-black"
                      : "border-zinc-700 bg-koma-card text-koma-secondary")
                  }
                >
                  {preset}h
                </button>
              ))}
              <input
                aria-label="Duração em horas (1 a 72)"
                type="number"
                min={1}
                max={72}
                value={hours}
                onChange={event => setHours(Number(event.target.value))}
                className="min-h-[44px] w-20 rounded-lg border border-zinc-700 bg-koma-card px-2.5 py-1.5 text-xs text-koma-foreground"
              />
            </div>
          </div>

          <label className="block text-xs font-semibold text-koma-foreground">
            Motivo
            <textarea
              rows={2}
              value={reason}
              onChange={event => setReason(event.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-zinc-700 bg-koma-card p-2.5 text-xs text-koma-foreground"
              placeholder="Descreva o objetivo do teste (mín. 10 caracteres)"
            />
          </label>
          <button
            type="button"
            onClick={() => setReason(DEFAULT_QA_START_REASON)}
            className="rounded-lg border border-zinc-700 bg-koma-card px-2.5 py-1.5 text-[11px] font-semibold text-koma-secondary hover:text-koma-foreground"
          >
            Preencher motivo padrão de implantação
          </button>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || reason.trim().length < 10 || !Number.isInteger(hours) || hours < 1 || hours > 72}
              onClick={() => void handleStartQa()}
              className="min-h-[44px] rounded-lg bg-[#00b894] px-4 py-2 text-xs font-black text-black disabled:opacity-50"
            >
              {busy ? "Liberando…" : "Liberar para testes"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setStartFormOpen(false)}
              className="min-h-[44px] rounded-lg border border-zinc-700 px-3.5 py-2 text-xs font-bold text-koma-secondary"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {qaActive && endFormOpen && (
        <div className="rounded-xl border border-rose-900/50 bg-koma-page p-4 space-y-3">
          <label className="block text-xs font-semibold text-koma-foreground">
            Motivo do encerramento antecipado
            <textarea
              rows={2}
              value={endReason}
              onChange={event => setEndReason(event.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-zinc-700 bg-koma-card p-2.5 text-xs text-koma-foreground"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || endReason.trim().length < 3}
              onClick={() => void handleEndQa()}
              className="min-h-[44px] rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {busy ? "Encerrando…" : "Confirmar encerramento"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEndFormOpen(false)}
              className="min-h-[44px] rounded-lg border border-zinc-700 px-3.5 py-2 text-xs font-bold text-koma-secondary"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
