import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import type { B8DreResponse } from '../../contracts/b8Contracts';
import { snapshotFetch as fetch } from '../../utils/snapshotFetch';

interface RelatorioDreTabProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function isoTodayMinus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function RelatorioDreTab({ apiBaseUrl, authHeaders }: RelatorioDreTabProps) {
  const [dataInicio, setDataInicio] = useState(() => isoTodayMinus(29));
  const [dataFim, setDataFim] = useState(() => isoTodayMinus(0));
  const [data, setData] = useState<B8DreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDre = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ data_inicio: dataInicio, data_fim: dataFim }).toString();
      const res = await fetch(`${apiBaseUrl}/b8/financeiro/dre?${qs}`, { headers: authHeaders });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Erro ${res.status} ao carregar DRE.`);
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar DRE Gerencial.');
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, authHeaders, dataFim, dataInicio]);

  useEffect(() => {
    void loadDre();
  }, [loadDre]);

  const linhas = data?.linhas;

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
        </div>
        <div className="koma-toolbar__actions">
          <button type="button" onClick={() => void loadDre()} disabled={loading} className="koma-btn-secondary">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar DRE
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-200">
          {error}
        </div>
      )}

      {data && linhas && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-koma-border bg-koma-panel px-4 py-3">
            <div className="flex items-center gap-2.5">
              {data.status_completude === 'completo' ? (
                <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-300" />
              ) : (
                <AlertTriangle size={18} className="text-amber-600 dark:text-amber-300" />
              )}
              <div>
                <h3 className="text-sm font-bold text-koma-foreground">
                  DRE Gerencial · Regime de Competência
                </h3>
                <p className="text-[11px] text-koma-muted">
                  Cobertura de CMV histórico: <strong className="text-koma-foreground">{data.cobertura_cmv.itens_com_custo}/{data.cobertura_cmv.itens_totais}</strong> itens ({data.cobertura_cmv.cobertura_pct}%)
                </p>
              </div>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${
                data.status_completude === 'completo'
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
              }`}
            >
              {data.status_completude === 'completo' ? 'Dados completos' : 'DRE parcial'}
            </span>
          </div>

          {data.lacunas.length > 0 && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-1.5">
              <strong className="block text-xs font-bold text-amber-800 dark:text-amber-200">
                Lacunas detectadas (valores desconhecidos não são estimados como zero):
              </strong>
              <ul className="list-disc pl-5 text-xs text-amber-800/90 dark:text-amber-200/90 space-y-0.5">
                {data.lacunas.map((lacuna, idx) => (
                  <li key={idx}>{lacuna}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <article className="rounded-2xl border border-koma-border bg-koma-panel p-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-koma-muted">Receita Líquida</span>
              <strong className="mt-1 block font-mono text-lg text-koma-foreground">{currency.format(linhas.receita_liquida)}</strong>
              <span className="text-[11px] text-koma-muted">Bruta: {currency.format(linhas.receita_bruta)}</span>
            </article>
            <article className="rounded-2xl border border-koma-border bg-koma-panel p-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-koma-muted">CMV Histórico</span>
              <strong className="mt-1 block font-mono text-lg text-koma-foreground">{currency.format(linhas.cmv)}</strong>
              <span className="text-[11px] text-koma-muted">Compras em estoque não entram no CMV</span>
            </article>
            <article className="rounded-2xl border border-koma-border bg-koma-panel p-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-koma-muted">Lucro Bruto</span>
              <strong className="mt-1 block font-mono text-lg text-koma-foreground">{currency.format(linhas.lucro_bruto)}</strong>
              <span className="text-[11px] text-koma-muted">
                Margem bruta: {linhas.margem_bruta_pct !== null ? `${linhas.margem_bruta_pct}%` : '—'}
              </span>
            </article>
            <article className="rounded-2xl border border-koma-border bg-koma-panel p-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-koma-muted">Resultado Líquido</span>
              <strong
                className={`mt-1 flex items-center gap-1.5 font-mono text-lg ${
                  linhas.resultado_liquido_gerencial >= 0
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : 'text-rose-700 dark:text-rose-300'
                }`}
              >
                {linhas.resultado_liquido_gerencial >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                {currency.format(linhas.resultado_liquido_gerencial)}
              </strong>
              <span className="text-[11px] text-koma-muted">
                Margem líquida: {linhas.margem_liquida_pct !== null ? `${linhas.margem_liquida_pct}%` : '—'}
              </span>
            </article>
          </div>

          <section className="overflow-hidden rounded-2xl border border-koma-border bg-koma-panel">
            <header className="border-b border-koma-border bg-koma-raised/40 px-4 py-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-koma-foreground">Estrutura da DRE</h4>
            </header>
            <div className="divide-y divide-koma-border text-xs">
              {[
                { label: '(+) Receita Bruta Operacional', val: linhas.receita_vendas_operacionais },
                { label: '(+) Outras Receitas (Contas a Receber)', val: linhas.receitas_extras },
                { label: '(-) Deduções, Descontos e Estornos', val: -linhas.deducoes_total },
                { label: '(=) Receita Líquida', val: linhas.receita_liquida, strong: true },
                { label: '(-) CMV (Custo Histórico de Baixas)', val: -linhas.cmv },
                { label: '(=) Lucro Bruto', val: linhas.lucro_bruto, strong: true },
                { label: '(-) Despesas Operacionais (Competência)', val: -linhas.despesas_operacionais },
                { label: '(-) Tributos', val: -linhas.tributos },
                { label: '(=) Resultado Operacional', val: linhas.resultado_operacional, strong: true },
                { label: '(+/-) Resultado Financeiro (Juros / Descontos / Taxas)', val: linhas.resultado_financeiro },
                { label: '(=) Resultado Líquido Gerencial', val: linhas.resultado_liquido_gerencial, strong: true },
              ].map((row) => (
                <div
                  key={row.label}
                  className={`flex items-center justify-between px-4 py-2.5 ${row.strong ? 'bg-koma-raised/30 font-bold' : ''}`}
                >
                  <span className="text-koma-foreground">{row.label}</span>
                  <span className="font-mono text-koma-foreground">{currency.format(row.val)}</span>
                </div>
              ))}
            </div>
          </section>

          {data.despesas_por_categoria.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-koma-border bg-koma-panel">
              <header className="border-b border-koma-border bg-koma-raised/40 px-4 py-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-koma-foreground">Despesas por Categoria</h4>
              </header>
              <div className="divide-y divide-koma-border text-xs">
                {data.despesas_por_categoria.map((cat) => (
                  <div key={cat.categoria} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-koma-foreground">{cat.categoria}</span>
                    <span className="font-mono font-semibold text-koma-foreground">{currency.format(cat.valor)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
