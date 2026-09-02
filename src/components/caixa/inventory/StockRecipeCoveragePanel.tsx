import { AlertTriangle, CheckCircle2, Link2 } from 'lucide-react';
import type { FichaTecnicaProduto, Insumo, Product } from '../../../types';
import { formatCompactCurrency } from '../cashierPresentation';

type Props = {
  products: Product[];
  fichas: FichaTecnicaProduto[];
  insumos: Insumo[];
  onEdit: () => void;
};

export function StockRecipeCoveragePanel({ products, fichas, insumos, onEdit }: Props) {
  const activeProducts = products.filter((product) => product.ativo !== false);
  const configured = fichas.filter((ficha) => ficha.produto_ativo && ficha.itens.length > 0);
  const configuredIds = new Set(configured.map((ficha) => ficha.produto_id));
  const missing = activeProducts.filter((product) => !configuredIds.has(product.id));
  const costByIngredient = new Map(insumos.map((insumo) => [insumo.id, Number(insumo.preco_medio_custo || 0)]));
  const configuredCost = configured.reduce(
    (total, ficha) =>
      total +
      ficha.itens.reduce(
        (sum, item) => sum + Number(item.quantidade || 0) * Number(costByIngredient.get(item.insumo_id) || 0),
        0,
      ),
    0,
  );
  const coverage = activeProducts.length === 0 ? 0 : Math.round((configured.length / activeProducts.length) * 100);

  return (
    <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5" aria-labelledby="recipe-coverage-title">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <p className="orders-eyebrow"><span /> CONSUMO AUTOMÁTICO</p>
          <h3 id="recipe-coverage-title" className="mt-1 flex items-center gap-2 text-sm font-black text-koma-foreground">
            <Link2 size={16} className="text-emerald-600 dark:text-emerald-300" /> Fichas técnicas sem virar outra planilha
          </h3>
          <p className="mt-1.5 text-[11px] leading-relaxed text-koma-muted">
            Veja só o que falta ligar às vendas. Quantidade e custo continuam sendo editados no mesmo fluxo de ficha técnica.
          </p>
        </div>
        <button type="button" className="koma-btn-secondary shrink-0" onClick={onEdit}>
          <Link2 size={13} /> Editar fichas
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-koma-border-subtle bg-koma-canvas/45 p-3">
          <span className="text-[9px] font-bold uppercase tracking-wide text-koma-muted">Cobertura</span>
          <strong className="mt-1 block font-mono text-lg text-koma-foreground">{coverage}%</strong>
          <span className="text-[9px] text-koma-subtle">{configured.length}/{activeProducts.length} produtos ativos</span>
        </div>
        <div className="rounded-xl border border-koma-border-subtle bg-koma-canvas/45 p-3">
          <span className="text-[9px] font-bold uppercase tracking-wide text-koma-muted">Sem ficha</span>
          <strong className={"mt-1 block font-mono text-lg " + (missing.length > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-300')}>{missing.length}</strong>
          <span className="text-[9px] text-koma-subtle">produtos sem baixa automática</span>
        </div>
        <div className="rounded-xl border border-koma-border-subtle bg-koma-canvas/45 p-3">
          <span className="text-[9px] font-bold uppercase tracking-wide text-koma-muted">Custo mapeado</span>
          <strong className="mt-1 block font-mono text-lg text-koma-foreground">{formatCompactCurrency(configuredCost)}</strong>
          <span className="text-[9px] text-koma-subtle">soma do custo unitário das fichas</span>
        </div>
      </div>

      {missing.length > 0 ? (
        <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
          <div className="flex items-center gap-2 text-[10px] font-bold text-amber-700 dark:text-amber-200">
            <AlertTriangle size={13} /> Prioridade: ligar {missing.length} {missing.length === 1 ? 'produto' : 'produtos'} ao estoque
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {missing.slice(0, 8).map((product) => (
              <span key={product.id} className="rounded-full border border-koma-border bg-koma-raised px-2.5 py-1 text-[9px] text-koma-secondary">
                {product.nome}
              </span>
            ))}
            {missing.length > 8 && (
              <span className="rounded-full px-2.5 py-1 text-[9px] font-bold text-koma-muted">+{missing.length - 8}</span>
            )}
          </div>
        </div>
      ) : activeProducts.length > 0 ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-[10px] font-semibold text-emerald-700 dark:text-emerald-200">
          <CheckCircle2 size={14} /> Todos os produtos ativos já possuem ficha técnica.
        </div>
      ) : null}
    </section>
  );
}
