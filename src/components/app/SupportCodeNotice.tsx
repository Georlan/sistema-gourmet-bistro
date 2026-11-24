import { Check, Copy, LifeBuoy, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getOperatorSession } from "../../utils/authSession";
import { SUPPORT_ERROR_EVENT, openSupportWidgetWithCode } from "../../utils/supportCode";

export function SupportCodeNotice() {
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onError = (event: Event) => {
      const next = (event as CustomEvent<{ code: string }>).detail?.code;
      if (!next) return;
      setCode(next);
      setCopied(false);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setCode(null), 15000);
    };
    window.addEventListener(SUPPORT_ERROR_EVENT, onError);
    return () => {
      window.removeEventListener(SUPPORT_ERROR_EVENT, onError);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!code) return null;

  const hasOperatorSession = (() => {
    try {
      return Boolean(getOperatorSession()?.token);
    } catch {
      return false;
    }
  })();

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      setCopied(false);
    }
  };

  const handleRequestHelp = () => {
    const currentCode = code;
    setCode(null);
    openSupportWidgetWithCode(currentCode);
  };

  return (
    <div
      role="status"
      style={{
        background: "var(--koma-surface-panel)",
        borderColor: "var(--koma-warning-border)",
        color: "var(--koma-text-primary)",
        fontFamily: "var(--koma-font-body)",
      }}
      className="fixed bottom-4 left-1/2 z-[9999] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-sm shadow-xl"
    >
      <span>
        Não foi possível concluir a operação. Código de suporte:{" "}
        <strong style={{ fontFamily: "var(--koma-font-display)" }}>{code}</strong>
      </span>
      <button
        type="button"
        onClick={handleCopy}
        style={{
          background: "var(--koma-surface-raised)",
          borderColor: "var(--koma-border-default)",
          color: "var(--koma-text-primary)",
        }}
        className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition hover:opacity-90"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copiado" : "Copiar"}
      </button>
      {hasOperatorSession ? (
        <button
          type="button"
          onClick={handleRequestHelp}
          style={{
            background: "var(--koma-action-bg)",
            color: "var(--koma-action-text)",
          }}
          className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition hover:opacity-90"
        >
          <LifeBuoy className="h-3.5 w-3.5" />
          Pedir ajuda
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Fechar aviso"
        onClick={() => setCode(null)}
        style={{ color: "var(--koma-text-muted)" }}
        className="ml-1 inline-flex min-h-[34px] min-w-[34px] items-center justify-center rounded-lg transition hover:opacity-80"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
