import React, { useId, useState } from "react";

export default function PixCopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const fieldId = useId();

  async function copyCode() {
    setCopied(false);
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopyFailed(true);
      setShowCode(true);
    }
  }

  return (
    <div className="mt-3 text-left">
      <button type="button" onClick={() => void copyCode()}
        className="flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-500 px-4 py-3 text-xs font-black text-white hover:bg-emerald-400">
        {copied ? "Código Pix copiado" : "Copiar código Pix"}
      </button>
      <p role="status" className="mt-2 text-xs leading-relaxed text-koma-muted">
        {copyFailed ? "A cópia automática não funcionou. Selecione e copie o código abaixo." : copied ? "Código copiado. Abra o Mercado Pago ou seu banco, mesmo que ele não apareça nas sugestões do celular." : "Pague com Pix Copia e Cola no Mercado Pago ou em outro banco que aceite Pix."}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-koma-muted">
        No aplicativo, escolha Pix → Copia e Cola e cole o código. Confira o destinatário e o valor antes de confirmar.
      </p>
      <button type="button" onClick={() => setShowCode(value => !value)} aria-expanded={showCode} aria-controls={fieldId}
        className="mt-2 min-h-11 w-full rounded-xl border border-koma-border px-3 py-2 text-xs font-bold text-koma-foreground">
        {showCode ? "Ocultar código Pix" : "Ver código para copiar manualmente"}
      </button>
      {showCode && <div className="mt-2">
        <label htmlFor={fieldId} className="text-xs font-bold text-koma-foreground">Código Pix Copia e Cola</label>
        <textarea id={fieldId} readOnly value={code} rows={3} onFocus={event => event.currentTarget.select()}
          className="mt-1 w-full rounded-lg border border-koma-border bg-koma-raised p-3 text-xs text-koma-foreground" />
      </div>}
    </div>
  );
}
