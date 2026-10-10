import { CheckCircle2, ExternalLink, Landmark, Loader2, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';

type Props = {
  name: string; headingId: string; connected: boolean; loading: boolean; busy: boolean;
  available?: boolean; onConnect: () => void; onRefresh: () => void;
  onDisconnect?: () => void; children?: ReactNode;
  feedback: { type: 'success' | 'error' | 'info'; text: string } | null;
};

/** Shared presentation only: each provider owns its authorization and account state. */
export function PaymentConnectionCard({ name, headingId, connected, loading, busy, available = true, onConnect, onRefresh, onDisconnect, children, feedback }: Props) {
  return <section aria-labelledby={headingId} className={`min-w-0 rounded-2xl border bg-koma-panel p-5 ${connected ? 'border-emerald-500/50' : 'border-koma-border'}`}>
    <div className="flex items-center gap-3">
      <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${name === 'PagBank' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-sky-500/10 text-sky-500'}`}><Landmark size={24}/></div>
      <div className="min-w-0 flex-1">
        <h3 id={headingId} className="text-base font-bold text-koma-foreground">{name}</h3>
        <span className={`mt-1 inline-flex items-center gap-1 text-xs ${connected ? 'text-emerald-600 dark:text-emerald-300' : 'text-koma-muted'}`}>
          {loading ? <Loader2 size={12} className="animate-spin"/> : connected ? <CheckCircle2 size={12}/> : null}
          {loading ? 'Consultando' : connected ? 'Conectado' : available ? 'Não conectado' : 'Em preparação'}
        </span>
      </div>
      <button type="button" onClick={onRefresh} disabled={loading || busy} aria-label={`Atualizar status do ${name}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-koma-muted hover:bg-koma-raised disabled:opacity-50"><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/></button>
    </div>
    <p className="mt-4 text-sm text-koma-muted">Pix direto na sua conta, com confirmação automática.</p>
    {children}
    <div className="mt-5 flex flex-wrap gap-2 border-t border-koma-border pt-4">
      <button type="button" onClick={onConnect} disabled={loading || busy || !available} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? <Loader2 size={16} className="animate-spin"/> : <ExternalLink size={16}/>}
        {connected ? 'Reconectar' : available ? `Conectar ${name}` : 'Conexão em preparação'}
      </button>
      {connected && onDisconnect && <button type="button" onClick={onDisconnect} disabled={busy || loading} className="min-h-11 rounded-xl border border-koma-border px-3 text-sm text-koma-muted disabled:opacity-50">Desconectar</button>}
    </div>
    {feedback && <p role="status" className={`mt-3 rounded-xl px-3 py-2 text-sm ${feedback.type === 'error' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-300' : feedback.type === 'success' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' : 'bg-koma-raised text-koma-muted'}`}>{feedback.text}</p>}
  </section>;
}
