import React, { useEffect, useState } from 'react';
import { superAdminFetch } from './superAdminApi';

type ReleasePreview = {
  restaurant: { id: string; name: string; plan: string };
  subscription: {
    status: string;
    billingCycle: string;
    paymentMethod: string | null;
    trialStartedAt: string | null;
    trialEndsAt: string | null;
  };
  steps: Record<'profile' | 'hours' | 'catalog' | 'operations', boolean>;
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

  useEffect(() => {
    const controller = new AbortController();
    void superAdminFetch(`/api/super-admin/onboarding/restaurantes/${restaurantId}/release`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || 'Não foi possível carregar a implantação.');
        setPreview(data as ReleasePreview);
      })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Falha ao carregar.'); });
    return () => controller.abort();
  }, [restaurantId]);

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
