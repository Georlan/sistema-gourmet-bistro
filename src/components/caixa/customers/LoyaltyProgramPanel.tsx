import { useState, type Dispatch, type SetStateAction } from 'react';
import GrowthEconomicsCalculator, { type GrowthEconomicsOption } from '../../clientes/GrowthEconomicsCalculator';
import { LoyaltyImpactPanel } from './LoyaltyImpactPanel';
import { effectiveLoyaltyPercent, type LoyaltyConfig } from './useLoyaltyConfiguration';

const currency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const percent = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  saved: LoyaltyConfig | null;
  draft: LoyaltyConfig;
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  onRetry: () => void;
  onEdit: Dispatch<SetStateAction<LoyaltyConfig>>;
  onDiscard: () => void;
  onSave: () => Promise<void>;
  onApplyOption: (option: GrowthEconomicsOption) => void;
  canRedeem: number;
  accumulating: number;
  onOpenCustomers: () => void;
}

export function LoyaltyProgramPanel({
  apiBaseUrl, authHeaders, saved, draft, dirty, loading, saving, error,
  onRetry, onEdit, onDiscard, onSave, onApplyOption, canRedeem, accumulating, onOpenCustomers,
}: Props) {
  const [reviewing, setReviewing] = useState(false);
  const [simulation, setSimulation] = useState<'vigente' | 'rascunho'>('vigente');
  const update: Dispatch<SetStateAction<LoyaltyConfig>> = (next) => {
    setReviewing(false);
    onEdit(next);
  };
  const applySuggestion = (option: GrowthEconomicsOption) => {
    setReviewing(false);
    onApplyOption(option);
  };
  const simulated = simulation === 'rascunho' && dirty ? draft : saved;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <section aria-label="Programa vigente" className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-koma-foreground">Seu programa de fidelidade</h3>
            <p className="mt-1 text-sm text-koma-muted">Regra confirmada pelo servidor, não pelo formulário.</p>
          </div>
          {saved && (
            <span className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${saved.ativo
              ? 'bg-emerald-500/10 text-emerald-400' : 'bg-koma-raised text-koma-muted'}`}>
              {saved.ativo ? 'Ativo' : 'Pausado'}
            </span>
          )}
        </div>

        {loading && !saved && <p role="status" className="text-sm text-koma-muted">Consultando configuração vigente…</p>}
        {error && (
          <div role="alert" className="text-sm text-rose-400">
            {error}
            <button type="button" onClick={onRetry} className="ml-3 min-h-10 font-semibold underline">Tentar novamente</button>
          </div>
        )}

        {saved && (
          <>
            <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
              <div>
                <dt className="text-sm text-koma-muted">Recompensa vigente</dt>
                <dd className="mt-1 text-base font-semibold text-koma-foreground">{saved.tipo_recompensa === 'PONTOS' ? 'Pontos' : 'Cashback'}</dd>
              </div>
              <div>
                <dt className="text-sm text-koma-muted">A cada R$ 100 vendidos</dt>
                <dd className="mt-1 text-xl font-bold text-koma-foreground">{currency(effectiveLoyaltyPercent(saved))}</dd>
              </div>
              <div>
                <dt className="text-sm text-koma-muted">Podem resgatar agora</dt>
                <dd className="mt-1 text-xl font-bold text-emerald-400">{canRedeem} <span className="text-sm font-medium text-koma-muted">clientes</span></dd>
              </div>
              <div>
                <dt className="text-sm text-koma-muted">Ainda acumulando</dt>
                <dd className="mt-1 text-xl font-bold text-koma-foreground">{accumulating} <span className="text-sm font-medium text-koma-muted">clientes</span></dd>
              </div>
            </dl>
            <p className="text-sm text-koma-muted">
              {saved.ativo
                ? saved.tipo_recompensa === 'PONTOS'
                  ? `${percent(saved.taxa_conversao)} ponto(s) por R$ 1; cada ponto vale ${saved.valor_ponto_em_dinheiro.toLocaleString('pt-BR', {style:'currency',currency:'BRL',minimumFractionDigits:4})} no resgate.`
                  : `${percent(saved.taxa_conversao)}% em cashback nas vendas elegíveis.`
                : 'Novas vendas não geram pontos ou cashback enquanto o programa estiver pausado.'}
            </p>
          </>
        )}

        {dirty && (
          <p role="status" className="border-l-2 border-amber-400 pl-3 text-sm font-medium text-amber-300">
            Alterações pendentes — a regra mostrada acima continua vigente até o salvamento ser confirmado.
          </p>
        )}

        {saved && (
          <details className="rounded-xl border border-koma-border bg-koma-card p-3 sm:p-4">
            <summary className="min-h-10 cursor-pointer py-2 text-sm font-semibold text-koma-foreground focus-visible:outline-2 focus-visible:outline-emerald-500">
              Ajustar programa {dirty ? '· alterações pendentes' : ''}
            </summary>
            <form className="mt-4 space-y-4" onSubmit={e => { e.preventDefault(); if (dirty && !saving) setReviewing(true); }}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="text-base font-semibold text-koma-foreground">Alteração em preparação</h4>
                  <p className="text-sm text-koma-muted">Preencha, compare e confirme antes de ativar qualquer mudança.</p>
                </div>
                <label className="inline-flex min-h-11 items-center gap-2 text-sm text-koma-foreground">
                  <input type="checkbox" aria-label="Ativar programa de fidelidade"
                    checked={draft.ativo} disabled={saving}
                    onChange={e => update(prev => ({ ...prev, ativo: e.target.checked }))}
                    className="h-5 w-5 accent-emerald-500 focus-visible:outline-2 focus-visible:outline-emerald-500"/>
                  {draft.ativo ? 'Programa ativo no rascunho' : 'Pausar programa'}
                </label>
              </div>
              <label className="block max-w-sm text-sm font-medium text-koma-muted">
                Benefício oferecido
                <select aria-label="Benefício oferecido" value={draft.tipo_recompensa} disabled={saving}
                  onChange={e => update(prev => ({ ...prev, tipo_recompensa: e.target.value as LoyaltyConfig['tipo_recompensa'] }))}
                  className="mt-1 min-h-11 w-full rounded-lg border border-koma-border bg-koma-panel px-3 text-sm text-koma-foreground">
                  <option value="PONTOS">Pontos</option>
                  <option value="CASHBACK">Dinheiro de volta</option>
                </select>
              </label>
              {draft.ativo && (
                <GrowthEconomicsCalculator
                  apiBaseUrl={apiBaseUrl} authHeaders={authHeaders} compact
                  onApplyOption={applySuggestion}
                  currentEffectivePercent={effectiveLoyaltyPercent(saved)}
                  applyLabel={draft.tipo_recompensa === 'CASHBACK' ? 'Usar no cashback' : 'Usar nos pontos'}
                />
              )}
              <details className="rounded-xl border border-koma-border p-3">
                <summary className="min-h-10 cursor-pointer py-2 text-sm font-semibold text-koma-foreground focus-visible:outline-2 focus-visible:outline-emerald-500">
                  Ajustar a taxa manualmente
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm text-koma-muted">
                    {draft.tipo_recompensa === 'PONTOS' ? 'Pontos ganhos a cada R$ 1' : 'Percentual devolvido ao cliente'}
                    <input type="number" aria-label="Taxa de conversão da fidelidade" min="0" step="0.01"
                      value={draft.taxa_conversao} disabled={saving}
                      onChange={e => update(prev => ({ ...prev, taxa_conversao: Number(e.target.value) }))}
                      className="mt-1 min-h-11 w-full rounded-lg border border-koma-border bg-koma-panel px-3 font-mono text-sm text-koma-foreground"/>
                  </label>
                  {draft.tipo_recompensa === 'PONTOS' && (
                    <label className="block text-sm text-koma-muted">
                      Valor de cada ponto
                      <input type="number" aria-label="Valor de cada ponto" min="0" step="0.0001"
                        value={draft.valor_ponto_em_dinheiro} disabled={saving}
                        onChange={e => update(prev => ({ ...prev, valor_ponto_em_dinheiro: Number(e.target.value) }))}
                        className="mt-1 min-h-11 w-full rounded-lg border border-koma-border bg-koma-panel px-3 font-mono text-sm text-koma-foreground"/>
                    </label>
                  )}
                </div>
              </details>
              <p className="text-sm text-koma-muted">
                Os saldos concedidos permanecem registrados. Alterar o valor de cada ponto pode mudar quanto os pontos anteriores representam em reais. Pausar impede novos créditos e resgates.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={!dirty || saving}
                  onClick={() => { onDiscard(); setReviewing(false); setSimulation('vigente'); }}
                  className="koma-btn-secondary min-h-11 rounded-lg px-4 text-sm disabled:opacity-50">
                  Descartar alterações
                </button>
                <button type="submit" disabled={!dirty || saving}
                  className="koma-btn-primary min-h-11 rounded-lg px-4 text-sm font-semibold disabled:opacity-50">
                  Salvar programa
                </button>
              </div>
            </form>

            {reviewing && dirty && (
              <section aria-label="Confirmar mudança da fidelidade" className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
                <h4 className="text-base font-bold text-koma-foreground">Confirmar mudança?</h4>
                <p className="text-sm text-koma-foreground">
                  Vigente: {saved.ativo ? 'ativo' : 'pausado'} · {saved.tipo_recompensa === 'PONTOS' ? 'pontos' : 'cashback'} · {percent(effectiveLoyaltyPercent(saved))}% equivalente.
                </p>
                <p className="text-sm text-koma-foreground">
                  Proposta: {draft.ativo ? 'ativo' : 'pausado'} · {draft.tipo_recompensa === 'PONTOS' ? 'pontos' : 'cashback'} · {percent(effectiveLoyaltyPercent(draft))}% equivalente.
                </p>
                <p className="text-sm text-amber-300">
                  Afeta vendas futuras. Saldos já registrados não são zerados, mas alterações no valor do ponto podem afetar seu equivalente monetário.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setReviewing(false)} className="koma-btn-secondary min-h-11 rounded-lg px-4 text-sm">Voltar à edição</button>
                  <button type="button" disabled={saving} onClick={() => { setReviewing(false); void onSave(); }}
                    className="koma-btn-primary min-h-11 rounded-lg px-4 text-sm font-semibold disabled:opacity-50">
                    {saving ? 'Salvando…' : 'Confirmar e salvar'}
                  </button>
                </div>
              </section>
            )}
          </details>
        )}
      </section>

      {saved && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-koma-foreground">Simulação financeira</h3>
            {dirty && (
              <div role="group" aria-label="Cenário da simulação" className="flex gap-1 rounded-lg bg-koma-raised p-1">
                {(['vigente', 'rascunho'] as const).map(mode => (
                  <button key={mode} type="button" aria-pressed={simulation === mode}
                    onClick={() => setSimulation(mode)}
                    className={`min-h-10 rounded-md px-3 text-sm font-semibold ${simulation === mode ? 'bg-koma-panel text-emerald-400' : 'text-koma-muted'}`}>
                    {mode === 'vigente' ? 'Vigente' : 'Rascunho'}
                  </button>
                ))}
              </div>
            )}
          </div>
          <LoyaltyImpactPanel
            active={simulated?.ativo ?? false}
            rewardPercent={simulated ? effectiveLoyaltyPercent(simulated) : 0}
          />
        </section>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-koma-muted">
        <span>Resgate mínimo prático: R$ 1,00 na modalidade vigente. Saldo da modalidade anterior permanece registrado.</span>
        <button type="button" onClick={onOpenCustomers} className="koma-btn-secondary min-h-11 rounded-lg px-4 text-sm">Ver benefícios por cliente</button>
      </div>
    </div>
  );
}
