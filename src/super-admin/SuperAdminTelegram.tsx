import React, { useState } from "react";
import { Bot, CheckCircle, Send, ShieldAlert, Trash2 } from "lucide-react";

export interface TelegramAlert {
  id: string;
  sender: "bot" | "user";
  text: string;
  timestamp: string;
}

interface SuperAdminTelegramProps {
  telegramMessages: TelegramAlert[];
  onTriggerTelegramAlert: (text: string) => Promise<boolean>;
  onClearMessages: () => void;
}

export default function SuperAdminTelegram({
  telegramMessages,
  onTriggerTelegramAlert,
  onClearMessages,
}: SuperAdminTelegramProps) {
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const sendMessage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;
    setIsSending(true);
    setSendError(null);
    const delivered = await onTriggerTelegramAlert(text);
    if (delivered) {
      setMessage("");
    } else {
      setSendError("A API não confirmou a entrega. A mensagem não foi adicionada ao histórico local.");
    }
    setIsSending(false);
  };

  return (
    <div className="space-y-6" id="superadmin-telegram-control">
      <header className="rounded border border-[#1e293b]/40 bg-koma-card p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-koma-foreground">
          <Bot className="h-4 w-4 text-[#00b894]" />
          Telegram
        </h2>
        <p className="mt-1 text-xs text-koma-muted">
          Envio manual pelo bot configurado exclusivamente no servidor.
        </p>
      </header>

      <section className="rounded border border-amber-800/60 bg-amber-950/20 p-4 text-xs text-amber-200">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Tokens e IDs de chat não são capturados por esta interface. Regras automáticas e histórico persistente permanecem indisponíveis até existirem rotas autenticadas e auditáveis no backend.
          </p>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded border border-[#1e293b]/40 bg-koma-card p-5">
          <h3 className="text-xs font-bold text-koma-foreground">Enviar mensagem</h3>
          <form onSubmit={sendMessage} className="mt-4 space-y-3">
            <textarea
              value={message}
              onChange={event => setMessage(event.target.value)}
              disabled={isSending}
              required
              rows={5}
              maxLength={2000}
              placeholder="Mensagem operacional..."
              className="w-full resize-y rounded border border-[#334155] bg-black/30 px-3 py-2 text-sm text-koma-foreground"
            />
            {sendError && <p className="text-xs text-red-300" role="alert">{sendError}</p>}
            <button
              type="submit"
              disabled={isSending || !message.trim()}
              className="flex items-center gap-2 rounded bg-[#00b894] px-4 py-2 text-xs font-bold text-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
              {isSending ? "Enviando..." : "Enviar"}
            </button>
          </form>
        </section>

        <section className="rounded border border-[#1e293b]/40 bg-koma-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-bold text-koma-foreground">Entregas confirmadas nesta sessão</h3>
            {telegramMessages.length > 0 && (
              <button type="button" onClick={onClearMessages} className="flex items-center gap-1 text-[10px] text-red-300">
                <Trash2 className="h-3 w-3" /> Limpar tela
              </button>
            )}
          </div>
          {telegramMessages.length === 0 ? (
            <p className="py-10 text-center text-xs text-koma-muted">Nenhuma entrega foi confirmada nesta sessão.</p>
          ) : (
            <ul className="mt-4 max-h-80 space-y-2 overflow-auto">
              {telegramMessages.map(item => (
                <li key={item.id} className="rounded border border-[#1e293b]/40 bg-black/20 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2 text-[10px] text-koma-muted">
                    <span className="flex items-center gap-1 text-[#00b894]"><CheckCircle className="h-3 w-3" /> Confirmada</span>
                    <time>{item.timestamp}</time>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-koma-secondary">{item.text}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
