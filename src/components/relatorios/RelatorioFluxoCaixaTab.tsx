import { useCallback, useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Info, RefreshCw, Wallet } from 'lucide-react';
import type { B8FluxoCaixaResponse } from '../../contracts/b8Contracts';
import { snapshotFetch as fetch } from '../../utils/snapshotFetch';

interface RelatorioFluxoCaixaTabProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function isoTodayMinus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function RelatorioFluxoCaixaTab({ apiBaseUrl, authHeaders }: RelatorioFluxoCaixaTabProps) {
  const [dataInicio, setDataInicio] = useState(() => isoTodayMinus(29));
  const [dataFim, setDataFim] = useState(() => isoTodayMinus(0));
  const [contaId, setContaId] = useState('');
  const [data, setData] = useState<B8FluxoCaixaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFluxo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ data_inicio: dataInicio, data_fim: dataFim });
      if (contaId) params.set('conta_financeira_id', contaId);
      const res = await fetch(`${apiBaseUrl}/b8/financeiro/fluxo-caixa?${params.toString()}`, { headers: authHeaders });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Erro ${res.status} ao carregar Fluxo de Caixa.`);
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar Fluxo de Caixa.');
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, authHeaders, contaId, dataFim, dataInicio]);

  useEffect(() => {
    void loadFluxo();
  }, [loadFluxo]);

  return (
    <div className="space-y-4 text-left animate-fade-in">
      <section className="koma-toolbar">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[11px] font-semibold text-koma-muted">
            Início
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="ml-2 min-h-9 rounded-xl border border-koma-border bg-koma-input px-2.5 text-xs text-koma-foreground"
            />
          </label>
          <label className="text-[11px] font-semibold text-koma-muted">
            Fim
            <input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
              className="ml-2 min-h-9 rounded-xl border border-koma-border bg-koma-input px-2.5 text-xs text-koma-foreground"
            />
          </label>
          {data && data.contas.length > 0 && (
            <select
              value={contaId}
              onChange={(e) => setContaId(e.target.value)}
              aria-label="Filtrar por conta financeira"
              className="koma-toolbar__select"
            >
              <option value="">Todas as contas</option>
              {data.contas.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          )}
        </div>
        <div className="koma-toolbar__actions">
          <button type="button" onClick={() => void loadFluxo()} disabled={loading} className="koma-btn-secondary">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar Fluxo
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-200">
          {error}
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <article className="rounded-2xl border border-koma-border bg-koma-panel p-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-koma-muted">Saldo Inicial</span>
              <strong className="mt-1 block font-mono text-lg text-koma-foreground">{currency.format(data.saldo_inicial)}</strong>
              <span className="text-[11px] text-koma-muted">Continuidade do período anterior</span>
            </article>
            <article className="rounded-2xl border border-koma-border bg-koma-panel p-4">
              <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                <ArrowDownLeft size={12} /> Entradas Realizadas
              </span>
              <strong className="mt-1 block font-mono text-lg text-koma-foreground">{currency.format(data.entradas_realizadas)}</strong>
              <span className="text-[11px] text-koma-muted">
                Dinheiro {currency.format(data.entradas_operacionais_por_meio.dinheiro)} · Pix {currency.format(data.entradas_operacionais_por_meio.pix)}
              </span>
            </article>
            <article className="rounded-2xl border border-koma-border bg-koma-panel p-4">
              <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">
                <ArrowUpRight size={12} /> Saídas Realizadas
              </span>
              <strong className="mt-1 block font-mono text-lg text-koma-foreground">{currency.format(data.saidas_realizadas)}</strong>
              <span className="text-[11px] text-koma-muted">Baixas e despesas pagas</span>
            </article>
            <article className="rounded-2xl border border-koma-border bg-koma-panel p-4">
              <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-koma-muted">
                <Wallet size={12} /> Saldo Realizado
              </span>
              <strong className="mt-1 block font-mono text-lg text-koma-foreground">{currency.format(data.saldo_final_realizado)}</strong>
              <span className="text-[11px] text-koma-muted">
                Projetado (com abertos): {currency.format(data.saldo_projetado)}
              </span>
            </article>
          </div>

          {data.aviso_cartao && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-koma-border bg-koma-raised/50 p-3.5 text-xs text-koma-muted">
              <Info size={16} className="mt-0.5 shrink-0 text-koma-foreground" />
              <div>
                <strong className="text-koma-foreground">
                  Cartão aprovado no PDV ({currency.format(data.entradas_operacionais_por_meio.cartao)}):
                </strong>{' '}
                {data.aviso_cartao}
              </div>
            </div>
          )}

          <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 text-xs space-y-2">
            <h4 className="font-bold text-koma-foreground">Previsto no período (Contas em aberto)</h4>
            <div className="flex flex-wrap gap-6 text-koma-muted">
              <span>A receber em aberto: <strong className="font-mono text-koma-foreground">{currency.format(data.entradas_previstas)}</strong></span>
              <span>A pagar em aberto: <strong className="font-mono text-koma-foreground">{currency.format(data.saidas_previstas)}</strong></span>
              <span>Entradas financeiras (baixas/aportes): <strong className="font-mono text-koma-foreground">{currency.format(data.entradas_financeiras)}</strong></span>
            </div>
          </section>

          {data.vencimentos_futuros.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-koma-border bg-koma-panel">
              <header className="border-b border-koma-border bg-koma-raised/40 px-4 py-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-koma-foreground">Vencimentos previstos</h4>
              </header>
              <div className="divide-y divide-koma-border text-xs">
                {data.vencimentos_futuros.map((v) => (
                  <div key={`${v.tipo}-${v.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div>
                      <strong className="text-koma-foreground">{v.descricao}</strong>
                      <span className="ml-2 text-[11px] text-koma-muted">
                        {v.tipo === 'pagar' ? 'A pagar' : 'A receber'} · Venc. {v.data_vencimento}
                        {v.atrasado ? ' (em atraso)' : ''}
                      </span>
                    </div>
                    <span className="font-mono font-semibold text-koma-foreground">
                      {v.tipo === 'pagar' ? '-' : '+'}{currency.format(v.valor_aberto)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="overflow-hidden rounded-2xl border border-koma-border bg-koma-panel">
            <header className="border-b border-koma-border bg-koma-raised/40 px-4 py-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-koma-foreground">Movimentações realizadas no período</h4>
            </header>
            {data.movimentacoes.length === 0 ? (
              <p className="p-6 text-center text-xs text-koma-muted">Nenhuma movimentação financeira registrada no período.</p>
            ) : (
              <div className="divide-y divide-koma-border text-xs">
                {data.movimentacoes.map((mov) => (
                  <div key={mov.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div>
                      <strong className="text-koma-foreground">{mov.descricao}</strong>
                      <span className="ml-2 text-[11px] text-koma-muted">{mov.data} · {mov.tipo}</span>
                    </div>
                    <span className="font-mono font-semibold text-koma-foreground">{currency.format(mov.valor)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
