import { useEffect, useState } from "react";
import { SUPPORT_ERROR_EVENT } from "../../utils/supportCode";

export function SupportCodeNotice() {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onError = (event: Event) => {
      const next = (event as CustomEvent<{ code: string }>).detail?.code;
      if (!next) return;
      setCode(next);
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
  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-[9999] -translate-x-1/2 rounded-xl border border-amber-500/50 bg-zinc-950 px-4 py-3 text-sm text-white shadow-xl">
      Não foi possível concluir a operação. Código de suporte: <strong>{code}</strong>
      <button type="button" aria-label="Fechar aviso" onClick={() => setCode(null)} className="ml-4 text-zinc-300">×</button>
    </div>
  );
}
