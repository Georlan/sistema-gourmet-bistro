import React, { useId, useState } from "react";

export default function PixCopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const fieldId = useId();

  async function copyCode() {
    setCopied(false);
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <div className="mt-3 text-left">
      <button type="button" onClick={() => void copyCode()}
        className="flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-500 px-4 py-3 text-xs font-black text-white shadow-sm shadow-black/25 transition-colors hover:bg-emerald-400 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">
        {copied ? "Código Pix copiado" : "Copiar código Pix"}
      </button>
      <p role="status" className="mt-2 text-xs text-koma-muted">
        {copyFailed
          ? "Não foi possível copiar automaticamente; selecione e copie o código abaixo."
          : copied
            ? "Copiado. Confira destinatário e valor no banco."
            : "No banco, confira destinatário e valor."}
      </p>
      <div className="mt-3">
        <label htmlFor={fieldId} className="block text-xs font-bold text-koma-foreground">
          Código Pix Copia e Cola
        </label>
        <textarea
          id={fieldId}
          readOnly
          value={code}
          rows={3}
          onFocus={event => event.currentTarget.select()}
          onClick={event => event.currentTarget.select()}
          aria-label="Código Pix Copia e Cola"
          className="mt-1.5 block w-full min-w-0 resize-none break-all rounded-xl border border-koma-border bg-koma-raised p-3 font-mono text-xs leading-relaxed text-koma-foreground select-all focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
        />
      </div>
    </div>
  );
}
