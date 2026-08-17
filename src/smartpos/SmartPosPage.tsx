import React from 'react';
import { Clock3, CreditCard, ReceiptText, Table2 } from 'lucide-react';
import { KomaLogo } from '../components/KomaLogo';

const SMARTPOS_ACTIONS = [
  {
    id: 'receber',
    label: 'Receber',
    description: 'Pagamentos serão habilitados em uma etapa posterior.',
    icon: CreditCard,
  },
  {
    id: 'mesas',
    label: 'Mesas',
    description: 'O mapa de mesas será conectado sem alterar o fluxo atual.',
    icon: Table2,
  },
  {
    id: 'historico',
    label: 'Histórico',
    description: 'O histórico do operador será integrado depois.',
    icon: ReceiptText,
  },
] as const;

export default function SmartPosPage() {
  return (
    <main className="min-h-dvh bg-koma-page text-koma-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-6 pt-4 sm:px-6">
        <header className="flex items-center justify-between gap-4 border-b border-koma-border pb-4">
          <KomaLogo withText size="lg" />
          <span className="rounded-full border border-koma-border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-koma-muted">
            SmartPOS
          </span>
        </header>

        <section className="flex flex-1 flex-col pt-8">
          <div className="mb-8">
            <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">
              Canal de atendimento
            </p>
            <h1 className="max-w-sm text-3xl font-black tracking-[-0.04em] sm:text-4xl">
              Kôma SmartPOS
            </h1>
            <p className="mt-3 max-w-sm text-sm leading-6 text-koma-muted">
              Estrutura inicial do SmartPOS. Nesta etapa nenhuma ação financeira, mesa ou histórico é alterado.
            </p>
          </div>

          <div className="grid gap-3">
            {SMARTPOS_ACTIONS.map(({ id, label, description, icon: Icon }) => (
              <button
                key={id}
                type="button"
                disabled
                aria-disabled="true"
                className="flex min-h-24 w-full cursor-not-allowed items-center gap-4 rounded-2xl border border-koma-border bg-koma-surface px-4 py-4 text-left opacity-80"
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-koma-border bg-koma-page text-koma-accent">
                  <Icon size={22} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-extrabold">{label}</span>
                  <span className="mt-1 block text-xs leading-5 text-koma-muted">{description}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="mt-auto pt-8">
            <div className="flex items-start gap-3 rounded-2xl border border-koma-border bg-koma-surface px-4 py-3">
              <Clock3 className="mt-0.5 shrink-0 text-koma-accent" size={18} aria-hidden="true" />
              <div>
                <p className="text-xs font-bold">Etapa 1 — shell isolado</p>
                <p className="mt-1 text-xs leading-5 text-koma-muted">
                  Autenticação, capabilities, leitura de caixa e pagamentos permanecem fora deste escopo.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
