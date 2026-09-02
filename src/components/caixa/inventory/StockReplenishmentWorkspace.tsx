import { FileUp, PackageCheck, ReceiptText, Truck } from 'lucide-react';
import type { Distribuidor, Insumo } from '../../../types';
import { formatCompactCurrency } from '../cashierPresentation';

type Props = {
  insumos: Insumo[];
  fornecedores: Distribuidor[];
  onRegisterEntry: () => void;
  onImportXml: () => void;
};

type ReplenishmentRow = {
  insumo: Insumo;
  suggestedQuantity: number;
  estimatedCost: number;
  urgency: 'critico' | 'baixo';
};

export function StockReplenishmentWorkspace({ insumos, fornecedores, onRegisterEntry, onImportXml }: Props) {
  const rows: ReplenishmentRow[] = insumos
    .filter((insumo) => Number(insumo.estoque_atual || 0) <= Number(insumo.estoque_minimo || 0))
    .map((insumo) => {
      const current = Number(insumo.estoque_atual || 0);
      const minimum = Number(insumo.estoque_minimo || 0);
      const maximum = Math.max(minimum, Number(insumo.estoque_maximo || minimum));
      const suggestedQuantity = Math.max(0, maximum - current);
      return {
        insumo,
        suggestedQuantity,
        estimatedCost: suggestedQuantity * Number(insumo.preco_medio_custo || 0),
        urgency: current < 0 ? 'critico' : 'baixo',
      };
    })
    .sort((a, b) => {
      if (a.urgency !== b.urgency) return a.urgency === 'critico' ? -1 : 1;
      return b.suggestedQuantity - a.suggestedQuantity;
    });

  const estimatedPurchase = rows.reduce((sum, row) => sum + row.estimatedCost, 0);
  const critical = rows.filter((row) => row.urgency === 'critico').length;
  const averageLeadTime = fornecedores.length
    ? Math.round(
        fornecedores.reduce((sum, fornecedor) => sum + Number(fornecedor.lead_time_dias || 0), 0) /
          fornecedores.length,
      )
    : 0;

  return (
    <section className="rounded-2xl border border-koma-border bg-koma-panel" aria-labelledby="replenishment-workspace-title">
      <div className="flex flex-col gap-4 border-b border-koma-border-subtle p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <p className="orders-eyebrow"><span /> COMPRA ORIENTADA PELO SALDO</p>
          <h3 id="replenishment-workspace-title" className="mt-1 text-sm font-black text-koma-foreground">O que comprar agora</h3>
          <p className="mt-1.5 text-[11px] leading-relaxed text-koma-muted">
            Em vez de separar “estoque baixo”, “lista de compra” e “entrada” em três telas, o Kôma reúne a decisão aqui e mantém o recebimento no fluxo já existente.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="koma-btn-secondary" onClick={onImportXml}>
            <FileUp size={13} /> Importar NF-e
          </button>
          <button type="button" className="koma-btn-success" onClick={onRegisterEntry}>
            <ReceiptText size={13} /> Registrar recebimento
          </button>
        </div>
      </div>

      <div className="grid gap-2 border-b border-koma-border-subtle p-4 sm:grid-cols-4 sm:p-5">
        <div className="rounded-xl border border-koma-border-subtle bg-koma-canvas/45 p-3">
          <span className="text-[9px] font-bold uppercase tracking-wide text-koma-muted">Para repor</span>
          <strong className="mt-1 block font-mono text-lg text-koma-foreground">{rows.length}</strong>
        </div>
        <div className="rounded-xl border border-koma-border-subtle bg-koma-canvas/45 p-3">
          <span className="text-[9px] font-bold uppercase tracking-wide text-koma-muted">Críticos</span>
          <strong className={"mt-1 block font-mono text-lg " + (critical > 0 ? 'text-rose-600 dark:text-rose-300' : 'text-koma-foreground')}>{critical}</strong>
        </div>
        <div className="rounded-xl border border-koma-border-subtle bg-koma-canvas/45 p-3">
          <span className="text-[9px] font-bold uppercase tracking-wide text-koma-muted">Compra estimada</span>
          <strong className="mt-1 block font-mono text-lg text-koma-foreground">{formatCompactCurrency(estimatedPurchase)}</strong>
        </div>
        <div className="rounded-xl border border-koma-border-subtle bg-koma-canvas/45 p-3">
          <span className="text-[9px] font-bold uppercase tracking-wide text-koma-muted">Prazo médio</span>
          <strong className="mt-1 block font-mono text-lg text-koma-foreground">{fornecedores.length ? `${averageLeadTime} d` : '—'}</strong>
          <span className="text-[9px] text-koma-subtle">{fornecedores.length} fornecedores</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-5 py-9 text-center">
          <PackageCheck size={24} className="text-emerald-600 dark:text-emerald-300" />
          <strong className="text-sm text-koma-foreground">Nenhuma reposição urgente</strong>
          <p className="max-w-md text-[10px] text-koma-muted">Todos os ingredientes estão acima do estoque mínimo configurado.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[10px]">
            <thead className="border-b border-koma-border-subtle bg-koma-canvas/35 text-[9px] uppercase tracking-wide text-koma-muted">
              <tr>
                <th className="px-4 py-2.5 font-bold">Ingrediente</th>
                <th className="px-4 py-2.5 font-bold">Saldo</th>
                <th className="px-4 py-2.5 font-bold">Mín. / máx.</th>
                <th className="px-4 py-2.5 font-bold">Sugestão</th>
                <th className="px-4 py-2.5 font-bold">Custo estimado</th>
                <th className="px-4 py-2.5 font-bold">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-koma-border-subtle">
              {rows.map(({ insumo, suggestedQuantity, estimatedCost, urgency }) => (
                <tr key={insumo.id} className="text-koma-secondary">
                  <td className="px-4 py-3 font-semibold text-koma-foreground">{insumo.nome}</td>
                  <td className="px-4 py-3 font-mono">{Number(insumo.estoque_atual || 0).toLocaleString('pt-BR')} {insumo.unidade_medida}</td>
                  <td className="px-4 py-3 font-mono">{Number(insumo.estoque_minimo || 0).toLocaleString('pt-BR')} / {Number(insumo.estoque_maximo || 0).toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-3 font-mono font-bold text-koma-foreground">+{suggestedQuantity.toLocaleString('pt-BR')} {insumo.unidade_medida}</td>
                  <td className="px-4 py-3 font-mono">{formatCompactCurrency(estimatedCost)}</td>
                  <td className="px-4 py-3">
                    <span className={"inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-bold " + (urgency === 'critico' ? 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-200' : 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-200')}>
                      <Truck size={10} /> {urgency === 'critico' ? 'Crítico' : 'Repor'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
