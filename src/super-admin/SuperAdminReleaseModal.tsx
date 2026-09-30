import React, { useEffect, useState } from 'react';
import { superAdminFetch } from './superAdminApi';

type ReleasePreview = {
  restaurant: { id: string; name: string; plan: string; operationProfile?: string };
  subscription: {
    status: string;
    billingCycle: string;
    paymentMethod: string | null;
    trialStartedAt: string | null;
    trialEndsAt: string | null;
  };
  steps: Record<'profile' | 'hours' | 'catalog' | 'operations', boolean>;
  operations?: { orderTypes?: string[]; tableMapEnabled?: boolean; blockers?: string[] };
  counts?: { tables?: number; products?: number; activeProducts?: number; orders?: number };
  catalogAssistance?: { status?: string; filename?: string } | null;
  readyForRelease: boolean;
  trialStarted: boolean;
};

const STEP_LABELS: Array<[keyof ReleasePreview['steps'], string]> = [
  ['profile', 'Dados do restaurante'],
  ['hours', 'Horários de funcionamento'],
  ['catalog', 'Produto ativo no cardápio'],
  ['operations', 'Modalidades de operação'],
];

export function SuperAdminReleaseModal({ restaurantId, onClose, onReleased }: {
  restaurantId: string;
  onClose: () => void;
  onReleased: () => void;
}) {
  const [preview, setPreview] = useState<ReleasePreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tableCount, setTableCount] = useState('');
  const [tableCapacity, setTableCapacity] = useState('4');
  const [tableReason, setTableReason] = useState('');
  const [tableBusy, setTableBusy] = useState(false);
  const [tableNotice, setTableNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void superAdminFetch(`/api/super-admin/onboarding/restaurantes/${restaurantId}/release`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || 'Não foi possível carregar a implantação.');
        setPreview(data as ReleasePreview);
        setTableCount((current) => current || (Number(data?.counts?.tables || 0) > 0 ? String(data.counts.tables) : ''));
      })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Falha ao carregar.'); });
    return () => controller.abort();
  }, [restaurantId]);

  const bootstrapTables = async () => {
    if (!preview || tableBusy) return;
    const count = Number.parseInt(tableCount, 10);
    const defaultCapacity = Number.parseInt(tableCapacity, 10);
    if (!Number.isFinite(count) || count < 1 || count > 300) {
      setError('Informe entre 1 e 300 mesas.');
      return;
    }
    if (!Number.isFinite(defaultCapacity) || defaultCapacity < 1 || defaultCapacity > 50) {
      setError('Informe uma capacidade entre 1 e 50 lugares.');
      return;
    }
    if (tableReason.trim().length < 3) {
      setError('Informe o motivo da alteração administrativa.');
      return;
    }

    setTableBusy(true);
    setError('');
    setTableNotice('');
    try {
      const response = await superAdminFetch(
        `/api/super-admin/onboarding/restaurantes/${restaurantId}/tables/bootstrap`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            count,
            default_capacity: defaultCapacity,
            reason: tableReason.trim(),
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Não foi possível preparar as mesas.');
      setPreview(data as ReleasePreview);
      setTableNotice(`Salão atualizado: ${data.counts?.tables || count} mesa(s) cadastrada(s).`);
      setTableReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao preparar as mesas.');
    } finally {
      setTableBusy(false);
    }
  };

  const release = async () => {
    if (!preview?.readyForRelease || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await superAdminFetch(`/api/super-admin/onboarding/restaurantes/${restaurantId}/release`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Não foi possível liberar a operação.');
      setPreview(data as ReleasePreview);
      onReleased();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao liberar a operação.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Liberação da operação">
    <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-koma-card p-6 text-koma-foreground">
      <h2 className="text-lg font-bold">Liberar operação e iniciar 7 dias</h2>
      {preview ? <>
        <p className="mt-2 text-sm">{preview.restaurant.name} · {preview.restaurant.plan} · {preview.subscription.billingCycle === 'annual' || preview.subscription.billingCycle === 'anual' ? 'Anual' : 'Mensal'}</p>
        <p className="mt-1 text-xs text-koma-muted">Autorização: {preview.subscription.paymentMethod || 'não disponível'} · Status: {preview.subscription.status}</p>
        <ul className="mt-4 space-y-2 text-sm">{STEP_LABELS.map(([key, label]) => <li key={key}>{preview.steps[key] ? '✓' : '○'} {label}</li>)}</ul>
        <div className="mt-4 grid gap-2 rounded-xl border border-zinc-700 bg-zinc-900/40 p-3 text-xs">
          <p><strong>Tipo de operação:</strong> {preview.restaurant.operationProfile || 'não informado'}</p>
          <p><strong>Modalidades:</strong> {preview.operations?.orderTypes?.length ? preview.operations.orderTypes.join(', ') : 'não configuradas'}</p>
          <p><strong>Mesas cadastradas:</strong> {preview.counts?.tables ?? 0}</p>
          {preview.catalogAssistance?.filename && <p><strong>Cardápio enviado:</strong> {preview.catalogAssistance.filename} · {preview.catalogAssistance.status || 'status indisponível'}</p>}
        </div>
        {preview.operations?.orderTypes?.includes('consumo_local') && (
          <section className="mt-4 rounded-xl border border-emerald-900/60 bg-emerald-950/20 p-3">
            <p className="text-sm font-bold text-emerald-200">Atalho de implantação do salão</p>
            <p className="mt-1 text-[11px] text-koma-muted">Cria apenas mesas padronizadas que estiverem faltando. Não remove nem sobrescreve mesas existentes.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="text-[10px] font-bold text-koma-muted">Quantidade total
                <input value={tableCount} onChange={event => setTableCount(event.target.value)} inputMode="numeric" placeholder="Ex.: 30" className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
              </label>
              <label className="text-[10px] font-bold text-koma-muted">Lugares por mesa
                <input value={tableCapacity} onChange={event => setTableCapacity(event.target.value)} inputMode="numeric" className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
              </label>
            </div>
            <label className="mt-2 block text-[10px] font-bold text-koma-muted">Motivo da alteração
              <input value={tableReason} onChange={event => setTableReason(event.target.value)} placeholder="Ex.: implantação assistida do salão" className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100" />
            </label>
            <button type="button" disabled={tableBusy} onClick={() => void bootstrapTables()} className="mt-3 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-zinc-950 disabled:opacity-50">
              {tableBusy ? 'Criando…' : 'CRIAR / COMPLETAR MESAS'}
            </button>
            {tableNotice && <p className="mt-2 text-[11px] font-bold text-emerald-300">{tableNotice}</p>}
          </section>
        )}
        {preview.trialStarted && <p className="mt-4 text-sm text-emerald-300">Trial iniciado em {preview.subscription.trialStartedAt ? new Date(preview.subscription.trialStartedAt).toLocaleString('pt-BR') : 'data indisponível'}; termina em {preview.subscription.trialEndsAt ? new Date(preview.subscription.trialEndsAt).toLocaleString('pt-BR') : 'data indisponível'}.</p>}
        {!preview.trialStarted && <p className="mt-4 text-xs text-koma-muted">O início será registrado agora. A primeira cobrança fixa permanece após os sete dias completos.</p>}
      </> : <p className="mt-4 text-sm">Carregando implantação…</p>}
      {error && <p className="mt-3 text-sm text-rose-400" role="alert">{error}</p>}
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onClose} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm">Fechar</button>
        {preview && !preview.trialStarted && <button type="button" disabled={!preview.readyForRelease || busy} onClick={() => void release()} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-zinc-950 disabled:opacity-40">{busy ? 'Liberando…' : 'LIBERAR OPERAÇÃO E INICIAR 7 DIAS'}</button>}
      </div>
    </div>
  </div>;
}
