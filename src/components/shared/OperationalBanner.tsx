import clsx from 'clsx';
import { BarChart3, X } from 'lucide-react';
import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';

export interface OperationalBannerMetric {
  label: string;
  value: string | number;
  valueClassName?: string;
}
interface OperationalBannerProps {
  id: string;
  eyebrow: string;
  title: string;
  accent: string;
  description: string;
  metrics: OperationalBannerMetric[];
  isConnected?: boolean;
}
type Summary = Pick<OperationalBannerProps, 'id' | 'title' | 'description' | 'metrics'>;
type Registration = Summary & { scope: string; token: symbol };
type Registry = { scope: string; register: (entry: Registration) => void; unregister: (token: symbol) => void };
const RegistryContext = createContext<Registry | null>(null);
const SummariesContext = createContext<Registration[]>([]);

/** Keeps already-computed screen indicators outside the workspace layout. */
export function OperationalSummaryProvider({ scope, children }: { scope: string; children: React.ReactNode }) {
  const [entries, setEntries] = useState<Registration[]>([]);
  const register = useCallback((entry: Registration) => setEntries(current => [...current.filter(item => item.token !== entry.token), entry]), []);
  const unregister = useCallback((token: symbol) => setEntries(current => current.filter(item => item.token !== token)), []);
  const registry = useMemo(() => ({ scope, register, unregister }), [scope, register, unregister]);
  const visible = useMemo(() => entries.filter(entry => entry.scope === scope), [entries, scope]);
  return <RegistryContext.Provider value={registry}><SummariesContext.Provider value={visible}>{children}</SummariesContext.Provider></RegistryContext.Provider>;
}

function SummaryContent({ summaries }: { summaries: Summary[] }) {
  return <div className="space-y-5">{summaries.map(summary => (
    <section key={summary.id} className="space-y-3">
      <h3 className="text-sm font-semibold text-koma-foreground">{summary.title}</h3>
      <dl className="grid grid-cols-2 gap-3">
        {summary.metrics.map(metric => <div key={metric.label} className="min-w-0 rounded-xl border border-koma-border bg-koma-raised p-3">
          <dt className="break-words text-xs text-koma-muted">{metric.label}</dt>
          <dd className={clsx('mt-1 break-words text-base font-semibold text-koma-foreground', metric.valueClassName)}>{metric.value}</dd>
        </div>)}
      </dl>
      <p className="text-xs leading-relaxed text-koma-muted">{summary.description}</p>
    </section>
  ))}</div>;
}

/** One entry point in the existing topbar, with no extra row per workspace. */
export function OperationalSummaryButton() {
  const summaries = useContext(SummariesContext);
  const registry = useContext(RegistryContext);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => { setOpen(false); }, [registry?.scope, summaries.length === 0]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); document.body.style.overflow = previousOverflow; };
  }, [open]);
  const close = () => { setOpen(false); buttonRef.current?.focus(); };
  if (!summaries.length) return null;
  return <>
    <button ref={buttonRef} type="button" id="btn-caixa-resumo" aria-label="Ver resumo da tela" onClick={() => setOpen(true)} className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl border border-koma-border bg-koma-raised px-3 py-1.5 text-xs font-bold text-koma-secondary hover:text-koma-foreground">
      <BarChart3 size={16} aria-hidden="true" /><span className="hidden sm:inline">Resumo</span>
    </button>
    <dialog ref={dialogRef} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }} className="operational-summary fixed inset-0 m-auto h-fit w-[calc(100%_-_2rem)] max-w-md max-h-[85dvh] overflow-y-auto rounded-2xl border border-koma-border bg-koma-panel p-5 text-koma-foreground backdrop:bg-black/60">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 id={titleId} className="text-base font-bold">Resumo da tela</h2>
        <button type="button" autoFocus onClick={close} aria-label="Fechar resumo" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl hover:bg-koma-raised"><X size={20} /></button>
      </header>
      {open && <SummaryContent summaries={summaries} />}
    </dialog>
  </>;
}

/** Compatibility adapter: retains screen headings and publishes the summary. */
export function OperationalBanner({ id, title, description, metrics }: OperationalBannerProps) {
  const registry = useContext(RegistryContext);
  const hostRef = useRef<HTMLHeadingElement>(null);
  const token = useRef(Symbol(id));
  // All metrics are serializable display values. Stable keys avoid an effect
  // loop when owners create fresh metric arrays on each render.
  const payload = JSON.stringify({ id, title, description, metrics });
  useEffect(() => {
    if (!registry || hostRef.current?.closest('[hidden]')) return;
    registry.register({ ...JSON.parse(payload), scope: registry.scope, token: token.current });
    return () => registry.unregister(token.current);
  }, [payload, registry]);
  return <>
    <h1 ref={hostRef} id={id} className="sr-only">{title}</h1>
    {!registry && <details className="operational-summary text-koma-foreground"><summary className="cursor-pointer text-sm font-semibold">Resumo</summary><SummaryContent summaries={[{ id, title, description, metrics }]} /></details>}
  </>;
}
