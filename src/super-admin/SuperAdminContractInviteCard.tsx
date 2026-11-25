import React, { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, FileSignature, MessageCircle } from "lucide-react";

export interface ContractInviteGenerateInput {
  billing_cycle: "mensal" | "anual";
  payment_method_type: "pix" | null;
  auto_release_on_accept: boolean;
}

export interface ContractInviteGeneratedResult {
  inviteUrl: string;
  paymentMethodType?: string | null;
  autoReleaseOnAccept?: boolean;
  expiresAt?: string | null;
}

interface SuperAdminContractInviteCardProps {
  tenantId: string;
  tenantName: string;
  tenantPlan: string;
  configurationComplete: boolean;
  ctaLabel?: string;
  onGenerateInvite: (input: ContractInviteGenerateInput) => Promise<ContractInviteGeneratedResult>;
}

const FIXED_FEE_PLANS = new Set(["pro", "premium"]);

export function SuperAdminContractInviteCard({
  tenantId,
  tenantName,
  tenantPlan,
  configurationComplete,
  ctaLabel = "Gerar link único de aceite",
  onGenerateInvite,
}: SuperAdminContractInviteCardProps) {
  const requiresPaymentForAutoRelease = FIXED_FEE_PLANS.has(String(tenantPlan || "").trim().toLowerCase());
  const [billingCycle, setBillingCycle] = useState<"mensal" | "anual">("mensal");
  const [paymentMethodType, setPaymentMethodType] = useState<"pix" | "">(
    requiresPaymentForAutoRelease ? "pix" : "pix",
  );
  const [autoReleaseOnAccept, setAutoReleaseOnAccept] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<ContractInviteGeneratedResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<"link" | "whatsapp" | null>(null);

  useEffect(() => {
    setError(null);
    setGenerated(null);
    setCopiedKey(null);
  }, [tenantId]);

  const handlePaymentMethodChange = (next: "pix" | "") => {
    setPaymentMethodType(next);
    if (next === "" && requiresPaymentForAutoRelease && autoReleaseOnAccept) {
      setAutoReleaseOnAccept(false);
    }
  };

  const handleAutoReleaseChange = (checked: boolean) => {
    setAutoReleaseOnAccept(checked);
    if (checked && requiresPaymentForAutoRelease && paymentMethodType === "") {
      setPaymentMethodType("pix");
    }
  };

  const handleGenerate = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setCopiedKey(null);
    try {
      const result = await onGenerateInvite({
        billing_cycle: billingCycle,
        payment_method_type: paymentMethodType === "pix" ? "pix" : null,
        auto_release_on_accept: autoReleaseOnAccept,
      });
      setGenerated(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gerar o link de aceite.");
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (text: string, key: "link" | "whatsapp") => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(current => (current === key ? null : current)), 2500);
    } catch {
      setError("Não foi possível copiar automaticamente; copie o link no campo abaixo.");
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-zinc-800 bg-koma-page p-4 text-xs text-koma-muted">
      <div className="flex items-start gap-2">
        <FileSignature className="mt-0.5 h-4 w-4 shrink-0 text-[#00b894]" />
        <div>
          <p className="font-bold text-koma-foreground">Enviar aceite contratual pós-homologação</p>
          <p className="mt-0.5 leading-relaxed">
            O link já nasce vinculado ao tenant #{tenantId}, encerra eventual janela QA ao ser aceito sem apagar o cardápio e pode liberar a operação comercial automaticamente.
          </p>
        </div>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold text-koma-secondary">Ciclo comercial</span>
          <select
            aria-label="Ciclo do link de aceite"
            value={billingCycle}
            onChange={event => setBillingCycle(event.target.value === "anual" ? "anual" : "mensal")}
            className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-koma-card px-3 py-2 text-xs text-koma-foreground"
          >
            <option value="mensal">Mensal</option>
            <option value="anual">Anual</option>
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-semibold text-koma-secondary">Meio de cobrança SaaS</span>
          <select
            aria-label="Meio de cobrança do link de aceite"
            value={paymentMethodType}
            onChange={event => handlePaymentMethodChange(event.target.value === "pix" ? "pix" : "")}
            className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-koma-card px-3 py-2 text-xs text-koma-foreground"
          >
            <option value="pix">Pix (pronto para auto-liberação)</option>
            <option value="">Definir depois (vincular somente contrato)</option>
          </select>
        </label>
      </div>

      <label className="flex min-h-[44px] cursor-pointer items-start gap-2.5 rounded-lg border border-zinc-800 bg-koma-card p-3">
        <input
          type="checkbox"
          checked={autoReleaseOnAccept}
          onChange={event => handleAutoReleaseChange(event.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[#00b894]"
        />
        <span className="text-xs leading-relaxed text-koma-foreground">
          Liberar operação comercial e iniciar os 7 dias de trial automaticamente após o aceite
        </span>
      </label>

      {autoReleaseOnAccept && (
        <p className={configurationComplete ? "text-[11px] text-emerald-300" : "text-[11px] text-amber-300"}>
          {configurationComplete
            ? "Implantação essencial 4/4 concluída: assim que o cliente aceitar, o QA será encerrado e a loja entrará em trial ativo."
            : "Ainda há etapas essenciais pendentes: o aceite vinculará o contrato e encerrará o QA, e o trial iniciará somente ao concluir os 4 itens."}
        </p>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => void handleGenerate()}
        className="min-h-[44px] w-full sm:w-auto rounded-lg bg-[#00b894] px-4 py-2 text-xs font-black text-black disabled:opacity-50"
      >
        {busy ? "Gerando link…" : ctaLabel}
      </button>

      {error && (
        <p className="rounded-lg border border-rose-800/50 bg-rose-950/25 px-3 py-2 text-rose-300" role="alert">
          {error}
        </p>
      )}

      {generated?.inviteUrl && (
        <div className="space-y-2.5 rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-bold text-emerald-300">Link único pronto (válido por 72h):</p>
            <span className="rounded-full border border-emerald-700/50 px-2 py-0.5 text-[10px] font-bold text-emerald-200">
              {generated.autoReleaseOnAccept ? "Auto-liberação ativa" : "Somente vínculo"} · {generated.paymentMethodType === "pix" ? "Pix" : "Sem meio definido"}
            </span>
          </div>
          <input
            readOnly
            aria-label="Link único de aceite contratual"
            value={generated.inviteUrl}
            onFocus={event => event.currentTarget.select()}
            className="w-full rounded-lg border border-zinc-700 bg-koma-card px-2.5 py-2 font-mono text-[11px] text-koma-foreground"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyText(generated.inviteUrl, "link")}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#00b894] px-3 py-2 text-xs font-black text-black"
            >
              {copiedKey === "link" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedKey === "link" ? "Copiado" : "Copiar link"}
            </button>
            <a
              href={generated.inviteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-emerald-700 bg-koma-card px-3 py-2 text-xs font-bold text-emerald-200"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Abrir aceite
            </a>
            <button
              type="button"
              onClick={() =>
                void copyText(
                  `Olá! Segue o link único para aceite dos termos do KÔMA (${tenantName}): ${generated.inviteUrl}`,
                  "whatsapp",
                )
              }
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-zinc-700 bg-koma-card px-3 py-2 text-xs font-bold text-koma-secondary hover:text-koma-foreground"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              {copiedKey === "whatsapp" ? "Texto copiado" : "Copiar p/ WhatsApp"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
