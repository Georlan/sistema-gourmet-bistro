import React, { useEffect, useRef, useState } from 'react';
import type { Tenant } from './superAdminTypes';
import { superAdminFetch, superAdminErrorMessage } from './superAdminApi';

type Snapshot = {
  plan: string;
  baseline: Record<string, boolean>;
  overrides: Record<string, { enabled: boolean; source: string }>;
  effective: Record<string, boolean>;
};
const labels: Record<string, string> = {
  printing: 'Impressão', kds: 'KDS', waiter_app: 'App Garçom', loyalty: 'Fidelidade',
  coupons: 'Cupons', courier_app: 'App Entregador', inventory: 'Estoque', advanced_reports: 'Relatórios avançados',
};

export function SuperAdminCapabilitiesModal({ tenant, onClose }: { tenant: Tenant; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [capability, setCapability] = useState('printing');
  const [mode, setMode] = useState('grant');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const [saved, setSaved] = useState(false);
  const url = `/api/super-admin/restaurantes/${tenant.id}/capabilities`;

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await superAdminFetch(url, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.detail || 'Falha ao carregar recursos.');
        if (!body.baseline || !body.overrides || !body.effective) throw new Error('Resposta de recursos inválida. Recarregue antes de alterar.');
        if (!controller.signal.aborted) setSnapshot(body);
      } catch (err) {
        if (!controller.signal.aborted) setError(superAdminErrorMessage(err));
      }
    })();
    return () => controller.abort();
  }, [url]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!snapshot || savingRef.current) return;
    if (reason.trim().length < 3) { setError('Informe um motivo com pelo menos 3 caracteres.'); return; }
    savingRef.current = true;
    setBusy(true); setError(null); setSaved(false);
    try {
      const response = await superAdminFetch(`${url}/${capability}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, reason: reason.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || 'Falha ao salvar benefício.');
      setSnapshot(body); setReason(''); setSaved(true);
    } catch (err) { setError(superAdminErrorMessage(err)); }
    finally { savingRef.current = false; setBusy(false); }
  }

  return <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/70 p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="benefits-title" className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl border border-zinc-700 bg-koma-page p-5 text-koma-foreground">
      <div className="flex justify-between gap-4"><h2 id="benefits-title" className="font-bold">Recursos e exceções — {tenant.name}</h2><button type="button" onClick={onClose} disabled={busy} aria-label="Fechar recursos">Fechar</button></div>
      <p className="my-3 text-sm">Plano comercial: {snapshot?.plan || tenant.plan}. Benefícios individuais preservam o plano e não alteram a cobrança.</p>
      {!snapshot && !error && <p role="status">Carregando recursos...</p>}
      {error && <p role="alert" className="my-3 text-rose-400">{error}</p>}
      {saved && <p role="status" className="my-3 text-emerald-400">Alteração salva com ator e motivo na Auditoria. O restaurante deve recarregar a sessão.</p>}
      {snapshot && <>
        <table className="w-full text-sm"><thead><tr><th className="text-left">Recurso</th><th>Incluído no plano</th><th>Exceção individual</th><th>Disponível agora</th></tr></thead><tbody>
          {Object.keys(snapshot.baseline).map(key => <tr key={key} className="border-t border-zinc-800">
            <td className="py-2">{labels[key] || key}</td><td className="text-center">{snapshot.baseline[key] ? 'Sim' : 'Não'}</td>
            <td className="text-center">{snapshot.overrides[key] ? snapshot.overrides[key].enabled ? 'Liberado manualmente' : 'Bloqueado manualmente' : 'Segue o plano'}</td>
            <td className="text-center">{snapshot.effective[key] ? 'Sim' : 'Não'}</td>
          </tr>)}
        </tbody></table>
        <form onSubmit={save} className="mt-5 space-y-3">
          <label className="block">Recurso<select aria-label="Recurso" className="mt-1 block w-full rounded border border-zinc-700 bg-koma-card p-2" value={capability} onChange={e => { setCapability(e.target.value); setSaved(false); }} disabled={busy}>{Object.keys(snapshot.baseline).map(key => <option key={key} value={key}>{labels[key] || key}</option>)}</select></label>
          <label className="block">Ação<select aria-label="Ação" className="mt-1 block w-full rounded border border-zinc-700 bg-koma-card p-2" value={mode} onChange={e => { setMode(e.target.value); setSaved(false); }} disabled={busy}><option value="grant">Liberar para esta loja</option><option value="revoke">Bloquear para esta loja</option><option value="baseline">Seguir o plano novamente</option></select></label>
          <p role="status" className="rounded-lg border border-zinc-700 p-3 text-sm">{labels[capability] || capability}: {snapshot.effective[capability] ? 'disponível' : 'bloqueado'} → {(mode === 'baseline' ? snapshot.baseline[capability] : mode === 'grant') ? 'disponível' : 'bloqueado'}. Plano e cobrança permanecem iguais.</p>
          <p className="text-xs text-koma-muted">Bloquear impede o uso mesmo quando o plano inclui o recurso. Seguir o plano remove a exceção individual.</p>
          <label className="block">Motivo obrigatório<textarea className="mt-1 block w-full rounded border border-zinc-700 bg-koma-card p-2" value={reason} onChange={e => setReason(e.target.value)} minLength={3} maxLength={1000} required disabled={busy} placeholder="Primeiro cliente KÔMA; plano Pocket; impressão de cortesia; extra R$ 0; pagamento online não habilitado inicialmente." /></label>
          <button type="submit" disabled={busy || reason.trim().length < 3} className="rounded bg-emerald-700 px-4 py-2 disabled:opacity-50">{busy ? 'Salvando...' : 'Salvar benefício'}</button>
        </form>
      </>}
    </section>
  </div>;
}
