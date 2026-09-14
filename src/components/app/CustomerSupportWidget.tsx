import {
  CircleHelp,
  Lightbulb,
  MessageSquareWarning,
  Send,
  TriangleAlert,
  Wrench,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import { API_BASE_URL } from '../../config/api';
import { getOperatorSession, type OperatorSession } from '../../utils/authSession';
import { KOMA_OPEN_CUSTOMER_SUPPORT_EVENT } from './customerSupportEvents';

type FeedbackKind = 'question' | 'suggestion' | 'complaint' | 'problem';

type FeedbackOption = {
  id: FeedbackKind;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

const FEEDBACK_OPTIONS: readonly FeedbackOption[] = [
  {
    id: 'question',
    label: 'Dúvida',
    description: 'Não encontrei ou não entendi como fazer algo.',
    icon: CircleHelp,
  },
  {
    id: 'suggestion',
    label: 'Sugestão',
    description: 'Tenho uma ideia para deixar o KÔMA melhor ou mais simples.',
    icon: Lightbulb,
  },
  {
    id: 'problem',
    label: 'Problema',
    description: 'Algo não funcionou como eu esperava.',
    icon: Wrench,
  },
  {
    id: 'complaint',
    label: 'Reclamação',
    description: 'Quero registrar uma insatisfação ou dificuldade.',
    icon: MessageSquareWarning,
  },
] as const;

function readSession(): OperatorSession | null {
  try {
    return getOperatorSession();
  } catch {
    return null;
  }
}

export function CustomerSupportWidget() {
  const [session, setSession] = useState<OperatorSession | null>(() => readSession());
  const [isOpen, setIsOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>('question');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [sentId, setSentId] = useState<string | null>(null);

  useEffect(() => {
    const syncSession = () => setSession(readSession());
    const openSupport = () => {
      const nextSession = readSession();
      setSession(nextSession);
      if (!nextSession?.token) return;
      setSentId(null);
      setError('');
      setIsOpen(true);
    };

    window.addEventListener('focus', syncSession);
    window.addEventListener('storage', syncSession);
    window.addEventListener(KOMA_OPEN_CUSTOMER_SUPPORT_EVENT, openSupport);
    return () => {
      window.removeEventListener('focus', syncSession);
      window.removeEventListener('storage', syncSession);
      window.removeEventListener(KOMA_OPEN_CUSTOMER_SUPPORT_EVENT, openSupport);
    };
  }, []);

  const activeOption = useMemo(
    () => FEEDBACK_OPTIONS.find((option) => option.id === kind) ?? FEEDBACK_OPTIONS[0],
    [kind],
  );

  if (!session?.token || !isOpen) return null;

  const resetForm = () => {
    setKind('question');
    setMessage('');
    setError('');
    setSentId(null);
  };

  const closeDrawer = () => {
    setIsOpen(false);
    setError('');
  };

  const submitFeedback = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedMessage = message.trim();
    if (trimmedMessage.length < 5 || isSending) return;

    setIsSending(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/support/feedback`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          kind,
          message: trimmedMessage,
          // Não enviamos query string nem hash para evitar vazar tokens em links.
          page_path: window.location.pathname,
        }),
      });

      if (!response.ok) {
        let detail = 'Não foi possível enviar agora. Tente novamente em instantes.';
        try {
          const body = await response.json();
          if (typeof body?.detail === 'string' && body.detail.trim()) detail = body.detail;
        } catch {
          // Mantém a mensagem segura e curta quando o backend não retornar JSON.
        }
        throw new Error(detail);
      }

      const body = await response.json();
      setSentId(typeof body?.id === 'string' ? body.id : 'ok');
      setMessage('');
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : 'Não foi possível enviar agora. Tente novamente em instantes.',
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Ajuda e feedback KÔMA">
      <button
        type="button"
        className="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
        onClick={closeDrawer}
        aria-label="Fechar ajuda"
      />

      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-koma-border bg-koma-page shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-koma-border px-5 py-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-koma-accent">Suporte KÔMA</p>
            <h2 className="mt-1 text-xl font-bold text-koma-foreground">Ajuda e feedback</h2>
            <p className="mt-1 text-sm text-koma-muted-foreground">
              Envie uma dúvida, sugestão, problema ou reclamação. Sua mensagem fica registrada com o restaurante e a tela atual.
            </p>
          </div>
          <button
            type="button"
            onClick={closeDrawer}
            className="rounded-xl border border-koma-border p-2 text-koma-muted-foreground transition hover:bg-koma-elevated hover:text-koma-foreground"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {sentId ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <div className="rounded-full border border-koma-accent/30 bg-koma-accent/10 p-4">
              <Send className="h-7 w-7 text-koma-accent" />
            </div>
            <h3 className="mt-5 text-lg font-bold text-koma-foreground">Mensagem recebida</h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-koma-muted-foreground">
              Obrigado. O feedback ficou registrado para o suporte KÔMA e será usado para melhorar o produto.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={resetForm}
                className="rounded-xl border border-koma-border px-4 py-2.5 text-sm font-semibold text-koma-foreground transition hover:bg-koma-elevated"
              >
                Enviar outra
              </button>
              <button
                type="button"
                onClick={closeDrawer}
                className="rounded-xl bg-koma-accent px-4 py-2.5 text-sm font-bold text-koma-accent-foreground transition hover:opacity-90"
              >
                Fechar
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submitFeedback} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 overflow-y-auto px-5 py-5">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-koma-muted-foreground">
                O que você quer enviar?
              </p>
              <div className="grid grid-cols-2 gap-2">
                {FEEDBACK_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const selected = option.id === kind;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setKind(option.id)}
                      className={`rounded-2xl border p-3 text-left transition ${
                        selected
                          ? 'border-koma-accent bg-koma-accent/10'
                          : 'border-koma-border bg-koma-card hover:bg-koma-elevated'
                      }`}
                      aria-pressed={selected}
                    >
                      <Icon className={`h-5 w-5 ${selected ? 'text-koma-accent' : 'text-koma-muted-foreground'}`} />
                      <span className="mt-2 block text-sm font-bold text-koma-foreground">{option.label}</span>
                      <span className="mt-1 block text-xs leading-5 text-koma-muted-foreground">
                        {option.description}
                      </span>
                    </button>
                  );
                })}
              </div>

              <label className="mt-5 block">
                <span className="text-xs font-bold uppercase tracking-[0.12em] text-koma-muted-foreground">
                  Conte o que aconteceu
                </span>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={2000}
                  rows={7}
                  className="mt-2 w-full resize-none rounded-2xl border border-koma-border bg-koma-card px-4 py-3 text-sm text-koma-foreground outline-none transition placeholder:text-koma-muted-foreground focus:border-koma-accent focus:ring-2 focus:ring-koma-accent/20"
                  placeholder={`Escreva sua ${activeOption.label.toLowerCase()} com o máximo de contexto que conseguir…`}
                  required
                />
              </label>

              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-koma-muted-foreground">
                <span>{message.length}/2000</span>
                <span>A tela atual é anexada automaticamente.</span>
              </div>

              {error ? (
                <div className="mt-4 flex gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}
            </div>

            <footer className="border-t border-koma-border bg-koma-card/60 px-5 py-4">
              <button
                type="submit"
                disabled={message.trim().length < 5 || isSending}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-koma-accent px-4 py-3 text-sm font-bold text-koma-accent-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
                {isSending ? 'Enviando…' : `Enviar ${activeOption.label.toLowerCase()}`}
              </button>
              <p className="mt-2 text-center text-[11px] leading-4 text-koma-muted-foreground">
                Não inclua senhas, dados de cartão ou outras credenciais na mensagem.
              </p>
            </footer>
          </form>
        )}
      </aside>
    </div>
  );
}
